"""Settings and request helpers shared by tts_service.py and the routers."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import Response

import auth_db

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(BASE_DIR / "outputs"))).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
