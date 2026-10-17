import testenv  # noqa: F401  (must run before the app is imported)

import datetime
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

import auth_db
import coach
import game
import srs
import tts_service

UTC = datetime.timezone.utc
PDT = 420  # JavaScript getTimezoneOffset() in Vancouver summer time


def _new_user() -> tuple[int, dict]:
    reg = auth_db.register_user(f"game_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


def _at(day: str, hour: int) -> datetime.datetime:
    """A UTC instant for a local (PDT) date and hour."""
    local = datetime.datetime.fromisoformat(f"{day}T{hour:02d}:00:00")
    return (local + datetime.timedelta(minutes=PDT)).replace(tzinfo=UTC)


class LevelCurveTests(unittest.TestCase):
    def test_levels_follow_study_hours(self):
        # One level per hour: level 1000 = 1000 hours
        self.assertEqual(game.level_threshold(0), 0)
        self.assertEqual(game.level_threshold(game.MAX_LEVEL), 1000 * 60)
        self.assertEqual(game.WEEK_TARGET_MIN, 16 * 60)
        self.assertEqual(game.level_for(59)["level"], 0)
        info = game.level_for(5 * 60 + 30)
        self.assertEqual(info["level"], 5)
        self.assertEqual(info["next_level_xp"], 6 * 60)
        self.assertEqual(info["progress"], 0.5)
        self.assertEqual(game.level_for(10**9)["level"], game.MAX_LEVEL)
        self.assertIsNone(game.level_for(10**9)["next_level_xp"])

    def test_plan_weeks(self):
        self.assertEqual(game.week_number(datetime.date(2026, 10, 4)), 0)
        self.assertEqual(game.week_number(datetime.date(2026, 10, 5)), 1)
        self.assertEqual(game.week_number(datetime.date(2026, 11, 29)), 8)
        self.assertEqual(game.week_target(datetime.date(2027, 6, 1)), game.MAINTENANCE_WEEK_TARGET_MIN)
        self.assertEqual(game.week_target(datetime.date(2026, 10, 5)), 960)

    def test_the_16_hour_week_and_its_split(self):
        # PRD 6.1: 16 h = 960 min, listening 3.5 h, reading 4 h, speaking 5 h, writing 2 h, review 1.5 h.
        self.assertEqual(
            game.LANE_WEEK_TARGETS,
            {"listening": 210, "reading": 240, "speaking": 300, "writing": 120, "review": 90, "car": 0},
        )
        self.assertEqual(game.WEEK_TARGET_MIN, 960)
        self.assertEqual(sum(game.LANE_WEEK_TARGETS.values()), game.WEEK_TARGET_MIN)
        self.assertEqual(game.MAINTENANCE_WEEK_TARGET_MIN, 300)

    def test_day_targets_add_up_to_the_week(self):
        # Monday = 0: 160 min on a weekday, 120 on Saturday, 40 on Sunday (PRD appendix C).
        self.assertEqual(game.DAY_TARGET_MIN, (160, 160, 160, 160, 160, 120, 40))
        self.assertEqual(sum(game.DAY_TARGET_MIN), game.WEEK_TARGET_MIN)

    def test_the_course_lane_is_gone(self):
        # Its 3 h went to intensive reading and shadowing (reading 4 h, speaking 5 h).
        self.assertNotIn("course", game.LANE_WEEK_TARGETS)
        self.assertNotIn("course", game.LANES)
        self.assertEqual(tuple(game.LANES), ("listening", "reading", "speaking", "writing", "review", "car"))

    def test_lane_targets_outside_maintenance_are_a_copy_of_the_split(self):
        targets = game.lane_week_targets(datetime.date(2026, 10, 5))
        self.assertEqual(targets, game.LANE_WEEK_TARGETS)
        targets["car"] = 99
        self.assertEqual(game.LANE_WEEK_TARGETS["car"], 0)

    def test_maintenance_scales_the_split_to_exactly_five_hours(self):
        scaled = game.lane_week_targets(datetime.date(2027, 6, 1))
        self.assertEqual(scaled, {"listening": 66, "reading": 75, "speaking": 94, "writing": 37, "review": 28, "car": 0})
        self.assertEqual(sum(scaled.values()), game.MAINTENANCE_WEEK_TARGET_MIN)
        # The edges of the period; the day before and after use the full split.
        self.assertEqual(sum(game.lane_week_targets(datetime.date(2027, 5, 1)).values()), 300)
        self.assertEqual(sum(game.lane_week_targets(datetime.date(2027, 8, 31)).values()), 300)
        self.assertEqual(sum(game.lane_week_targets(datetime.date(2027, 4, 30)).values()), 960)
        self.assertEqual(sum(game.lane_week_targets(datetime.date(2027, 9, 1)).values()), 960)


class StudyTimeTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()

    def test_minutes_beyond_five_hours_earn_half_xp(self):
        now = _at("2026-10-06", 10)  # a Tuesday
        game.log_time(self.user_id, "reading", 200, "", PDT, now)
        game.log_time(self.user_id, "listening", 200, "", PDT, now)
        state = game.state(self.user_id, PDT, now)
        self.assertEqual(state["today"]["minutes"], 400)
        self.assertEqual(state["xp"], 300 + 50)
        self.assertEqual(state["today"]["target"], 160)
        self.assertEqual(state["week"]["by_lane"]["reading"], 200)

    def test_day_targets_follow_the_weekly_template(self):
        for offset, expected in enumerate(game.DAY_TARGET_MIN):  # 2026-10-05 is a Monday
            day = datetime.date(2026, 10, 5) + datetime.timedelta(days=offset)
            with self.subTest(day=day.isoformat()):
                state = game.state(self.user_id, PDT, _at(day.isoformat(), 10))
                self.assertEqual(state["today"]["target"], expected)
        self.assertEqual(
            [game.state(self.user_id, PDT, _at(d, 10))["today"]["target"] for d in ("2026-10-10", "2026-10-11")],
            [120, 40],
        )

    def test_tcf_skills_grouping_and_furthest_behind(self):
        now = _at("2026-10-06", 10)  # a Tuesday
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        skills = week["skills"]
        self.assertEqual(skills["CO"]["target"], 210)  # listening (210) + car*0.5 (the car has no target)
        self.assertEqual(skills["CE"]["target"], 240)  # reading (all intensive reading)
        self.assertEqual(skills["EE"]["target"], 120)  # writing
        self.assertEqual(skills["EO"]["target"], 300)  # speaking (incl. 90 shadowing)
        self.assertEqual(skills["shared"]["target"], 90)  # review
        total_target = sum(s["target"] for s in skills.values())
        self.assertEqual(total_target, 960)
        self.assertEqual(week["target"], 960)
        self.assertEqual(week["focus_skill"]["skill"], "EO")  # nothing done: the biggest target is furthest behind
        self.assertEqual(week["focus_skill"]["link"], "/speak")

        # Log speaking time: 300 min speaking -> EO is done and CE is furthest behind (target 240)
        game.log_time(self.user_id, "speaking", 300, "", PDT, now)
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        self.assertEqual(week["focus_skill"]["skill"], "CE")
        self.assertEqual(week["focus_skill"]["link"], "/study")

        # Log reading time: 240 min reading -> CO becomes furthest behind (target 210 vs EE 120)
        game.log_time(self.user_id, "reading", 240, "", PDT, now)
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        self.assertEqual(week["focus_skill"]["skill"], "CO")
        self.assertEqual(week["focus_skill"]["link"], "/listen")

        # Log listening time: 210 min listening -> EE becomes furthest behind
        game.log_time(self.user_id, "listening", 210, "", PDT, now)
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        self.assertEqual(week["focus_skill"]["skill"], "EE")
        self.assertEqual(week["focus_skill"]["link"], "/write")

    def test_week_lane_targets_add_up_to_the_week_target(self):
        week = game.state(self.user_id, PDT, _at("2026-10-06", 10))["week"]
        self.assertEqual(week["lane_targets"], game.LANE_WEEK_TARGETS)
        weighted = sum(m * week["lane_weights"][lane] for lane, m in week["lane_targets"].items())
        self.assertEqual(weighted, week["target"])

    def test_car_listening_counts_half(self):
        now = _at("2026-10-10", 10)  # a Saturday
        game.log_time(self.user_id, "car", 60, "", PDT, now)
        state = game.state(self.user_id, PDT, now)
        self.assertEqual(state["today"]["by_lane"]["car"], 60)
        self.assertEqual(state["today"]["minutes"], 30)
        self.assertEqual(state["week"]["minutes"], 30)
        self.assertEqual(state["xp"], 30)
        self.assertEqual(state["today"]["target"], 120)  # Saturday

    def test_heartbeats_are_capped_and_land_on_the_study_day(self):
        early = _at("2026-10-07", 2)  # 02:00 still belongs to the 6th
        stored = game.record_time(self.user_id, "review", 999, PDT, early)
        self.assertEqual(stored, game.MAX_HEARTBEAT_SECONDS)
        state = game.state(self.user_id, PDT, early)
        self.assertEqual(state["today"]["day"], "2026-10-06")
        self.assertEqual(state["today"]["by_lane"]["review"], 2)

    def test_weekday_streak_skips_weekends_and_family_days(self):
        # Thu, Fri active; Sat/Sun off; Mon family day; Tue (today) not studied yet
        for day in ("2026-10-08", "2026-10-09"):
            game.log_time(self.user_id, "reading", 60, "", PDT, _at(day, 10))
        game.set_family_day(self.user_id, True, PDT, _at("2026-10-12", 10))
        state = game.state(self.user_id, PDT, _at("2026-10-13", 10))
        self.assertEqual(state["streak_days"], 2)
        self.assertFalse(state["today"]["family_day"])
        # A missed weekday breaks it
        state = game.state(self.user_id, PDT, _at("2026-10-15", 10))
        self.assertEqual(state["streak_days"], 0)

    def test_family_day_has_no_target(self):
        now = _at("2026-10-06", 10)
        game.set_family_day(self.user_id, True, PDT, now)
        self.assertEqual(game.state(self.user_id, PDT, now)["today"]["target"], 0)

    def test_wave_cleared_pays_once_a_day(self):
        now = _at("2026-10-06", 11)
        self.assertEqual(game.wave_cleared(self.user_id, PDT, now), game.WAVE_CLEARED_XP)
        self.assertEqual(game.wave_cleared(self.user_id, PDT, now), 0)
        self.assertEqual(game.state(self.user_id, PDT, now)["xp"], game.WAVE_CLEARED_XP)


class RetiredCourseLaneTests(unittest.TestCase):
    """Time logged under the old course lane stays in history but belongs to no lane or target."""

    def setUp(self):
        self.user_id, _ = _new_user()
        self.now = _at("2026-10-06", 10)  # a Tuesday
        with game._connect() as conn:
            for source, minutes in (("manual", 90), ("auto", 30)):
                conn.execute(
                    "INSERT INTO study_time (user_id, day, lane, source, seconds, note, created_at) VALUES (?, ?, 'course', ?, ?, 'old', ?)",
                    (self.user_id, "2026-10-06", source, minutes * 60, "2026-10-06T00:00:00+00:00"),
                )

    def test_new_course_time_cannot_be_logged(self):
        with self.assertRaises(ValueError):
            game.log_time(self.user_id, "course", 30, "", PDT, self.now)
        with self.assertRaises(ValueError):
            game.record_time(self.user_id, "course", 60, PDT, self.now)

    def test_old_course_minutes_still_count_as_study_but_not_toward_a_lane(self):
        state = game.state(self.user_id, PDT, self.now)
        self.assertEqual(state["today"]["minutes"], 120)
        self.assertEqual(state["hours_total"], 2.0)
        self.assertEqual(state["xp"], 120)
        self.assertEqual(state["week"]["minutes"], 120)
        self.assertNotIn("course", state["today"]["by_lane"])
        self.assertNotIn("course", state["week"]["by_lane"])
        self.assertNotIn("course", state["week"]["lane_targets"])
        self.assertEqual(sum(state["week"]["by_lane"].values()), 0)
        self.assertEqual(sum(s["minutes"] for s in state["week"]["skills"].values()), 0)
        self.assertEqual(sum(s["target"] for s in state["week"]["skills"].values()), 960)

    def test_an_old_manual_course_log_is_still_listed_so_it_can_be_deleted(self):
        logs = game.state(self.user_id, PDT, self.now)["today"]["logs"]
        self.assertEqual([(log["lane"], log["minutes"]) for log in logs], [("course", 90)])
        self.assertTrue(game.delete_log(self.user_id, logs[0]["id"]))
        self.assertEqual(game.state(self.user_id, PDT, self.now)["today"]["logs"], [])


class MaintenanceStateTests(unittest.TestCase):
    """May-Aug 2027: 5 h a week, the same split scaled down, nothing on weekends."""

    def setUp(self):
        self.user_id, _ = _new_user()

    def test_week_target_lanes_and_day_targets(self):
        wed = game.state(self.user_id, PDT, _at("2027-06-02", 10))
        week = wed["week"]
        self.assertTrue(week["maintenance"])
        self.assertEqual(week["target"], game.MAINTENANCE_WEEK_TARGET_MIN)
        self.assertEqual(week["lane_targets"], game.lane_week_targets(datetime.date(2027, 6, 2)))
        self.assertEqual(sum(week["lane_targets"].values()), week["target"])
        self.assertEqual(sum(s["target"] for s in week["skills"].values()), 0)  # no skill targets in maintenance
        self.assertEqual(wed["today"]["target"], 60)
        sat = game.state(self.user_id, PDT, _at("2027-06-05", 10))
        self.assertEqual(sat["today"]["target"], 0)

    def test_the_weekdays_add_up_to_five_hours(self):
        days = [datetime.date(2027, 6, 7) + datetime.timedelta(days=i) for i in range(7)]  # Monday to Sunday
        targets = [game.state(self.user_id, PDT, _at(d.isoformat(), 10))["today"]["target"] for d in days]
        self.assertEqual(sum(targets), game.MAINTENANCE_WEEK_TARGET_MIN)


class CoachPlanTargetsTests(unittest.TestCase):
    """A stored coach plan replaces the fixed week; its default weights follow the 16 h split."""

    def setUp(self):
        self.user_id, _ = _new_user()

    def _profile(self, weekday_minutes: int, weekend_minutes: int) -> dict:
        return dict(
            exam="TCF Canada", target="NCLC 7",
            deadline=(coach.local_date() + datetime.timedelta(days=230)).isoformat(),
            timezone="America/Vancouver", levels={k: "A1" for k in coach.KINDS},
            weekday_minutes=weekday_minutes, weekend_minutes=weekend_minutes,
            weekday_start="09:00", weekend_start="09:00", study_days=list(range(7)),
            constraints="", experience="", reminder=False,
        )

    def test_default_weights_are_the_hours_of_the_16_hour_plan(self):
        lane = {"listen": "listening", "write": "writing", "speak": "speaking", "review": "review", "read": "reading"}
        self.assertEqual(set(coach.DEFAULT_WEIGHTS), set(coach.KINDS))
        for kind, weight in coach.DEFAULT_WEIGHTS.items():
            self.assertEqual(weight * 60, game.LANE_WEEK_TARGETS[lane[kind]], kind)
        self.assertEqual(sum(coach.DEFAULT_WEIGHTS.values()), 16)
        self.assertTrue(all(1 <= w <= 5 for w in coach.DEFAULT_WEIGHTS.values()))  # what the AI coach may set

    def test_a_960_minute_coach_week_gets_the_same_lane_targets(self):
        coach.save_profile(self.user_id, self._profile(160, 80))  # 5 * 160 + 2 * 80
        state = game.state(self.user_id, PDT, _at("2026-10-06", 10))
        week = state["week"]
        self.assertEqual(week["target"], 960)
        self.assertEqual(week["lane_targets"], game.LANE_WEEK_TARGETS)
        self.assertEqual(state["today"]["target"], 160)

    def test_a_smaller_coach_week_keeps_the_proportions(self):
        coach.save_profile(self.user_id, self._profile(60, 60))  # 7 h
        week = game.state(self.user_id, PDT, _at("2026-10-06", 10))["week"]
        self.assertEqual(week["target"], 420)
        for lane, minutes in week["lane_targets"].items():
            share = game.LANE_WEEK_TARGETS[lane] / game.WEEK_TARGET_MIN
            self.assertAlmostEqual(minutes, 420 * share, delta=0.5, msg=lane)  # rounded to whole minutes
        self.assertEqual(week["lane_targets"]["car"], 0)


class ReviewFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()
        note = srs.add_note(self.user_id, "Je vais à la gare.", translation_en="I am going to the station.",
                            targets=[{"text": "gare"}, {"text": "vais"}, {"text": "la"}])
        self.cards = [c["id"] for c in note["cards"]]

    def _review(self, card_id, rating, minute):
        now = _at("2026-10-06", 10) + datetime.timedelta(minutes=minute)
        srs.review_card(self.user_id, card_id, rating, now=now)
        return game.review_feedback(self.user_id, PDT, now)

    def test_first_blood_combo_and_death(self):
        first = self._review(self.cards[0], 3, 0)
        self.assertTrue(first["kill"] and first["first_blood"])
        self.assertEqual(first["combo"], 1)
        self.assertEqual(first["xp"], 4 + game.NEW_CARD_XP + game.FIRST_BLOOD_XP)

        second = self._review(self.cards[1], 4, 1)
        self.assertEqual(second["combo"], 2)
        self.assertFalse(second["first_blood"])
        self.assertEqual(second["xp"], 5 + game.NEW_CARD_XP + 1)

        death = self._review(self.cards[2], 1, 2)
        self.assertTrue(death["death"])
        self.assertEqual(death["combo"], 0)
        self.assertEqual(death["state"]["today"]["kills"], 2)
        self.assertEqual(death["state"]["today"]["deaths"], 1)
        self.assertEqual(death["state"]["today"]["best_combo"], 2)
        self.assertEqual(death["state"]["today"]["combo"], 0)
        self.assertEqual(second["state"]["today"]["combo"], 2)


class GameApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user_id, self.headers = _new_user()

    def test_requires_login(self):
        self.assertEqual(self.client.get("/api/game/state").status_code, 401)

    def test_log_heartbeat_and_undo(self):
        res = self.client.post("/api/game/log", headers=self.headers,
                               json={"lane": "speaking", "minutes": 60, "note": "Teacher class", "tz_offset": PDT})
        self.assertEqual(res.status_code, 200)
        log = res.json()["today"]["logs"][0]
        self.assertEqual(log["minutes"], 60)
        self.client.post("/api/game/heartbeat", headers=self.headers, json={"lane": "review", "seconds": 60, "tz_offset": PDT})
        state = self.client.get(f"/api/game/state?tz_offset={PDT}", headers=self.headers).json()
        self.assertEqual(state["today"]["minutes"], 61)
        res = self.client.delete(f"/api/game/log/{log['id']}?tz_offset={PDT}", headers=self.headers)
        self.assertEqual(res.json()["today"]["minutes"], 1)
        bad = self.client.post("/api/game/log", headers=self.headers, json={"lane": "dota", "minutes": 5})
        self.assertEqual(bad.status_code, 422)

    def test_the_course_lane_is_rejected(self):
        log = self.client.post("/api/game/log", headers=self.headers, json={"lane": "course", "minutes": 5})
        beat = self.client.post("/api/game/heartbeat", headers=self.headers, json={"lane": "course", "seconds": 60})
        self.assertEqual((log.status_code, beat.status_code), (422, 422))

    def test_callouts_are_fixed_lines_generated_once(self):
        self.assertEqual(self.client.get("/api/game/callout/hello.mp3").status_code, 404)
        spoken = []

        class FakeCommunicate:
            def __init__(self, text, **kwargs):
                spoken.append((text, kwargs["voice"]))

            async def save(self, path):
                with open(path, "wb") as handle:
                    handle.write(b"ID3fake")

        with patch.object(tts_service.edge_tts, "Communicate", FakeCommunicate):
            first = self.client.get("/api/game/callout/double_kill.mp3")
            second = self.client.get("/api/game/callout/double_kill.mp3")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["content-type"], "audio/mpeg")
        self.assertEqual(second.content, b"ID3fake")
        self.assertEqual(spoken, [("Double kill!", game.CALLOUT_VOICE["voice"])])

    def test_review_response_carries_the_kill_feed(self):
        note = srs.add_note(self.user_id, "Bonjour.", targets=[{"text": "Bonjour"}])
        card_id = note["cards"][0]["id"]
        res = self.client.post(f"/api/srs/cards/{card_id}/review", headers=self.headers,
                               json={"rating": 3, "tz_offset": PDT})
        self.assertEqual(res.status_code, 200)
        feed = res.json()["game"]
        self.assertTrue(feed["kill"])
        self.assertTrue(feed["first_blood"])
        self.assertGreater(feed["state"]["xp"], 0)


if __name__ == "__main__":
    unittest.main()
