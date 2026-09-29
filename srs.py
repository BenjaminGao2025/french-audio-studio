"""
French Audio Studio - Spaced repetition storage and scheduling.

A note is one French sentence. Each note owns cards, one per review mode:
  listen    - hear the sentence (no text), recall its meaning
  speak     - see the Chinese meaning, say the French sentence
  cloze     - fill a blanked chunk (target) back into the sentence
  recognize - legacy word card: see the French word, recall its meaning
  grammar   - apply a grammar point: fill the blank in a NEW example sentence
Scheduling uses FSRS (py-fsrs). Everything is stored per user in users.db.
"""

from __future__ import annotations

import datetime
import json
import re
import sqlite3
import uuid
from typing import Any, Iterable

from fsrs import Card, Rating, Scheduler, State

import auth_db

MODES = ("listen", "cloze", "grammar", "speak", "recognize")
MODE_ORDER = {mode: index for index, mode in enumerate(MODES)}
DEFAULT_NEW_LIMIT = 10
DAY_ROLLOVER_HOUR = 4  # like Anki: a study day starts at 04:00 local time
LEARN_AHEAD = datetime.timedelta(minutes=20)

SCHEDULER = Scheduler(desired_retention=0.9)
PREVIEW_SCHEDULER = Scheduler(desired_retention=0.9, enable_fuzzing=False)


_initialized_db_paths: set[str] = set()


def init_db() -> None:
    db_path = str(auth_db._get_db_path())
    if db_path in _initialized_db_paths:
        return
    auth_db.init_db()
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS srs_notes (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                sentence TEXT NOT NULL,
                sentence_key TEXT NOT NULL,
                translation_zh TEXT NOT NULL DEFAULT '',
                translation_en TEXT NOT NULL DEFAULT '',
                extra_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                UNIQUE (user_id, sentence_key)
            );
            CREATE TABLE IF NOT EXISTS srs_cards (
                id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                mode TEXT NOT NULL,
                target TEXT NOT NULL DEFAULT '',
                target_json TEXT NOT NULL DEFAULT '{}',
                fsrs_json TEXT NOT NULL,
                due TEXT NOT NULL,
                is_new INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                UNIQUE (note_id, mode, target)
            );
            CREATE INDEX IF NOT EXISTS idx_srs_cards_user_due ON srs_cards(user_id, due);
            CREATE INDEX IF NOT EXISTS idx_srs_cards_note ON srs_cards(note_id);
            CREATE TABLE IF NOT EXISTS srs_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id TEXT NOT NULL,
                note_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                was_new INTEGER NOT NULL,
                reviewed_at TEXT NOT NULL,
                duration_ms INTEGER,
                score INTEGER,
                answer TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_srs_reviews_user_time ON srs_reviews(user_id, reviewed_at);
            """
        )
    _initialized_db_paths.add(db_path)


def _connect() -> sqlite3.Connection:
    init_db()
    conn = sqlite3.connect(auth_db._get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _iso(value: datetime.datetime) -> str:
    # Fixed width so due dates compare correctly as strings in SQL.
    return value.astimezone(datetime.timezone.utc).isoformat(timespec="microseconds")


def sentence_key(sentence: str) -> str:
    text = sentence.replace("’", "'").replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip().lower()


def target_in_sentence(sentence: str, target: str) -> bool:
    """Whole-word, case-insensitive match (so "en" does not match inside "prends")."""
    target = target.strip()
    if not target:
        return False
    start = r"(?<!\w)" if target[0].isalnum() else ""
    end = r"(?!\w)" if target[-1].isalnum() else ""
    return re.search(start + re.escape(target) + end, sentence, re.IGNORECASE) is not None


def study_day_start(now: datetime.datetime, tz_offset_minutes: int) -> datetime.datetime:
    """UTC instant when the learner's current study day began.

    tz_offset_minutes follows JavaScript's Date#getTimezoneOffset (UTC - local).
    """
    offset = datetime.timedelta(minutes=tz_offset_minutes)
    local_now = now - offset
    start = local_now.replace(hour=DAY_ROLLOVER_HOUR, minute=0, second=0, microsecond=0)
    if local_now < start:
        start -= datetime.timedelta(days=1)
    return start + offset


def _state_name(card: Card) -> str:
    if card.last_review is None:
        return "new"
    return {State.Learning: "learning", State.Review: "review", State.Relearning: "relearning"}[card.state]


def _preview_intervals(card: Card, now: datetime.datetime) -> dict[str, int]:
    intervals = {}
    for rating in Rating:
        next_card, _ = PREVIEW_SCHEDULER.review_card(card, rating, now)
        intervals[str(int(rating))] = max(0, int((next_card.due - now).total_seconds()))
    return intervals


def _card_payload(row: sqlite3.Row, now: datetime.datetime, with_preview: bool = False) -> dict[str, Any]:
    fsrs_card = Card.from_dict(json.loads(row["fsrs_json"]))
    payload = {
        "id": row["id"],
        "note_id": row["note_id"],
        "mode": row["mode"],
        "target": row["target"],
        "target_meta": json.loads(row["target_json"] or "{}"),
        "due": row["due"],
        "state": _state_name(fsrs_card),
        "created_at": row["created_at"],
    }
    if "sentence" in row.keys():
        payload["note"] = {
            "id": row["note_id"],
            "sentence": row["sentence"],
            "translation_zh": row["translation_zh"],
            "translation_en": row["translation_en"],
            "extra": json.loads(row["extra_json"] or "{}"),
        }
    if with_preview:
        payload["intervals"] = _preview_intervals(fsrs_card, now)
    return payload


def _clean_meta(meta: dict[str, Any] | None) -> dict[str, str]:
    allowed = (
        "meaning_zh", "meaning_en", "lemma", "pos", "ipa", "hook",
        # grammar cards
        "rule", "prompt_fr", "answer", "hint", "full_fr", "full_en",
    )
    return {key: str(meta[key]).strip() for key in allowed if meta and meta.get(key)}


def add_note(
    user_id: int,
    sentence: str,
    translation_zh: str = "",
    translation_en: str = "",
    extra: dict[str, Any] | None = None,
    modes: Iterable[str] = (),
    targets: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Create (or reuse) the note for a sentence and add the requested cards.

    `modes` holds sentence-level modes (listen/speak); each item of `targets`
    ({"text", "mode", "meta"}) adds a cloze or recognize card for a chunk.
    Existing cards are kept untouched, so calling this twice is harmless.
    """
    clean_sentence = re.sub(r"\s+", " ", sentence).strip()
    if not clean_sentence:
        raise ValueError("句子不能为空。")
    key = sentence_key(clean_sentence)
    now = _now()

    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM srs_notes WHERE user_id = ? AND sentence_key = ?", (user_id, key)
        ).fetchone()
        if row:
            note_id = row["id"]
            conn.execute(
                """
                UPDATE srs_notes SET
                    translation_zh = CASE WHEN ? != '' THEN ? ELSE translation_zh END,
                    translation_en = CASE WHEN ? != '' THEN ? ELSE translation_en END,
                    extra_json = CASE WHEN ? != '{}' THEN ? ELSE extra_json END
                WHERE id = ?
                """,
                (
                    translation_zh, translation_zh,
                    translation_en, translation_en,
                    json.dumps(extra or {}, ensure_ascii=False),
                    json.dumps(extra or {}, ensure_ascii=False),
                    note_id,
                ),
            )
        else:
            note_id = "note_" + uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO srs_notes (id, user_id, sentence, sentence_key, translation_zh,
                                       translation_en, extra_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    note_id, user_id, clean_sentence, key, translation_zh.strip(),
                    translation_en.strip(), json.dumps(extra or {}, ensure_ascii=False), _iso(now),
                ),
            )

        wanted: list[tuple[str, str, dict[str, str]]] = []
        for mode in modes:
            if mode in ("listen", "speak"):
                wanted.append((mode, "", {}))
        for target in targets:
            text = re.sub(r"\s+", " ", str(target.get("text") or "")).strip()
            mode = target.get("mode") or "cloze"
            if mode == "cloze" and not target_in_sentence(clean_sentence, text):
                mode = "recognize"  # a blank is impossible if the chunk is not in the sentence
            if text and mode in ("cloze", "recognize", "grammar"):
                wanted.append((mode, text, _clean_meta(target.get("meta"))))

        for mode, text, meta in wanted:
            fsrs_card = Card(due=now)
            conn.execute(
                """
                INSERT OR IGNORE INTO srs_cards (id, note_id, user_id, mode, target, target_json,
                                                 fsrs_json, due, is_new, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    "card_" + uuid.uuid4().hex, note_id, user_id, mode, text,
                    json.dumps(meta, ensure_ascii=False), json.dumps(fsrs_card.to_dict()),
                    _iso(fsrs_card.due), _iso(now),
                ),
            )
        conn.commit()
    return get_note(user_id, note_id)


def get_note(user_id: int, note_id: str) -> dict[str, Any]:
    with _connect() as conn:
        note = conn.execute(
            "SELECT * FROM srs_notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        ).fetchone()
        if not note:
            raise KeyError(note_id)
        cards = conn.execute(
            "SELECT * FROM srs_cards WHERE note_id = ? ORDER BY created_at", (note_id,)
        ).fetchall()
    now = _now()
    return {
        "id": note["id"],
        "sentence": note["sentence"],
        "translation_zh": note["translation_zh"],
        "translation_en": note["translation_en"],
        "extra": json.loads(note["extra_json"] or "{}"),
        "cards": [_card_payload(card, now) for card in cards],
    }


def lookup_notes(user_id: int, sentences: Iterable[str]) -> list[dict[str, Any]]:
    keys = {sentence_key(s): s for s in sentences if s and s.strip()}
    if not keys:
        return []
    with _connect() as conn:
        placeholders = ",".join("?" for _ in keys)
        rows = conn.execute(
            f"SELECT id FROM srs_notes WHERE user_id = ? AND sentence_key IN ({placeholders})",
            (user_id, *keys),
        ).fetchall()
    return [get_note(user_id, row["id"]) for row in rows]


def delete_card(user_id: int, card_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT note_id FROM srs_cards WHERE id = ? AND user_id = ?", (card_id, user_id)
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM srs_cards WHERE id = ?", (card_id,))
        remaining = conn.execute(
            "SELECT COUNT(*) FROM srs_cards WHERE note_id = ?", (row["note_id"],)
        ).fetchone()[0]
        if remaining == 0:
            conn.execute("DELETE FROM srs_notes WHERE id = ?", (row["note_id"],))
        conn.commit()
    return True


def delete_note(user_id: int, note_id: str) -> bool:
    with _connect() as conn:
        deleted = conn.execute(
            "DELETE FROM srs_notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        ).rowcount
        if deleted:
            conn.execute("DELETE FROM srs_cards WHERE note_id = ?", (note_id,))
        conn.commit()
    return bool(deleted)


_CARD_WITH_NOTE_SQL = """
    SELECT c.*, n.sentence, n.translation_zh, n.translation_en, n.extra_json,
           n.created_at AS note_created_at
    FROM srs_cards c JOIN srs_notes n ON n.id = c.note_id
    WHERE c.user_id = ?
"""


def _today_activity(conn: sqlite3.Connection, user_id: int, day_start: datetime.datetime):
    rows = conn.execute(
        "SELECT note_id, card_id, was_new FROM srs_reviews WHERE user_id = ? AND reviewed_at >= ?",
        (user_id, _iso(day_start)),
    ).fetchall()
    new_cards_today = {row["card_id"] for row in rows if row["was_new"]}
    return {row["note_id"] for row in rows}, len(new_cards_today), len(rows)


def build_queue(
    user_id: int,
    tz_offset_minutes: int = 0,
    new_limit: int = DEFAULT_NEW_LIMIT,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    """Today's review queue: learning cards, then due reviews, then new cards.

    Siblings are buried: a sentence contributes at most one card per day unless
    that card is still in its short learning steps, so "listen" comes first and
    "speak"/"cloze" of the same sentence follow on later days.
    """
    now = now or _now()
    day_start = study_day_start(now, tz_offset_minutes)
    # FSRS due times carry the time of day of the last review; like Anki, a
    # review card counts as due for the whole study day it falls on.
    day_end = _iso(day_start + datetime.timedelta(days=1))
    horizon = _iso(now + LEARN_AHEAD)

    with _connect() as conn:
        touched_notes, new_done, reviews_done = _today_activity(conn, user_id, day_start)
        rows = conn.execute(
            _CARD_WITH_NOTE_SQL + " AND (c.is_new = 1 OR c.due <= ?)",
            (user_id, max(horizon, day_end)),
        ).fetchall()

    learning, reviews, new_cards = [], [], []
    for row in rows:
        card = Card.from_dict(json.loads(row["fsrs_json"]))
        state = _state_name(card)
        if state in ("learning", "relearning"):
            if row["due"] <= horizon:
                learning.append(row)
        elif state == "review" and row["due"] <= day_end:
            reviews.append(row)
        elif state == "new":
            new_cards.append(row)

    learning.sort(key=lambda r: r["due"])
    reviews.sort(key=lambda r: r["due"])
    new_cards.sort(key=lambda r: (r["note_created_at"], MODE_ORDER.get(r["mode"], 9), r["created_at"]))

    queue = list(learning)
    seen_notes = set(touched_notes) | {row["note_id"] for row in learning}
    for row in reviews:
        if row["note_id"] not in seen_notes:
            queue.append(row)
            seen_notes.add(row["note_id"])

    new_slots = max(0, new_limit - new_done)
    new_added = 0
    for row in new_cards:
        if new_added >= new_slots:
            break
        if row["note_id"] not in seen_notes:
            queue.append(row)
            seen_notes.add(row["note_id"])
            new_added += 1

    cards = [_card_payload(row, now, with_preview=True) for row in queue]
    return {
        "cards": cards,
        "counts": {
            "learning": sum(1 for c in cards if c["state"] in ("learning", "relearning")),
            "review": sum(1 for c in cards if c["state"] == "review"),
            "new": new_added,
            "total": len(cards),
            "reviewed_today": reviews_done,
            "new_today": new_done,
            "new_limit": new_limit,
        },
        "day_start": _iso(day_start),
    }


def review_card(
    user_id: int,
    card_id: str,
    rating: int,
    duration_ms: int | None = None,
    score: int | None = None,
    answer: str | None = None,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    now = now or _now()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM srs_cards WHERE id = ? AND user_id = ?", (card_id, user_id)
        ).fetchone()
        if not row:
            raise KeyError(card_id)
        card = Card.from_dict(json.loads(row["fsrs_json"]))
        was_new = card.last_review is None
        next_card, _ = SCHEDULER.review_card(card, Rating(rating), now)
        conn.execute(
            "UPDATE srs_cards SET fsrs_json = ?, due = ?, is_new = 0 WHERE id = ?",
            (json.dumps(next_card.to_dict()), _iso(next_card.due), card_id),
        )
        conn.execute(
            """
            INSERT INTO srs_reviews (card_id, note_id, user_id, rating, was_new, reviewed_at,
                                     duration_ms, score, answer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card_id, row["note_id"], user_id, rating, int(was_new), _iso(now),
                duration_ms, score, (answer or "")[:500] or None,
            ),
        )
        conn.commit()
        updated = conn.execute(
            _CARD_WITH_NOTE_SQL + " AND c.id = ?", (user_id, card_id)
        ).fetchone()
    return _card_payload(updated, now, with_preview=True)


def list_cards(user_id: int, query: str = "", limit: int = 500) -> list[dict[str, Any]]:
    sql = _CARD_WITH_NOTE_SQL
    params: list[Any] = [user_id]
    if query.strip():
        like = f"%{query.strip().lower()}%"
        sql += (
            " AND (lower(n.sentence) LIKE ? OR lower(c.target) LIKE ?"
            " OR n.translation_zh LIKE ? OR lower(c.target_json) LIKE ?)"
        )
        params += [like, like, like, like]
    sql += " ORDER BY n.created_at DESC, c.created_at LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    now = _now()
    return [_card_payload(row, now) for row in rows]


def missing_english(user_id: int) -> dict[str, list[dict[str, str]]]:
    """Notes without an English translation and word cards without an English meaning."""
    with _connect() as conn:
        notes = conn.execute(
            "SELECT id, sentence, translation_zh FROM srs_notes WHERE user_id = ? AND translation_en = ''",
            (user_id,),
        ).fetchall()
        cards = conn.execute(
            _CARD_WITH_NOTE_SQL + " AND c.mode IN ('cloze', 'recognize')", (user_id,)
        ).fetchall()
    return {
        "notes": [{"id": r["id"], "fr": r["sentence"], "zh": r["translation_zh"]} for r in notes],
        "cards": [
            {"id": r["id"], "word": r["target"], "sentence": r["sentence"],
             "zh": json.loads(r["target_json"] or "{}").get("meaning_zh", "")}
            for r in cards if not json.loads(r["target_json"] or "{}").get("meaning_en")
        ],
    }


def set_english(user_id: int, note_translations: dict[str, str], card_meanings: dict[str, str]) -> int:
    updated = 0
    with _connect() as conn:
        for note_id, english in note_translations.items():
            updated += conn.execute(
                "UPDATE srs_notes SET translation_en = ? WHERE id = ? AND user_id = ? AND translation_en = ''",
                (english.strip(), note_id, user_id),
            ).rowcount
        for card_id, english in card_meanings.items():
            row = conn.execute(
                "SELECT target_json FROM srs_cards WHERE id = ? AND user_id = ?", (card_id, user_id)
            ).fetchone()
            if not row:
                continue
            meta = json.loads(row["target_json"] or "{}")
            if meta.get("meaning_en"):
                continue
            meta["meaning_en"] = english.strip()
            updated += conn.execute(
                "UPDATE srs_cards SET target_json = ? WHERE id = ?",
                (json.dumps(meta, ensure_ascii=False), card_id),
            ).rowcount
        conn.commit()
    return updated


def import_legacy_cards(user_id: int, cards: Iterable[dict[str, Any]]) -> dict[str, int]:
    """Import cards from the old browser-only deck (localStorage frenchStudio.ankiDeck).

    A word that appears in its example sentence becomes a cloze card on that
    sentence; anything else becomes a recognize card. Cards start fresh in FSRS.
    """
    imported = skipped = 0
    for legacy in cards:
        token = re.sub(r"\s+", " ", str(legacy.get("token") or "")).strip()
        if not token:
            skipped += 1
            continue
        sentence = str(legacy.get("sentence") or "").strip()
        meaning_zh = str(legacy.get("explanation_cn") or "").strip()
        if meaning_zh.startswith("\U0001F4A1"):
            meaning_zh = meaning_zh.lstrip("\U0001F4A1 ").strip()
        meta = {
            "meaning_zh": meaning_zh,
            "meaning_en": legacy.get("explanation_en") or "",
            "lemma": legacy.get("lemma") or "",
            "pos": legacy.get("pos") or "",
            "ipa": legacy.get("phonetic") or "",
            "hook": legacy.get("hook") or "",
        }
        in_sentence = bool(sentence) and target_in_sentence(sentence, token)
        add_note(
            user_id,
            sentence if sentence else token,
            translation_zh=str(legacy.get("sentence_cn") or ""),
            targets=[{"text": token, "mode": "cloze" if in_sentence else "recognize", "meta": meta}],
        )
        imported += 1
    return {"imported": imported, "skipped": skipped}
