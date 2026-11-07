"""Paths, limits and request helpers shared by the routers and services (sessions, cookies, user id)."""

from __future__ import annotations

import asyncio
import os
import threading
import time
from collections.abc import Coroutine
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import Response

import auth_db

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(BASE_DIR / "outputs"))).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "15000"))

SIGNED_OUT_DETAIL = {
    "code": "session_revoked",
    "message": "这台设备已退出登录：账号最多同时登录 3 台设备，可能是在别的设备上登录了。请重新登录。",
}

SESSION_COOKIE = "fas_session"
SESSION_MAX_AGE = 90 * 24 * 3600


def _bearer_value(authorization: str | None) -> str:
    if not authorization:
        return ""
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return authorization.strip()


def _session_value(authorization: str | None, request: Request | None = None) -> str:
    header = _bearer_value(authorization)
    if header:
        return header
    if request is not None:
        return request.cookies.get(SESSION_COOKIE, "")
    return ""


_TRUSTED_PROXY_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _cookie_secure(request: Request) -> bool:
    # Only trust X-Forwarded-Proto from the local reverse proxy (cloudflared on loopback).
    client_host = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-proto", "") if client_host in _TRUSTED_PROXY_HOSTS else ""
    proto = (forwarded or request.url.scheme).split(",")[0].strip().lower()
    return proto == "https"


def _set_session_cookie(response: Response, token: str, request: Request) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
        path="/",
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
    )


def _require_user_id(authorization: str | None, request: Request | None = None) -> int:
    token = _session_value(authorization, request)
    payload = auth_db.verify_token(token)
    if not payload and auth_db.is_signed_out_token(token):
        raise HTTPException(status_code=401, detail=SIGNED_OUT_DETAIL)
    if not payload:
        raise HTTPException(
            status_code=401,
            detail={"code": "login_required", "message": "请先登录账号。"},
        )
    return int(payload["sub"])


def _normalized_text(value: str) -> str:
    text = value.strip()
    if not text:
        raise HTTPException(status_code=422, detail="请输入需要处理的文本。")
    return text


# Strong references to fire-and-forget jobs (feedback rounds, episode renders): the event loop only
# keeps weak ones, so an unreferenced task can be garbage-collected mid-run.
_background_tasks: set[asyncio.Task] = set()


def run_in_background(coro: Coroutine) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def client_ip(request: Request) -> str:
    """The visitor's IP. Behind the Cloudflare tunnel every request arrives from loopback, so
    CF-Connecting-IP is trusted only then; anyone else could set it to dodge a per-IP limit."""
    host = request.client.host if request.client else ""
    if host in _TRUSTED_PROXY_HOSTS:
        return request.headers.get("cf-connecting-ip", "").strip() or host
    return host


# ---------------------------------------------------------------------------
# Rate limiting: in-memory token buckets. One process, so a dict is enough.
# ---------------------------------------------------------------------------
RATE_LIMITS: dict[str, tuple[float, float]] = {
    # bucket: (capacity, refill tokens per second)
    "ai": (float(os.getenv("RATE_AI_BURST", "40")), float(os.getenv("RATE_AI_PER_MIN", "30")) / 60),
    "speech": (float(os.getenv("RATE_SPEECH_BURST", "120")), float(os.getenv("RATE_SPEECH_PER_MIN", "60")) / 60),
    "transcribe": (float(os.getenv("RATE_ASR_BURST", "10")), float(os.getenv("RATE_ASR_PER_MIN", "6")) / 60),
    "episode": (float(os.getenv("RATE_EPISODE_BURST", "3")), float(os.getenv("RATE_EPISODE_PER_HOUR", "6")) / 3600),
    # Sign-in / sign-up attempts, per client IP and per email: slows password guessing (and the CPU it costs)
    # while leaving room for a family behind one IP and a few mistyped passwords.
    "auth_ip": (float(os.getenv("RATE_AUTH_IP_BURST", "20")), float(os.getenv("RATE_AUTH_IP_PER_HOUR", "30")) / 3600),
    "auth_email": (
        float(os.getenv("RATE_AUTH_EMAIL_BURST", "8")),
        float(os.getenv("RATE_AUTH_EMAIL_PER_HOUR", "6")) / 3600,
    ),
    "waitlist": (5.0, 5 / 3600),
    # Dictation checks are local (no AI): roomy, but a script cannot fill the history table
    "dictation": (
        float(os.getenv("RATE_DICTATION_BURST", "60")),
        float(os.getenv("RATE_DICTATION_PER_MIN", "40")) / 60,
    ),
    # The optional AI review, on top of the shared "ai" bucket
    "dictation_ai": (
        float(os.getenv("RATE_DICTATION_AI_BURST", "10")),
        float(os.getenv("RATE_DICTATION_AI_PER_HOUR", "40")) / 3600,
    ),
    # Fixed expressions of an older sentence (one model call per user and sentence, then cached),
    # on top of the shared "ai" bucket
    "phrase_ai": (
        float(os.getenv("RATE_PHRASE_AI_BURST", "20")),
        float(os.getenv("RATE_PHRASE_AI_PER_HOUR", "60")) / 3600,
    ),
}
_rate_buckets: dict[tuple[object, str], tuple[float, float]] = {}
_rate_lock = threading.Lock()


def rate_limit(key: object, bucket: str) -> None:
    """Spend one token of `key`'s bucket (a user id, "ip:..." or "email:..."), or raise a 429."""
    capacity, refill = RATE_LIMITS[bucket]
    now = time.monotonic()
    with _rate_lock:
        tokens, last = _rate_buckets.get((key, bucket), (capacity, now))
        tokens = min(capacity, tokens + (now - last) * refill)
        if tokens < 1:
            wait = max(1, int((1 - tokens) / refill) + 1) if refill > 0 else 60
            _rate_buckets[(key, bucket)] = (tokens, now)
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "rate_limited",
                    "message": f"操作太频繁了，请等 {wait} 秒后再试。",
                    "retry_after": wait,
                },
                headers={"Retry-After": str(wait)},
            )
        _rate_buckets[(key, bucket)] = (tokens - 1, now)
        if len(_rate_buckets) > 20000:  # drop idle entries (a bucket idle for an hour has refilled anyway)
            for stale in [k for k, (_, t) in _rate_buckets.items() if now - t > 3600]:
                _rate_buckets.pop(stale, None)
