import testenv  # noqa: F401  (must run before the app is imported)

import datetime
import threading
import unittest
import uuid

from fastapi.testclient import TestClient

import auth_db
import cockpit
import game
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

    def test_the_seeded_todos_are_listed_with_their_due_dates(self):
        todos = cockpit.today(self.user_id, PDT, now=_at(MON))["todos"]
        self.assertEqual([x["due"] for x in todos], ["2026-11-01", "2026-11-29"])
        self.assertTrue(all(set(x) == {"id", "text", "due", "done"} and x["done"] is False for x in todos))

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























if __name__ == "__main__":
    unittest.main()
