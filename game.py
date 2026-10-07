"""
French Audio Studio - study time, XP and hero level ("the game").

Built around the learner's own plan (TCF Canada, NCLC 7 = about B2 in all four skills):
  * Hero level = effective study time: one level per hour (60 XP), level 1000 =
    1000 hours, the "1000H" goal. NCLC 7 is about B2 in all four skills; B2 takes
    about 480-620 guided hours from zero (Alliance Française / Cambridge planning
    figures) plus TCF practice, so the first exam window comes around level
    600-750 and 1000 leaves room to spare.
  * Effective time: focused study counts fully; listening in the car or while
    walking counts half (attention is on the road), a judgment call, not a study
    result.
  * XP: 1 per effective minute (tracked in the app or logged by hand) up to 5
    hours a day, half after that.
    Reviews add Again 1 / Hard 2 / Good 4 / Easy 5, +3 for a card's first review,
    a combo bonus while answers keep coming Good/Easy, and +10 for the day's
    first Good/Easy ("First blood"). Clearing today's queue gives +20 once a day.
  * Targets are weekly (24 h); weekdays aim for 4 h, weekend days for 2 h, family
    days for nothing. Only weekdays count for the streak, and family days never
    break it.
"""

from __future__ import annotations

import datetime
from typing import Any

import auth_db
import srs


LANE_WEEK_TARGETS = {  # raw minutes per week (24 effective hours in total)
    "course": 180,       # weekday mornings, as in the plan
    "listening": 210,
    "reading": 150,
    "speaking": 240,     # incl. 2 h with the teacher + a weekend hour
    "writing": 210,      # TCF EE practice (increased from 120)
    "review": 150,       # cards (decreased from 240, sum stays 1440 min)
    "car": 600,          # car and walk listening: 10 h heard = 5 effective hours
}
LANE_WEIGHTS = {"car": 0.5}
LANES = tuple(LANE_WEEK_TARGETS)

TCF_SKILL_LANES = {
    "CO": ("listening", "car"),
    "CE": ("reading",),
    "EE": ("writing",),
    "EO": ("speaking",),
    "shared": ("course", "review"),
}
TCF_SKILL_LINKS = {
    "CO": "/listen",
    "CE": "/study",
    "EE": "/write",
    "EO": "/speak",
}
PLAN_START = datetime.date(2026, 10, 5)  # week 1 of the plan
WEEK_TARGET_MIN = round(sum(m * LANE_WEIGHTS.get(lane, 1) for lane, m in LANE_WEEK_TARGETS.items()))
MAINTENANCE_WEEK_TARGET_MIN = 300  # May-Aug 2027 (new baby): 5 h a week
MAINTENANCE = (datetime.date(2027, 5, 1), datetime.date(2027, 8, 31))
WEEKDAY_TARGET_MIN = 240
WEEKEND_TARGET_MIN = 120
DAY_FULL_XP_MIN = 300  # beyond 5 effective hours a day, XP is halved
STREAK_MIN = 30  # minutes that make a weekday count for the streak

# One level per hour (60 XP): level 1000 = 1000 hours, the "1000H" goal
XP_PER_LEVEL = 60
MAX_LEVEL = 1000

RATING_XP = {1: 1, 2: 2, 3: 4, 4: 5}
NEW_CARD_XP = 3
FIRST_BLOOD_XP = 10
WAVE_CLEARED_XP = 20
MAX_HEARTBEAT_SECONDS = 120

# Announcer lines for the kill feed: fixed phrases only, spoken once by TTS and cached
CALLOUT_PHRASES = {
    "kill": "Kill!",
    "first_blood": "First blood!",
    "double_kill": "Double kill!",
    "triple_kill": "Triple kill!",
    "ultra_kill": "Ultra kill!",
    "rampage": "Rampage!",
    "unstoppable": "Unstoppable!",
    "godlike": "Godlike!",
    "beyond_godlike": "Beyond godlike!",
    "wave_cleared": "Wave cleared!",
    "level_up": "Level up!",
}
CALLOUT_VOICE = {"voice": "en-US-ChristopherNeural", "rate": "-5%", "pitch": "-10Hz"}
MAX_AUTO_SECONDS_PER_LANE_DAY = 8 * 3600

_initialized_db_paths: set[str] = set()


def init_db() -> None:
    db_path = str(auth_db._get_db_path())
    if db_path in _initialized_db_paths:
        return
    srs.init_db()
    with srs._connect() as conn:  # same connection handling as the review tables
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS study_time (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                lane TEXT NOT NULL,
                source TEXT NOT NULL,
                seconds INTEGER NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_study_time_user_day ON study_time(user_id, day);
            CREATE TABLE IF NOT EXISTS game_events (
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                kind TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, day, kind)
            );
            """
        )
    _initialized_db_paths.add(db_path)


def _connect():
    init_db()
    return srs._connect()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def local_day(moment: datetime.datetime, tz_offset_minutes: int) -> datetime.date:
    """The learner's study day (rolls over at 04:00 local, like the review queue)."""
    local = moment - datetime.timedelta(minutes=tz_offset_minutes)
    return (local - datetime.timedelta(hours=srs.DAY_ROLLOVER_HOUR)).date()


def week_number(day: datetime.date) -> int:
    """Week of the plan: week 1 starts on PLAN_START; anything before is week 0."""
    if day < PLAN_START:
        return 0
    return (day - PLAN_START).days // 7 + 1


def week_bounds(day: datetime.date) -> tuple[datetime.date, datetime.date]:
    start = day - datetime.timedelta(days=day.weekday())  # Monday, like the plan's weeks
    return start, start + datetime.timedelta(days=6)


def week_target(day: datetime.date) -> int:
    return MAINTENANCE_WEEK_TARGET_MIN if MAINTENANCE[0] <= day <= MAINTENANCE[1] else WEEK_TARGET_MIN


def level_threshold(level: int) -> int:
    """Total XP needed to reach a level (level 0 is the start)."""
    return max(0, min(MAX_LEVEL, level)) * XP_PER_LEVEL


def level_for(xp: int) -> dict[str, Any]:
    level = min(MAX_LEVEL, max(0, xp) // XP_PER_LEVEL)
    start = level_threshold(level)
    nxt = level_threshold(level + 1) if level < MAX_LEVEL else None
    progress = 1.0 if nxt is None else (xp - start) / max(1, nxt - start)
    return {"level": level, "level_xp": start, "next_level_xp": nxt, "progress": round(progress, 4)}


def _day_minutes_xp(minutes: float) -> float:
    return min(minutes, DAY_FULL_XP_MIN) + max(0.0, minutes - DAY_FULL_XP_MIN) / 2


def _check_lane(lane: str) -> str:
    if lane not in LANE_WEEK_TARGETS:
        raise ValueError(f"unknown lane: {lane}")
    return lane


# ---------------------------------------------------------------------------
# Writing study time
# ---------------------------------------------------------------------------
def record_time(user_id: int, lane: str, seconds: int, tz_offset: int, now=None) -> int:
    """Add actively tracked seconds (a heartbeat from an open page). Returns seconds stored."""
    lane = _check_lane(lane)
    seconds = max(0, min(int(seconds), MAX_HEARTBEAT_SECONDS))
    if not seconds:
        return 0
    now = now or _now()
    day = local_day(now, tz_offset).isoformat()
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, seconds FROM study_time WHERE user_id = ? AND day = ? AND lane = ? AND source = 'auto'",
            (user_id, day, lane),
        ).fetchone()
        if row:
            seconds = min(seconds, max(0, MAX_AUTO_SECONDS_PER_LANE_DAY - row["seconds"]))
            conn.execute("UPDATE study_time SET seconds = seconds + ? WHERE id = ?", (seconds, row["id"]))
        else:
            conn.execute(
                "INSERT INTO study_time (user_id, day, lane, source, seconds, created_at) VALUES (?, ?, ?, 'auto', ?, ?)",
                (user_id, day, lane, seconds, srs._iso(now)),
            )
        conn.commit()
    return seconds


def log_time(user_id: int, lane: str, minutes: int, note: str, tz_offset: int, now=None) -> int:
    """Study done outside the app (teacher class, course book...). Returns the log id."""
    lane = _check_lane(lane)
    minutes = max(1, min(int(minutes), 300))
    now = now or _now()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT INTO study_time (user_id, day, lane, source, seconds, note, created_at) VALUES (?, ?, ?, 'manual', ?, ?, ?)",
            (user_id, local_day(now, tz_offset).isoformat(), lane, minutes * 60, (note or "")[:200], srs._iso(now)),
        )
        conn.commit()
        return int(cursor.lastrowid)


def delete_log(user_id: int, log_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM study_time WHERE id = ? AND user_id = ? AND source = 'manual'", (log_id, user_id)
        )
        conn.commit()
        return cursor.rowcount > 0


def set_family_day(user_id: int, on: bool, tz_offset: int, now=None) -> None:
    """A day given to the family: no target, never breaks the streak."""
    now = now or _now()
    day = local_day(now, tz_offset).isoformat()
    with _connect() as conn:
        if on:
            conn.execute(
                "INSERT OR IGNORE INTO game_events (user_id, day, kind, created_at) VALUES (?, ?, 'family_day', ?)",
                (user_id, day, srs._iso(now)),
            )
        else:
            conn.execute(
                "DELETE FROM game_events WHERE user_id = ? AND day = ? AND kind = 'family_day'", (user_id, day)
            )
        conn.commit()


def wave_cleared(user_id: int, tz_offset: int, now=None) -> int:
    """Today's review queue is done. Returns the XP awarded (0 if already awarded today)."""
    now = now or _now()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO game_events (user_id, day, kind, created_at) VALUES (?, ?, 'wave_cleared', ?)",
            (user_id, local_day(now, tz_offset).isoformat(), srs._iso(now)),
        )
        conn.commit()
        return WAVE_CLEARED_XP if cursor.rowcount else 0


# ---------------------------------------------------------------------------
# Reading the game state
# ---------------------------------------------------------------------------
def _review_events(rows, tz_offset: int) -> list[dict[str, Any]]:
    """XP, combo and first blood for every review, in time order."""
    events = []
    day = None
    combo = 0
    first_blood_done = False
    for row in rows:
        moment = datetime.datetime.fromisoformat(row["reviewed_at"])
        this_day = local_day(moment, tz_offset)
        if this_day != day:
            day, combo, first_blood_done = this_day, 0, False
        rating = int(row["rating"])
        kill = rating >= 3
        first_blood = False
        if kill:
            combo += 1
            if not first_blood_done:
                first_blood = first_blood_done = True
        elif rating == 1:
            combo = 0
        xp = RATING_XP.get(rating, 0) + (NEW_CARD_XP if row["was_new"] else 0)
        if kill and combo >= 2:
            xp += min(combo - 1, 4)
        if first_blood:
            xp += FIRST_BLOOD_XP
        events.append({
            "day": this_day, "rating": rating, "kill": kill, "death": rating == 1,
            "combo": combo if kill else 0, "first_blood": first_blood, "xp": xp,
        })
    return events


def _weekday_streak(active_days: set[datetime.date], family_days: set[datetime.date], today: datetime.date) -> int:
    streak = 0
    day = today
    if day not in active_days:  # today is still open: it does not break the streak yet
        day -= datetime.timedelta(days=1)
    for _ in range(400):
        if day.weekday() >= 5 or day in family_days:
            day -= datetime.timedelta(days=1)
            continue
        if day not in active_days:
            break
        streak += 1
        day -= datetime.timedelta(days=1)
    return streak


def state(user_id: int, tz_offset: int, now=None) -> dict[str, Any]:
    now = now or _now()
    today = local_day(now, tz_offset)
    week_start, week_end = week_bounds(today)
    with _connect() as conn:
        time_rows = conn.execute(
            "SELECT id, day, lane, source, seconds, note FROM study_time WHERE user_id = ?", (user_id,)
        ).fetchall()
        review_rows = conn.execute(
            "SELECT reviewed_at, rating, was_new FROM srs_reviews WHERE user_id = ? ORDER BY reviewed_at", (user_id,)
        ).fetchall()
        event_rows = conn.execute(
            "SELECT day, kind FROM game_events WHERE user_id = ?", (user_id,)
        ).fetchall()

    minutes_by_day: dict[datetime.date, float] = {}
    today_lanes = {lane: 0.0 for lane in LANES}
    week_lanes = {lane: 0.0 for lane in LANES}
    today_effective = 0.0
    week_effective = 0.0
    logs_today = []
    for row in time_rows:
        day = datetime.date.fromisoformat(row["day"])
        minutes = row["seconds"] / 60  # as heard/studied; car listening counts half below
        effective = minutes * LANE_WEIGHTS.get(row["lane"], 1)
        minutes_by_day[day] = minutes_by_day.get(day, 0.0) + effective
        if day == today:
            today_lanes[row["lane"]] += minutes
            today_effective += effective
            if row["source"] == "manual":
                logs_today.append({"id": row["id"], "lane": row["lane"], "minutes": round(minutes), "note": row["note"]})
        if week_start <= day <= week_end:
            week_lanes[row["lane"]] += minutes
            week_effective += effective

    family_days = {datetime.date.fromisoformat(r["day"]) for r in event_rows if r["kind"] == "family_day"}
    wave_days = {datetime.date.fromisoformat(r["day"]) for r in event_rows if r["kind"] == "wave_cleared"}
    reviews = _review_events(review_rows, tz_offset)

    xp = sum(_day_minutes_xp(m) for m in minutes_by_day.values())
    xp += sum(event["xp"] for event in reviews)
    xp += WAVE_CLEARED_XP * len(wave_days)
    xp = int(round(xp))

    today_reviews = [event for event in reviews if event["day"] == today]
    combo_now = 0  # the running combo, so a reloaded page continues it
    for event in today_reviews:
        if event["kill"]:
            combo_now = event["combo"]
        elif event["death"]:
            combo_now = 0
    total_minutes = sum(minutes_by_day.values())
    active_days = {day for day, minutes in minutes_by_day.items() if minutes >= STREAK_MIN}
    family_today = today in family_days
    weekend = today.weekday() >= 5
    maintenance = week_target(today) != WEEK_TARGET_MIN
    if family_today:
        day_target = 0
    elif maintenance:
        day_target = 0 if weekend else MAINTENANCE_WEEK_TARGET_MIN // 5
    else:
        day_target = WEEKEND_TARGET_MIN if weekend else WEEKDAY_TARGET_MIN

    skills = {}
    for skill_key, skill_lanes in TCF_SKILL_LANES.items():
        done = sum(week_lanes[lane] * LANE_WEIGHTS.get(lane, 1) for lane in skill_lanes)
        target = 0 if maintenance else sum(LANE_WEEK_TARGETS[lane] * LANE_WEIGHTS.get(lane, 1) for lane in skill_lanes)
        skills[skill_key] = {
            "minutes": round(done),
            "target": round(target),
            "lanes": list(skill_lanes),
            "link": TCF_SKILL_LINKS.get(skill_key),
        }

    exam_skills = ["CO", "CE", "EE", "EO"]
    furthest = min(
        exam_skills,
        key=lambda s: (
            skills[s]["minutes"] / skills[s]["target"] if skills[s]["target"] else 1.0,
            -(skills[s]["target"] - skills[s]["minutes"]),
        ),
    )
    focus_skill = {
        "skill": furthest,
        "link": TCF_SKILL_LINKS[furthest],
        "minutes": skills[furthest]["minutes"],
        "target": skills[furthest]["target"],
    }

    return {
        **level_for(xp),
        "xp": xp,
        "max_level": MAX_LEVEL,
        "hours_total": round(total_minutes / 60, 1),
        "today": {
            "day": today.isoformat(),
            "minutes": round(today_effective),
            "target": day_target,
            "family_day": family_today,
            "weekend": weekend,
            "by_lane": {lane: round(value) for lane, value in today_lanes.items()},
            "logs": logs_today,
            "kills": sum(1 for e in today_reviews if e["kill"]),
            "deaths": sum(1 for e in today_reviews if e["death"]),
            "best_combo": max((e["combo"] for e in today_reviews), default=0),
            "combo": combo_now,
            "first_blood": any(e["first_blood"] for e in today_reviews),
            "wave_cleared": today in wave_days,
        },
        "week": {
            "number": week_number(today),
            "start": week_start.isoformat(),
            "end": week_end.isoformat(),
            "minutes": round(week_effective),
            "target": week_target(today),
            "maintenance": maintenance,
            "by_lane": {lane: round(value) for lane, value in week_lanes.items()},
            "lane_targets": dict(LANE_WEEK_TARGETS),
            "lane_weights": {lane: LANE_WEIGHTS.get(lane, 1) for lane in LANES},
            "skills": skills,
            "focus_skill": focus_skill,
        },
        "streak_days": _weekday_streak(active_days, family_days, today),
    }


def review_feedback(user_id: int, tz_offset: int, now=None) -> dict[str, Any]:
    """What the learner just earned with their latest review, plus the new totals."""
    now = now or _now()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT reviewed_at, rating, was_new FROM srs_reviews WHERE user_id = ? AND reviewed_at >= ? ORDER BY reviewed_at",
            (user_id, srs._iso(srs.study_day_start(now, tz_offset))),
        ).fetchall()
    events = _review_events(rows, tz_offset)
    last = events[-1] if events else {"xp": 0, "kill": False, "death": False, "combo": 0, "first_blood": False}
    totals = state(user_id, tz_offset, now)
    return {
        "xp": last["xp"],
        "kill": last["kill"],
        "death": last["death"],
        "combo": last["combo"],
        "first_blood": last["first_blood"],
        "state": totals,
    }
