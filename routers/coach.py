"""Coach routes: the listening checks behind the mini listening practice (the coach dashboard page is gone)."""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

import coach
import curriculum
from services import speech
from web_common import _require_user_id, rate_limit

logger = logging.getLogger(__name__)
router = APIRouter()


class ListeningCheckRequest(BaseModel):
    level: Literal["starter", "A1"] = "starter"
    theme: str | None = Field(default=None, max_length=80)
    challenge: bool = False


@router.post("/api/coach/listen")
def coach_listen(req: ListeningCheckRequest, authorization: str | None = Header(default=None)):
    try:
        return coach.start_check(_require_user_id(authorization), req.level, req.theme, req.challenge)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.get("/api/coach/listen/{check_id}/audio")
async def coach_listen_audio(check_id: str, request: Request, line: int = Query(default=-1, ge=-1, le=2)):
    user_id = _require_user_id(request.headers.get("authorization"), request)
    try:
        check = coach.get_check(user_id, check_id)
    except KeyError:
        raise HTTPException(404, "练习不存在 / Check not found")
    lines = curriculum.BY_ID[check["lesson"]["id"]]["lines"]
    text = lines[line][0] if line >= 0 else " ".join(x[0] for x in lines)
    voice = "fr-FR-DeniseNeural"
    if not speech.snippet_cached(text, voice):
        rate_limit(user_id, "speech")
    filename, _ = await speech.create_speech_files(text, voice)
    return speech.output_file(filename, cache_seconds=30 * 86400)


@router.post("/api/coach/listen/{check_id}/hint")
def coach_listen_hint(check_id: str, authorization: str | None = Header(default=None)):
    try:
        return {"lines": coach.transcript(_require_user_id(authorization), check_id)}
    except KeyError:
        raise HTTPException(404, "练习不存在 / Check not found")
    except ValueError as exc:
        raise HTTPException(422, str(exc))


class ListeningAnswers(BaseModel):
    answers: list[int] = Field(min_length=3, max_length=3)


@router.post("/api/coach/listen/{check_id}/answers")
def coach_listen_answers(check_id: str, req: ListeningAnswers, authorization: str | None = Header(default=None)):
    if any(a < 0 or a > 2 for a in req.answers):
        raise HTTPException(422, "无效答案 / Invalid answer")
    try:
        return coach.answer_check(_require_user_id(authorization), check_id, req.answers)
    except KeyError:
        raise HTTPException(404, "练习不存在 / Check not found")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
