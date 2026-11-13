"""First-party usage recording: which screens, tabs and main buttons the learner uses.

The web app (web/src/lib/track.ts) sends small batches of events to POST /api/events. They are
stored here, in users.db, for RETENTION_DAYS and never leave the server. An event is a name, an
in-app route pattern and a few short properties. The checks below keep sentences and typed text
out by construction: a string property is one short token without spaces.

scripts/usage_report.py prints the summary (screens by time, top actions, funnels, errors).
"""

from __future__ import annotations

import datetime
import json
import math
import re
import threading
import time
from collections import Counter, defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from zoneinfo import ZoneInfo

import auth_db

RETENTION_DAYS = 180
MAX_EVENTS_PER_BATCH = 50
MAX_BODY_BYTES = 32 * 1024
MAX_PROPS = 8
MAX_CLOCK_SKEW_MS = 7 * 24 * 3600 * 1000
MAX_SCREEN_SECONDS = 4 * 3600  # one screen_time event never claims more than this
PURGE_INTERVAL_SECONDS = 3600
REPORT_TZ = ZoneInfo("America/Vancouver")

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
ROUTE_RE = re.compile(r"^[a-z0-9/_:-]{0,60}$")
SESSION_RE = re.compile(r"^[a-z0-9]{8,32}$")
PROP_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/-]{0,40}$")


def _create(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ui_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            route TEXT NOT NULL DEFAULT '',
            props_json TEXT NOT NULL DEFAULT '{}',
            ts INTEGER NOT NULL,
            received_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ui_events_user_ts ON ui_events(user_id, ts);
        CREATE INDEX IF NOT EXISTS idx_ui_events_ts ON ui_events(ts);
        """
    )


@contextmanager
def _connect() -> Iterator[Any]:
    with auth_db.connect() as conn:
        auth_db.ensure_schema(conn, "usage", _create)
        yield conn


def _now_ms() -> int:
    return int(time.time() * 1000)


def clean_props(props: Any) -> dict[str, Any]:
    """Keep at most MAX_PROPS flat properties whose values are booleans, finite numbers or short tokens."""
    if not isinstance(props, dict):
        return {}
    out: dict[str, Any] = {}
    for key, value in props.items():
        if len(out) >= MAX_PROPS:
            break
        if not isinstance(key, str) or not PROP_KEY_RE.match(key):
            continue
        if isinstance(value, bool):
            out[key] = value
        elif isinstance(value, (int, float)):
            if math.isfinite(value) and abs(value) <= 10**9:
                out[key] = round(value, 3) if isinstance(value, float) else value
        elif isinstance(value, str) and TOKEN_RE.match(value):
            out[key] = value
    return out


def clean_event(event: dict[str, Any], now_ms: int) -> tuple[str, str, str, int] | None:
    """(name, route, props_json, ts) for a valid event, None for one to drop."""
    name = event.get("name")
    route = event.get("route") or ""
    if not isinstance(name, str) or not NAME_RE.match(name):
        return None
    if not isinstance(route, str) or not ROUTE_RE.match(route):
        return None
    ts = event.get("ts")
    if not isinstance(ts, int) or isinstance(ts, bool) or abs(ts - now_ms) > MAX_CLOCK_SKEW_MS:
        ts = now_ms
    props = clean_props(event.get("props"))
    return name, route, json.dumps(props, separators=(",", ":"), sort_keys=True), ts


_purge_lock = threading.Lock()
_last_purge = 0.0


def purge_old(now_ms: int | None = None) -> int:
    """Delete events older than RETENTION_DAYS. Returns how many were deleted."""
    cutoff = (now_ms if now_ms is not None else _now_ms()) - RETENTION_DAYS * 24 * 3600 * 1000
    with _connect() as conn:
        return conn.execute("DELETE FROM ui_events WHERE ts < ?", (cutoff,)).rowcount


def _maybe_purge() -> None:
    global _last_purge
    now = time.monotonic()
    with _purge_lock:
        if _last_purge and now - _last_purge < PURGE_INTERVAL_SECONDS:
            return
        _last_purge = now
    purge_old()


def record(user_id: int, session: str, events: list[dict[str, Any]]) -> dict[str, int]:
    """Store a batch for a signed-in user. Invalid events are dropped, not rejected."""
    now = _now_ms()
    session = session if isinstance(session, str) and SESSION_RE.match(session) else ""
    rows = []
    for event in events[:MAX_EVENTS_PER_BATCH]:
        cleaned = clean_event(event, now) if isinstance(event, dict) else None
        if cleaned:
            rows.append((user_id, session, *cleaned, now))
    if rows:
        with _connect() as conn:
            conn.executemany(
                "INSERT INTO ui_events (user_id, session, name, route, props_json, ts, received_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
    _maybe_purge()
    return {"stored": len(rows), "dropped": len(events) - len(rows)}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def _day_bounds_ms(start: datetime.date, end: datetime.date) -> tuple[int, int]:
    """[start 00:00, end+1 00:00) in REPORT_TZ, as epoch milliseconds."""
    lo = datetime.datetime.combine(start, datetime.time(), REPORT_TZ)
    hi = datetime.datetime.combine(end + datetime.timedelta(days=1), datetime.time(), REPORT_TZ)
    return int(lo.timestamp() * 1000), int(hi.timestamp() * 1000)


def load_events(user_id: int, start: datetime.date, end: datetime.date) -> list[dict[str, Any]]:
    lo, hi = _day_bounds_ms(start, end)
    with _connect() as conn:
        rows = conn.execute(
            "SELECT session, name, route, props_json, ts FROM ui_events"
            " WHERE user_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id",
            (user_id, lo, hi),
        ).fetchall()
    return [
        {"session": r["session"], "name": r["name"], "route": r["route"], "props": json.loads(r["props_json"]), "ts": r["ts"]}
        for r in rows
    ]


# Funnels: ordered steps within one page session (tab). A step is (event name, {prop: value} filter).
FUNNELS: dict[str, list[tuple[str, dict[str, Any]]]] = {
    "word tap -> add to review saved": [
        ("word_tap", {}),
        ("add_review_open", {}),
        ("add_review_saved", {}),
    ],
    "review session -> check answer": [
        ("screen_view", {"_route": "review/session"}),
        ("check_answer", {"screen": "review"}),
    ],
    "history open -> open in study": [
        ("history_open", {}),
        ("history_reopen", {}),
    ],
}


def _matches(event: dict[str, Any], name: str, where: dict[str, Any]) -> bool:
    if event["name"] != name:
        return False
    for key, value in where.items():
        actual = event["route"] if key == "_route" else event["props"].get(key)
        if actual != value:
            return False
    return True


def funnel(events: list[dict[str, Any]], steps: list[tuple[str, dict[str, Any]]]) -> list[int]:
    """How many sessions reached each step, in order (events must be sorted by time)."""
    by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        by_session[e["session"]].append(e)
    reached = [0] * len(steps)
    for session_events in by_session.values():
        step = 0
        for e in session_events:
            if step < len(steps) and _matches(e, *steps[step]):
                reached[step] += 1
                step += 1
    return reached


def summarize(events: list[dict[str, Any]]) -> dict[str, Any]:
    screen_seconds: Counter[str] = Counter()
    screen_views: Counter[str] = Counter()
    actions: Counter[str] = Counter()
    tabs: Counter[str] = Counter()
    plays: Counter[str] = Counter()
    errors: Counter[tuple[str, str]] = Counter()
    checks: dict[str, Counter[str]] = defaultdict(Counter)
    days: set[datetime.date] = set()
    for e in events:
        days.add(datetime.datetime.fromtimestamp(e["ts"] / 1000, REPORT_TZ).date())
        name, props = e["name"], e["props"]
        if name == "screen_time":
            seconds = props.get("seconds")
            if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds > 0:
                screen_seconds[e["route"]] += min(float(seconds), MAX_SCREEN_SECONDS)
            continue
        if name == "screen_view":
            screen_views[e["route"]] += 1
            continue
        actions[name] += 1
        if name == "tab_view":
            tabs[str(props.get("tab", "?"))] += 1
        elif name == "play":
            plays[str(props.get("owner", "?"))] += 1
        elif name == "error_shown":
            errors[(str(props.get("msg", "?")), e["route"])] += 1
        elif name == "check_answer":
            screen = str(props.get("screen", "?"))
            checks[screen]["total"] += 1
            if props.get("correct") is True:
                checks[screen]["correct"] += 1
    routes = set(screen_seconds) | set(screen_views)
    screens = sorted(
        ({"route": r, "seconds": round(screen_seconds[r]), "views": screen_views[r]} for r in routes),
        key=lambda s: (-s["seconds"], -s["views"], s["route"]),
    )
    return {
        "events": len(events),
        "sessions": len({e["session"] for e in events}),
        "active_days": len(days),
        "screens": screens,
        "actions": actions.most_common(),
        "tabs": tabs.most_common(),
        "plays": plays.most_common(),
        "checks": {k: dict(v) for k, v in checks.items()},
        "errors": [{"msg": m, "route": r, "count": n} for (m, r), n in errors.most_common()],
        "funnels": {label: funnel(events, steps) for label, steps in FUNNELS.items()},
    }


def report(user_id: int, start: datetime.date, end: datetime.date) -> dict[str, Any]:
    summary = summarize(load_events(user_id, start, end))
    summary.update({"user_id": user_id, "from": start.isoformat(), "to": end.isoformat()})
    return summary


def format_report(r: dict[str, Any]) -> str:
    def minutes(seconds: float) -> str:
        return f"{seconds / 60:.1f} min"

    lines = [
        f"Usage {r['from']} .. {r['to']} (America/Vancouver), user {r['user_id']}",
        f"{r['events']} events, {r['sessions']} page sessions, {r['active_days']} active days",
        "",
        "Screens by time:",
    ]
    lines += [f"  {s['route'] or '(none)':<28} {minutes(s['seconds']):>10}  {s['views']:>4} views" for s in r["screens"]]
    lines += ["", "Top actions:"]
    lines += [f"  {name:<28} {count:>6}" for name, count in r["actions"]]
    if r["tabs"]:
        lines += ["", "Study tabs:"] + [f"  {tab:<28} {count:>6}" for tab, count in r["tabs"]]
    if r["plays"]:
        lines += ["", "Play by source:"] + [f"  {owner:<28} {count:>6}" for owner, count in r["plays"]]
    if r["checks"]:
        lines += ["", "Answers checked:"]
        for screen, c in sorted(r["checks"].items()):
            total, correct = c.get("total", 0), c.get("correct", 0)
            lines.append(f"  {screen:<28} {total:>6}  {round(100 * correct / total) if total else 0}% correct")
    lines += ["", "Funnels (page sessions reaching each step):"]
    for label, counts in r["funnels"].items():
        lines.append(f"  {label}: " + " -> ".join(str(n) for n in counts))
    lines += ["", "Errors seen:"]
    lines += [f"  {e['msg']:<40} {e['route']:<22} {e['count']:>4}" for e in r["errors"]] or ["  (none)"]
    return "\n".join(lines)
