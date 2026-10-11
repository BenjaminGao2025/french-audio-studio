"""Per-user history of audio and study records."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

import auth_db
import coach
from web_common import _require_user_id

router = APIRouter()


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
