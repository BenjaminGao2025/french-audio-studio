import testenv  # noqa: F401  (must run before the app is imported)

import datetime
import threading
import unittest
import uuid

from fastapi.testclient import TestClient

import auth_db
import cockpit
import game
import srs
import tts_service

UTC = datetime.timezone.utc
PDT = 420  # JavaScript getTimezoneOffset() in Vancouver summer time
CEST = -120

# Study days used below (PLAN_START, 2026-10-05, is a Monday)
MON, TUE, FRI, SAT, SUN = "2026-10-19", "2026-10-20", "2026-10-23", "2026-10-24", "2026-10-25"


def _new_user() -> tuple[int, dict]:
    reg = auth_db.register_user(f"cockpit_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


def _at(day: str, hour: int = 10, tz: int = PDT) -> datetime.datetime:
    """A UTC instant for a local date and hour."""
    local = datetime.datetime.fromisoformat(f"{day}T{hour:02d}:00:00")
    return (local + datetime.timedelta(minutes=tz)).replace(tzinfo=UTC)


def _add_time(user_id: int, lane: str, minutes: int, day: str, source: str = "auto") -> None:
    with game._connect() as conn:
        conn.execute(
            "INSERT INTO study_time (user_id, day, lane, source, seconds, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, day, lane, source, minutes * 60, "2026-10-19T00:00:00+00:00"),
        )


def _kinds(plan: dict) -> list[str]:
    return [b["kind"] for b in plan["blocks"]]


class TodayPlanTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()

    def test_monday_plan_follows_the_template_minus_disabled_kinds(self):
        plan = cockpit.today(self.user_id, PDT, now=_at(MON))
        self.assertEqual(plan["day"], MON)
        self.assertFalse(plan["minimal"])
        self.assertEqual(_kinds(plan), ["warmup", "review", "writing", "minimal"])
        self.assertEqual([b["position"] for b in plan["blocks"]], [1, 2, 3, 4])
        self.assertEqual(
            [b["route"] for b in plan["blocks"]],
            ["/cards?modes=speak,listen&new_limit=0", "/cards", "/writing", "/wrapup"],
        )
        self.assertTrue(all(b["status"] == "planned" and b["actual_sec"] == 0 for b in plan["blocks"]))
        self.assertEqual(plan["blocks"][0]["start_time"], "09:00")
        self.assertEqual(plan["blocks"][0]["lane"], "review")
        self.assertEqual(plan["blocks"][2]["lane"], "writing")
        self.assertEqual(plan["blocks"][0]["material_ids"], [])

    def test_header_fields_are_honest(self):
        plan = cockpit.today(self.user_id, PDT, now=_at(MON))
        self.assertEqual(plan["phase"]["id"], "A")
        self.assertEqual(plan["phase"]["hours_from"], 0)
        self.assertEqual(plan["phase"]["hours_to"], 300)
        self.assertEqual(plan["phase"]["week_target_min"], game.WEEK_TARGET_MIN)
        self.assertFalse(plan["materials_ready"])  # no nightly job yet
        self.assertFalse(plan["fallback"])

    def test_other_weekdays(self):
        tue = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(_kinds(tue), ["warmup", "review", "course", "minimal"])
        self.assertEqual(tue["blocks"][2]["route"], "/hours")
        fri = cockpit.today(self.user_id, PDT, now=_at(FRI))
        self.assertEqual(_kinds(fri), ["warmup", "review", "review", "minimal"])

    def test_weekend_templates(self):
        sat = cockpit.today(self.user_id, PDT, now=_at(SAT))
        self.assertEqual([b["route"] for b in sat["blocks"]], ["/tutor", "/wrapup"])
        self.assertEqual(sat["blocks"][0]["planned_min"], 120)
        sun = cockpit.today(self.user_id, PDT, now=_at(SUN))
        self.assertEqual([b["route"] for b in sun["blocks"]], ["/cards", "/wrapup"])

    def test_no_day_ever_contains_a_disabled_kind(self):
        for offset in range(7):
            day = (datetime.date.fromisoformat(MON) + datetime.timedelta(days=offset)).isoformat()
            for minimal in (False, True):
                with self.subTest(day=day, minimal=minimal):
                    self.assertTrue(
                        {s.kind for s in cockpit._template(datetime.date.fromisoformat(day), minimal)}
                        <= cockpit.ENABLED_KINDS
                    )
        for kind in ("journal", "listening", "reading", "checkpoint"):
            self.assertNotIn(kind, cockpit.ENABLED_KINDS)

    def test_loading_twice_does_not_duplicate_the_plan(self):
        first = cockpit.today(self.user_id, PDT, now=_at(MON, 9))
        second = cockpit.today(self.user_id, PDT, now=_at(MON, 14))
        self.assertEqual([b["id"] for b in first["blocks"]], [b["id"] for b in second["blocks"]])
        with cockpit._connect() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM day_blocks WHERE user_id = ? AND day = ?", (self.user_id, MON)
            ).fetchone()[0]
        self.assertEqual(count, 4)

    def test_simultaneous_loads_create_one_plan(self):
        errors, results = [], []

        def load():
            try:
                results.append([b["id"] for b in cockpit.today(self.user_id, PDT, now=_at(MON))["blocks"]])
            except Exception as exc:  # pragma: no cover - reported below
                errors.append(exc)

        threads = [threading.Thread(target=load) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(len({tuple(ids) for ids in results}), 1)
        self.assertEqual(len(results[0]), 4)

    def test_day_boundary_follows_the_timezone_offset(self):
        # The same instant is Monday evening in Vancouver and Tuesday morning in Paris.
        instant = datetime.datetime(2026, 10, 20, 8, 0, tzinfo=UTC)
        self.assertEqual(cockpit.today(self.user_id, PDT, now=instant)["day"], MON)
        self.assertEqual(cockpit.today(self.user_id, CEST, now=instant)["day"], TUE)

    def test_study_day_rolls_over_at_four_in_the_morning(self):
        self.assertEqual(cockpit.today(self.user_id, PDT, now=_at(TUE, 3))["day"], MON)
        self.assertEqual(cockpit.today(self.user_id, PDT, now=_at(TUE, 4))["day"], TUE)

    def test_users_have_separate_plans(self):
        other, _ = _new_user()
        mine = cockpit.today(self.user_id, PDT, now=_at(MON))
        theirs = cockpit.today(other, PDT, now=_at(MON))
        self.assertFalse({b["id"] for b in mine["blocks"]} & {b["id"] for b in theirs["blocks"]})

    def test_maintenance_period_defaults_to_the_minimal_day(self):
        plan = cockpit.today(self.user_id, 0, now=datetime.datetime(2027, 6, 15, 12, 0, tzinfo=UTC))
        self.assertTrue(plan["minimal"])
        self.assertEqual(_kinds(plan), ["review", "minimal"])
        self.assertEqual(plan["phase"]["id"], "maintenance")
        self.assertEqual(plan["phase"]["week_target_min"], game.MAINTENANCE_WEEK_TARGET_MIN)

    def test_yesterday_summary(self):
        before = cockpit.today(self.user_id, PDT, now=_at(MON))
        cockpit.finish_block(self.user_id, before["blocks"][0]["id"])
        cockpit.finish_block(self.user_id, before["blocks"][1]["id"])
        cockpit.skip_block(self.user_id, before["blocks"][2]["id"], "no_time")
        _add_time(self.user_id, "review", 30, MON)
        _add_time(self.user_id, "writing", 15, MON, source="manual")
        _add_time(self.user_id, "car", 120, MON)  # input, not active
        _add_time(self.user_id, "review", 99, SAT)  # another day
        after = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(after["yesterday"], {"blocks_done": 2, "blocks_total": 4, "active_minutes": 45})

    def test_first_day_has_an_empty_yesterday(self):
        plan = cockpit.today(self.user_id, PDT, now=_at(MON))
        self.assertEqual(plan["yesterday"], {"blocks_done": 0, "blocks_total": 0, "active_minutes": 0})

    def test_next_milestone_counts_active_and_manual_hours_but_not_the_car(self):
        _add_time(self.user_id, "review", 60 * 30, MON)
        _add_time(self.user_id, "course", 60 * 5, MON, source="manual")
        _add_time(self.user_id, "car", 60 * 400, MON)
        plan = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(plan["next_milestone"], {"hours": 100, "hours_to_go": 65.0})

    def test_milestone_reached_moves_on(self):
        _add_time(self.user_id, "review", 60 * 100, MON)
        plan = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(plan["next_milestone"], {"hours": 300, "hours_to_go": 200.0})

    def test_today_lists_only_open_todos(self):
        todos = cockpit.today(self.user_id, PDT, now=_at(MON))["todos"]
        self.assertEqual([t["done"] for t in todos], [False, False])
        cockpit.complete_todo(self.user_id, todos[0]["id"])
        after = cockpit.today(self.user_id, PDT, now=_at(MON))["todos"]
        self.assertEqual([t["id"] for t in after], [todos[1]["id"]])


class BlockLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()
        self.plan = cockpit.today(self.user_id, PDT, now=_at(MON))
        self.block = self.plan["blocks"][0]  # warm-up, 10 planned minutes

    def test_start_then_finish_records_the_elapsed_time(self):
        start = _at(MON, 9)
        started = cockpit.start_block(self.user_id, self.block["id"], now=start)
        self.assertEqual(started["status"], "active")
        done = cockpit.finish_block(self.user_id, self.block["id"], now=start + datetime.timedelta(minutes=9))
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["actual_sec"], 540)

    def test_starting_twice_keeps_the_first_start(self):
        start = _at(MON, 9)
        cockpit.start_block(self.user_id, self.block["id"], now=start)
        cockpit.start_block(self.user_id, self.block["id"], now=start + datetime.timedelta(minutes=5))
        done = cockpit.finish_block(self.user_id, self.block["id"], now=start + datetime.timedelta(minutes=8))
        self.assertEqual(done["actual_sec"], 480)

    def test_actual_time_is_capped_at_twice_the_plan(self):
        start = _at(MON, 9)
        cockpit.start_block(self.user_id, self.block["id"], now=start)
        done = cockpit.finish_block(self.user_id, self.block["id"], now=start + datetime.timedelta(hours=3))
        self.assertEqual(done["actual_sec"], 10 * 60 * 2)

    def test_finishing_a_block_that_never_started_records_zero(self):
        done = cockpit.finish_block(self.user_id, self.block["id"])
        self.assertEqual((done["status"], done["actual_sec"]), ("done", 0))

    def test_finishing_twice_changes_nothing(self):
        start = _at(MON, 9)
        cockpit.start_block(self.user_id, self.block["id"], now=start)
        first = cockpit.finish_block(self.user_id, self.block["id"], now=start + datetime.timedelta(minutes=6))
        second = cockpit.finish_block(self.user_id, self.block["id"], now=start + datetime.timedelta(minutes=90))
        self.assertEqual(first, second)

    def test_a_finished_block_is_not_restarted(self):
        cockpit.finish_block(self.user_id, self.block["id"])
        self.assertEqual(cockpit.start_block(self.user_id, self.block["id"])["status"], "done")

    def test_skip_records_the_reason(self):
        skipped = cockpit.skip_block(self.user_id, self.block["id"], "health")
        self.assertEqual(skipped["status"], "skipped")
        with cockpit._connect() as conn:
            reason = conn.execute("SELECT skip_reason FROM day_blocks WHERE id = ?", (self.block["id"],)).fetchone()[0]
        self.assertEqual(reason, "health")

    def test_a_done_block_cannot_be_skipped(self):
        cockpit.finish_block(self.user_id, self.block["id"])
        self.assertEqual(cockpit.skip_block(self.user_id, self.block["id"], "no_time")["status"], "done")

    def test_unknown_skip_reason_is_refused(self):
        with self.assertRaises(ValueError):
            cockpit.skip_block(self.user_id, self.block["id"], "bored")

    def test_blocks_of_another_user_are_not_found(self):
        other, _ = _new_user()
        for call in (
            lambda: cockpit.start_block(other, self.block["id"]),
            lambda: cockpit.finish_block(other, self.block["id"]),
            lambda: cockpit.skip_block(other, self.block["id"], "no_time"),
        ):
            with self.assertRaises(KeyError):
                call()
        with cockpit._connect() as conn:
            status = conn.execute("SELECT status FROM day_blocks WHERE id = ?", (self.block["id"],)).fetchone()[0]
        self.assertEqual(status, "planned")


class MinimalDayTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()
        self.now = _at(MON)
        self.plan = cockpit.today(self.user_id, PDT, now=self.now)

    def _positions(self):
        with cockpit._connect() as conn:
            return [
                r[0]
                for r in conn.execute(
                    "SELECT position FROM day_blocks WHERE user_id = ? AND day = ? ORDER BY position",
                    (self.user_id, MON),
                )
            ]

    def test_switching_on_replaces_the_planned_blocks(self):
        plan = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertTrue(plan["minimal"])
        self.assertEqual(_kinds(plan), ["review", "minimal"])
        self.assertEqual(plan["blocks"][0]["title"], "Review 10 cards")
        self.assertEqual(self._positions(), [1, 2])

    def test_switching_to_the_same_state_keeps_the_blocks(self):
        on = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        again = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertEqual([b["id"] for b in on["blocks"]], [b["id"] for b in again["blocks"]])
        off = cockpit.set_minimal(self.user_id, False, PDT, now=self.now)
        same = cockpit.set_minimal(self.user_id, False, PDT, now=self.now)
        self.assertEqual([b["id"] for b in off["blocks"]], [b["id"] for b in same["blocks"]])

    def test_done_blocks_survive_on_off_on_without_duplicate_positions(self):
        warmup = self.plan["blocks"][0]
        cockpit.finish_block(self.user_id, warmup["id"])
        on = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertEqual(_kinds(on), ["warmup", "review", "minimal"])
        off = cockpit.set_minimal(self.user_id, False, PDT, now=self.now)
        self.assertEqual(_kinds(off), ["warmup", "review", "writing", "minimal"])
        on_again = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertEqual(_kinds(on_again), ["warmup", "review", "minimal"])
        for plan in (on, off, on_again):
            self.assertEqual(plan["blocks"][0]["id"], warmup["id"])
            self.assertEqual(plan["blocks"][0]["status"], "done")
        self.assertEqual(self._positions(), [1, 2, 3])

    def test_a_finished_wrapup_is_not_added_again(self):
        wrapup = self.plan["blocks"][3]
        cockpit.finish_block(self.user_id, wrapup["id"])
        on = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertEqual(_kinds(on).count("minimal"), 1)

    def test_active_and_skipped_blocks_are_kept_too(self):
        cockpit.start_block(self.user_id, self.plan["blocks"][1]["id"], now=self.now)
        cockpit.skip_block(self.user_id, self.plan["blocks"][2]["id"], "no_time")
        on = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        statuses = {b["id"]: b["status"] for b in on["blocks"]}
        self.assertEqual(statuses[self.plan["blocks"][1]["id"]], "active")
        self.assertEqual(statuses[self.plan["blocks"][2]["id"]], "skipped")

    def test_switching_before_the_first_load_creates_the_plan(self):
        user, _ = _new_user()
        plan = cockpit.set_minimal(user, True, PDT, now=self.now)
        self.assertEqual(_kinds(plan), ["review", "minimal"])

    def test_the_choice_is_remembered_for_the_day(self):
        cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertTrue(cockpit.today(self.user_id, PDT, now=self.now)["minimal"])


class HoursLedgerTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()

    def test_empty_user_gets_zeros_without_dividing_by_zero(self):
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual((ledger["active_hours"], ledger["manual_hours"], ledger["input_hours"]), (0, 0, 0))
        self.assertEqual((ledger["next_milestone"], ledger["hours_to_go"]), (100, 100.0))
        self.assertEqual(ledger["milestones"], [100, 300, 500, 750, 1000])
        self.assertEqual([row["lane"] for row in ledger["lanes"]], list(game.LANES))
        self.assertTrue(all(row["active"] == row["manual"] == row["input"] == 0 for row in ledger["lanes"]))

    def test_car_time_never_reaches_active_or_manual(self):
        _add_time(self.user_id, "review", 60, MON)
        _add_time(self.user_id, "car", 600, MON)
        _add_time(self.user_id, "car", 60, MON, source="manual")
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual(ledger["active_hours"], 1.0)
        self.assertEqual(ledger["manual_hours"], 0)
        self.assertEqual(ledger["input_hours"], 11.0)
        self.assertEqual(ledger["hours_to_go"], 99.0)

    def test_manual_hours_are_listed_apart_and_counted(self):
        _add_time(self.user_id, "review", 90, MON)
        _add_time(self.user_id, "speaking", 120, MON, source="manual")
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual((ledger["active_hours"], ledger["manual_hours"]), (1.5, 2.0))
        self.assertEqual(ledger["hours_to_go"], 96.5)

    def test_manual_only_user(self):
        _add_time(self.user_id, "course", 180, MON, source="manual")
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual((ledger["active_hours"], ledger["manual_hours"]), (0, 3.0))

    def test_lanes_show_this_week_in_hours_but_totals_show_everything(self):
        _add_time(self.user_id, "listening", 120, MON)  # this week (Mon 19 - Sun 25 Oct)
        _add_time(self.user_id, "listening", 600, "2026-10-12")  # last week
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(TUE))
        row = next(r for r in ledger["lanes"] if r["lane"] == "listening")
        self.assertEqual(row["active"], 2.0)
        self.assertEqual(row["week_target"], 3.5)  # 210 minutes
        self.assertEqual(ledger["active_hours"], 12.0)

    def test_car_lane_row_reports_input_and_its_target(self):
        _add_time(self.user_id, "car", 90, MON)
        row = next(r for r in cockpit.ledger(self.user_id, PDT, now=_at(MON))["lanes"] if r["lane"] == "car")
        self.assertEqual((row["active"], row["manual"], row["input"], row["week_target"]), (0, 0, 1.5, 10.0))

    def test_after_the_last_milestone_nothing_is_left(self):
        _add_time(self.user_id, "review", 60 * 1001, MON)
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual((ledger["next_milestone"], ledger["hours_to_go"]), (1000, 0.0))

    def test_users_are_separate(self):
        other, _ = _new_user()
        _add_time(other, "review", 600, MON)
        self.assertEqual(cockpit.ledger(self.user_id, PDT, now=_at(MON))["active_hours"], 0)

    def test_phase_name_is_reported(self):
        self.assertEqual(cockpit.ledger(self.user_id, PDT, now=_at(MON))["phase"], "Phase A (0–300h)")


class TodoTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()

    def test_seeded_lazily_and_only_once(self):
        first = cockpit.list_todos(self.user_id)
        second = cockpit.list_todos(self.user_id)
        self.assertEqual(first, second)
        self.assertEqual([t["due"] for t in first], ["2026-11-01", "2026-11-29"])
        self.assertTrue(all(set(t) == {"id", "text", "due", "done"} and t["done"] is False for t in first))
        self.assertIn("外教", first[0]["text"])
        self.assertIn("分级", first[1]["text"])

    def test_seeding_is_per_user(self):
        other, _ = _new_user()
        self.assertFalse({t["id"] for t in cockpit.list_todos(self.user_id)} & {t["id"] for t in cockpit.list_todos(other)})

    def test_done_marks_the_todo_and_is_idempotent(self):
        todo = cockpit.list_todos(self.user_id)[0]
        cockpit.complete_todo(self.user_id, todo["id"])
        cockpit.complete_todo(self.user_id, todo["id"])
        after = cockpit.list_todos(self.user_id)
        self.assertEqual([t["done"] for t in after], [True, False])
        self.assertEqual(len(after), 2)  # seeding does not bring a finished todo back

    def test_another_users_todo_is_not_found(self):
        other, _ = _new_user()
        todo = cockpit.list_todos(self.user_id)[0]
        cockpit.list_todos(other)
        with self.assertRaises(KeyError):
            cockpit.complete_todo(other, todo["id"])
        self.assertFalse(cockpit.list_todos(self.user_id)[0]["done"])


class GameLogDayTests(unittest.TestCase):
    def test_log_time_can_book_a_past_day(self):
        user_id, _ = _new_user()
        game.log_time(user_id, "speaking", 30, "past", PDT, now=_at(TUE), day=MON)
        game.log_time(user_id, "speaking", 20, "today", PDT, now=_at(TUE))
        with game._connect() as conn:
            rows = conn.execute("SELECT day, seconds FROM study_time WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
        self.assertEqual([(r["day"], r["seconds"]) for r in rows], [(MON, 1800), (TUE, 1200)])


class HttpApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(tts_service.app)

    def setUp(self):
        self.user_id, self.headers = _new_user()

    # --- auth ---
    def test_every_route_requires_a_login(self):
        some_id = "x" * 8
        calls = [
            ("get", "/api/today", None),
            ("post", f"/api/today/blocks/{some_id}/start", None),
            ("post", f"/api/today/blocks/{some_id}/finish", None),
            ("post", f"/api/today/blocks/{some_id}/skip", {"reason": "no_time"}),
            ("post", "/api/today/minimal", {"on": True}),
            ("get", "/api/hours/ledger", None),
            ("get", "/api/todos", None),
            ("post", f"/api/todos/{some_id}/done", None),
            ("post", "/api/daily-reviews", {"day": MON, "hard": "x"}),
            ("get", f"/api/daily-reviews?day={MON}", None),
            ("get", "/api/tutor/sessions", None),
            ("post", "/api/tutor/sessions", {"day": MON, "minutes": 30}),
            ("get", "/api/phase", None),
            ("get", "/api/shadow/sentences", None),
        ]
        for method, path, body in calls:
            with self.subTest(route=f"{method.upper()} {path}"):
                res = getattr(self.client, method)(path, **({"json": body} if body is not None else {}))
                self.assertEqual(res.status_code, 401)

    # --- today ---
    def test_today_then_block_lifecycle_over_http(self):
        plan = self.client.get("/api/today", params={"tz_offset": PDT}, headers=self.headers).json()
        self.assertGreaterEqual(len(plan["blocks"]), 2)
        block = plan["blocks"][0]
        started = self.client.post(f"/api/today/blocks/{block['id']}/start", headers=self.headers)
        self.assertEqual(started.json()["status"], "active")
        finished = self.client.post(f"/api/today/blocks/{block['id']}/finish", headers=self.headers)
        self.assertEqual(finished.json()["status"], "done")
        again = self.client.get("/api/today", params={"tz_offset": PDT}, headers=self.headers).json()
        self.assertEqual(again["blocks"][0]["status"], "done")
        self.assertEqual([b["id"] for b in again["blocks"]], [b["id"] for b in plan["blocks"]])

    def test_session_cookie_is_accepted_like_the_audio_tags_need(self):
        self.client.cookies.set("fas_session", self.headers["Authorization"].split(" ")[1])
        try:
            self.assertEqual(self.client.get("/api/today").status_code, 200)
        finally:
            self.client.cookies.clear()

    def test_skip_validates_the_reason(self):
        block = self.client.get("/api/today", headers=self.headers).json()["blocks"][0]
        bad = self.client.post(f"/api/today/blocks/{block['id']}/skip", json={"reason": "bored"}, headers=self.headers)
        self.assertEqual(bad.status_code, 422)
        good = self.client.post(f"/api/today/blocks/{block['id']}/skip", json={"reason": "family"}, headers=self.headers)
        self.assertEqual(good.json()["status"], "skipped")

    def test_other_users_and_unknown_blocks_are_404(self):
        block = self.client.get("/api/today", headers=self.headers).json()["blocks"][0]
        _, other = _new_user()
        for action, body in (("start", None), ("finish", None), ("skip", {"reason": "no_time"})):
            for who, target in ((other, block["id"]), (self.headers, "nope")):
                with self.subTest(action=action, target=target):
                    res = self.client.post(
                        f"/api/today/blocks/{target}/{action}", headers=who, **({"json": body} if body else {})
                    )
                    self.assertEqual(res.status_code, 404)
                    self.assertIn("message", res.json()["detail"])

    def test_minimal_toggle_over_http(self):
        on = self.client.post("/api/today/minimal", json={"on": True, "tz_offset": PDT}, headers=self.headers)
        self.assertEqual(on.status_code, 200)
        self.assertTrue(on.json()["minimal"])
        off = self.client.post("/api/today/minimal", json={"on": False, "tz_offset": PDT}, headers=self.headers)
        self.assertFalse(off.json()["minimal"])
        self.assertEqual(self.client.post("/api/today/minimal", json={}, headers=self.headers).status_code, 422)

    def test_tz_offset_out_of_range_is_422(self):
        res = self.client.get("/api/today", params={"tz_offset": 99999}, headers=self.headers)
        self.assertEqual(res.status_code, 422)

    def test_response_matches_the_frontend_types(self):
        plan = self.client.get("/api/today", params={"tz_offset": PDT}, headers=self.headers).json()
        self.assertEqual(
            set(plan),
            {"minimal", "day", "phase", "blocks", "materials_ready", "fallback", "todos", "yesterday", "next_milestone"},
        )
        self.assertEqual(set(plan["phase"]), {"id", "name", "hours_from", "hours_to", "week_target_min"})
        block_keys = {"id", "position", "kind", "title", "planned_min", "actual_sec", "status", "route", "lane", "material_ids"}
        for block in plan["blocks"]:
            self.assertTrue(block_keys <= set(block) <= block_keys | {"start_time"})
        self.assertEqual(set(plan["yesterday"]), {"blocks_done", "blocks_total", "active_minutes"})
        self.assertEqual(set(plan["next_milestone"]), {"hours", "hours_to_go"})

    # --- hours ---
    def test_ledger_over_http(self):
        _add_time(self.user_id, "review", 60, MON)
        _add_time(self.user_id, "car", 120, MON)
        body = self.client.get("/api/hours/ledger", params={"tz_offset": PDT}, headers=self.headers).json()
        self.assertEqual((body["active_hours"], body["input_hours"]), (1.0, 2.0))
        self.assertEqual(
            set(body),
            {"active_hours", "manual_hours", "input_hours", "lanes", "milestones", "next_milestone", "hours_to_go", "phase"},
        )
        self.assertEqual(set(body["lanes"][0]), {"lane", "active", "manual", "input", "week_target"})

    # --- todos ---
    def test_todos_over_http(self):
        todos = self.client.get("/api/todos", headers=self.headers).json()
        self.assertEqual(len(todos), 2)
        self.assertEqual(self.client.post(f"/api/todos/{todos[0]['id']}/done", headers=self.headers).status_code, 200)
        self.assertTrue(self.client.get("/api/todos", headers=self.headers).json()[0]["done"])
        _, other = _new_user()
        self.assertEqual(self.client.post(f"/api/todos/{todos[1]['id']}/done", headers=other).status_code, 404)

    # --- daily review ---
    def _review(self, **fields):
        body = {"day": MON, "hard": "", "solved": "", "unsolved": "", "tomorrow": ""} | fields
        return self.client.post("/api/daily-reviews", json=body, headers=self.headers)

    def test_review_needs_at_least_one_answer(self):
        self.assertEqual(self._review().status_code, 422)
        self.assertEqual(self._review(hard="   ", solved="\n").status_code, 422)
        self.assertEqual(self._review(hard="Subjunctive").status_code, 200)

    def test_review_validates_mood_length_and_day(self):
        self.assertEqual(self._review(hard="x", mood=6).status_code, 422)
        self.assertEqual(self._review(hard="x", mood=0).status_code, 422)
        self.assertEqual(self._review(hard="x", mood=5).status_code, 200)
        self.assertEqual(self._review(hard="x" * 1001).status_code, 422)
        self.assertEqual(self._review(hard="x" * 1000).status_code, 200)
        self.assertEqual(self._review(hard="x", day="not-a-day").status_code, 422)

    def test_review_round_trip_and_overwrite(self):
        saved = self._review(hard="Liaison", tomorrow="Cards first", mood=4).json()
        self.assertEqual(saved, {"day": MON, "hard": "Liaison", "solved": "", "unsolved": "", "tomorrow": "Cards first", "mood": 4})
        got = self.client.get("/api/daily-reviews", params={"day": MON}, headers=self.headers).json()
        self.assertEqual(got, saved)
        self._review(hard="Gender", solved="Passé composé")
        got = self.client.get("/api/daily-reviews", params={"day": MON}, headers=self.headers).json()
        self.assertEqual((got["hard"], got["solved"], got["tomorrow"]), ("Gender", "Passé composé", ""))
        self.assertNotIn("mood", got)  # the second save did not rate the day

    def test_review_of_an_empty_day_is_an_empty_form_not_an_error(self):
        res = self.client.get("/api/daily-reviews", params={"day": TUE}, headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"day": TUE, "hard": "", "solved": "", "unsolved": "", "tomorrow": ""})

    def test_review_requires_a_day(self):
        self.assertEqual(self.client.get("/api/daily-reviews", headers=self.headers).status_code, 422)

    def test_reviews_are_private(self):
        self._review(hard="secret")
        _, other = _new_user()
        got = self.client.get("/api/daily-reviews", params={"day": MON}, headers=other).json()
        self.assertEqual(got["hard"], "")

    # --- tutor ---
    def _session(self, **fields):
        body = {"day": MON, "minutes": 60} | fields
        return self.client.post("/api/tutor/sessions", json=body, headers=self.headers)

    def test_tutor_minutes_are_bounded(self):
        for minutes in (0, 301, -5):
            with self.subTest(minutes=minutes):
                self.assertEqual(self._session(minutes=minutes).status_code, 422)
        self.assertEqual(self._session(minutes=1).status_code, 200)
        self.assertEqual(self._session(minutes=300).status_code, 200)

    def test_tutor_session_adds_manual_speaking_time(self):
        before = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        res = self._session(minutes=90, tutor="Marie · italki", topics="Passé composé", homework="Write 5 sentences", cost=24.5)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(
            {k: body[k] for k in ("day", "minutes", "tutor", "topics", "homework", "cost")},
            {"day": MON, "minutes": 90, "tutor": "Marie · italki", "topics": "Passé composé", "homework": "Write 5 sentences", "cost": 24.5},
        )
        after = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual(after["manual_hours"] - before["manual_hours"], 1.5)
        self.assertEqual(after["active_hours"], before["active_hours"])
        speaking = next(r for r in after["lanes"] if r["lane"] == "speaking")
        self.assertEqual(speaking["manual"], 1.5)
        with game._connect() as conn:
            row = conn.execute(
                "SELECT lane, source, day FROM study_time WHERE user_id = ?", (self.user_id,)
            ).fetchone()
        self.assertEqual((row["lane"], row["source"], row["day"]), ("speaking", "manual", MON))

    def test_tutor_time_is_booked_on_the_lesson_day_not_today(self):
        self._session(day="2026-10-12", minutes=60)
        with game._connect() as conn:
            day = conn.execute("SELECT day FROM study_time WHERE user_id = ?", (self.user_id,)).fetchone()[0]
        self.assertEqual(day, "2026-10-12")

    def test_tutor_session_links_to_its_study_time_row(self):
        session_id = self._session(minutes=45).json()["id"]
        with cockpit._connect() as conn:
            link = conn.execute("SELECT study_time_id FROM tutor_sessions WHERE id = ?", (session_id,)).fetchone()[0]
            seconds = conn.execute("SELECT seconds FROM study_time WHERE id = ?", (link,)).fetchone()[0]
        self.assertEqual(seconds, 45 * 60)

    def test_tutor_optional_fields_are_left_out(self):
        body = self._session(minutes=30).json()
        self.assertEqual(set(body), {"id", "day", "minutes"})

    def test_tutor_validation(self):
        self.assertEqual(self._session(day="soon").status_code, 422)
        self.assertEqual(self._session(cost=-1).status_code, 422)
        self.assertEqual(self._session(topics="x" * 501).status_code, 422)

    def test_tutor_sessions_list_newest_day_first_and_are_private(self):
        self._session(day="2026-10-10", minutes=30)
        self._session(day="2026-10-17", minutes=45)
        listing = self.client.get("/api/tutor/sessions", headers=self.headers).json()
        self.assertEqual([s["day"] for s in listing], ["2026-10-17", "2026-10-10"])
        _, other = _new_user()
        self.assertEqual(self.client.get("/api/tutor/sessions", headers=other).json(), [])

    # --- phase ---
    def test_phase_is_read_only_and_mirrors_game_targets(self):
        body = self.client.get("/api/phase", headers=self.headers).json()
        self.assertEqual(body["id"], "A")
        self.assertEqual(body["lane_targets"], game.LANE_WEEK_TARGETS)
        self.assertEqual(body["week_target_min"], game.WEEK_TARGET_MIN)
        self.assertEqual(body["new_cards_per_day"], 10)
        self.assertEqual(body["gates"], {})
        self.assertEqual(self.client.put("/api/phase", json=body, headers=self.headers).status_code, 405)

    # --- shadowing ---
    def test_shadow_sentences_empty_without_notes(self):
        self.assertEqual(self.client.get("/api/shadow/sentences", headers=self.headers).json(), [])

    def test_shadow_uses_sentences_with_a_speak_card_newest_first_up_to_eight(self):
        for i in range(10):
            srs.add_note(self.user_id, f"Phrase numéro {i} pour la maison.", modes=["listen", "speak"])
        srs.add_note(self.user_id, "Seulement à écouter.", modes=["listen"])
        body = self.client.get("/api/shadow/sentences", headers=self.headers).json()
        self.assertEqual(len(body), 8)
        self.assertEqual(body[0], {"text": "Phrase numéro 9 pour la maison.", "ipa": ""})
        self.assertNotIn("Seulement à écouter.", [s["text"] for s in body])

    def test_shadow_never_returns_another_users_notes(self):
        other, _ = _new_user()
        srs.add_note(other, "La phrase de quelqu'un d'autre.", modes=["speak"])
        self.assertEqual(self.client.get("/api/shadow/sentences", headers=self.headers).json(), [])


if __name__ == "__main__":
    unittest.main()
