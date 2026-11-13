"""Print how one account used the web app: screens by time, top actions, funnels and errors.

Reads the first-party ui_events table (usage.py). It also deletes events older than the retention
period (180 days) before reporting, the same cleanup the service runs while recording.

    # inside the production container (scripts/ ships in the image)
    docker exec tts-service python scripts/usage_report.py --email you@example.com
    docker exec tts-service python scripts/usage_report.py --email you@example.com --from 2026-11-01 --to 2026-11-13
    docker exec tts-service python scripts/usage_report.py --email you@example.com --days 7 --json

Dates are inclusive days in America/Vancouver. It needs the same OUTPUT_DIR and AUTH_SECRET as the
service (auth_db refuses to load without the secret).
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent if (HERE.parent / "auth_db.py").exists() else HERE))

import auth_db  # noqa: E402
import usage  # noqa: E402


def _date(value: str) -> datetime.date:
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {value}")


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--email", required=True, help="the account to report on")
    parser.add_argument("--from", dest="start", type=_date, help="first day (default: --days before --to)")
    parser.add_argument("--to", dest="end", type=_date, help="last day (default: today)")
    parser.add_argument("--days", type=int, default=30, help="range length when --from is not given (default 30)")
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = parser.parse_args(argv)

    end = args.end or datetime.datetime.now(usage.REPORT_TZ).date()
    start = args.start or end - datetime.timedelta(days=max(1, args.days) - 1)
    if start > end:
        raise SystemExit("--from is after --to.")
    with auth_db.connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (args.email.strip(),)).fetchone()
    if not row:
        raise SystemExit(f"No account for {args.email}.")

    usage.purge_old()
    result = usage.report(int(row["id"]), start, end)
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else usage.format_report(result))


if __name__ == "__main__":
    main(sys.argv[1:])
