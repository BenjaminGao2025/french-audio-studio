import testenv  # noqa: F401  (must run before the app is imported)

import datetime
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

import auth_db
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
        self.assertEqual(game.WEEK_TARGET_MIN, 24 * 60)
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
        self.assertEqual(game.week_target(datetime.date(2026, 10, 5)), 1440)

    def test_rebalanced_targets_and_skills(self):
        self.assertEqual(game.LANE_WEEK_TARGETS["writing"], 210)
        self.assertEqual(game.LANE_WEEK_TARGETS["review"], 150)
        self.assertEqual(game.WEEK_TARGET_MIN, 1440)

    def test_the_course_target_moved_into_reading_and_speaking(self):
        # The old 180 min/week course target is now 90 min of intensive reading and 90 of shadowing.
        self.assertNotIn("course", game.LANE_WEEK_TARGETS)
        self.assertNotIn("course", game.LANES)
        self.assertEqual(game.LANE_WEEK_TARGETS["reading"], 150 + 90)
        self.assertEqual(game.LANE_WEEK_TARGETS["speaking"], 240 + 90)
        self.assertEqual(tuple(game.LANES), ("listening", "reading", "speaking", "writing", "review", "car"))
        self.assertEqual(game.WEEK_TARGET_MIN, 1440)  # the weekly total did not change



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
        self.assertEqual(state["today"]["target"], 240)
        self.assertEqual(state["week"]["by_lane"]["reading"], 200)

    def test_tcf_skills_grouping_and_furthest_behind(self):
        now = _at("2026-10-06", 10)  # a Tuesday
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        skills = week["skills"]
        self.assertEqual(skills["CO"]["target"], 510)  # listening (210) + car*0.5 (300)
        self.assertEqual(skills["CE"]["target"], 240)  # reading (150 + 90 intensive reading)
        self.assertEqual(skills["EE"]["target"], 210)  # writing (210)
        self.assertEqual(skills["EO"]["target"], 330)  # speaking (240 + 90 shadowing)
        self.assertEqual(skills["shared"]["target"], 150)  # review (150)
        total_target = sum(s["target"] for s in skills.values())
        self.assertEqual(total_target, 1440)
        self.assertEqual(week["focus_skill"]["skill"], "CO")
        self.assertEqual(week["focus_skill"]["link"], "/listen")

        # Log some listening time: 200 min listening -> EO becomes furthest behind (target 330 vs CE 240)
        game.log_time(self.user_id, "listening", 200, "", PDT, now)
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        self.assertEqual(week["focus_skill"]["skill"], "EO")
        self.assertEqual(week["focus_skill"]["link"], "/speak")

        # Log speaking time: 240 min speaking -> CE becomes furthest behind (target 240 vs EE 210)
        game.log_time(self.user_id, "speaking", 240, "", PDT, now)
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        self.assertEqual(week["focus_skill"]["skill"], "CE")
        self.assertEqual(week["focus_skill"]["link"], "/study")

        # Log reading time: 240 min reading -> EE becomes furthest behind
        game.log_time(self.user_id, "reading", 240, "", PDT, now)
        st = game.state(self.user_id, PDT, now)
        week = st["week"]
        self.assertEqual(week["focus_skill"]["skill"], "EE")
        self.assertEqual(week["focus_skill"]["link"], "/write")


    def test_car_listening_counts_half(self):
        now = _at("2026-10-10", 10)  # a Saturday
        game.log_time(self.user_id, "car", 60, "", PDT, now)
        state = game.state(self.user_id, PDT, now)
        self.assertEqual(state["today"]["by_lane"]["car"], 60)
        self.assertEqual(state["today"]["minutes"], 30)
        self.assertEqual(state["week"]["minutes"], 30)
        self.assertEqual(state["xp"], 30)
        self.assertEqual(state["today"]["target"], game.WEEKEND_TARGET_MIN)

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
        self.assertEqual(sum(s["target"] for s in state["week"]["skills"].values()), 1440)

    def test_an_old_manual_course_log_is_still_listed_so_it_can_be_deleted(self):
        logs = game.state(self.user_id, PDT, self.now)["today"]["logs"]
        self.assertEqual([(log["lane"], log["minutes"]) for log in logs], [("course", 90)])
        self.assertTrue(game.delete_log(self.user_id, logs[0]["id"]))
        self.assertEqual(game.state(self.user_id, PDT, self.now)["today"]["logs"], [])


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
