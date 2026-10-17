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
MON, TUE, THU, FRI, SAT, SUN = "2026-10-19", "2026-10-20", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"


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
        self.assertEqual(_kinds(plan), ["warmup", "journal", "review", "writing", "minimal"])
        self.assertEqual([b["position"] for b in plan["blocks"]], [1, 2, 3, 4, 5])
        self.assertEqual(
            [b["route"] for b in plan["blocks"]],
            ["/cards?modes=speak,listen&new_limit=0", "/journal", "/cards", "/writing", "/wrapup"],
        )
        self.assertTrue(all(b["status"] == "planned" and b["actual_sec"] == 0 for b in plan["blocks"]))
        self.assertEqual(plan["blocks"][0]["start_time"], "09:00")
        self.assertEqual(plan["blocks"][0]["lane"], "review")
        self.assertEqual(plan["blocks"][1]["lane"], "speaking")
        self.assertEqual(plan["blocks"][3]["lane"], "writing")
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
        self.assertEqual(_kinds(tue), ["warmup", "journal", "review", "intensive", "minimal"])
        self.assertEqual(tue["blocks"][3]["route"], "/reading")
        thu = cockpit.today(self.user_id, PDT, now=_at(THU))
        self.assertEqual(_kinds(thu), ["warmup", "journal", "review", "shadowing", "minimal"])
        self.assertEqual(thu["blocks"][3]["route"], "/shadow")
        fri = cockpit.today(self.user_id, PDT, now=_at(FRI))
        self.assertEqual(_kinds(fri), ["warmup", "journal", "review", "review", "minimal"])

    def test_tuesday_and_thursday_alternate_intensive_reading_and_shadowing(self):
        tue = cockpit.today(self.user_id, PDT, now=_at(TUE))["blocks"][3]
        thu = cockpit.today(self.user_id, PDT, now=_at(THU))["blocks"][3]
        self.assertEqual(
            (tue["title"], tue["lane"], tue["planned_min"], tue["start_time"]),
            ("Main block 2 · Intensive reading (sentence breakdown)", "reading", 40, "11:15"),
        )
        self.assertEqual(
            (thu["title"], thu["lane"], thu["planned_min"], thu["start_time"]),
            ("Main block 2 · Shadowing", "speaking", 40, "11:15"),
        )

    def test_no_course_block_anywhere_in_the_template(self):
        every = [s for slots in cockpit.WEEK_TEMPLATE.values() for s in slots] + list(cockpit.MINIMAL_TEMPLATE)
        self.assertFalse([s for s in every if s.kind == "course" or s.lane == "course" or s.route == "/hours"])
        self.assertNotIn("course", cockpit.ENABLED_KINDS)

    def test_the_swap_keeps_the_weekly_planned_minutes(self):
        # Before: Tue and Thu 11:15 were two 40-minute course blocks, so the plan was 770 minutes
        # (kinds enabled today) and 1070 with every kind. Intensive reading and shadowing replace
        # them one for one.
        def minutes(kinds):
            return sum(s.planned_min for slots in cockpit.WEEK_TEMPLATE.values() for s in slots if s.kind in kinds)

        everything = {s.kind for slots in cockpit.WEEK_TEMPLATE.values() for s in slots}
        self.assertEqual(minutes(cockpit.ENABLED_KINDS), 770)
        self.assertEqual(minutes(everything), 1070)
        by_lane: dict[str, int] = {}
        for slots in cockpit.WEEK_TEMPLATE.values():
            for s in slots:
                by_lane[s.lane] = by_lane.get(s.lane, 0) + s.planned_min
        self.assertEqual(
            by_lane,
            {"review": 265, "speaking": 325, "listening": 180, "reading": 160, "writing": 140},
        )

    def test_weekend_templates(self):
        sat = cockpit.today(self.user_id, PDT, now=_at(SAT))
        self.assertEqual([b["route"] for b in sat["blocks"]], ["/speaking", "/writing", "/wrapup"])
        self.assertEqual(_kinds(sat), ["speaking", "writing", "minimal"])
        self.assertEqual([b["lane"] for b in sat["blocks"]], ["speaking", "writing", "review"])
        self.assertEqual([b["planned_min"] for b in sat["blocks"][:2]], [60, 60])  # the old 2 h block, now AI practice
        self.assertEqual(
            [b["title"] for b in sat["blocks"][:2]],
            ["Main block 1 · AI speaking practice", "Main block 2 · AI writing correction"],
        )
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
        self.assertIn("journal", cockpit.ENABLED_KINDS)
        self.assertIn("speaking", cockpit.ENABLED_KINDS)
        for kind in ("listening", "reading", "checkpoint"):
            self.assertNotIn(kind, cockpit.ENABLED_KINDS)

    def test_loading_twice_does_not_duplicate_the_plan(self):
        first = cockpit.today(self.user_id, PDT, now=_at(MON, 9))
        second = cockpit.today(self.user_id, PDT, now=_at(MON, 14))
        self.assertEqual([b["id"] for b in first["blocks"]], [b["id"] for b in second["blocks"]])
        with cockpit._connect() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM day_blocks WHERE user_id = ? AND day = ?", (self.user_id, MON)
            ).fetchone()[0]
        self.assertEqual(count, 5)

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
        self.assertEqual(len(results[0]), 5)

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
        self.assertEqual(_kinds(plan), ["review", "journal", "minimal"])
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
        self.assertEqual(after["yesterday"], {"blocks_done": 2, "blocks_total": 5, "active_minutes": 45})

    def test_first_day_has_an_empty_yesterday(self):
        plan = cockpit.today(self.user_id, PDT, now=_at(MON))
        self.assertEqual(plan["yesterday"], {"blocks_done": 0, "blocks_total": 0, "active_minutes": 0})

    def test_next_milestone_counts_active_and_manual_hours_but_not_the_car(self):
        _add_time(self.user_id, "review", 60 * 30, MON)
        _add_time(self.user_id, "reading", 60 * 5, MON, source="manual")
        _add_time(self.user_id, "car", 60 * 400, MON)
        plan = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(plan["next_milestone"], {"hours": 100, "hours_to_go": 65.0})

    def test_milestone_reached_moves_on(self):
        _add_time(self.user_id, "review", 60 * 100, MON)
        plan = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(plan["next_milestone"], {"hours": 300, "hours_to_go": 200.0})

    def test_today_lists_only_open_todos(self):
        todos = cockpit.today(self.user_id, PDT, now=_at(MON))["todos"]
        self.assertEqual([t["done"] for t in todos], [False])
        cockpit.complete_todo(self.user_id, todos[0]["id"])
        self.assertEqual(cockpit.today(self.user_id, PDT, now=_at(MON))["todos"], [])


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
        self.assertEqual(_kinds(plan), ["review", "journal", "minimal"])
        self.assertEqual(plan["blocks"][0]["title"], "Review 10 cards")
        self.assertEqual(self._positions(), [1, 2, 3])

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
        self.assertEqual(_kinds(on), ["warmup", "review", "journal", "minimal"])
        off = cockpit.set_minimal(self.user_id, False, PDT, now=self.now)
        self.assertEqual(_kinds(off), ["warmup", "journal", "review", "writing", "minimal"])
        on_again = cockpit.set_minimal(self.user_id, True, PDT, now=self.now)
        self.assertEqual(_kinds(on_again), ["warmup", "review", "journal", "minimal"])
        for plan in (on, off, on_again):
            self.assertEqual(plan["blocks"][0]["id"], warmup["id"])
            self.assertEqual(plan["blocks"][0]["status"], "done")
        self.assertEqual(self._positions(), [1, 2, 3, 4])

    def test_a_finished_wrapup_is_not_added_again(self):
        wrapup = self.plan["blocks"][-1]
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
        self.assertEqual(_kinds(plan), ["review", "journal", "minimal"])

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
        _add_time(self.user_id, "reading", 180, MON, source="manual")
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual((ledger["active_hours"], ledger["manual_hours"]), (0, 3.0))

    def test_ledger_has_no_course_row_and_new_targets_for_reading_and_speaking(self):
        rows = {r["lane"]: r for r in cockpit.ledger(self.user_id, PDT, now=_at(MON))["lanes"]}
        self.assertEqual(list(rows), ["listening", "reading", "speaking", "writing", "review", "car"])
        self.assertEqual((rows["reading"]["week_target"], rows["speaking"]["week_target"]), (4.0, 5.5))
        self.assertEqual(cockpit.phase()["lane_targets"], game.LANE_WEEK_TARGETS)
        self.assertNotIn("course", cockpit.phase()["lane_targets"])

    def test_old_course_hours_still_count_in_the_totals_but_have_no_lane_row(self):
        _add_time(self.user_id, "course", 120, MON, source="manual")
        _add_time(self.user_id, "course", 60, MON)  # auto time
        _add_time(self.user_id, "review", 60, MON)
        ledger = cockpit.ledger(self.user_id, PDT, now=_at(MON))
        self.assertEqual((ledger["active_hours"], ledger["manual_hours"]), (2.0, 2.0))
        self.assertEqual(ledger["hours_to_go"], 96.0)
        self.assertNotIn("course", [r["lane"] for r in ledger["lanes"]])
        self.assertTrue(all(r["active"] == r["manual"] == 0 for r in ledger["lanes"] if r["lane"] != "review"))
        plan = cockpit.today(self.user_id, PDT, now=_at(TUE))
        self.assertEqual(plan["next_milestone"], {"hours": 100, "hours_to_go": 96.0})

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
        self.assertEqual([t["due"] for t in first], ["2026-11-29"])
        self.assertTrue(all(set(t) == {"id", "text", "due", "done"} and t["done"] is False for t in first))
        self.assertIn("分级", first[0]["text"])

    def test_seeding_is_per_user(self):
        other, _ = _new_user()
        self.assertFalse({t["id"] for t in cockpit.list_todos(self.user_id)} & {t["id"] for t in cockpit.list_todos(other)})

    def test_done_marks_the_todo_and_is_idempotent(self):
        todo = cockpit.list_todos(self.user_id)[0]
        cockpit.complete_todo(self.user_id, todo["id"])
        cockpit.complete_todo(self.user_id, todo["id"])
        after = cockpit.list_todos(self.user_id)
        self.assertEqual([t["done"] for t in after], [True])
        self.assertEqual(len(after), 1)  # seeding does not bring a finished todo back

    def test_another_users_todo_is_not_found(self):
        other, _ = _new_user()
        todo = cockpit.list_todos(self.user_id)[0]
        cockpit.list_todos(other)
        with self.assertRaises(KeyError):
            cockpit.complete_todo(other, todo["id"])
        self.assertFalse(cockpit.list_todos(self.user_id)[0]["done"])


class RetiredTutorRowsTests(unittest.TestCase):
    """Rows written before the tutor block was removed must not reach Today."""

    def setUp(self):
        self.user_id, _ = _new_user()

    def test_the_tutor_todo_is_no_longer_seeded(self):
        cockpit.list_todos(self.user_id)
        with cockpit._connect() as conn:
            kinds = [r["kind"] for r in conn.execute("SELECT kind FROM todos WHERE user_id = ?", (self.user_id,))]
        self.assertEqual(kinds, ["placement"])

    def test_an_old_tutor_todo_is_deleted(self):
        with cockpit._connect() as conn:
            conn.execute(
                "INSERT INTO todos (id, user_id, title, due, kind) VALUES (?, ?, 'old', '2026-11-01', 'tutor')",
                (f"seed-tutor-{self.user_id}", self.user_id),
            )
            cockpit._retire_tutor_rows(conn)
        self.assertEqual([t["due"] for t in cockpit.list_todos(self.user_id)], ["2026-11-29"])

    def test_an_old_tutor_block_becomes_ai_speaking_practice_with_its_minutes(self):
        cockpit.today(self.user_id, PDT, now=_at(MON))
        with cockpit._connect() as conn:
            conn.execute(
                """
                INSERT INTO day_blocks (id, user_id, day, position, slot, kind, title, route, lane, start_time, planned_min, status)
                VALUES (?, ?, ?, 9, 'main1', 'course', 'Tutor lesson (log it afterwards)', '/tutor', 'speaking', '10:00', 120, 'skipped')
                """,
                (f"old-tutor-{self.user_id}", self.user_id, MON),
            )
            cockpit._retire_tutor_rows(conn)
            cockpit._retire_tutor_rows(conn)  # idempotent
            row = conn.execute("SELECT * FROM day_blocks WHERE id = ?", (f"old-tutor-{self.user_id}",)).fetchone()
        self.assertEqual(
            (row["kind"], row["route"], row["lane"], row["planned_min"], row["status"]),
            ("speaking", "/speaking", "speaking", 120, "skipped"),
        )
        self.assertEqual(row["title"], "Main block 1 · AI speaking practice")


class RetiredCourseRowsTests(unittest.TestCase):
    """Course blocks written before the course track was removed must not reach Today."""

    def setUp(self):
        self.user_id, _ = _new_user()

    def _id(self, name):
        return f"{name}-{self.user_id}"  # day_blocks.id is global and the test database is shared

    def _old_course_block(self, conn, name, day, position, status="planned", planned_min=40, actual_sec=0):
        conn.execute(
            """
            INSERT INTO day_blocks (id, user_id, day, position, slot, kind, title, route, lane, start_time, planned_min, status, actual_sec)
            VALUES (?, ?, ?, ?, 'main2', 'course', 'Main block 2 · Course or textbook (log the time)', '/hours', 'course', '11:15', ?, ?, ?)
            """,
            (self._id(name), self.user_id, day, position, planned_min, status, actual_sec),
        )

    def _block(self, conn, name):
        return conn.execute("SELECT * FROM day_blocks WHERE id = ?", (self._id(name),)).fetchone()

    def test_tuesday_becomes_intensive_reading_and_thursday_shadowing_keeping_minutes_and_status(self):
        cockpit.today(self.user_id, PDT, now=_at(MON))  # make sure the tables exist
        with cockpit._connect() as conn:
            self._old_course_block(conn, "old-tue", TUE, 4, status="planned", planned_min=40)
            self._old_course_block(conn, "old-thu", THU, 4, status="skipped", planned_min=55)
            self._old_course_block(conn, "old-done", "2026-10-13", 4, status="done", planned_min=40, actual_sec=2100)
            cockpit._retire_course_rows(conn)
            cockpit._retire_course_rows(conn)  # idempotent
            tue, thu, done = (self._block(conn, b) for b in ("old-tue", "old-thu", "old-done"))
            left = conn.execute(
                "SELECT COUNT(*) FROM day_blocks WHERE user_id = ? AND (kind = 'course' OR lane = 'course')", (self.user_id,)
            ).fetchone()[0]
        self.assertEqual(
            (tue["kind"], tue["route"], tue["lane"], tue["planned_min"], tue["status"], tue["slot"]),
            ("intensive", "/reading", "reading", 40, "planned", "main2"),
        )
        self.assertEqual(tue["title"], "Main block 2 · Intensive reading (sentence breakdown)")
        self.assertEqual(
            (thu["kind"], thu["route"], thu["lane"], thu["planned_min"], thu["status"]),
            ("shadowing", "/shadow", "speaking", 55, "skipped"),
        )
        self.assertEqual(thu["title"], "Main block 2 · Shadowing")
        self.assertEqual((done["kind"], done["status"], done["actual_sec"]), ("intensive", "done", 2100))  # a Tuesday
        self.assertEqual(left, 0)

    def test_it_runs_on_startup_and_today_shows_the_new_blocks(self):
        cockpit.today(self.user_id, PDT, now=_at(TUE))
        with cockpit._connect() as conn:
            conn.execute("DELETE FROM day_blocks WHERE user_id = ? AND day = ? AND slot = 'main2'", (self.user_id, TUE))
            self._old_course_block(conn, "old-tue", TUE, 9, status="active")
        cockpit._initialized_db_paths.discard(str(auth_db._get_db_path()))  # a fresh process
        plan = cockpit.today(self.user_id, PDT, now=_at(TUE))
        block = next(b for b in plan["blocks"] if b["id"] == self._id("old-tue"))
        self.assertEqual((block["kind"], block["route"], block["lane"], block["status"]), ("intensive", "/reading", "reading", "active"))
        self.assertNotIn("course", _kinds(plan))
        self.assertEqual(len(plan["blocks"]), 5)  # nothing was added or duplicated

    def test_the_old_tutor_block_is_left_to_the_tutor_migration(self):
        cockpit.today(self.user_id, PDT, now=_at(MON))
        with cockpit._connect() as conn:
            conn.execute(
                """
                INSERT INTO day_blocks (id, user_id, day, position, slot, kind, title, route, lane, start_time, planned_min, status)
                VALUES (?, ?, ?, 9, 'main1', 'course', 'Tutor lesson (log it afterwards)', '/tutor', 'speaking', '10:00', 120, 'planned')
                """,
                (self._id("old-tutor"), self.user_id, SAT),
            )
            cockpit._retire_course_rows(conn)
            untouched = self._block(conn, "old-tutor")
            cockpit._retire_tutor_rows(conn)
            cockpit._retire_course_rows(conn)
            row = self._block(conn, "old-tutor")
        self.assertEqual((untouched["kind"], untouched["route"]), ("course", "/tutor"))
        self.assertEqual((row["kind"], row["route"], row["planned_min"]), ("speaking", "/speaking", 120))

    def test_logged_course_minutes_are_not_rewritten(self):
        _add_time(self.user_id, "course", 45, MON, source="manual")
        cockpit.today(self.user_id, PDT, now=_at(MON))
        with cockpit._connect() as conn:
            cockpit._retire_course_rows(conn)
            rows = conn.execute("SELECT lane, source, seconds FROM study_time WHERE user_id = ?", (self.user_id,)).fetchall()
        self.assertEqual([(r["lane"], r["source"], r["seconds"]) for r in rows], [("course", "manual", 2700)])


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
        self.assertEqual(len(todos), 1)
        _, other = _new_user()
        self.assertEqual(self.client.post(f"/api/todos/{todos[0]['id']}/done", headers=other).status_code, 404)
        self.assertEqual(self.client.post(f"/api/todos/{todos[0]['id']}/done", headers=self.headers).status_code, 200)
        self.assertTrue(self.client.get("/api/todos", headers=self.headers).json()[0]["done"])

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

    # --- retired tutor feature ---
    def test_tutor_session_routes_are_gone(self):
        for method in ("get", "post"):
            with self.subTest(method=method):
                res = getattr(self.client, method)("/api/tutor/sessions", headers=self.headers)
                self.assertEqual(res.status_code, 404)

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
