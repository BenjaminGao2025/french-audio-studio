"""French Audio Studio: the FastAPI app.

This module only assembles the app: static files, security headers, startup recovery and the
routers. Routes live in routers/, outside services (AI gateway, TTS, ASR) in services/, and the
learning logic in the top-level modules (srs, writing, speaking, episodes, ...). See ARCHITECTURE.md.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

import edge_compat  # noqa: F401  (Microsoft moved the synthesis host; must load before edge_tts is used)
import episodes
import routers.app_shell
import routers.auth
import routers.coach
import routers.episodes
import routers.game
import routers.grammar
import routers.history
import routers.homework
import routers.pages
import routers.speaking
import routers.srs
import routers.studio
import routers.tutor
import routers.writing
import speaking
import writing
from services import ai
from web_common import OUTPUT_DIR, STATIC_DIR

logger = logging.getLogger(__name__)

app = FastAPI(title="French Audio Studio", version="2.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Order matters only where paths overlap; this is the order the routes were declared in before the
# split, so every request still resolves to the same handler.
for _routes in (
    routers.auth,
    routers.history,
    routers.srs,
    routers.game,
    routers.grammar,
    routers.app_shell,
    routers.studio,
    routers.pages,
    routers.tutor,
    routers.episodes,
    routers.writing,
    routers.speaking,
    routers.coach,
    routers.homework,
):
    app.include_router(_routes.router)


CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        # Cloudflare Web Analytics beacon is injected by the tunnel/CDN, not by our pages
        "script-src 'self' https://static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline'",  # style="" attributes in markup; scripts stay strict
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://cloudflareinsights.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "worker-src 'self'",  # /sw.js (installable app)
        "manifest-src 'self'",
    ]
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    if request.url.path in {"/", "/study"}:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
async def _recover_interrupted_feedback() -> None:
    for module in (writing, speaking, episodes):
        try:
            count = await run_in_threadpool(module.fail_interrupted_attempts, ai.INTERRUPTED_MESSAGE)
            if count:
                logger.warning("Marked %s interrupted %s attempts as failed", count, module.__name__)
        except Exception:
            logger.exception("Could not recover interrupted %s attempts", module.__name__)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "model": ai.DEFAULT_MODEL,
        "proofread_model": ai.DEFAULT_MODEL,
        "output_directory_ready": OUTPUT_DIR.is_dir(),
    }


if __name__ == "__main__":
    import uvicorn

    # Loopback only: the public entry is the Cloudflare tunnel (network_mode: host).
    uvicorn.run(app, host=os.getenv("TTS_HOST", "127.0.0.1"), port=int(os.getenv("TTS_PORT", "8000")))
