"""Serves the React SPA built into static/app (source: frontend/)."""
from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from web_common import STATIC_DIR

router = APIRouter()

APP_DIR = (STATIC_DIR / "app").resolve()
IMMUTABLE = "public, max-age=31536000, immutable"
NO_STORE = "no-cache, no-store, must-revalidate"
# Explicit types: the server sends nosniff, so a script or stylesheet must not depend on the
# host's mime database.
MEDIA_TYPES = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
}


@router.api_route("/app", methods=["GET", "HEAD"], include_in_schema=False)
@router.api_route("/app/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def app_shell(path: str = ""):
    # A last segment with a dot (or anything under assets/) is a file: serve it or 404, never
    # the shell, so a missing chunk is a real 404 instead of HTML served as JavaScript.
    if path.startswith("assets/") or "." in PurePosixPath(path).name:
        try:
            target = (APP_DIR / path).resolve()
            found = target.is_relative_to(APP_DIR) and target.is_file()
        except (OSError, ValueError):  # NUL byte, name too long
            found = False
        if not found:
            raise HTTPException(status_code=404, detail="文件不存在。")
        headers = {"Cache-Control": IMMUTABLE} if path.startswith("assets/") else {}
        return FileResponse(target, media_type=MEDIA_TYPES.get(target.suffix), headers=headers)
    index = APP_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=503, detail={"message": "前端尚未构建：cd frontend && npm run build"})
    # No auth on the shell: the SPA redirects to /app/login on a 401 from the API.
    return HTMLResponse(
        index.read_text(encoding="utf-8"),
        headers={"Cache-Control": NO_STORE, "Pragma": "no-cache", "Expires": "0"},
    )
