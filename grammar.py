"""Grammar inventory (data/grammar_inventory.json) and the per-sentence structure the analyzer returns.

Every analysed sentence may carry "structure": ordered spans coloured N (noun group), V (verb) or
S (how the sentence is built), each optionally tied to an inventory id, plus "grammar_ids". The
analyzer's output is untrusted, so everything here is validated against the inventory.
"""

from __future__ import annotations

import json
import unicodedata
from typing import Any

from web_common import BASE_DIR

INVENTORY_PATH = BASE_DIR / "data" / "grammar_inventory.json"
BLOCKS = ("N", "V", "S")
MAX_SPANS = 40
MAX_GRAMMAR_IDS = 12
MAX_SPAN_TEXT = 200
MAX_ROLE = 40
MAX_DETAIL = 160

_inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
BLOCK_NAMES: dict[str, dict[str, str]] = _inventory["blocks"]
POINTS: list[dict[str, Any]] = _inventory["points"]
BY_ID: dict[str, dict[str, Any]] = {p["id"]: p for p in POINTS}


def prompt_inventory() -> str:
    """One line per block: "N: N.gender (noun gender); ..." — ids plus a short English name."""
    return "\n".join(
        f"{block}: " + "; ".join(f"{p['id']} ({p['en']})" for p in POINTS if p["block"] == block) for block in BLOCKS
    )


def valid_gid(value: Any) -> str | None:
    gid = value.strip() if isinstance(value, str) else ""
    return gid if gid in BY_ID else None


def _comparable(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("’", "'").replace(" ", " ")
    return " ".join(text.split()).casefold()


def _clip(value: Any, limit: int) -> str:
    return " ".join(str(value).split())[:limit] if isinstance(value, (str, int, float)) else ""


def clean_structure(raw: Any, sentence: str) -> list[dict[str, Any]]:
    """Spans with a known block whose text is in the sentence; unknown gids become null."""
    if not isinstance(raw, list):
        return []
    whole = _comparable(sentence)
    spans = []
    for item in raw[:MAX_SPANS]:
        if not isinstance(item, dict):
            continue
        text = _clip(item.get("text"), MAX_SPAN_TEXT)
        block = str(item.get("block") or "").strip().upper()
        if not text or block not in BLOCKS or _comparable(text) not in whole:
            continue
        gid = valid_gid(item.get("gid"))
        span = {
            "text": text,
            "block": block,
            "role": _clip(item.get("role", ""), MAX_ROLE),
            "detail": _clip(item.get("detail", ""), MAX_DETAIL),
            "gid": gid,
        }
        if gid:
            span["gid_zh"] = BY_ID[gid]["zh"]
            span["gid_en"] = BY_ID[gid]["en"]
        spans.append(span)
    return spans


def clean_grammar_ids(raw: Any, structure: list[dict[str, Any]] = ()) -> list[str]:
    """Known ids from grammar_ids and from the spans, in order, without duplicates."""
    found: list[str] = []
    listed = raw if isinstance(raw, list) else []
    for value in [*listed, *(span.get("gid") for span in structure)]:
        gid = valid_gid(value)
        if gid and gid not in found:
            found.append(gid)
    return found[:MAX_GRAMMAR_IDS]


def hits_from_sentences(sentences: Any) -> list[tuple[str, str]]:
    """(gid, sentence_text) pairs from analysed sentences, e.g. a study history payload."""
    pairs: list[tuple[str, str]] = []
    if not isinstance(sentences, list):
        return pairs
    for s in sentences[:200]:
        if not isinstance(s, dict):
            continue
        text = " ".join(str(s.get("sentence") or s.get("original") or "").split())[:1000]
        if not text:
            continue
        structure = s.get("structure") if isinstance(s.get("structure"), list) else []
        spans = [span for span in structure if isinstance(span, dict)]
        for gid in clean_grammar_ids(s.get("grammar_ids"), spans):
            pairs.append((gid, text))
    return pairs
