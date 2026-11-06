"""Writing practice (TCF EE) routes; both feedback rounds run in the background."""

from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

import coach
import game
import writing
from services import ai
from web_common import _require_user_id, run_in_background

logger = logging.getLogger(__name__)
router = APIRouter()


async def _generate_write_feedback_1(user_id: int, attempt_id: str, api_key: str | None, model: str) -> None:
    if not api_key:
        writing.set_attempt_feedback_1(attempt_id, {}, error=ai.TRIAL_ENDED_MESSAGE)
        return
    try:
        attempt = writing.get_attempt(user_id, attempt_id)
        if not attempt:
            return
        payload = writing.build_round1_payload(attempt, ai.AGY_MODEL)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
            _, raw_text = await ai.post_chat(client, payload, headers)
        feedback = writing.parse_round1_feedback(raw_text, attempt["text_1"], attempt["task"], attempt["subject"])
        writing.set_attempt_feedback_1(attempt_id, feedback)
        coach.writing_evidence(user_id, writing.get_attempt(user_id, attempt_id))
    except Exception as exc:
        logger.warning("Writing round 1 feedback failed: %s", exc)
        writing.set_attempt_feedback_1(attempt_id, {}, error=ai.feedback_error_message(exc))


async def _generate_write_feedback_2(user_id: int, attempt_id: str, api_key: str | None, model: str) -> None:
    if not api_key:
        writing.set_attempt_feedback_2(attempt_id, {}, error=ai.TRIAL_ENDED_MESSAGE)
        return
    try:
        attempt = writing.get_attempt(user_id, attempt_id)
        if not attempt:
            return
        payload = writing.build_round2_payload(attempt, ai.AGY_MODEL)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
            _, raw_text = await ai.post_chat(client, payload, headers)
        feedback = writing.parse_round2_feedback(raw_text)
        writing.set_attempt_feedback_2(attempt_id, feedback)
        coach.writing_evidence(user_id, writing.get_attempt(user_id, attempt_id))
    except Exception as exc:
        logger.warning("Writing round 2 feedback failed: %s", exc)
        writing.set_attempt_feedback_2(attempt_id, {}, error=ai.feedback_error_message(exc))


@router.get("/api/write/tasks")
def write_tasks(authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    hours = game.state(user_id, 0)["hours_total"]
    stored = coach.get_profile(user_id)
    rec_level = stored["profile"]["levels"].get("write", "A1") if stored else "A1"
    if rec_level == "A0":
        rec_level = "A1"
    rec_task = "T1" if rec_level in ("A1", "A2") else ("T2" if rec_level == "B1" else "T3")
    return {
        "recommended_task": rec_task,
        "recommended_level": rec_level,
        "hours": hours,
        "tasks": writing.TASKS,
        "subjects": writing.SUBJECTS,
        "practice_default": "P0" if rec_level == "A1" else "P2" if rec_level == "A2" else rec_task,
        "attempts": writing.list_attempts(user_id, limit=20),
    }


class WriteSubjectRequest(BaseModel):
    task: Literal["T1", "T2", "T3", "P0", "P1", "P2"]
    level: Literal["A1", "A2", "B1", "B2"] = "A1"
    theme: str = ""
    model: ai.TransformModel = ai.DEFAULT_MODEL


@router.post("/api/write/subject")
async def write_new_subject(
    req: WriteSubjectRequest,
    authorization: str | None = Header(default=None),
):
    _require_user_id(authorization)
    api_key = ai.upstream_key(authorization)
    payload = writing.build_new_subject_payload(req.task, req.level, req.theme, ai.AGY_MODEL)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    return writing.parse_new_subject(raw_text, req.task)


class WriteRound1Request(BaseModel):
    task: Literal["T1", "T2", "T3", "P0", "P1", "P2"]
    subject: dict[str, Any]
    level: str = "A1"
    text: str = Field(min_length=1, max_length=10000)
    seconds: int = 0
    model: ai.TransformModel = ai.DEFAULT_MODEL


@router.post("/api/write/attempts")
async def create_write_attempt(
    req: WriteRound1Request,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        api_key = ai.upstream_key(authorization)
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
        api_key = None
    attempt = writing.create_attempt(user_id, req.task, req.subject, req.level, req.text.strip(), req.seconds)
    run_in_background(_generate_write_feedback_1(user_id, attempt["id"], api_key, req.model))
    return attempt


@router.get("/api/write/attempts/{attempt_id}")
def get_write_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    attempt = writing.get_attempt(user_id, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail={"message": "写作记录不存在。"})
    return attempt


class WriteRound2Request(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    seconds: int = 0
    model: ai.TransformModel = ai.DEFAULT_MODEL


@router.post("/api/write/attempts/{attempt_id}/round2")
async def submit_write_round2(
    attempt_id: str,
    req: WriteRound2Request,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        api_key = ai.upstream_key(authorization)
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
        api_key = None
    attempt = writing.get_attempt(user_id, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail={"message": "写作记录不存在。"})
    updated = writing.update_attempt_round2(user_id, attempt_id, req.text.strip(), req.seconds)
    run_in_background(_generate_write_feedback_2(user_id, attempt_id, api_key, req.model))
    return updated


@router.get("/api/write/attempts")
def list_write_attempts(
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    return {"attempts": writing.list_attempts(user_id, limit=30)}
