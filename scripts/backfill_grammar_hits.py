"""Optional one-off: fill grammar_hits from study history saved before hits were recorded.

New study history records grammar hits as it is saved (routers/history.py). This script reads
existing "study" history records and adds a hit for every (grammar id, sentence) they contain.
Only analyses made after the analyzer started returning "structure" / "grammar_ids" carry ids;
older records have none and are skipped, so re-analysing a text is the way to light them up.

Dry run by default: it only reads the database (read-only connection) and prints what it would add.

    # inside the production container (the script is not in the image, copy it in first)
    docker cp scripts/backfill_grammar_hits.py tts-service:/app/backfill_grammar_hits.py
    docker exec tts-service python backfill_grammar_hits.py                  # dry run
    docker exec tts-service python backfill_grammar_hits.py --apply          # write
    docker exec tts-service python backfill_grammar_hits.py --user you@example.com --apply

It needs the same OUTPUT_DIR and AUTH_SECRET as the service (auth_db refuses to load without the
secret). Writes are INSERT OR IGNORE into grammar_hits only, so running it twice is harmless and
no existing table or row is changed.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent if (HERE.parent / "auth_db.py").exists() else HERE))

import auth_db  # noqa: E402
import grammar  # noqa: E402


def study_records(conn: sqlite3.Connection, email: str | None):
    query = "SELECT h.id, h.user_id, h.payload_json FROM history_records h"
    params: list = []
    if email:
        query += " JOIN users u ON u.id = h.user_id WHERE u.email = ? AND"
        params.append(email.strip().lower())
    else:
        query += " WHERE"
    query += " h.record_type = 'study' AND h.user_id IS NOT NULL AND h.user_id != 0 ORDER BY h.created_at"
    for row in conn.execute(query, params):
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, ValueError):
            continue
        yield row["id"], row["user_id"], payload.get("sentences") if isinstance(payload, dict) else None


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the hits (default: dry run)")
    parser.add_argument("--user", metavar="EMAIL", help="only this account")
    args = parser.parse_args(argv)

    db_path = auth_db._get_db_path()
    if not db_path.exists():
        raise SystemExit(f"No database at {db_path}.")
    read = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    read.row_factory = sqlite3.Row
    records = with_ids = pairs = added = 0
    try:
        for history_id, user_id, sentences in study_records(read, args.user):
            records += 1
            hits = grammar.hits_from_sentences(sentences)
            if not hits:
                continue
            with_ids += 1
            pairs += len(hits)
            if args.apply:
                added += auth_db.record_grammar_hits(int(user_id), hits, history_id)
    finally:
        read.close()

    print(f"{records} study records, {with_ids} with grammar ids, {pairs} (grammar id, sentence) pairs.")
    print(f"Added {added} new hits." if args.apply else "Dry run: nothing written. Use --apply to write.")


if __name__ == "__main__":
    main(sys.argv[1:])
