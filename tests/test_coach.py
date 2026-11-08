import datetime as dt
import json
import unittest
import uuid

import testenv  # noqa: F401
from fastapi.testclient import TestClient

import auth_db
import coach
import curriculum
import episodes
import game
import tts_service
import writing


def user():
    u = auth_db.register_user(f"coach-{uuid.uuid4().hex}@example.com", "password123")
    return u["user"]["id"], {"Authorization": "Bearer " + u["token"]}


def profile():
    return dict(
        exam="TCF Canada",
        target="NCLC 7",
        deadline=(coach.local_date() + dt.timedelta(days=230)).isoformat(),
        timezone="America/Vancouver",
        levels={k: "A1" for k in coach.KINDS},
        weekday_minutes=45,
        weekend_minutes=30,
        weekday_start="19:00",
        weekend_start="09:00",
        study_days=[0, 1, 2, 3, 4, 5],
        constraints="Sunday is family time",
        experience="",
        reminder=False,
    )


class CoachTests(unittest.TestCase):
    def setUp(self):
        self.uid, self.auth = user()
        self.client = TestClient(tts_service.app)

    def test_capacity_and_seven_day_schedule(self):
        coach.save_profile(self.uid, profile())
        d = coach.dashboard(self.uid)
        self.assertEqual(len(d["schedule"]), 7)
        self.assertEqual(d["capacity"]["weekly_minutes"], 255)
        for slot in d["schedule"]:
            day = dt.date.fromisoformat(slot["day"])
            self.assertEqual(sum(t["minutes"] for t in slot["tasks"]), coach.budget(profile(), day))
            self.assertTrue(all(t["minutes"] > 0 for t in slot["tasks"]))
        self.assertEqual(coach.dashboard(self.uid)["schedule"], d["schedule"])

    def test_rewards_are_idempotent_and_capped(self):
        self.assertEqual(coach.record(self.uid, "write", "one"), 10)
        self.assertEqual(coach.record(self.uid, "write", "one"), 0)
        for i in range(5):
            coach.record(self.uid, "write", str(i))
        self.assertEqual(coach.progress(self.uid)["xp"], 30)
        self.assertEqual(game.state(self.uid, 0)["xp"], 30)
        self.assertEqual(game.state(self.uid, 0)["hours_total"], 0)

    def test_revision_reward_requires_changed_text_and_successful_fix(self):
        a = dict(
            id="revision1",
            task="P0",
            level="A1",
            text_1="Je suis chinois.",
            text_2="Je suis chinois.",
            feedback_1={"praise": "OK"},
            feedback_2={"fixed_errors": [{"fixed": True}]},
        )
        coach.writing_evidence(self.uid, a)
        self.assertEqual(coach.progress(self.uid)["weekly"]["revision"], 0)
        a["text_2"] = "Je suis chinoise."
        coach.writing_evidence(self.uid, a)
        coach.writing_evidence(self.uid, a)
        self.assertEqual(coach.progress(self.uid)["xp"], 25)

    def test_manual_completion_is_not_verified_and_does_not_award_xp(self):
        p = profile()
        p["study_days"] = list(range(7))
        coach.save_profile(self.uid, p)
        d = coach.dashboard(self.uid)
        kind = d["tasks"][0]["kind"]
        coach.record(self.uid, "self", f"{d['day']}:{kind}", {"kind": kind, "note": ""}, 0)
        d = coach.dashboard(self.uid)
        task = next(t for t in d["tasks"] if t["kind"] == kind)
        self.assertTrue(task["self_reported"])
        self.assertFalse(task["verified"])
        self.assertEqual(d["progress"]["xp"], 0)

    def test_model_cannot_increase_time_or_choose_unknown_task(self):
        p = profile()
        coach.save_profile(self.uid, p)
        plan = coach.save_ai_plan(
            self.uid,
            json.dumps(
                {
                    "summary": "short steps",
                    "task_weights": {"listen": 10000, "write": -200, "evil": 999},
                    "questions": ["Which time works?"],
                    "weekday_minutes": 999,
                }
            ),
            note="Chinese hints please",
        )
        self.assertEqual(plan["task_weights"]["listen"], 5)
        self.assertEqual(plan["task_weights"]["write"], 1)
        self.assertNotIn("evil", plan["task_weights"])
        self.assertEqual(coach.get_profile(self.uid)["profile"]["weekday_minutes"], 45)
        self.assertIn("Chinese hints", plan["interview_notes"])

    def test_game_uses_personal_budget(self):
        coach.save_profile(self.uid, profile())
        state = game.state(self.uid, 0)
        self.assertEqual(state["week"]["target"], 255)

    def test_check_private_and_no_answer_leak(self):
        check = coach.start_check(self.uid, theme="cafe")
        self.assertNotIn("lines", check["lesson"])
        self.assertNotIn("correct", check["lesson"]["questions"][0])
        _, other = user()
        self.assertEqual(
            self.client.post(f"/api/coach/listen/{check['id']}/hint", headers=other, json={}).status_code, 404
        )
        self.assertEqual(coach.start_check(self.uid, theme="cafe")["id"], check["id"])

    def test_hint_marks_support_and_repeated_submission_cannot_farm(self):
        check = coach.start_check(self.uid, theme="cafe")
        coach.transcript(self.uid, check["id"])
        result = coach.answer_check(self.uid, check["id"], [0, 1, 2])
        self.assertEqual(result["score"], 3)
        self.assertTrue(result["assisted"])
        self.assertEqual(coach.answer_check(self.uid, check["id"], [1, 1, 1]), result)
        self.assertEqual(coach.progress(self.uid)["xp"], 20)
        self.assertEqual(coach.progress(self.uid)["independent_listens"], 0)

    def test_challenge_hides_text_until_submitted(self):
        check = coach.start_check(self.uid, challenge=True)
        with self.assertRaises(ValueError):
            coach.transcript(self.uid, check["id"])
        coach.answer_check(self.uid, check["id"], [0, 0, 0])
        self.assertEqual(len(coach.transcript(self.uid, check["id"])), 3)
        self.assertEqual(coach.start_check(self.uid, challenge=True)["id"], check["id"])

    def test_independent_progress_requires_distinct_lessons(self):
        for lesson in curriculum.LESSONS[:3]:
            check = coach.start_check(self.uid, theme=lesson["id"])
            coach.answer_check(self.uid, check["id"], [q[3] for q in lesson["questions"]])
        self.assertTrue(coach.progress(self.uid)["suggest_a1"])

    def test_beginner_material_filters_complex_history(self):
        material = [
            {
                "key": "long",
                "sentence": "Les autorités demandent que vous présentiez tous les documents nécessaires immédiatement.",
                "en": "Complex",
                "build_up": [],
            },
            {"key": "simple", "sentence": "Je voudrais un café.", "en": "A coffee", "build_up": []},
        ]
        self.assertEqual([x["key"] for x in episodes.material_for_level(material, "A1")], ["simple"])
        self.assertEqual(len(episodes.material_for_level(material, "B2")), 2)

    def test_beginner_feedback_range_and_error_limit(self):
        raw = json.dumps(
            {"errors": [{"span": str(i), "hint": "Check agreement", "type": "agreement"} for i in range(8)]}
        )
        result = writing.parse_round1_feedback(raw, "Je suis ici.", "P0", writing.SUBJECTS["P0"][0])
        self.assertEqual(result["word_count"]["min"], 6)
        self.assertLessEqual(len(result["errors"]), 2)
        a = dict(task="P0", subject=writing.SUBJECTS["P0"][0], text_1="Je suis ici.", level="A1")
        prompt = writing.build_round1_payload(a, "test")["messages"][0]["content"]
        self.assertIn("NOT an exam", prompt)
        self.assertIn("up to 2 error spans", prompt)
        prompt = writing.build_new_subject_payload("T1", "B1")["messages"][0]["content"]
        self.assertIn("Learner level: B1", prompt)
