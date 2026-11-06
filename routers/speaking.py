"""Speaking practice (TCF EO) routes: tasks, role-play replies and both feedback rounds."""
from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

import coach
import episodes
import game
import speaking
from services import ai
from web_common import _require_user_id, run_in_background

logger = logging.getLogger(__name__)
router = APIRouter()


async def _generate_speak_feedback_1(
    user_id: int, attempt_id: str, api_key: str | None, model: str
) -> None:
    if not api_key:
        speaking.set_attempt_feedback_1(attempt_id, {}, error=ai.TRIAL_ENDED_MESSAGE)
        return
    try:
        attempt = speaking.get_attempt(user_id, attempt_id)
        if not attempt:
            return
        payload = speaking.build_round1_payload(attempt, ai.AGY_MODEL)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
            _, raw_text = await ai.post_chat(client, payload, headers)
        duration = attempt.get("audio_duration") or attempt.get("seconds") or 0
        wpm = attempt.get("wpm") or speaking.calculate_wpm(speaking.word_count(attempt["transcript_1"]), duration)
        feedback = speaking.parse_round1_feedback(
            raw_text, attempt["transcript_1"], attempt["task"], attempt["subject"], duration, wpm
        )
        speaking.set_attempt_feedback_1(attempt_id, feedback)
        coach.speaking_evidence(user_id, speaking.get_attempt(user_id, attempt_id))
    except Exception as exc:
        logger.warning("Speaking round 1 feedback failed: %s", exc)
        speaking.set_attempt_feedback_1(attempt_id, {}, error=ai.feedback_error_message(exc))


async def _generate_speak_feedback_2(
    user_id: int, attempt_id: str, api_key: str | None, model: str
) -> None:
    if not api_key:
        speaking.set_attempt_feedback_2(attempt_id, {}, error=ai.TRIAL_ENDED_MESSAGE)
        return
    try:
        attempt = speaking.get_attempt(user_id, attempt_id)
        if not attempt:
            return
        payload = speaking.build_round2_payload(attempt, ai.AGY_MODEL)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
            _, raw_text = await ai.post_chat(client, payload, headers)
        feedback = speaking.parse_round2_feedback(raw_text)
        speaking.set_attempt_feedback_2(attempt_id, feedback)
    except Exception as exc:
        logger.warning("Speaking round 2 feedback failed: %s", exc)
        speaking.set_attempt_feedback_2(attempt_id, {}, error=ai.feedback_error_message(exc))


@router.get("/api/speak/tasks")
def speak_tasks(authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    hours = game.state(user_id, 0)["hours_total"]
    rec_level = episodes.recommended_level(hours)
    rec_task = "T1" if rec_level in ("A1", "A2") else ("T2" if rec_level == "B1" else "T3")
    return {
        "recommended_task": rec_task,
        "recommended_level": rec_level,
        "hours": hours,
        "tasks": speaking.TASKS,
        "subjects": speaking.SUBJECTS,
        "attempts": speaking.list_attempts(user_id, limit=20),
    }


class SpeakRoleplayReplyRequest(BaseModel):
    scenario: dict[str, Any]
    history: list[dict[str, str]] = Field(default_factory=list)
    user_utterance: str = Field(min_length=1, max_length=1000)
    model: ai.TransformModel = ai.DEFAULT_MODEL


@router.post("/api/speak/roleplay/reply")
async def speak_roleplay_reply(
    req: SpeakRoleplayReplyRequest,
    authorization: str | None = Header(default=None),
):
    _require_user_id(authorization)
    api_key = ai.upstream_key(authorization)
    payload = speaking.build_roleplay_reply_payload(
        req.scenario, req.history, req.user_utterance, ai.AGY_MODEL
    )
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    reply_fr = speaking.parse_roleplay_reply(raw_text)
    return {"reply": reply_fr}


class SpeakRound1Request(BaseModel):
    task: Literal["T1", "T2", "T3"]
    subject: dict[str, Any]
    level: str = "A1"
    transcript: str = Field(min_length=1, max_length=10000)
    seconds: int = 0
    audio_duration: float = 0.0
    model: ai.TransformModel = ai.DEFAULT_MODEL


@router.post("/api/speak/attempts")
async def create_speak_attempt(
    req: SpeakRound1Request,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        api_key = ai.upstream_key(authorization)
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
        api_key = None
    attempt = speaking.create_attempt(
        user_id, req.task, req.subject, req.level, req.transcript.strip(), req.seconds, req.audio_duration
    )
    run_in_background(_generate_speak_feedback_1(user_id, attempt["id"], api_key, req.model))
    return attempt


@router.get("/api/speak/attempts/{attempt_id}")
def get_speak_attempt(
    attempt_id: str,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    attempt = speaking.get_attempt(user_id, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail={"message": "口语记录不存在。"})
    return attempt


class SpeakRound2Request(BaseModel):
    transcript: str = Field(min_length=1, max_length=10000)
    seconds: int = 0
    audio_duration: float = 0.0
    model: ai.TransformModel = ai.DEFAULT_MODEL


@router.post("/api/speak/attempts/{attempt_id}/round2")
async def submit_speak_round2(
    attempt_id: str,
    req: SpeakRound2Request,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        api_key = ai.upstream_key(authorization)
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
        api_key = None
    attempt = speaking.get_attempt(user_id, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail={"message": "口语记录不存在。"})
    updated = speaking.update_attempt_round2(
        user_id, attempt_id, req.transcript.strip(), req.seconds, req.audio_duration
    )
    run_in_background(_generate_speak_feedback_2(user_id, attempt_id, api_key, req.model))
    return updated


@router.get("/api/speak/attempts")
def list_speak_attempts(
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    return {"attempts": speaking.list_attempts(user_id, limit=30)}
