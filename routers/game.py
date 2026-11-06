"""Progress HUD routes: study time, weekly targets and streaks (see game.py)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

import edge_compat  # noqa: F401  (Microsoft moved the synthesis host; must load before use)
import game
from web_common import _require_user_id

router = APIRouter()


# ---------------------------------------------------------------------------
# Progress: study time, weekly targets and streaks (see game.py)
# ---------------------------------------------------------------------------
GameLane = Literal["listening", "reading", "speaking", "writing", "review", "car"]


class GameHeartbeat(BaseModel):
    lane: GameLane
    seconds: int = Field(ge=0, le=600)
    tz_offset: int = Field(default=0, ge=-840, le=840)


class GameLog(BaseModel):
    lane: GameLane
    minutes: int = Field(ge=1, le=300)
    note: str = Field(default="", max_length=200)
    tz_offset: int = Field(default=0, ge=-840, le=840)


class GameDayRequest(BaseModel):
    tz_offset: int = Field(default=0, ge=-840, le=840)
    on: bool = True


@router.get("/api/game/state")
def game_state(
    tz_offset: int = Query(default=0, ge=-840, le=840),
    authorization: str | None = Header(default=None),
):
    return game.state(_require_user_id(authorization), tz_offset)


@router.post("/api/game/heartbeat")
def game_heartbeat(req: GameHeartbeat, authorization: str | None = Header(default=None)):
    stored = game.record_time(_require_user_id(authorization), req.lane, req.seconds, req.tz_offset)
    return {"stored_seconds": stored}


@router.post("/api/game/log")
def game_log(req: GameLog, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    game.log_time(user_id, req.lane, req.minutes, req.note, req.tz_offset)
    return game.state(user_id, req.tz_offset)


@router.delete("/api/game/log/{log_id}")
def game_delete_log(
    log_id: int,
    tz_offset: int = Query(default=0, ge=-840, le=840),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    if not game.delete_log(user_id, log_id):
        raise HTTPException(status_code=404, detail={"message": "记录不存在。"})
    return game.state(user_id, tz_offset)


@router.post("/api/game/family-day")
def game_family_day(req: GameDayRequest, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    game.set_family_day(user_id, req.on, req.tz_offset)
    return game.state(user_id, req.tz_offset)
