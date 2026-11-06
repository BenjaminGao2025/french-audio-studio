"""Free disk space in outputs/: delete old, unreferenced cached TTS snippets and stale temp files.

Short texts (up to 600 characters) are synthesised once and cached as
outputs/TTS_<voice>_snip_<hash>.mp3 + .srt, and nothing ever removed them. A snippet is
re-created on demand the next time it is played (/tts, listening checks, homework references),
so deleting an old one costs at most one more synthesis. Kept regardless of age: any snippet whose
file name appears anywhere in the database (history records, homework, ...).

Dry run by default: it lists what it would delete and how much space that frees.

    docker exec tts-service python scripts/prune_outputs.py                 # dry run
    docker exec tts-service python scripts/prune_outputs.py --apply         # delete
    docker exec tts-service python scripts/prune_outputs.py --days 30 --apply

Reads OUTPUT_DIR like the service (default ./outputs). Opens the database read-only.
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

SNIPPET_RE = re.compile(r"TTS_[A-Za-z]{2}-[A-Za-z]{2}-[A-Za-z]+Neural(?:@[0-9.]+)?_snip_[0-9a-f]{32}\.(?:mp3|srt)")
PART_MAX_AGE_SECONDS = 24 * 3600  # an unfinished synthesis left behind by a crash


def output_dir() -> Path:
    return Path(os.getenv("OUTPUT_DIR", "./outputs")).resolve()


def referenced_names(db_path: Path) -> set[str]:
    """Every snippet file name mentioned in any row of any table.

    Raises FileNotFoundError without a database: with no references to protect, every old
    snippet would look unreferenced (a wrong OUTPUT_DIR must never delete files still in use).
    """
    if not db_path.is_file():
        raise FileNotFoundError(f"No database at {db_path}")
    names: set[str] = set()
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for line in conn.iterdump():
            names.update(SNIPPET_RE.findall(line))
    finally:
        conn.close()
    return names


def candidates(directory: Path, days: float, now: float | None = None) -> list[Path]:
    now = time.time() if now is None else now
    keep = referenced_names(directory / "users.db")
    found = []
    for path in directory.iterdir():
        if not path.is_file():
            continue
        age = now - path.stat().st_mtime
        if SNIPPET_RE.fullmatch(path.name):
            if age > days * 86400 and path.name not in keep:
                found.append(path)
        elif path.name.startswith("TTS_") and path.name.endswith(".part") and age > PART_MAX_AGE_SECONDS:
            found.append(path)
    return sorted(found)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--days", type=float, default=60, help="delete snippets not modified for this many days")
    parser.add_argument("--apply", action="store_true", help="delete (default: dry run)")
    args = parser.parse_args(argv)
    directory = output_dir()
    try:
        found = candidates(directory, args.days)
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}; refusing to prune without it", file=sys.stderr)
        return 1
    total = sum(path.stat().st_size for path in found)
    for path in found:
        if args.apply:
            path.unlink(missing_ok=True)
    verb = "Deleted" if args.apply else "Would delete"
    print(f"{verb} {len(found)} files, {total / 1e6:.1f} MB, in {directory}")
    if not args.apply and found:
        print("Dry run. Re-run with --apply to delete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
