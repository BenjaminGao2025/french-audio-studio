"""Copy outputs/users.db to outputs/backups/ with SQLite's online backup, keeping the newest N.

The deploy workflow runs this before every release, so a bad migration can be undone:

    docker run --rm -v "$PWD/outputs:/app/outputs" --entrypoint python deploygrow-tts:candidate \
        scripts/backup_db.py --label <commit>

Safe while the service is running: the backup API copies a consistent snapshot even mid-write.
These copies sit on the same disk as the database; copy outputs/backups/ elsewhere for real
off-machine backups.
"""
from __future__ import annotations

import argparse
import datetime
import os
import re
import sqlite3
import sys
from pathlib import Path


def backup(output_dir: Path, label: str = "", keep: int = 14) -> Path | None:
    source_path = output_dir / "users.db"
    if not source_path.exists():
        return None
    backups = output_dir / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = f"-{re.sub(r'[^0-9A-Za-z_.-]', '', label)[:40]}" if label else ""
    target = backups / f"users-{stamp}{suffix}.db"
    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    dest = sqlite3.connect(target)
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()
    for old in sorted(backups.glob("users-*.db"))[:-keep] if keep > 0 else []:
        old.unlink(missing_ok=True)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--label", default="", help="appended to the file name, e.g. the commit")
    parser.add_argument("--keep", type=int, default=14, help="how many backups to keep")
    args = parser.parse_args(argv)
    output_dir = Path(os.getenv("OUTPUT_DIR", "./outputs")).resolve()
    target = backup(output_dir, args.label, args.keep)
    print(f"Backed up to {target}" if target else f"No database at {output_dir / 'users.db'}; nothing to back up")
    return 0


if __name__ == "__main__":
    sys.exit(main())
