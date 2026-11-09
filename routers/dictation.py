"""Dictation routes for /study: register an exercise item, grade attempts, history, optional AI review.

Every route needs a session. The user id comes from that session only; requests that carry a user id or an
expected answer are rejected (extra fields are forbidden), and targets are read from the user's own item.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

import dictation
from services import ai
from web_common import _require_user_id, rate_limit

logger = logging.getLogger(__name__)
router = APIRouter()

HexId = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
Mode = Literal["write", "listen"]


class BuildUpStep(BaseModel):
    model_config = ConfigDict(extra="ignore")  # a saved analysis step may carry more keys

    fr: str = Field(default="", max_length=dictation.SENTENCE_MAX_CHARS)
    en: str = Field(default="", max_length=dictation.PROMPT_MAX_CHARS)
    new: str = Field(default="", max_length=dictation.NOTE_MAX_CHARS)


class ItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sentence: str = Field(min_length=1, max_length=dictation.SENTENCE_MAX_CHARS)
    translation_en: str = Field(default="", max_length=dictation.PROMPT_MAX_CHARS)
    build_up: list[BuildUpStep] = Field(default_factory=list, max_length=dictation.MAX_STEPS)


class AttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: HexId
    mode: Mode
    step: int = Field(default=0, ge=0, le=dictation.MAX_STEPS)
    answer: str = Field(min_length=1, max_length=dictation.ANSWER_MAX_CHARS)


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404, detail={"code": "dictation_not_found", "message": "找不到这道练习，请刷新后再试。"}
    )


@router.post("/api/dictation/items")
async def register_item(request: ItemRequest, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    rate_limit(user_id, "dictation")
    try:
        item = await run_in_threadpool(
            dictation.register_item,
            user_id,
            request.sentence,
            request.translation_en,
            [step.model_dump() for step in request.build_up],
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail={"code": "dictation_empty", "message": "这句话没有可练习的法语。"}
        ) from exc
    summary = await run_in_threadpool(dictation.item_summary, user_id, item)
    return {**dictation.public_item(item), "summary": summary}


@router.get("/api/dictation/items/{item_id}")
async def get_item(
    item_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")], authorization: str | None = Header(default=None)
):
    user_id = _require_user_id(authorization)
    item = await run_in_threadpool(dictation.get_item, user_id, item_id)
    if item is None:
        raise _not_found()
    summary = await run_in_threadpool(dictation.item_summary, user_id, item)
    return {**dictation.public_item(item), "summary": summary}


@router.post("/api/dictation/attempts")
async def submit_attempt(request: AttemptRequest, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    rate_limit(user_id, "dictation")
    if not request.answer.strip():
        raise HTTPException(status_code=422, detail={"code": "dictation_blank", "message": "请先写下你的答案。"})
    item = await run_in_threadpool(dictation.get_item, user_id, request.item_id)
    target = dictation.target_for(item, request.step) if item else None
    if target is None:
        raise _not_found()
    answer = dictation.clean_text(request.answer, dictation.ANSWER_MAX_CHARS)
    result = dictation.grade(target["expected"], answer)
    response = {
        **result,
        "attempt_id": None,
        "saved": False,
        "mode": request.mode,
        "step": request.step,
        "expected": target["expected"],
        "prompt_en": target["prompt_en"],
        "note": target["note"],
        "summary": None,
    }
    # The grade is already computed: a failed history write must never cost the learner their feedback
    try:
        response["attempt_id"] = await run_in_threadpool(
            dictation.record_attempt, user_id, item, request.mode, request.step, answer, target["expected"], result
        )
        response["saved"] = True
        response["summary"] = await run_in_threadpool(
            dictation.target_summary, user_id, request.mode, target["expected"]
        )
    except Exception:
        logger.exception("Could not save a dictation attempt")
    return response


@router.get("/api/dictation/attempts")
async def list_attempts(
    item_id: Annotated[str, Query(pattern=r"^[0-9a-f]{32}$")],
    mode: Mode,
    step: int = Query(default=0, ge=0, le=dictation.MAX_STEPS),
    limit: int = Query(default=10, ge=1, le=dictation.HISTORY_LIMIT),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    item = await run_in_threadpool(dictation.get_item, user_id, item_id)
    target = dictation.target_for(item, step) if item else None
    if target is None:
        raise _not_found()
    attempts = await run_in_threadpool(dictation.list_attempts, user_id, item, mode, step, limit)
    summary = await run_in_threadpool(dictation.target_summary, user_id, mode, target["expected"])
    return {"attempts": attempts, "summary": summary}



@router.get("/api/dictation/history")
async def attempt_history(
    limit: int = Query(default=200, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """Every Recall (write) and Dictation (listen) attempt, newest first, for History."""
    user_id = _require_user_id(authorization)
    attempts, total = await run_in_threadpool(dictation.recent_attempts, user_id, limit)
    return {"attempts": attempts, "total": total}


@router.delete("/api/dictation/history")
async def clear_attempt_history(authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    return {"deleted": await run_in_threadpool(dictation.clear_attempts, user_id)}

# One AI review per attempt at a time: a double click must not pay twice
_ai_in_flight: set[tuple[int, str]] = set()


@router.post("/api/dictation/attempts/{attempt_id}/ai")
async def ai_review(
    attempt_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")],
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    attempt = await run_in_threadpool(dictation.get_attempt, user_id, attempt_id)
    if attempt is None:
        raise _not_found()
    if attempt["ai"]:
        return {"feedback": attempt["ai"], "cached": True}
    if attempt["correct"]:
        return {"feedback": {"summary": "完全正确，没有需要批改的地方。", "points": [], "tip": ""}, "cached": True}
    key = dictation.ai_cache_key(attempt["mode"], attempt["expected"], attempt["answer"])
    cached = await run_in_threadpool(dictation.get_ai_cache, user_id, key)
    if cached:
        await run_in_threadpool(dictation.save_ai_feedback, user_id, attempt_id, key, cached)
        return {"feedback": cached, "cached": True}
    if (user_id, attempt_id) in _ai_in_flight:
        raise HTTPException(
            status_code=409, detail={"code": "dictation_ai_busy", "message": "AI 正在批改这次作答，请稍等。"}
        )
    rate_limit(user_id, "dictation_ai")
    api_key = ai.upstream_key(authorization)  # also checks the account and spends the shared "ai" bucket
    item = await run_in_threadpool(dictation.get_item, user_id, attempt["item_id"])
    target = dictation.target_for(item, attempt["step"]) if item else None
    prompt_en = target["prompt_en"] if target else ""
    payload = dictation.ai_payload(ai.AGY_MODEL, attempt["mode"], attempt["expected"], attempt["answer"], prompt_en)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    _ai_in_flight.add((user_id, attempt_id))
    try:
        async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
            _, raw_text = await ai.post_chat(client, payload, headers)
    finally:
        _ai_in_flight.discard((user_id, attempt_id))
    feedback = dictation.parse_ai_feedback(raw_text)
    if feedback is None:
        raise HTTPException(
            status_code=502, detail={"code": "dictation_ai_bad_output", "message": "AI 批改格式异常，请再试一次。"}
        )
    try:
        await run_in_threadpool(dictation.save_ai_feedback, user_id, attempt_id, key, feedback)
    except Exception:
        logger.exception("Could not cache a dictation AI review")
    return {"feedback": feedback, "cached": False}
