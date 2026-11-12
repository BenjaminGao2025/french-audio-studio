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
import unicodedata
import uuid
from typing import Any, Iterable

from fsrs import Card, Rating, Scheduler, State

import auth_db
from offline_dictionary import strip_elided_prefix

MODES = ("listen", "cloze", "grammar", "speak", "recognize")
MODE_ORDER = {mode: index for index, mode in enumerate(MODES)}
DEFAULT_NEW_LIMIT = 10
MAX_NEW_LIMIT = 200
DEFAULT_SESSION_SIZE = 40  # cards per review session (the app's session plan; the queue itself is not capped)
MIN_SESSION_SIZE, MAX_SESSION_SIZE = 10, 300
DEFAULT_IMPORTANCE = 3  # Default saved-word importance.
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
            -- Additive: lookup counts are their own table, so existing srs_cards and notes are untouched.
            -- Additive: per-user review settings (the daily new-card limit), synced across devices.
            CREATE TABLE IF NOT EXISTS srs_settings (
                user_id INTEGER PRIMARY KEY,
                new_limit INTEGER,
                updated_at TEXT NOT NULL
            );
            -- Additive: favorited words (by normalize_lookup_word), separate from importance.
            CREATE TABLE IF NOT EXISTS word_favorites (
                user_id INTEGER NOT NULL,
                word TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, word)
            );
            CREATE TABLE IF NOT EXISTS word_lookup_counts (
                user_id INTEGER NOT NULL,
                word TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                first_looked_at TEXT NOT NULL,
                last_looked_at TEXT NOT NULL,
                PRIMARY KEY (user_id, word)
            );
            """
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(srs_cards)")}
        if "importance" not in columns:
            conn.execute("ALTER TABLE srs_cards ADD COLUMN importance INTEGER NOT NULL DEFAULT 3")
        # Additive soft archive ("mastered"): the card stays, with its history, but leaves the review queue.
        if "archived_at" not in columns:
            conn.execute("ALTER TABLE srs_cards ADD COLUMN archived_at TEXT")
        settings_columns = {row[1] for row in conn.execute("PRAGMA table_info(srs_settings)")}
        if "session_size" not in settings_columns:
            conn.execute("ALTER TABLE srs_settings ADD COLUMN session_size INTEGER")
        conn.execute("CREATE TABLE IF NOT EXISTS srs_migrations (name TEXT PRIMARY KEY)")
        if not conn.execute("SELECT 1 FROM srs_migrations WHERE name = 'importance-1.3.4'").fetchone():
            _sync_word_importance(conn)
            conn.execute("INSERT INTO srs_migrations VALUES ('importance-1.3.4')")
        if not conn.execute("SELECT 1 FROM srs_migrations WHERE name = 'elision-keys-1.3.4'").fetchone():
            _merge_elided_keys(conn)
            _sync_word_importance(conn)
            conn.execute("INSERT INTO srs_migrations VALUES ('elision-keys-1.3.4')")
        conn.commit()
    _initialized_db_paths.add(db_path)


def _connect():
    init_db()
    return auth_db.connect()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _iso(value: datetime.datetime) -> str:
    # Fixed width so due dates compare correctly as strings in SQL.
    return value.astimezone(datetime.timezone.utc).isoformat(timespec="microseconds")


def get_new_limit(user_id: int) -> int | None:
    """The learner's saved daily new-card limit, or None when they never set one."""
    with _connect() as conn:
        row = conn.execute("SELECT new_limit FROM srs_settings WHERE user_id = ?", (user_id,)).fetchone()
    return row["new_limit"] if row and row["new_limit"] is not None else None


def set_new_limit(user_id: int, new_limit: int, now: datetime.datetime | None = None) -> int:
    """Save the daily new-card limit (0 to MAX_NEW_LIMIT) and return it. ValueError when out of range."""
    if isinstance(new_limit, bool) or not isinstance(new_limit, int) or not 0 <= new_limit <= MAX_NEW_LIMIT:
        raise ValueError(f"new_limit must be a whole number from 0 to {MAX_NEW_LIMIT}")
    with _connect() as conn:
        conn.execute(
            "INSERT INTO srs_settings (user_id, new_limit, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET new_limit = excluded.new_limit, updated_at = excluded.updated_at",
            (user_id, new_limit, _iso(now or _now())),
        )
        conn.commit()
    return new_limit


def get_session_size(user_id: int) -> int | None:
    """Cards per review session, or None when the learner never set one."""
    with _connect() as conn:
        row = conn.execute("SELECT session_size FROM srs_settings WHERE user_id = ?", (user_id,)).fetchone()
    return row["session_size"] if row and row["session_size"] is not None else None


def set_session_size(user_id: int, size: int, now: datetime.datetime | None = None) -> int:
    """Save cards per review session (MIN_SESSION_SIZE to MAX_SESSION_SIZE). ValueError when out of range."""
    if isinstance(size, bool) or not isinstance(size, int) or not MIN_SESSION_SIZE <= size <= MAX_SESSION_SIZE:
        raise ValueError(f"session_size must be a whole number from {MIN_SESSION_SIZE} to {MAX_SESSION_SIZE}")
    with _connect() as conn:
        conn.execute(
            "INSERT INTO srs_settings (user_id, session_size, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET session_size = excluded.session_size, updated_at = excluded.updated_at",
            (user_id, size, _iso(now or _now())),
        )
        conn.commit()
    return size


def lookup_counts(user_id: int) -> dict[str, int]:
    """Every looked-up word (normalized) with its lookup count."""
    with _connect() as conn:
        rows = conn.execute("SELECT word, count FROM word_lookup_counts WHERE user_id = ?", (user_id,)).fetchall()
    return {r["word"]: int(r["count"]) for r in rows}


def favorite_words(user_id: int) -> list[str]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT word FROM word_favorites WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [r["word"] for r in rows]


def set_favorite(user_id: int, word: str, favorite: bool, now: datetime.datetime | None = None) -> dict[str, Any]:
    """Favorite or unfavorite a word. Never changes its lookup count or importance."""
    normalized = normalize_lookup_word(word)
    if not normalized:
        raise ValueError("单词不能为空。")
    with _connect() as conn:
        if favorite:
            conn.execute(
                "INSERT OR IGNORE INTO word_favorites (user_id, word, created_at) VALUES (?, ?, ?)",
                (user_id, normalized, _iso(now or _now())),
            )
        else:
            conn.execute("DELETE FROM word_favorites WHERE user_id = ? AND word = ?", (user_id, normalized))
        conn.commit()
    return {"word": normalized, "favorite": favorite}


def sentence_key(sentence: str) -> str:
    text = sentence.replace("’", "'").replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip().lower()


# Word lookup counts (Eudic-style "已查 N 次"): one row per user per normalized word.
LOOKUP_DEBOUNCE_SECONDS = 5
IMPORTANCE_FROM_LOOKUPS = ((5, 5), (3, 4))


def _normalize_word_surface(word: str) -> str:
    """Normalize spelling without conflating elision prefixes or their remainders."""
    text = unicodedata.normalize("NFC", str(word or ""))
    text = text.replace("’", "'").replace("‘", "'").replace("ʼ", "'")
    text = text.replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip().lower()


def normalize_lookup_word(word: str) -> str:
    """Canonical lemma identity: NFC, apostrophes, whitespace, case and a single elision prefix."""
    return strip_elided_prefix(_normalize_word_surface(word))


# Historical counts lack sentence context: do not infer that these remainders
# represent the same word as an elided expression (including conjugated verbs).
ELISION_MIGRATION_SKIP_REMAINDERS = frozenset("""
    à y il ils elle elles on en un une le la les lui leur leurs eux
    je tu nous vous ce ceci cela ça se soi me te ne que qui quoi où dont
    ai as a avons avez ont est es suis sommes êtes sont était étais étaient
    être avoir avais avait avaient arrive arrives arrivent
    et ou au aux de du des dans par pour sur sous avec sans si mais donc
""".split())


def _merge_elided_keys(conn: sqlite3.Connection) -> None:
    """Remap only unambiguous word data, backing up every replaced row.

    Sentence cards and review assignments must never be merged or rewritten.
    """
    conn.execute("CREATE TABLE IF NOT EXISTS srs_elision_merge_backup "
                 "(source_table TEXT NOT NULL, source_key TEXT NOT NULL, row_json TEXT NOT NULL, "
                 "PRIMARY KEY (source_table, source_key))")

    def backup(table, row, key):
        conn.execute("INSERT OR IGNORE INTO srs_elision_merge_backup VALUES (?, ?, ?)",
                     (table, str(key), json.dumps(dict(row), ensure_ascii=False)))

    tables = ("word_lookup_counts", "word_favorites")
    originals = {table: conn.execute(f"SELECT * FROM {table}").fetchall() for table in tables}
    prefixes = {}
    # Inspect both tables before writing, so a star and a count cannot resolve
    # competing prefixes differently. When in doubt, retain the whole surface.
    for rows in originals.values():
        for row in rows:
            surface = _normalize_word_surface(row["word"])
            remainder = strip_elided_prefix(surface)
            if remainder != surface:
                prefixes.setdefault((row["user_id"], remainder), set()).add(surface.split("'", 1)[0])

    for table, originals_rows in originals.items():
        groups = {}
        for row in originals_rows:
            surface = _normalize_word_surface(row["word"])
            remainder = strip_elided_prefix(surface)
            key = surface
            if (remainder not in ELISION_MIGRATION_SKIP_REMAINDERS
                    and len(prefixes.get((row["user_id"], remainder), ())) <= 1):
                key = remainder
            groups.setdefault((row["user_id"], key), []).append(row)
        for (user_id, key), rows in groups.items():
            if all(r["word"] == key for r in rows):
                continue
            for r in rows:
                backup(table, r, f"{user_id}:{r['word']}")
                conn.execute(f"DELETE FROM {table} WHERE user_id = ? AND word = ?", (user_id, r["word"]))
            if table == "word_lookup_counts":
                conn.execute("INSERT INTO word_lookup_counts VALUES (?, ?, ?, ?, ?)",
                             (user_id, key, sum(r["count"] for r in rows),
                              min(r["first_looked_at"] for r in rows), max(r["last_looked_at"] for r in rows)))
            else:
                conn.execute("INSERT INTO word_favorites VALUES (?, ?, ?)",
                             (user_id, key, min(r["created_at"] for r in rows)))


def importance_for_lookups(count: int) -> int:
    """Saved-word importance: default 3, 3+ lookups → 4, 5+ → 5."""
    for threshold, importance in IMPORTANCE_FROM_LOOKUPS:
        if count >= threshold:
            return importance
    return DEFAULT_IMPORTANCE


def _sync_word_importance(
    conn: sqlite3.Connection,
    user_id: int | None = None,
    ids: list[str] | None = None,
    word: str | None = None,
) -> int:
    """Recompute existing word cards only. The migration uses all users; requests use one."""
    scope = " WHERE user_id = ?" if user_id is not None else ""
    params = (user_id,) if user_id is not None else ()
    counts = {(r["user_id"], r["word"]): r["count"] for r in conn.execute(
        "SELECT user_id, word, count FROM word_lookup_counts" + scope, params)}
    rows = conn.execute(
        "SELECT id, user_id, target FROM srs_cards" + scope
        + (" AND" if scope else " WHERE") + " mode IN ('cloze', 'recognize')", params,
    ).fetchall()
    updated = 0
    for row in rows:
        normalized = normalize_lookup_word(row["target"])
        if (ids is not None and row["id"] not in ids) or (word is not None and normalized != word):
            continue
        conn.execute("UPDATE srs_cards SET importance = ? WHERE id = ?",
                     (importance_for_lookups(counts.get((row["user_id"], normalized), 0)), row["id"]))
        updated += 1
    return updated


def record_word_lookup(
    user_id: int,
    word: str,
    now: datetime.datetime | None = None,
    debounce_seconds: int = LOOKUP_DEBOUNCE_SECONDS,
    sentence: str = "",
    translation_en: str = "",
    translation_zh: str = "",
) -> dict[str, Any]:
    """Count one lookup of `word`, at most once per `debounce_seconds` for repeated opens."""
    normalized = normalize_lookup_word(word)
    if not normalized:
        raise ValueError("单词不能为空。")
    moment = now or _now()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    moment_iso = _iso(moment)

    with _connect() as conn:
        row = conn.execute(
            "SELECT count, last_looked_at FROM word_lookup_counts WHERE user_id = ? AND word = ?",
            (user_id, normalized),
        ).fetchone()
        incremented = False
        if row:
            count = int(row["count"])
            last = datetime.datetime.fromisoformat(row["last_looked_at"])
            if last.tzinfo is None:
                last = last.replace(tzinfo=datetime.timezone.utc)
            # Repeated opens of the same word (a second surface, a quick reopen) do not inflate the count.
            if (moment - last).total_seconds() >= debounce_seconds:
                count += 1
                incremented = True
                conn.execute(
                    "UPDATE word_lookup_counts SET count = ?, last_looked_at = ? WHERE user_id = ? AND word = ?",
                    (count, moment_iso, user_id, normalized),
                )
        else:
            count = 1
            incremented = True
            conn.execute(
                "INSERT INTO word_lookup_counts (user_id, word, count, first_looked_at, last_looked_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, normalized, count, moment_iso, moment_iso),
            )
        conn.commit()

    # Only a newly counted lookup can auto-save, never a suppressed reopen after unstar.
    if incremented and count >= min(t for t, _ in IMPORTANCE_FROM_LOOKUPS):
        with _connect() as conn:
            cards = conn.execute("SELECT id, target FROM srs_cards WHERE user_id = ? AND mode IN ('cloze', 'recognize')", (user_id,)).fetchall()
        if not any(normalize_lookup_word(c["target"]) == normalized for c in cards):
            add_note(user_id, sentence.strip() or word, translation_en=translation_en, translation_zh=translation_zh, modes=[],
                     targets=[{"text": word, "mode": "cloze", "exact_target": True}], auto_listen=False)
    with _connect() as conn:
        if incremented:
            _sync_word_importance(conn, user_id, word=normalized)
        saved = any(normalize_lookup_word(r["target"]) == normalized for r in conn.execute(
            "SELECT target FROM srs_cards WHERE user_id = ? AND mode IN ('cloze', 'recognize')", (user_id,)))
        conn.commit()
    return {"word": normalized, "count": count,
            "importance": importance_for_lookups(count) if saved else 0,
            "incremented": incremented}


def target_in_sentence(sentence: str, target: str) -> bool:
    """Whole-word, case-insensitive match (so "en" does not match inside "prends")."""
    target = target.strip()
    if not target:
        return False
    start = r"(?<!\w)" if target[0].isalnum() else ""
    end = r"(?!\w)" if target[-1].isalnum() else ""
    return re.search(start + re.escape(target) + end, sentence, re.IGNORECASE) is not None


FUNCTION_WORDS = {
    "à",
    "de",
    "du",
    "des",
    "le",
    "la",
    "les",
    "l'",
    "un",
    "une",
    "et",
    "en",
    "au",
    "aux",
    "ce",
    "se",
    "ne",
    "pas",
    "que",
    "qui",
    "y",
    "d'",
    "n'",
    "s'",
    "c'",
    "qu'",
    "j'",
    "m'",
    "t'",
}


def sentence_word_count(sentence: str) -> int:
    """Word count for French sentences, splitting apostrophes (j'ai -> 2 words)."""
    cleaned = sentence.replace("'", " ").replace("’", " ")
    tokens = re.findall(r"[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*", cleaned)
    return len(tokens)


# Keep in sync with api/review.ts for legacy-card presentation.
CLOZE_MIN_SENTENCE_WORDS = 3
CLOZE_MAX_BLANK_FRACTION = 0.5


def cloze_has_context(sentence: str, target: str) -> bool:
    words = sentence_word_count(sentence)
    return (words >= CLOZE_MIN_SENTENCE_WORDS and target_in_sentence(sentence, target)
            and sentence_word_count(target) / words <= CLOZE_MAX_BLANK_FRACTION)


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
                        return clean_sentence[m.start() : m.end()]
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
                            return clean_sentence[m.start() : m.end()]

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
            start_i = max(
                0,
                target_idx - 2
                if (target_idx >= 2 and matches[target_idx - 2].group().lower() == "ne")
                else target_idx - 1,
            )
        end_i = target_idx
    elif token_norm == "ne":
        curr = target_idx
        while curr + 1 < total and (curr - target_idx + 1) < 4:
            next_word = matches[curr + 1].group().lower().replace("’", "'")
            curr += 1
            if next_word in ("pas", "plus", "jamais", "rien", "que"):
                break
            if not is_function_word(next_word):
                if curr + 1 < total and matches[curr + 1].group().lower().replace("’", "'") in (
                    "pas",
                    "plus",
                    "jamais",
                    "rien",
                    "que",
                ):
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
        "archived": bool(row["archived_at"]),
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


SNAPSHOT_MAX_CHARS = 600


# UI status text that must never be stored as a meaning (a star pressed while the lookup was pending)
_PLACEHOLDER_RE = re.compile(
    r"^\s*(?:正在)?查询(?:中|字义|词义|释义)?\s*(?:\.{2,}|…+|。+)?\s*$"
    r"|^\s*查词失败\s*$|^\s*查询超时.*$|^\s*暂无(?:释义|字义|定义)[。.]?\s*$|^\s*暂无法获取.*$"
    r"|^\s*(?:looking up|loading|lookup failed|lookup timed out|could not get the meaning|no definition)\b.*$",
    re.IGNORECASE,
)
_MEANING_KEYS = ("meaning_zh", "meaning_en", "dict_zh", "dict_en", "ctx_zh", "ctx_en", "why_zh", "hook")


def is_placeholder_meaning(value: Any) -> bool:
    return isinstance(value, str) and bool(_PLACEHOLDER_RE.match(value))


def _clean_meta(meta: dict[str, Any] | None) -> dict[str, str]:
    allowed = (
        "meaning_zh",
        "meaning_en",
        "lemma",
        "pos",
        "ipa",
        "hook",
        # Meaning snapshot taken when the word was saved (dictionary + this sentence), so reviewing the
        # card needs no live lookup. "snap" marks a card that has been through the snapshot step.
        "dict_zh",
        "dict_en",
        "ctx_zh",
        "ctx_en",
        "why_zh",
        "snap",
        # grammar cards
        "rule",
        "prompt_fr",
        "answer",
        "hint",
        "full_fr",
        "full_en",
    )
    return {
        key: str(meta[key]).strip()[:SNAPSHOT_MAX_CHARS]
        for key in allowed
        if meta and meta.get(key) and not (key in _MEANING_KEYS and is_placeholder_meaning(str(meta[key])))
    }


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
        # Word importance is derived; retain manual priority only for sentence/grammar cards.
        updated = conn.execute(
            f"UPDATE srs_cards SET importance = ? WHERE user_id = ? AND id IN ({placeholders}) AND mode NOT IN ('cloze', 'recognize')",
            (_clamp_importance(importance), user_id, *ids),
        ).rowcount
        updated += _sync_word_importance(conn, user_id, ids)
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
        {
            "text": r["target"],
            "card_id": r["id"],
            "note_id": r["note_id"],
            "sentence": r["sentence"],
            "mode": r["mode"],
            "importance": r["importance"],
            "target_meta": json.loads(r["target_json"] or "{}"),
        }
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
        row = conn.execute("SELECT id FROM srs_notes WHERE user_id = ? AND sentence_key = ?", (user_id, key)).fetchone()
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
                    translation_zh,
                    translation_zh,
                    translation_en,
                    translation_en,
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
                    note_id,
                    user_id,
                    clean_sentence,
                    key,
                    translation_zh.strip(),
                    translation_en.strip(),
                    json.dumps(extra or {}, ensure_ascii=False),
                    _iso(now),
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
            if mode == "cloze" and not target.get("exact_target", False):
                if not target_in_sentence(clean_sentence, text):
                    mode = "recognize"  # a blank is impossible if the chunk is not in the sentence
                elif is_function_word(text):
                    text = expand_function_word(clean_sentence, text, extra)
            if mode == "cloze" and not cloze_has_context(clean_sentence, text):
                mode = "recognize"
            if mode == "cloze":
                has_cloze = True
            if text and mode in ("cloze", "recognize", "grammar"):
                importance = _clamp_importance(target.get("importance", DEFAULT_IMPORTANCE))
                if mode in ("cloze", "recognize"):
                    row = conn.execute("SELECT count FROM word_lookup_counts WHERE user_id = ? AND word = ?", (user_id, normalize_lookup_word(text))).fetchone()
                    importance = importance_for_lookups(row["count"] if row else 0)
                wanted.append((mode, text, _clean_meta(target.get("meta")), importance))

        if auto_listen and has_cloze and sentence_word_count(clean_sentence) <= 25:
            if not any(m == "listen" for m, _, _, _ in wanted):
                wanted.append(("listen", "", {}, DEFAULT_IMPORTANCE))

        for mode, text, meta, importance in wanted:
            if mode in ("cloze", "recognize"):
                existing = conn.execute("SELECT target FROM srs_cards WHERE user_id = ? AND mode IN ('cloze', 'recognize')", (user_id,)).fetchall()
                if any(normalize_lookup_word(r["target"]) == normalize_lookup_word(text)
                       and (sentence_key(r["target"]) != sentence_key(text)) for r in existing):
                    continue  # Surface and base lemma share one saved identity.
            fsrs_card = Card(due=now)
            conn.execute(
                """
                INSERT OR IGNORE INTO srs_cards (id, note_id, user_id, mode, target, target_json,
                                                 fsrs_json, due, is_new, created_at, importance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    "card_" + uuid.uuid4().hex,
                    note_id,
                    user_id,
                    mode,
                    text,
                    json.dumps(meta, ensure_ascii=False),
                    json.dumps(fsrs_card.to_dict()),
                    _iso(fsrs_card.due),
                    _iso(now),
                    importance,
                ),
            )
        conn.commit()
    return get_note(user_id, note_id)


def get_note(user_id: int, note_id: str) -> dict[str, Any]:
    with _connect() as conn:
        note = conn.execute("SELECT * FROM srs_notes WHERE id = ? AND user_id = ?", (note_id, user_id)).fetchone()
        if not note:
            raise KeyError(note_id)
        cards = conn.execute("SELECT * FROM srs_cards WHERE note_id = ? ORDER BY created_at", (note_id,)).fetchall()
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


def set_archived(user_id: int, card_id: str, archived: bool, now: datetime.datetime | None = None) -> dict[str, Any]:
    """Mark a card mastered (out of the review queue) or bring it back. Nothing is deleted; KeyError if unknown."""
    now = now or _now()
    with _connect() as conn:
        updated = conn.execute(
            "UPDATE srs_cards SET archived_at = ? WHERE id = ? AND user_id = ?",
            (_iso(now) if archived else None, card_id, user_id),
        ).rowcount
        if not updated:
            raise KeyError(card_id)
        conn.commit()
        row = conn.execute(_CARD_WITH_NOTE_SQL + " AND c.id = ?", (user_id, card_id)).fetchone()
    return _card_payload(row, now, with_preview=True)


def patch_card_meta(user_id: int, card_id: str, meta: dict[str, Any]) -> dict[str, str]:
    """Fill the empty (or placeholder) snapshot fields of a card; never overwrites a real meaning."""
    clean = _clean_meta(meta)
    with _connect() as conn:
        row = conn.execute("SELECT target_json FROM srs_cards WHERE id = ? AND user_id = ?", (card_id, user_id)).fetchone()
        if not row:
            raise KeyError(card_id)
        current = json.loads(row["target_json"] or "{}")
        for key, value in clean.items():
            if key in _MEANING_KEYS and current.get(key) and not is_placeholder_meaning(current[key]):
                continue
            current[key] = value
        for key in _MEANING_KEYS:
            if is_placeholder_meaning(current.get(key)):
                current.pop(key)
        conn.execute("UPDATE srs_cards SET target_json = ? WHERE id = ?", (json.dumps(current, ensure_ascii=False), card_id))
        conn.commit()
    return current


def delete_card(user_id: int, card_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT note_id FROM srs_cards WHERE id = ? AND user_id = ?", (card_id, user_id)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM srs_cards WHERE id = ?", (card_id,))
        remaining = conn.execute("SELECT COUNT(*) FROM srs_cards WHERE note_id = ?", (row["note_id"],)).fetchone()[0]
        if remaining == 0:
            conn.execute("DELETE FROM srs_notes WHERE id = ?", (row["note_id"],))
        conn.commit()
    return True


def delete_note(user_id: int, note_id: str) -> bool:
    with _connect() as conn:
        deleted = conn.execute("DELETE FROM srs_notes WHERE id = ? AND user_id = ?", (note_id, user_id)).rowcount
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


def practice_queue(user_id: int, card_ids: list[str], now: datetime.datetime | None = None) -> dict[str, Any]:
    """The cards the learner picked, in their order, due or not. Ratings count as normal reviews."""
    now = now or _now()
    ids = list(dict.fromkeys(card_ids))
    if not ids:
        return {"cards": [], "counts": {"learning": 0, "review": 0, "new": 0, "total": 0}}
    with _connect() as conn:
        rows = conn.execute(
            _CARD_WITH_NOTE_SQL + f" AND c.id IN ({','.join('?' * len(ids))})", (user_id, *ids)
        ).fetchall()
    order = {card_id: index for index, card_id in enumerate(ids)}
    cards = [_card_payload(row, now, with_preview=True) for row in sorted(rows, key=lambda r: order[r["id"]])]
    return {
        "cards": cards,
        "counts": {
            "learning": sum(1 for c in cards if c["state"] in ("learning", "relearning")),
            "review": sum(1 for c in cards if c["state"] == "review"),
            "new": sum(1 for c in cards if c["state"] == "new"),
            "total": len(cards),
        },
    }


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
    new_limit: int | None = None,
    now: datetime.datetime | None = None,
    min_importance: int = 1,
    modes: Iterable[str] = (),
) -> dict[str, Any]:
    """Today's review queue: learning cards, then due reviews, then new cards.

    `modes` limits it to some card types (e.g. only "listen" while driving).

    Siblings are buried: a sentence contributes at most one card per day unless
    that card is still in its short learning steps, so "listen" comes first and
    "speak"/"cloze" of the same sentence follow on later days.
    """
    now = now or _now()
    if new_limit is None:  # not asked for explicitly: the learner's saved limit, synced across devices
        saved = get_new_limit(user_id)
        new_limit = DEFAULT_NEW_LIMIT if saved is None else saved
    day_start = study_day_start(now, tz_offset_minutes)
    # FSRS due times carry the time of day of the last review; like Anki, a
    # review card counts as due for the whole study day it falls on.
    day_end = _iso(day_start + datetime.timedelta(days=1))
    horizon = _iso(now + LEARN_AHEAD)

    with _connect() as conn:
        touched_notes, new_done, reviews_done = _today_activity(conn, user_id, day_start)
        rows = conn.execute(
            _CARD_WITH_NOTE_SQL + " AND c.archived_at IS NULL AND (c.is_new = 1 OR c.due <= ?) AND c.importance >= ?",
            (user_id, max(horizon, day_end), _clamp_importance(min_importance)),
        ).fetchall()

    wanted_modes = set(modes)
    learning, reviews, new_cards = [], [], []
    for row in rows:
        if wanted_modes and row["mode"] not in wanted_modes:
            continue
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
    new_cards.sort(
        key=lambda r: (-r["importance"], r["note_created_at"], MODE_ORDER.get(r["mode"], 9), r["created_at"])
    )

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
        row = conn.execute("SELECT * FROM srs_cards WHERE id = ? AND user_id = ?", (card_id, user_id)).fetchone()
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
                card_id,
                row["note_id"],
                user_id,
                rating,
                int(was_new),
                _iso(now),
                duration_ms,
                score,
                (answer or "")[:500] or None,
            ),
        )
        conn.commit()
        updated = conn.execute(_CARD_WITH_NOTE_SQL + " AND c.id = ?", (user_id, card_id)).fetchone()
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
        cards = conn.execute(_CARD_WITH_NOTE_SQL + " AND c.mode IN ('cloze', 'recognize')", (user_id,)).fetchall()
    return {
        "notes": [{"id": r["id"], "fr": r["sentence"], "zh": r["translation_zh"]} for r in notes],
        "cards": [
            {
                "id": r["id"],
                "word": r["target"],
                "sentence": r["sentence"],
                "zh": json.loads(r["target_json"] or "{}").get("meaning_zh", ""),
            }
            for r in cards
            if not json.loads(r["target_json"] or "{}").get("meaning_en")
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
        if meaning_zh.startswith("\U0001f4a1"):
            meaning_zh = meaning_zh.lstrip("\U0001f4a1 ").strip()
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
                            card_id,
                            row["id"],
                            row["user_id"],
                            json.dumps(fsrs_card.to_dict()),
                            _iso(fsrs_card.due),
                            _iso(now),
                            DEFAULT_IMPORTANCE,
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
    backfill_p.add_argument(
        "--max-words", type=int, default=25, help="Maximum sentence words for listen card (default 25)"
    )
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
