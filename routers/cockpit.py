"""Cockpit routes: today's plan, hours ledger, to-dos, daily review, tutor sessions (see cockpit.py)."""
from __future__ import annotations

import datetime
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field, model_validator

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


class DailyReviewRequest(BaseModel):
    day: datetime.date
    hard: str = Field(default="", max_length=1000)
    solved: str = Field(default="", max_length=1000)
    unsolved: str = Field(default="", max_length=1000)
    tomorrow: str = Field(default="", max_length=1000)
    mood: int | None = Field(default=None, ge=1, le=5)

    @model_validator(mode="after")
    def at_least_one_answer(self):
        if not any(v.strip() for v in (self.hard, self.solved, self.unsolved, self.tomorrow)):
            raise ValueError("请至少回答一个问题。")
        return self


class TutorSessionRequest(BaseModel):
    day: datetime.date
    minutes: int = Field(ge=1, le=300)
    tutor: str | None = Field(default=None, max_length=100)
    topics: str | None = Field(default=None, max_length=500)
    homework: str | None = Field(default=None, max_length=500)
    cost: float | None = Field(default=None, ge=0, le=100000)
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


@router.get("/api/hours/ledger")
def hours_ledger(request: Request, tz_offset: int = Tz, authorization: str | None = Header(default=None)):
    return cockpit.ledger(_require_user_id(authorization, request), tz_offset)


@router.get("/api/todos")
def list_todos(request: Request, authorization: str | None = Header(default=None)):
    return cockpit.list_todos(_require_user_id(authorization, request))


@router.post("/api/todos/{todo_id}/done")
def complete_todo(todo_id: str, request: Request, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization, request)
    try:
        cockpit.complete_todo(user_id, todo_id)
    except KeyError:
        raise HTTPException(status_code=404, detail={"message": "待办不存在。"})
    return {"success": True}


@router.post("/api/daily-reviews")
def save_daily_review(
    req: DailyReviewRequest, request: Request, authorization: str | None = Header(default=None)
):
    return cockpit.save_review(
        _require_user_id(authorization, request),
        req.day.isoformat(), req.hard, req.solved, req.unsolved, req.tomorrow, req.mood,
    )


@router.get("/api/daily-reviews")
def get_daily_review(
    request: Request, day: datetime.date, authorization: str | None = Header(default=None)
):
    return cockpit.get_review(_require_user_id(authorization, request), day.isoformat())


@router.get("/api/tutor/sessions")
def list_tutor_sessions(request: Request, authorization: str | None = Header(default=None)):
    return cockpit.list_tutor_sessions(_require_user_id(authorization, request))


@router.post("/api/tutor/sessions")
def add_tutor_session(
    req: TutorSessionRequest, request: Request, authorization: str | None = Header(default=None)
):
    return cockpit.add_tutor_session(
        _require_user_id(authorization, request),
        req.day.isoformat(), req.minutes, req.tutor, req.topics, req.homework, req.cost, req.tz_offset,
    )


@router.get("/api/phase")
def get_phase(request: Request, authorization: str | None = Header(default=None)):
    _require_user_id(authorization, request)
    return cockpit.phase()


@router.get("/api/shadow/sentences")
def shadow_sentences(request: Request, authorization: str | None = Header(default=None)):
    return cockpit.shadow_sentences(_require_user_id(authorization, request))
