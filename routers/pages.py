"""HTML pages (PWA head + asset version), the landing waitlist, favicon, service worker and manifest."""

from __future__ import annotations

import hashlib
import os
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import auth_db
from web_common import STATIC_DIR, client_ip, rate_limit

router = APIRouter()


def _asset_version() -> str:
    digest = hashlib.sha256()
    for path in sorted(STATIC_DIR.iterdir()):
        if path.suffix in {".js", ".css"}:
            digest.update(path.name.encode("utf-8"))
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()


# Installable app (iPhone "Add to Home Screen"): manifest, icons, safe areas, service worker
PWA_HEAD = (
    '<link rel="manifest" href="/manifest.webmanifest">\n'
    '<meta name="theme-color" content="#f5f7fb" media="(prefers-color-scheme: light)">\n'
    '<meta name="theme-color" content="#141a23" media="(prefers-color-scheme: dark)">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="1000H French">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
    '<link rel="apple-touch-icon" sizes="180x180" href="/static/pwa/apple-touch-icon.png">\n'
    '<link rel="stylesheet" href="/static/pwa.css?v=__ASSET_VERSION__">\n'
    '<script src="/static/pwa-register.js?v=__ASSET_VERSION__" defer></script>\n'
)


def _with_pwa(html: str) -> str:
    html = html.replace(
        'content="width=device-width, initial-scale=1.0"',
        'content="width=device-width, initial-scale=1.0, viewport-fit=cover"',
        1,
    )
    return html.replace("</head>", PWA_HEAD + "</head>", 1)


def _html_page(name: str) -> HTMLResponse:
    html = _with_pwa((STATIC_DIR / name).read_text(encoding="utf-8"))
    if "__PERSONAL_PRACTICE__" in html:
        html = html.replace(
            "__PERSONAL_PRACTICE__", (STATIC_DIR / "personal-practice.html").read_text(encoding="utf-8")
        )
    return HTMLResponse(
        html.replace("__ASSET_VERSION__", ASSET_VERSION),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/api/version")
async def asset_version():
    # Open pages compare this with the version they were loaded with
    return {"version": ASSET_VERSION}


# Hosts (e.g. the product domain) whose "/" shows the public site instead of the audio workbench
LANDING_HOSTS = {host.strip().lower() for host in os.getenv("LANDING_HOSTS", "").split(",") if host.strip()}


def _invite_redirect(request: Request) -> RedirectResponse | None:
    """Invite links (?invite=CODE) open the sign-up form on /study with the code filled in."""
    invite = request.query_params.get("invite", "").strip()
    if not invite:
        return None
    return RedirectResponse("/study?" + urlencode({"invite": invite[:64]}), status_code=302)


@router.get("/")
async def root(request: Request):
    if redirect := _invite_redirect(request):
        return redirect
    host = request.headers.get("host", "").split(":")[0].lower()
    return _html_page("landing.html" if host in LANDING_HOSTS else "index.html")


@router.get("/home")
async def landing_page(request: Request):
    return _invite_redirect(request) or _html_page("landing.html")


@router.get("/account")
async def account_page():
    return _html_page("account.html")


@router.get("/for-institutions")
async def institutions_page():
    return _html_page("for-institutions.html")


@router.get("/privacy")
async def privacy_page():
    return _html_page("privacy.html")


class WaitlistRequest(BaseModel):
    kind: Literal["learner", "institution"] = "learner"
    contact: str = Field(min_length=1, max_length=120)
    org: str = Field(default="", max_length=120)
    size: str = Field(default="", max_length=20)
    level: str = Field(default="", max_length=20)
    target: str = Field(default="", max_length=20)
    exam: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=1000)
    lang: Literal["zh", "en"] = "zh"
    website: str = Field(default="", max_length=200)  # honeypot: people never see it


@router.post("/api/waitlist")
async def join_waitlist(req: WaitlistRequest, request: Request):
    if req.website:
        return {"ok": True}  # a bot filled the hidden field: pretend it worked
    contact = req.contact.strip()
    if not contact or (req.kind == "institution" and not req.org.strip()):
        raise HTTPException(status_code=422, detail={"message": "请填写必填项。"})
    rate_limit(f"ip:{client_ip(request)}", "waitlist")
    fields = ("org", "size", "level", "target", "exam", "note")
    details = {name: getattr(req, name).strip() for name in fields if getattr(req, name).strip()}
    await run_in_threadpool(auth_db.add_waitlist_entry, req.kind, contact, details, req.lang)
    return {"ok": True}


@router.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@router.get("/sw.js", include_in_schema=False)
async def service_worker():
    # At the site root so it can control every page; the version makes each deploy a new worker
    source = (STATIC_DIR / "sw.js").read_text(encoding="utf-8").replace("__ASSET_VERSION__", ASSET_VERSION)
    return Response(
        source,
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@router.get("/manifest.webmanifest", include_in_schema=False)
async def web_manifest():
    return FileResponse(
        STATIC_DIR / "pwa" / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/study")
async def study():
    return _html_page("study.html")


@router.get("/review")
async def review_page():
    return _html_page("review.html")


@router.get("/grammar")
async def grammar_page():
    return _html_page("grammar.html")


@router.get("/listen")
async def listen_page():
    return _html_page("listen.html")


@router.get("/write")
async def write_page():
    return _html_page("write.html")


@router.get("/speak")
async def speak_page():
    return _html_page("speak.html")


@router.get("/coach")
async def coach_page():
    return _html_page("coach.html")


@router.get("/homework")
async def homework_page():
    return RedirectResponse("/study?mode=personal", status_code=302)
