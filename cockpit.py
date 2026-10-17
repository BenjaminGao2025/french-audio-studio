"""
French Audio Studio - the daily cockpit (PRD M1).

Today's plan: blocks from a weekly template with a planned -> active -> done/skipped lifecycle,
and a 20-minute "minimal" day. A block kind is only planned once its page and backend exist
(ENABLED_KINDS), so a day never contains a dead end.

Nothing here calls an AI model. It shares users.db with game.py and srs.py and reads their
study_time table. Targets still come from game.py's constants (24 h/week); the PRD's 16 h/week
and phase_configs are a separate product decision.
"""

from __future__ import annotations

import datetime
import json
import sqlite3
import uuid
from typing import Any, NamedTuple

import auth_db
import game
import srs

SKIP_REASONS = ("no_time", "too_hard", "health", "family")
MILESTONES = (100, 300, 500, 750, 1000)

# Block kinds whose page and backend exist in this build. journal (homework), listening,
# reading and checkpoint blocks join the plan when their backends land.
ENABLED_KINDS = frozenset({"warmup", "review", "writing", "course", "minimal"})

PHASE_A = {"id": "A", "name": "Phase A (0–300h)", "hours_from": 0, "hours_to": 300}
PHASE_MAINTENANCE = {"id": "maintenance", "name": "Maintenance (5 h/week)", "hours_from": 480, "hours_to": 585}


class Slot(NamedTuple):
    slot: str  # stable key, so a template can be re-applied without duplicating a finished block
    kind: str
    title: str
    planned_min: int
    route: str
    lane: str
    start_time: str


WARMUP = Slot("warmup", "warmup", "Speaking warm-up · 10 cards", 10, "/cards?modes=speak,listen&new_limit=0", "review", "09:00")
JOURNAL = Slot("journal", "journal", "“Say what I want to say” journal", 45, "/journal", "speaking", "09:10")
REVIEW = Slot("review", "review", "Review queue", 10, "/cards", "review", "10:00")
LISTENING = Slot("main1", "listening", "Main block 1 · Listening 3-step", 60, "/listening", "listening", "10:10")
READING = Slot("main1", "reading", "Main block 1 · Intensive reading", 60, "/reading", "reading", "10:10")
WRITING = Slot("main2", "writing", "Main block 2 · Writing T1 practice", 40, "/writing", "writing", "11:15")
COURSE = Slot("main2", "course", "Main block 2 · Course or textbook (log the time)", 40, "/hours", "course", "11:15")
WEEKLY_REVIEW = Slot("main2", "review", "Main block 2 · Weekly review", 40, "/cards?new_limit=0", "review", "11:15")
WRAPUP = Slot("wrapup", "minimal", "Wrap-up", 5, "/wrapup", "review", "11:55")
TUTOR = Slot("main1", "course", "Tutor lesson (log it afterwards)", 120, "/tutor", "speaking", "10:00")
SUNDAY_REVIEW = Slot("main1", "review", "Weekly review · due cards", 90, "/cards", "review", "10:00")

# PRD 6.1 and appendix C (phase A), Monday = 0.
WEEK_TEMPLATE: dict[int, tuple[Slot, ...]] = {
    0: (WARMUP, JOURNAL, REVIEW, LISTENING, WRITING, WRAPUP),
    1: (WARMUP, JOURNAL, REVIEW, READING, COURSE, WRAPUP),
    2: (WARMUP, JOURNAL, REVIEW, LISTENING, WRITING, WRAPUP),
    3: (WARMUP, JOURNAL, REVIEW, READING, COURSE, WRAPUP),
    4: (WARMUP, JOURNAL, REVIEW, LISTENING, WEEKLY_REVIEW, WRAPUP),
    5: (TUTOR, WRAPUP),
    6: (SUNDAY_REVIEW, WRAPUP),
}
# PRD 6.3: ten cards, one listening item, a short journal.
MINIMAL_TEMPLATE: tuple[Slot, ...] = (
    Slot("min_review", "review", "Review 10 cards", 8, "/cards?new_limit=0", "review", ""),
    Slot("min_listening", "listening", "One listening 3-step item", 7, "/listening", "listening", ""),
    Slot("min_journal", "journal", "Journal-lite · 30 words + shadow + one recording", 5, "/journal", "speaking", ""),
    WRAPUP._replace(start_time=""),
)

# PRD 13.2 #11: shown at the top of Today until done. id is deterministic, so seeding is idempotent.
SEED_TODOS = (
    ("tutor", "选定外教 · Choose a tutor", "2026-11-01"),
    ("placement", "完成分级测试 · Take the placement test", "2026-11-29"),
)

_initialized_db_paths: set[str] = set()


def init_db() -> None:
    db_path = str(auth_db._get_db_path())
    if db_path in _initialized_db_paths:
        return
    game.init_db()  # study_time and the srs tables
    with srs._connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS day_plans (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                minimal INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            CREATE TABLE IF NOT EXISTS day_blocks (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                position INTEGER NOT NULL,
                slot TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                route TEXT NOT NULL,
                lane TEXT NOT NULL,
                start_time TEXT NOT NULL DEFAULT '',
                planned_min INTEGER NOT NULL,
                actual_sec INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'planned',
                skip_reason TEXT,
                material_ids_json TEXT NOT NULL DEFAULT '[]',
                started_at TEXT,
                finished_at TEXT,
                UNIQUE (user_id, day, position)
            );
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                due TEXT,
                done_at TEXT,
                kind TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
            """
        )
    _initialized_db_paths.add(db_path)


def _connect():
    init_db()
    return srs._connect()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _in_maintenance(day: datetime.date) -> bool:
    return game.MAINTENANCE[0] <= day <= game.MAINTENANCE[1]


def phase_info(day: datetime.date | None = None) -> dict[str, Any]:
    """The current phase. Constants for now (no phase_configs table): targets mirror game.py."""
    day = day or game.local_day(_now(), 0)
    base = PHASE_MAINTENANCE if _in_maintenance(day) else PHASE_A
    return {**base, "week_target_min": game.week_target(day)}


# ---------------------------------------------------------------------------
# Today's plan
# ---------------------------------------------------------------------------
def _template(day: datetime.date, minimal: bool) -> list[Slot]:
    slots = MINIMAL_TEMPLATE if minimal else WEEK_TEMPLATE[day.weekday()]
    return [s for s in slots if s.kind in ENABLED_KINDS]


def _insert_blocks(
    conn: sqlite3.Connection, user_id: int, day: str, slots: list[Slot], skip: frozenset[str] | set[str] = frozenset()
) -> None:
    position = conn.execute(
        "SELECT COALESCE(MAX(position), 0) FROM day_blocks WHERE user_id = ? AND day = ?", (user_id, day)
    ).fetchone()[0]
    for s in slots:
        if s.slot in skip:
            continue
        position += 1
        conn.execute(
            """
            INSERT INTO day_blocks (id, user_id, day, position, slot, kind, title, route, lane, start_time, planned_min)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (uuid.uuid4().hex, user_id, day, position, s.slot, s.kind, s.title, s.route, s.lane, s.start_time, s.planned_min),
        )


def _ensure_plan(conn: sqlite3.Connection, user_id: int, day: datetime.date, now: datetime.datetime) -> bool:
    """Create the day's plan on first use; returns whether it is a minimal day.

    The day_plans row is the claim: only the call whose INSERT succeeds generates the blocks, so
    two page loads at once cannot both do it. The maintenance period defaults to minimal days.
    """
    cursor = conn.execute(
        "INSERT OR IGNORE INTO day_plans (user_id, day, minimal, created_at) VALUES (?, ?, ?, ?)",
        (user_id, day.isoformat(), int(_in_maintenance(day)), srs._iso(now)),
    )
    if cursor.rowcount:
        _insert_blocks(conn, user_id, day.isoformat(), _template(day, _in_maintenance(day)))
    row = conn.execute(
        "SELECT minimal FROM day_plans WHERE user_id = ? AND day = ?", (user_id, day.isoformat())
    ).fetchone()
    return bool(row["minimal"])


def _seed_todos(conn: sqlite3.Connection, user_id: int) -> None:
    for kind, title, due in SEED_TODOS:
        conn.execute(
            "INSERT OR IGNORE INTO todos (id, user_id, title, due, kind) VALUES (?, ?, ?, ?, ?)",
            (f"seed-{kind}-{user_id}", user_id, title, due, kind),
        )


def _block(row: sqlite3.Row) -> dict[str, Any]:
    block = {
        "id": row["id"],
        "position": row["position"],
        "kind": row["kind"],
        "title": row["title"],
        "planned_min": row["planned_min"],
        "actual_sec": row["actual_sec"],
        "status": row["status"],
        "route": row["route"],
        "lane": row["lane"],
        "material_ids": json.loads(row["material_ids_json"] or "[]"),
    }
    if row["start_time"]:
        block["start_time"] = row["start_time"]
    return block


def _todo(row: sqlite3.Row) -> dict[str, Any]:
    todo = {"id": row["id"], "text": row["title"], "done": bool(row["done_at"])}
    if row["due"]:
        todo["due"] = row["due"]
    return todo


def _counted_hours(conn: sqlite3.Connection, user_id: int) -> float:
    """Active + manual hours, car lane excluded (PRD 11.3)."""
    seconds = conn.execute(
        "SELECT COALESCE(SUM(seconds), 0) FROM study_time WHERE user_id = ? AND lane != 'car'", (user_id,)
    ).fetchone()[0]
    return seconds / 3600


def _next_milestone(counted_hours: float) -> tuple[int, float]:
    target = next((m for m in MILESTONES if m > counted_hours), MILESTONES[-1])
    return target, max(0.0, round(target - counted_hours, 2))


def _today_payload(conn: sqlite3.Connection, user_id: int, day: datetime.date, minimal: bool) -> dict[str, Any]:
    blocks = conn.execute(
        "SELECT * FROM day_blocks WHERE user_id = ? AND day = ? ORDER BY position", (user_id, day.isoformat())
    ).fetchall()
    todos = conn.execute(
        "SELECT * FROM todos WHERE user_id = ? AND done_at IS NULL ORDER BY due IS NULL, due, id", (user_id,)
    ).fetchall()
    yesterday = (day - datetime.timedelta(days=1)).isoformat()
    done, total = conn.execute(
        "SELECT COALESCE(SUM(status = 'done'), 0), COUNT(*) FROM day_blocks WHERE user_id = ? AND day = ?",
        (user_id, yesterday),
    ).fetchone()
    active_sec = conn.execute(
        "SELECT COALESCE(SUM(seconds), 0) FROM study_time WHERE user_id = ? AND day = ? AND lane != 'car'",
        (user_id, yesterday),
    ).fetchone()[0]
    milestone, to_go = _next_milestone(_counted_hours(conn, user_id))
    return {
        "minimal": minimal,
        "day": day.isoformat(),
        "phase": phase_info(day),
        "blocks": [_block(b) for b in blocks],
        "materials_ready": False,  # no nightly pre-generation job yet
        "fallback": False,
        "todos": [_todo(t) for t in todos],
        "yesterday": {"blocks_done": done, "blocks_total": total, "active_minutes": round(active_sec / 60)},
        "next_milestone": {"hours": milestone, "hours_to_go": to_go},
    }


def today(user_id: int, tz_offset: int = 0, now: datetime.datetime | None = None) -> dict[str, Any]:
    now = now or _now()
    day = game.local_day(now, tz_offset)
    with _connect() as conn:
        minimal = _ensure_plan(conn, user_id, day, now)
        _seed_todos(conn, user_id)
        return _today_payload(conn, user_id, day, minimal)


def set_minimal(user_id: int, on: bool, tz_offset: int = 0, now: datetime.datetime | None = None) -> dict[str, Any]:
    """Switch today between the full plan and the 20-minute day.

    Planned blocks are replaced by the other template; blocks already started, done or skipped
    stay, and a template slot that is already represented by one of them is not added again.
    """
    now = now or _now()
    day = game.local_day(now, tz_offset)
    with _connect() as conn:
        current = _ensure_plan(conn, user_id, day, now)
        _seed_todos(conn, user_id)
        if current != on:
            conn.execute(
                "UPDATE day_plans SET minimal = ? WHERE user_id = ? AND day = ?", (int(on), user_id, day.isoformat())
            )
            conn.execute(
                "DELETE FROM day_blocks WHERE user_id = ? AND day = ? AND status = 'planned'", (user_id, day.isoformat())
            )
            kept = {
                r["slot"]
                for r in conn.execute("SELECT slot FROM day_blocks WHERE user_id = ? AND day = ?", (user_id, day.isoformat()))
            }
            _insert_blocks(conn, user_id, day.isoformat(), _template(day, on), kept)
        return _today_payload(conn, user_id, day, on)


def _own_block(conn: sqlite3.Connection, user_id: int, block_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM day_blocks WHERE id = ? AND user_id = ?", (block_id, user_id)).fetchone()
    if not row:
        raise KeyError(block_id)
    return row


def start_block(user_id: int, block_id: str, now: datetime.datetime | None = None) -> dict[str, Any]:
    """planned -> active. Anything else is left alone, so calling it again is harmless."""
    now = now or _now()
    with _connect() as conn:
        row = _own_block(conn, user_id, block_id)
        if row["status"] == "planned":
            conn.execute(
                "UPDATE day_blocks SET status = 'active', started_at = ? WHERE id = ?", (srs._iso(now), block_id)
            )
        return _block(_own_block(conn, user_id, block_id))


def finish_block(user_id: int, block_id: str, now: datetime.datetime | None = None) -> dict[str, Any]:
    """-> done. actual_sec is the time since start, capped at twice the plan (a tab left open)."""
    now = now or _now()
    with _connect() as conn:
        row = _own_block(conn, user_id, block_id)
        if row["status"] != "done":
            actual = 0
            if row["started_at"]:
                elapsed = (now - datetime.datetime.fromisoformat(row["started_at"])).total_seconds()
                actual = int(max(0, min(elapsed, row["planned_min"] * 60 * 2)))
            conn.execute(
                "UPDATE day_blocks SET status = 'done', finished_at = ?, actual_sec = ? WHERE id = ?",
                (srs._iso(now), actual, block_id),
            )
        return _block(_own_block(conn, user_id, block_id))


def skip_block(user_id: int, block_id: str, reason: str) -> dict[str, Any]:
    if reason not in SKIP_REASONS:
        raise ValueError(f"unknown skip reason: {reason}")
    with _connect() as conn:
        row = _own_block(conn, user_id, block_id)
        if row["status"] != "done":
            conn.execute("UPDATE day_blocks SET status = 'skipped', skip_reason = ? WHERE id = ?", (reason, block_id))
        return _block(_own_block(conn, user_id, block_id))
