"""Old /app links (the archived React SPA) land on the study page.

The SPA lived in frontend/ and was taken offline on 2026-10-21. Its source, build and the
cockpit/comprehension backends are kept on the `archive/react-spa` branch.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter()

APP_SHELL_FALLBACK = "/study"


@router.api_route("/app", methods=["GET", "HEAD"], include_in_schema=False)
@router.api_route("/app/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def app_shell(path: str = "") -> RedirectResponse:
    return RedirectResponse(APP_SHELL_FALLBACK, status_code=302)
