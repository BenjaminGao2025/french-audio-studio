"""Account routes: register, login, session cookie, logout, signed-in devices."""

from __future__ import annotations

import os
import time

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import auth_db
from web_common import (
    _bearer_value,
    _clear_session_cookie,
    _require_user_id,
    _session_value,
    _set_session_cookie,
    client_ip,
    rate_limit,
)

router = APIRouter()

# Sign in with Google shows only when this OAuth client ID (type "Web application") is set.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class AuthRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(AuthRequest):
    invite_code: str = ""


class GoogleRequest(BaseModel):
    credential: str
    invite_code: str = ""


async def _google_tokeninfo(credential: str) -> dict:
    """Google checks the ID token's signature and expiry; we check it was issued for this site."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential})
    if response.status_code != 200:
        return {}
    return response.json()


def _verified_google_email(info: dict) -> str | None:
    if not GOOGLE_CLIENT_ID or info.get("aud") != GOOGLE_CLIENT_ID or info.get("iss") not in GOOGLE_ISSUERS:
        return None
    if str(info.get("email_verified", "")).lower() != "true":
        return None
    try:
        if int(info.get("exp", 0)) <= time.time():
            return None
    except (TypeError, ValueError):
        return None
    email = info.get("email")
    return email if isinstance(email, str) and email else None


def _auth_response(payload: dict, request: Request) -> JSONResponse:
    response = JSONResponse(payload)
    token = payload.get("token")
    if isinstance(token, str) and token:
        _set_session_cookie(response, token, request)
    return response


def _limit_attempts(request: Request, email: str) -> None:
    """Sign-in and sign-up cost a deliberately slow hash: cap them per client IP and per email."""
    rate_limit(f"ip:{client_ip(request)}", "auth_ip")
    rate_limit(f"email:{email.strip().lower()}", "auth_email")


def _device_label(user_agent: str) -> str:
    """A short, human name for the device a login came from, e.g. "Chrome · Android"."""
    ua = user_agent or ""
    browsers = [
        ("Edg/", "Edge"),
        ("MicroMessenger", "WeChat"),
        ("Firefox/", "Firefox"),
        ("CriOS", "Chrome"),
        ("Chrome/", "Chrome"),
        ("Safari/", "Safari"),
    ]
    systems = [
        ("iPhone", "iPhone"),
        ("iPad", "iPad"),
        ("Android", "Android"),
        ("Windows", "Windows"),
        ("Mac OS X", "Mac"),
        ("Linux", "Linux"),
    ]
    browser = next((name for key, name in browsers if key in ua), "")
    system = next((name for key, name in systems if key in ua), "")
    return " · ".join(part for part in (browser, system) if part) or "Unknown device"


@router.post("/api/auth/register")
async def register_account(req: RegisterRequest, request: Request):
    # Closed sign-up still lets people in with an invite code; a bad code is a 400 below
    invite = req.invite_code.strip()
    if not auth_db.ALLOW_REGISTRATION and not invite:
        raise HTTPException(status_code=403, detail={"message": "本站暂不开放注册。"})
    _limit_attempts(request, req.email)
    device = _device_label(request.headers.get("user-agent", ""))
    try:
        # The password hash takes a few hundred ms of CPU: keep it off the event loop
        account = await run_in_threadpool(auth_db.register_user, req.email, req.password, device, invite or None)
        return _auth_response(account, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})


@router.post("/api/auth/login")
async def login_account(req: AuthRequest, request: Request):
    _limit_attempts(request, req.email)
    try:
        device = _device_label(request.headers.get("user-agent", ""))
        account = await run_in_threadpool(auth_db.login_user, req.email, req.password, device)
        return _auth_response(account, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})


@router.get("/api/auth/options")
async def auth_options():
    return {"google_client_id": GOOGLE_CLIENT_ID or None}


@router.post("/api/auth/google")
async def google_login(req: GoogleRequest, request: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=404, detail={"message": "Sign in with Google isn’t set up."})
    rate_limit(f"ip:{client_ip(request)}", "auth_ip")
    if not req.credential or len(req.credential) > 4096:
        raise HTTPException(status_code=400, detail={"message": "Google sign-in didn’t finish. Please try again."})
    try:
        info = await _google_tokeninfo(req.credential)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail={"message": "Couldn’t reach Google. Please try again."})
    email = _verified_google_email(info)
    if not email:
        raise HTTPException(status_code=400, detail={"message": "Google couldn’t confirm this account. Please try again."})
    device = _device_label(request.headers.get("user-agent", ""))
    try:
        account = await run_in_threadpool(auth_db.google_sign_in, email, device, req.invite_code.strip() or None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})
    return _auth_response(account, request)


@router.post("/api/auth/session")
async def refresh_session(request: Request, authorization: str | None = Header(default=None)):
    """Turn an existing bearer token into the cookie that audio requests can carry."""
    token = _bearer_value(authorization)
    if not auth_db.verify_token(token):
        raise HTTPException(
            status_code=401,
            detail={"code": "login_required", "message": "请先登录账号。"},
        )
    response = Response(status_code=204)
    _set_session_cookie(response, token, request)
    return response


@router.post("/api/auth/logout")
async def logout_account(request: Request, authorization: str | None = Header(default=None)):
    payload = auth_db.verify_token(_session_value(authorization, request))
    if payload:
        auth_db.end_session(int(payload["sub"]), payload["sid"])
    response = Response(status_code=204)
    _clear_session_cookie(response, request)
    return response


@router.get("/api/auth/me")
async def get_current_user(authorization: str | None = Header(default=None)):
    status = auth_db.get_user_status(_require_user_id(authorization))
    if not status:
        raise HTTPException(status_code=404, detail={"message": "账号不存在"})
    return status


@router.get("/api/auth/devices")
async def list_devices(request: Request, authorization: str | None = Header(default=None)):
    token = _session_value(authorization, request)
    user_id = _require_user_id(authorization, request)
    current = (auth_db.verify_token(token) or {}).get("sid")
    devices = [{**session, "current": session["id"] == current} for session in auth_db.list_sessions(user_id)]
    return {"devices": devices, "max_devices": auth_db.device_limit(user_id)}


@router.delete("/api/auth/devices/{session_id}")
async def sign_out_device(session_id: str, request: Request, authorization: str | None = Header(default=None)):
    return {"success": auth_db.end_session(_require_user_id(authorization, request), session_id)}
