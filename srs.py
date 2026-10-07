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
DEFAULT_IMPORTANCE = 3  # 1-5 stars, like Eudic's word book
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
    with auth_db.connect() as conn:
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
        columns = {row[1] for row in conn.execute("PRAGMA table_info(srs_cards)")}
        if "importance" not in columns:
            conn.execute("ALTER TABLE srs_cards ADD COLUMN importance INTEGER NOT NULL DEFAULT 3")
    _initialized_db_paths.add(db_path)


def _connect():
    init_db()
    return auth_db.connect()


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


FUNCTION_WORDS = {
    "à", "de", "du", "des", "le", "la", "les", "l'", "un", "une",
    "et", "en", "au", "aux", "ce", "se", "ne", "pas", "que", "qui", "y",
    "d'", "n'", "s'", "c'", "qu'", "j'", "m'", "t'",
}


def sentence_word_count(sentence: str) -> int:
    """Word count for French sentences, splitting apostrophes (j'ai -> 2 words)."""
    cleaned = sentence.replace("'", " ").replace("’", " ")
    tokens = re.findall(r"[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*", cleaned)
    return len(tokens)


def is_function_word(token: str) -> bool:
    clean = re.sub(r"\s+", " ", token).strip().lower().replace("’", "'")
    if clean in FUNCTION_WORDS:
        return True
    if clean.endswith("'") and clean in FUNCTION_WORDS:
        return True
    return False


def expand_function_word(sentence: str, token: str, extra: dict[str, Any] | None = None) -> str:
    """Expand a small French function word into the smallest chunk (2-4 words) around it.

    Uses extra phrase/grammar data if available; otherwise expands neighbouring words.
    """
    clean_token = token.strip()
    if not clean_token:
        return token
    clean_sentence = re.sub(r"\s+", " ", sentence).strip()
    if not is_function_word(clean_token):
        return clean_token

    # 1. Check if extra provides phrase data (e.g. from study analysis)
    if extra:
        phrase_candidate = extra.get("phrase") or extra.get("expression")
        if phrase_candidate and isinstance(phrase_candidate, str):
            p_clean = phrase_candidate.strip()
            if p_clean and re.search(r"(?i)\b" + re.escape(clean_token) + r"\b", p_clean):
                if 2 <= sentence_word_count(p_clean) <= 4 and p_clean.lower() in clean_sentence.lower():
                    m = re.search(re.escape(p_clean), clean_sentence, re.IGNORECASE)
                    if m:
                        return clean_sentence[m.start():m.end()]
                    return p_clean
        grammar = extra.get("grammar")
        if isinstance(grammar, list):
            for g in grammar:
                title = (g.get("title") or "") if isinstance(g, dict) else str(g)
                m_title = re.search(r"['\"«]([^'\"»]+)['\"»]", title)
                cand = m_title.group(1).strip() if m_title else title.strip()
                if cand and 2 <= sentence_word_count(cand) <= 4 and cand.lower() in clean_sentence.lower():
                    if re.search(r"(?i)\b" + re.escape(clean_token) + r"\b", cand):
                        m = re.search(re.escape(cand), clean_sentence, re.IGNORECASE)
                        if m:
                            return clean_sentence[m.start():m.end()]

    # 2. Tokenize sentence into word match spans
    pattern = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿŒœ0-9]+['’]?|[A-Za-zÀ-ÖØ-öø-ÿŒœ0-9]+", re.IGNORECASE)
    matches = list(pattern.finditer(clean_sentence))
    if not matches:
        return clean_token

    token_norm = clean_token.lower().replace("’", "'")
    target_idx = -1
    for i, m in enumerate(matches):
        w = m.group().lower().replace("’", "'")
        if w == token_norm or (token_norm.endswith("'") and w == token_norm):
            target_idx = i
            break
        if token_norm.rstrip("'") == w:
            target_idx = i
            break

    if target_idx == -1:
        m = re.search(r"(?<!\w)" + re.escape(clean_token) + r"(?!\w)", clean_sentence, re.IGNORECASE)
        if not m:
            return clean_token
        for i, tok in enumerate(matches):
            if tok.start() <= m.start() < tok.end():
                target_idx = i
                break

    if target_idx == -1:
        return clean_token

    total = len(matches)
    start_i = target_idx
    end_i = target_idx

    if token_norm == "pas":
        if target_idx > 0:
            start_i = max(0, target_idx - 2 if (target_idx >= 2 and matches[target_idx - 2].group().lower() == "ne") else target_idx - 1)
        end_i = target_idx
    elif token_norm == "ne":
        curr = target_idx
        while curr + 1 < total and (curr - target_idx + 1) < 4:
            next_word = matches[curr + 1].group().lower().replace("’", "'")
            curr += 1
            if next_word in ("pas", "plus", "jamais", "rien", "que"):
                break
            if not is_function_word(next_word):
                if curr + 1 < total and matches[curr + 1].group().lower().replace("’", "'") in ("pas", "plus", "jamais", "rien", "que"):
                    curr += 1
                break
        end_i = curr
    else:
        curr = target_idx
        while curr + 1 < total and (curr - target_idx + 1) < 4:
            next_word = matches[curr + 1].group().lower().replace("’", "'")
            curr += 1
            if not is_function_word(next_word):
                break
        end_i = curr

        chunk_words = end_i - start_i + 1
        if chunk_words < 2 and start_i > 0:
            start_i = max(0, start_i - 1)

        if target_idx > 0 and target_idx + 1 < total and (end_i - start_i + 1) <= 2:
            prev_word = matches[target_idx - 1].group().lower()
            if prev_word in ("tout", "rien", "peu", "il", "plus", "moins"):
                start_i = target_idx - 1

    chunk_len = end_i - start_i + 1
    if chunk_len < 2 and end_i + 1 < total:
        end_i += 1
    elif chunk_len < 2 and start_i > 0:
        start_i -= 1

    start_char = matches[start_i].start()
    end_char = matches[end_i].end()
    return clean_sentence[start_char:end_char].strip()



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
        "importance": row["importance"],
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


def _clamp_importance(value: Any) -> int:
    try:
        return min(5, max(1, int(value)))
    except (TypeError, ValueError):
        return DEFAULT_IMPORTANCE


def set_importance(user_id: int, card_ids: Iterable[str], importance: int) -> int:
    ids = list(card_ids)
    if not ids:
        return 0
    with _connect() as conn:
        placeholders = ",".join("?" for _ in ids)
        updated = conn.execute(
            f"UPDATE srs_cards SET importance = ? WHERE user_id = ? AND id IN ({placeholders})",
            (_clamp_importance(importance), user_id, *ids),
        ).rowcount
        conn.commit()
    return updated


def saved_words(user_id: int) -> list[dict[str, Any]]:
    """Every word/chunk in the learner's deck (cloze + recognize cards), for "already saved?" checks."""
    with _connect() as conn:
        rows = conn.execute(
            _CARD_WITH_NOTE_SQL + " AND c.mode IN ('cloze', 'recognize') ORDER BY c.created_at",
            (user_id,),
        ).fetchall()
    return [
        {"text": r["target"], "card_id": r["id"], "note_id": r["note_id"],
         "sentence": r["sentence"], "mode": r["mode"], "importance": r["importance"]}
        for r in rows
    ]


def add_note(
    user_id: int,
    sentence: str,
    translation_zh: str = "",
    translation_en: str = "",
    extra: dict[str, Any] | None = None,
    modes: Iterable[str] = (),
    targets: Iterable[dict[str, Any]] = (),
    auto_listen: bool = False,
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

        wanted: list[tuple[str, str, dict[str, str], int]] = []
        for mode in modes:
            if mode in ("listen", "speak"):
                wanted.append((mode, "", {}, DEFAULT_IMPORTANCE))
        has_cloze = False
        for target in targets:
            text = re.sub(r"\s+", " ", str(target.get("text") or "")).strip()
            mode = target.get("mode") or "cloze"
            if mode == "cloze":
                if not target_in_sentence(clean_sentence, text):
                    mode = "recognize"  # a blank is impossible if the chunk is not in the sentence
                elif is_function_word(text):
                    text = expand_function_word(clean_sentence, text, extra)
            if mode == "cloze":
                has_cloze = True
            if text and mode in ("cloze", "recognize", "grammar"):
                importance = _clamp_importance(target.get("importance", DEFAULT_IMPORTANCE))
                wanted.append((mode, text, _clean_meta(target.get("meta")), importance))

        if auto_listen and has_cloze and sentence_word_count(clean_sentence) <= 25:
            if not any(m == "listen" for m, _, _, _ in wanted):
                wanted.append(("listen", "", {}, DEFAULT_IMPORTANCE))

        for mode, text, meta, importance in wanted:
            fsrs_card = Card(due=now)
            conn.execute(
                """
                INSERT OR IGNORE INTO srs_cards (id, note_id, user_id, mode, target, target_json,
                                                 fsrs_json, due, is_new, created_at, importance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    "card_" + uuid.uuid4().hex, note_id, user_id, mode, text,
                    json.dumps(meta, ensure_ascii=False), json.dumps(fsrs_card.to_dict()),
                    _iso(fsrs_card.due), _iso(now), importance,
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
    min_importance: int = 1,
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
            _CARD_WITH_NOTE_SQL + " AND (c.is_new = 1 OR c.due <= ?) AND c.importance >= ?",
            (user_id, max(horizon, day_end), _clamp_importance(min_importance)),
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
    reviews.sort(key=lambda r: (-r["importance"], r["due"]))
    new_cards.sort(key=lambda r: (-r["importance"], r["note_created_at"], MODE_ORDER.get(r["mode"], 9), r["created_at"]))

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
            "min_importance": _clamp_importance(min_importance),
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


def backfill_listen_cards(
    user_id: int | None = None,
    max_words: int = 25,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Find notes that only have cloze cards (no listen card).

    If the sentence has at most `max_words` (default 25), add a listen card.
    """
    now = _now()
    eligible_count = 0
    created_count = 0
    skipped_count = 0
    with _connect() as conn:
        query = """
            SELECT n.id, n.user_id, n.sentence
            FROM srs_notes n
            WHERE EXISTS (
                SELECT 1 FROM srs_cards c WHERE c.note_id = n.id AND c.mode = 'cloze'
            )
            AND NOT EXISTS (
                SELECT 1 FROM srs_cards c WHERE c.note_id = n.id AND c.mode = 'listen'
            )
        """
        params: list[Any] = []
        if user_id is not None:
            query += " AND n.user_id = ?"
            params.append(user_id)
        query += " ORDER BY n.created_at"
        rows = conn.execute(query, params).fetchall()

        for row in rows:
            sentence = row["sentence"]
            if sentence_word_count(sentence) <= max_words:
                eligible_count += 1
                if not dry_run:
                    fsrs_card = Card(due=now)
                    card_id = "card_" + uuid.uuid4().hex
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO srs_cards (
                            id, note_id, user_id, mode, target, target_json,
                            fsrs_json, due, is_new, created_at, importance
                        )
                        VALUES (?, ?, ?, 'listen', '', '{}', ?, ?, 1, ?, ?)
                        """,
                        (
                            card_id, row["id"], row["user_id"],
                            json.dumps(fsrs_card.to_dict()), _iso(fsrs_card.due),
                            _iso(now), DEFAULT_IMPORTANCE,
                        ),
                    )
                    created_count += 1
            else:
                skipped_count += 1

        if not dry_run:
            conn.commit()

    return {
        "eligible": eligible_count,
        "created": created_count,
        "skipped_too_long": skipped_count,
        "dry_run": dry_run,
    }


def _admin_cli(argv: list[str]) -> None:
    """Admin maintenance commands:
    python srs.py backfill-listen [--dry-run] [--email EMAIL] [--user-id ID] [--max-words 25]
    """
    import argparse

    parser = argparse.ArgumentParser(prog="srs.py")
    sub = parser.add_subparsers(dest="command", required=True)
    backfill_p = sub.add_parser("backfill-listen", help="Backfill listen cards for notes that only have cloze cards")
    backfill_p.add_argument("--dry-run", action="store_true", help="Count candidates without writing to the database")
    backfill_p.add_argument("--user-id", type=int, default=None, help="Target specific user ID")
    backfill_p.add_argument("--email", default=None, help="Target specific user email")
    backfill_p.add_argument("--max-words", type=int, default=25, help="Maximum sentence words for listen card (default 25)")
    args = parser.parse_args(argv)

    if args.command == "backfill-listen":
        target_uid = args.user_id
        if args.email and target_uid is None:
            with _connect() as conn:
                row = conn.execute("SELECT id FROM users WHERE email = ?", (args.email.strip().lower(),)).fetchone()
                if not row:
                    raise SystemExit(f"No user with email {args.email!r}.")
                target_uid = row[0]
        res = backfill_listen_cards(user_id=target_uid, max_words=args.max_words, dry_run=args.dry_run)
        prefix = "[DRY RUN] " if res["dry_run"] else ""
        print(
            f"{prefix}Found {res['eligible']} eligible note(s) (<= {args.max_words} words). "
            f"Created {res['created']} listen card(s). Skipped {res['skipped_too_long']} note(s) > {args.max_words} words."
        )


if __name__ == "__main__":
    import sys

    _admin_cli(sys.argv[1:])

