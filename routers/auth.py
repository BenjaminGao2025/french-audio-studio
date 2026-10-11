"""Account routes: register, login, session cookie, logout, signed-in devices."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import auth_db
from web_common import (
    _bearer_value,
    _clear_session_cookie,
    _require_user_id,
    _session_value,
    _set_session_cookie,
)

router = APIRouter()


class AuthRequest(BaseModel):
    email: str
    password: str


def _auth_response(payload: dict, request: Request) -> JSONResponse:
    response = JSONResponse(payload)
    token = payload.get("token")
    if isinstance(token, str) and token:
        _set_session_cookie(response, token, request)
    return response


def _device_label(user_agent: str) -> str:
    """A short, human name for the device a login came from, e.g. "Chrome · Android"."""
    ua = user_agent or ""
    browsers = [("Edg/", "Edge"), ("MicroMessenger", "WeChat"), ("Firefox/", "Firefox"),
                ("CriOS", "Chrome"), ("Chrome/", "Chrome"), ("Safari/", "Safari")]
    systems = [("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"),
               ("Windows", "Windows"), ("Mac OS X", "Mac"), ("Linux", "Linux")]
    browser = next((name for key, name in browsers if key in ua), "")
    system = next((name for key, name in systems if key in ua), "")
    return " · ".join(part for part in (browser, system) if part) or "Unknown device"


@router.post("/api/auth/register")
async def register_account(req: AuthRequest, request: Request):
    if not auth_db.ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail={"message": "本站暂不开放注册。"})
    device = _device_label(request.headers.get("user-agent", ""))
    try:
        return _auth_response(auth_db.register_user(req.email, req.password, device), request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})


@router.post("/api/auth/login")
async def login_account(req: AuthRequest, request: Request):
    try:
        device = _device_label(request.headers.get("user-agent", ""))
        return _auth_response(auth_db.login_user(req.email, req.password, device), request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})


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
    devices = [
        {**session, "current": session["id"] == current} for session in auth_db.list_sessions(user_id)
    ]
    return {"devices": devices, "max_devices": auth_db.MAX_DEVICES}


@router.delete("/api/auth/devices/{session_id}")
async def sign_out_device(session_id: str, request: Request, authorization: str | None = Header(default=None)):
    return {"success": auth_db.end_session(_require_user_id(authorization, request), session_id)}
