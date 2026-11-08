"""Optional one-off: give saved word cards a meaning snapshot (dictionary + this sentence).

New word cards keep the card's dictionary gloss and its meaning in the saved sentence in target_json
(dict_zh / dict_en / ctx_zh / ctx_en / why_zh, plus snap = "1") when they are saved, so the review page
renders them with no live lookup. This script fills the same keys for cards saved before that:

  * the sentence meaning (ctx_*, why_zh) comes from word_context_cache, when that word in that sentence
    was ever opened (no model call);
  * the dictionary gloss (dict_*) is the card's existing meaning when it differs from the sentence
    meaning, or, with --live-lookup, a fresh /api/lookup-style answer for the word.

Dry run by default: it opens the database read-only and prints what it would change.

    OUTPUT_DIR=/path/to/a/COPY AUTH_SECRET=... python scripts/backfill_card_snapshots.py            # dry run
    OUTPUT_DIR=/path/to/a/COPY AUTH_SECRET=... python scripts/backfill_card_snapshots.py --apply

It uses the same OUTPUT_DIR and AUTH_SECRET as the service. Run it on a copy first. Only target_json of
word cards (cloze / recognize) is updated, and only by adding keys; a card with "snap" is skipped, so
running it twice is harmless.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent if (HERE.parent / "auth_db.py").exists() else HERE))

import auth_db  # noqa: E402
import word_context  # noqa: E402


def cached_context(conn: sqlite3.Connection, user_id: int, sentence: str, target: str) -> dict[str, str] | None:
    """The first cached 语境 answer for `target` in `sentence`, read straight from the table."""
    clean_sentence = word_context.clean_sentence(sentence)
    word = word_context.clean_word(target)
    if not clean_sentence or not word:
        return None
    for occurrence in range(len(word_context.word_spans(word, clean_sentence))):
        key = word_context.cache_key(clean_sentence, word, occurrence)
        try:
            row = conn.execute(
                "SELECT result_json FROM word_context_cache WHERE user_id = ? AND key = ? AND version = ?",
                (user_id, key, word_context.VERSION),
            ).fetchone()
        except sqlite3.OperationalError:  # nobody ever asked for a 语境
            return None
        if row:
            try:
                result = word_context.clean_result(json.loads(row["result_json"]))
            except ValueError:
                result = None
            if result and not word_context.is_empty(result):
                return result
    return None


def live_dictionary(target: str) -> dict[str, str] | None:
    from routers import tutor
    from services import ai

    if not ai.SERVER_WEB2API_KEY:
        raise SystemExit("--live-lookup needs WEB2API_API_KEY (and AGY_BASE_URL) in the environment.")
    try:
        got = asyncio.run(tutor.request_word_lookup(target, ai.SERVER_WEB2API_KEY))
    except Exception as exc:  # noqa: BLE001 - one word failing must not stop the run
        print(f"  lookup failed for {target!r}: {exc}")
        return None
    return {"dict_zh": got.get("explanation_cn", ""), "dict_en": got.get("explanation_en", "")}


def snapshot_for(conn: sqlite3.Connection, row: sqlite3.Row, live: bool) -> dict[str, str] | None:
    meta = json.loads(row["target_json"] or "{}")
    if meta.get("snap"):
        return None
    update: dict[str, str] = {"snap": "1"}
    here = cached_context(conn, row["user_id"], row["sentence"], row["target"])
    if here:
        update.update(ctx_zh=here["meaning_zh"], ctx_en=here["meaning_en"], why_zh=here["why_zh"])
    old_zh, old_en = meta.get("meaning_zh", ""), meta.get("meaning_en", "")
    # What the card showed was the sentence meaning when it matches the cached 语境, else the dictionary's
    if (old_zh or old_en) and not (here and (old_zh, old_en) == (here["meaning_zh"], here["meaning_en"])):
        update.update(dict_zh=old_zh, dict_en=old_en)
    elif live:
        update.update(live_dictionary(row["target"]) or {})
    return {key: value for key, value in update.items() if value}


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the snapshots (default: dry run)")
    parser.add_argument("--live-lookup", action="store_true", help="ask the model for a missing dictionary gloss")
    parser.add_argument("--user", metavar="EMAIL", help="only this account")
    args = parser.parse_args(argv)

    db_path = auth_db._get_db_path()
    if not db_path.exists():
        raise SystemExit(f"No database at {db_path}.")
    print(f"Database: {db_path}")
    read = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    read.row_factory = sqlite3.Row
    query = (
        "SELECT c.id, c.user_id, c.target, c.target_json, n.sentence FROM srs_cards c "
        "JOIN srs_notes n ON n.id = c.note_id WHERE c.mode IN ('cloze', 'recognize')"
    )
    params: list = []
    if args.user:
        query += " AND c.user_id = (SELECT id FROM users WHERE email = ?)"
        params.append(args.user.strip().lower())
    changes: list[tuple[str, dict]] = []
    cards = 0
    try:
        for row in read.execute(query, params).fetchall():
            cards += 1
            update = snapshot_for(read, row, args.live_lookup)
            if update:
                changes.append((row["id"], {**json.loads(row["target_json"] or "{}"), **update}))
    finally:
        read.close()

    print(f"{cards} word cards, {len(changes)} without a snapshot.")
    if not args.apply:
        print("Dry run: nothing written. Use --apply to write.")
        return
    with auth_db.connect() as conn:
        for card_id, meta in changes:
            conn.execute("UPDATE srs_cards SET target_json = ? WHERE id = ?", (json.dumps(meta, ensure_ascii=False), card_id))
        conn.commit()
    print(f"Updated {len(changes)} cards.")


if __name__ == "__main__":
    main(sys.argv[1:])
