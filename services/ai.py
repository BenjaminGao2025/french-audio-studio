"""The AGY gateway (OpenAI-compatible Gemini): which key to send upstream, per-user rate limits,
and one chat call with a retry and learner-safe errors."""

from __future__ import annotations

import os
from typing import Annotated

import httpx
from fastapi import HTTPException
from pydantic import Field

import auth_db
from web_common import SIGNED_OUT_DETAIL, _bearer_value, rate_limit

# Every AI call goes to the AGY (Antigravity) adapter: an OpenAI-compatible Gemini gateway.
AGY_BASE_URL = os.getenv("AGY_BASE_URL", "http://127.0.0.1:8645/v1").rstrip("/")
AGY_MODEL = os.getenv("AGY_MODEL", "gemini-3.8-flash-low")
# Sent on every AGY call unless a payload sets its own. Empty / "none" / "off" disables it.
AGY_REASONING_EFFORT = os.getenv("AGY_REASONING_EFFORT", "low").strip()
# The model id clients see. Browsers may still hold an older model name (a Perplexity-era one):
# every name is accepted, and AGY_MODEL answers it.
DEFAULT_MODEL = "gemini-3.8-flash"
MODEL_LABELS = {DEFAULT_MODEL: "Gemini 3.8 Flash (AGY)"}
# Stays under the ~100s Cloudflare tunnel limit.
UPSTREAM_TIMEOUT_SECONDS = float(os.getenv("UPSTREAM_TIMEOUT_SECONDS", "90"))

# Any name: one an old browser saved must never 422. The value is not forwarded upstream.
TransformModel = Annotated[str, Field(max_length=100)]


SERVER_WEB2API_KEY = os.getenv("WEB2API_API_KEY", "")


def upstream_key(authorization: str | None) -> str:
    """The key to send upstream for this request: the server's own, for a signed-in, active user.

    Also spends one token of the user's "ai" rate-limit bucket. A token that is not a valid session is
    never forwarded as an API key (that once made every AI endpoint an anonymous proxy to the gateway).
    """
    token = _bearer_value(authorization)  # same parsing as every other signed-in route
    if not token:
        raise HTTPException(status_code=401, detail={"code": "missing_api_key", "message": "请先登录账号。"})
    user_payload = auth_db.verify_token(token)
    if not user_payload:
        if auth_db.is_signed_out_token(token):
            raise HTTPException(status_code=401, detail=SIGNED_OUT_DETAIL)
        raise HTTPException(status_code=401, detail={"code": "login_required", "message": "请先登录账号。"})
    rate_limit(int(user_payload["sub"]), "ai")
    user_info = auth_db.get_user_status(user_payload["sub"])
    if not user_info or not user_info.get("is_valid"):
        raise HTTPException(
            status_code=403,
            detail={"code": "trial_expired", "message": "您的 60 天免费试用期已结束，请联系站长续期。"},
        )
    if not SERVER_WEB2API_KEY:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "server_key_missing",
                "message": "服务器尚未配置上游 API Key（WEB2API_API_KEY），请联系站长。",
            },
        )
    return SERVER_WEB2API_KEY


TRIAL_ENDED_MESSAGE = "试用已结束：AI 批改暂时不可用。请联系站长续期后再试。"
FEEDBACK_FAILED_MESSAGE = "AI 批改暂时失败，请稍后点「重试」。"
INTERRUPTED_MESSAGE = "服务重启，本次批改被中断，请点「重试」重新提交。"


def feedback_error_message(exc: Exception) -> str:
    """Never show raw upstream errors to learners; details go to the log."""
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and detail.get("code") in {
            "trial_expired",
            "server_key_missing",
            "missing_api_key",
        }:
            return TRIAL_ENDED_MESSAGE
        if exc.status_code == 429:
            return "AI 服务繁忙，请稍后点「重试」。"
    return FEEDBACK_FAILED_MESSAGE


def upstream_error(response: httpx.Response) -> HTTPException:
    code = "upstream_error"
    message = f"AI 服务返回 HTTP {response.status_code}。"
    try:
        payload = response.json()
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
        if isinstance(error, dict):
            code = str(error.get("code") or code)
            message = str(error.get("message") or message)
    except ValueError:
        pass

    if response.status_code == 401:
        # The only key sent upstream is the server's own, so this is a server problem.
        return HTTPException(
            status_code=503,
            detail={"code": code, "message": "AI 服务拒绝了服务器的密钥，请联系站长。"},
        )
    if response.status_code == 429:
        return HTTPException(
            status_code=429,
            detail={"code": code, "message": "AI 服务请求过多，请稍后重试。"},
        )
    return HTTPException(
        status_code=502,
        detail={"code": code, "message": message},
    )


async def post_chat(client: httpx.AsyncClient, payload: dict, headers: dict[str, str]) -> tuple[dict, str]:
    # Copy so the caller's dict stays untouched, and never override an explicit value.
    requested = dict(payload)
    effort = AGY_REASONING_EFFORT.lower()
    if effort and effort not in ("none", "off") and "reasoning_effort" not in requested:
        requested["reasoning_effort"] = AGY_REASONING_EFFORT
    for upstream_attempt in range(2):
        try:
            response = await client.post(
                f"{AGY_BASE_URL}/chat/completions",
                headers=headers,
                json=requested,
            )
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail={
                    "code": "upstream_timeout",
                    "message": "AI 处理超时，请缩短文本或稍后重试。",
                },
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "upstream_unreachable",
                    "message": "无法连接 AI 服务（AGY）。",
                },
            ) from exc
        if response.status_code >= 500 and upstream_attempt == 0:
            continue
        break

    if response.status_code >= 400:
        raise upstream_error(response)

    try:
        body = response.json()
        raw_text = str(body["choices"][0]["message"]["content"])
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "invalid_upstream_response",
                "message": "AI 服务返回了无法识别的内容。",
            },
        ) from exc
    if not raw_text.strip():
        raise HTTPException(
            status_code=502,
            detail={"code": "empty_upstream_response", "message": "模型没有返回内容，请再试一次。"},
        )
    return body, raw_text
