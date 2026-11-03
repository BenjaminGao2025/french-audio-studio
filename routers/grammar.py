"""Per-user grammar map: which inventory points the learner has met in their own analysed sentences."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

import auth_db
import grammar
from web_common import _require_user_id

router = APIRouter()


@router.get("/api/grammar/map")
async def grammar_map(authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    counts = await run_in_threadpool(auth_db.grammar_hit_counts, user_id)
    blocks = []
    for block in grammar.BLOCKS:
        points = [{**p, "count": counts.get(p["id"], 0)} for p in grammar.POINTS if p["block"] == block]
        # Présent and passé composé first: they are the core of A1–A2
        points.sort(key=lambda p: not p["focus"])
        blocks.append({"id": block, **grammar.BLOCK_NAMES[block], "points": points})
    return {"blocks": blocks, "seen": sum(1 for gid in counts if gid in grammar.BY_ID)}


@router.get("/api/grammar/{gid}/sentences")
async def grammar_sentences(gid: str, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    if gid not in grammar.BY_ID:
        raise HTTPException(status_code=404, detail={"message": "没有这个语法点。"})
    sentences = await run_in_threadpool(auth_db.grammar_hit_sentences, user_id, gid)
    return {"point": grammar.BY_ID[gid], "sentences": sentences}
