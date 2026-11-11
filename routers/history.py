"""Per-user history of audio and study records."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

import auth_db
import coach
import grammar
from web_common import _require_user_id

router = APIRouter()
logger = logging.getLogger(__name__)


class SaveHistoryRequest(BaseModel):
    id: str
    type: str = "tts"
    text: str
    payload: dict[str, Any] = Field(default_factory=dict)


@router.get("/api/history")
async def list_history(
    type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    records = auth_db.get_history_records(user_id=user_id, record_type=type, limit=limit)
    return {"records": records, "count": len(records)}


@router.post("/api/history")
async def save_history(
    req: SaveHistoryRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    res = auth_db.save_history_record(
        record_id=req.id,
        record_type=req.type,
        text=req.text,
        payload=req.payload,
        user_id=user_id,
    )
    if req.type == "study":
        coach.record(user_id, "read", req.id, {"source": "sentence_analysis"}, 0)
        # The grammar map counts each analysed sentence once per grammar point it showed
        try:
            auth_db.record_grammar_hits(user_id, grammar.hits_from_sentences(req.payload.get("sentences")), req.id)
        except Exception:
            logger.exception("Could not record grammar hits")
    return res


@router.delete("/api/history/{record_id}")
async def delete_history(
    record_id: str,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    ok = auth_db.delete_history_record(record_id, user_id=user_id)
    return {"success": ok}


@router.delete("/api/history")
async def clear_all_history(
    type: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    count = auth_db.clear_history_records(user_id=user_id, record_type=type)
    return {"deleted": count}


class WordNoteText(BaseModel):
    text: str = Field(min_length=1, max_length=10000)


class CreateWordNote(WordNoteText):
    word: str = Field(min_length=1, max_length=200)


@router.get("/api/word-notes")
async def list_word_notes(word: str = Query(min_length=1, max_length=200), authorization: str | None = Header(default=None)):
    return {"notes": auth_db.word_notes(_require_user_id(authorization), word)}


@router.post("/api/word-notes", status_code=201)
async def create_word_note(req: CreateWordNote, authorization: str | None = Header(default=None)):
    return auth_db.word_notes(_require_user_id(authorization), req.word, text=req.text)


@router.patch("/api/word-notes/{note_id}")
async def update_word_note(note_id: int, req: WordNoteText, authorization: str | None = Header(default=None)):
    from fastapi import HTTPException
    note = auth_db.word_notes(_require_user_id(authorization), note_id=note_id, text=req.text)
    if note is None:
        raise HTTPException(404, "Note not found")
    return note


@router.delete("/api/word-notes/{note_id}")
async def delete_word_note(note_id: int, authorization: str | None = Header(default=None)):
    from fastapi import HTTPException
    if not auth_db.word_notes(_require_user_id(authorization), note_id=note_id, delete=True):
        raise HTTPException(404, "Note not found")
    return {"success": True}
