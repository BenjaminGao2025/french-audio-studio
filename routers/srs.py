"""Spaced repetition routes: sentence notes and FSRS cards, per logged-in user."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

import game
import coach
import srs
from web_common import _require_user_id

router = APIRouter()


# ---------------------------------------------------------------------------
# Spaced repetition (sentence notes + FSRS cards), per logged-in user
# ---------------------------------------------------------------------------
class SrsTarget(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    mode: Literal["cloze", "recognize", "grammar"] = "cloze"
    importance: int = Field(default=3, ge=1, le=5)
    meta: dict[str, Any] = Field(default_factory=dict)


class SrsNoteRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=2000)
    translation_en: str = Field(default="", max_length=2000)
    extra: dict[str, Any] = Field(default_factory=dict)
    modes: list[Literal["listen", "speak"]] = Field(default_factory=list)
    targets: list[SrsTarget] = Field(default_factory=list, max_length=20)
    auto_listen: bool = False


class SrsLookupRequest(BaseModel):
    sentences: list[str] = Field(default_factory=list, max_length=1000)


class SrsReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=4)
    duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    score: int | None = Field(default=None, ge=0, le=100)
    answer: str | None = Field(default=None, max_length=5000)  # srs stores the first 500 chars
    tz_offset: int = Field(default=0, ge=-840, le=840)


class SrsImportRequest(BaseModel):
    cards: list[dict[str, Any]] = Field(default_factory=list, max_length=5000)


@router.get("/api/srs/queue")
def srs_queue(
    tz_offset: int = Query(default=0, ge=-840, le=840),
    new_limit: int = Query(default=srs.DEFAULT_NEW_LIMIT, ge=0, le=100),
    min_importance: int = Query(default=1, ge=1, le=5),
    modes: str = Query(default="", max_length=80),
    authorization: str | None = Header(default=None),
):
    wanted = [mode for mode in modes.split(",") if mode in srs.MODES]
    return srs.build_queue(
        _require_user_id(authorization), tz_offset, new_limit, min_importance=min_importance, modes=wanted
    )


class SrsPracticeRequest(BaseModel):
    card_ids: list[str] = Field(min_length=1, max_length=200)


@router.post("/api/srs/practice")
def srs_practice(req: SrsPracticeRequest, authorization: str | None = Header(default=None)):
    return srs.practice_queue(_require_user_id(authorization), req.card_ids)


class SrsImportanceRequest(BaseModel):
    card_ids: list[str] = Field(min_length=1, max_length=50)
    importance: int = Field(ge=1, le=5)


@router.post("/api/srs/importance")
def srs_set_importance(req: SrsImportanceRequest, authorization: str | None = Header(default=None)):
    return {"updated": srs.set_importance(_require_user_id(authorization), req.card_ids, req.importance)}


@router.get("/api/srs/words")
def srs_saved_words(authorization: str | None = Header(default=None)):
    return {"words": srs.saved_words(_require_user_id(authorization))}


@router.post("/api/srs/notes")
def srs_add_note(
    req: SrsNoteRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        return srs.add_note(
            user_id,
            req.sentence,
            translation_zh=req.translation_zh,
            translation_en=req.translation_en,
            extra=req.extra,
            modes=req.modes,
            targets=[t.model_dump() for t in req.targets],
            auto_listen=req.auto_listen,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)})


@router.post("/api/srs/notes/lookup")
def srs_lookup_notes(
    req: SrsLookupRequest,
    authorization: str | None = Header(default=None),
):
    return {"notes": srs.lookup_notes(_require_user_id(authorization), req.sentences)}


@router.delete("/api/srs/notes/{note_id}")
def srs_delete_note(note_id: str, authorization: str | None = Header(default=None)):
    return {"success": srs.delete_note(_require_user_id(authorization), note_id)}


@router.get("/api/srs/cards")
def srs_list_cards(
    q: str = Query(default="", max_length=100),
    authorization: str | None = Header(default=None),
):
    return {"cards": srs.list_cards(_require_user_id(authorization), q)}


@router.delete("/api/srs/cards/{card_id}")
def srs_delete_card(card_id: str, authorization: str | None = Header(default=None)):
    return {"success": srs.delete_card(_require_user_id(authorization), card_id)}


@router.post("/api/srs/cards/{card_id}/review")
def srs_review_card(
    card_id: str,
    req: SrsReviewRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        card = srs.review_card(
            user_id, card_id, req.rating, req.duration_ms, req.score, req.answer
        )
    except KeyError:
        raise HTTPException(status_code=404, detail={"message": "卡片不存在。"})
    coach.record(user_id, "review", f"{coach.date_for(user_id)}:{card_id}", {"rating": req.rating}, 0)
    # Kill feed for the review page: XP, combo, first blood and the new totals
    card["game"] = game.review_feedback(user_id, req.tz_offset)
    return card


@router.post("/api/srs/import")
def srs_import_legacy(
    req: SrsImportRequest,
    authorization: str | None = Header(default=None),
):
    return srs.import_legacy_cards(_require_user_id(authorization), req.cards)
