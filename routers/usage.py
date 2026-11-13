"""First-party usage events from the web app (see usage.py). Signed-in users only."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

import usage
from web_common import _require_user_id, rate_limit

router = APIRouter()


class UiEvent(BaseModel):
    name: str = Field(max_length=40)
    route: str = Field(default="", max_length=60)
    props: dict[str, Any] = Field(default_factory=dict)
    ts: int = 0


class UiEventBatch(BaseModel):
    session: str = Field(default="", max_length=32)
    events: list[UiEvent] = Field(max_length=usage.MAX_EVENTS_PER_BATCH)


async def _read_capped(request: Request) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > usage.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail={"code": "too_large", "message": "Too many events at once."})
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > usage.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail={"code": "too_large", "message": "Too many events at once."})
    return bytes(body)


@router.post("/api/events", status_code=204)
async def record_events(request: Request, authorization: str | None = Header(default=None)):
    # Bearer for the timed flush, the session cookie for sendBeacon (which cannot set headers).
    user_id = _require_user_id(authorization, request)
    rate_limit(user_id, "events")
    body = await _read_capped(request)
    try:
        batch = UiEventBatch.model_validate_json(body)
    except ValidationError:
        raise HTTPException(status_code=422, detail={"code": "invalid_events", "message": "Invalid events."})
    await run_in_threadpool(usage.record, user_id, batch.session, [e.model_dump() for e in batch.events])
    return Response(status_code=204)
