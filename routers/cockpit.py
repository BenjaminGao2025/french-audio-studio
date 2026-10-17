"""Cockpit routes: today's plan and its blocks (see cockpit.py)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

import cockpit
from web_common import _require_user_id

router = APIRouter()

NOT_FOUND_BLOCK = {"message": "这个任务块不存在。"}
Tz = Query(default=0, ge=-840, le=840)


class SkipRequest(BaseModel):
    reason: Literal["no_time", "too_hard", "health", "family"]


class MinimalRequest(BaseModel):
    on: bool
    tz_offset: int = Field(default=0, ge=-840, le=840)


@router.get("/api/today")
def today(request: Request, tz_offset: int = Tz, authorization: str | None = Header(default=None)):
    return cockpit.today(_require_user_id(authorization, request), tz_offset)


def _block_call(fn, *args):
    try:
        return fn(*args)
    except KeyError:
        raise HTTPException(status_code=404, detail=NOT_FOUND_BLOCK)


@router.post("/api/today/blocks/{block_id}/start")
def start_block(block_id: str, request: Request, authorization: str | None = Header(default=None)):
    return _block_call(cockpit.start_block, _require_user_id(authorization, request), block_id)


@router.post("/api/today/blocks/{block_id}/finish")
def finish_block(block_id: str, request: Request, authorization: str | None = Header(default=None)):
    return _block_call(cockpit.finish_block, _require_user_id(authorization, request), block_id)


@router.post("/api/today/blocks/{block_id}/skip")
def skip_block(
    block_id: str, req: SkipRequest, request: Request, authorization: str | None = Header(default=None)
):
    return _block_call(cockpit.skip_block, _require_user_id(authorization, request), block_id, req.reason)


@router.post("/api/today/minimal")
def minimal(req: MinimalRequest, request: Request, authorization: str | None = Header(default=None)):
    return cockpit.set_minimal(_require_user_id(authorization, request), req.on, req.tz_offset)
