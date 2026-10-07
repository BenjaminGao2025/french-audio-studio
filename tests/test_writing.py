import testenv  # noqa: F401

import json
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import auth_db
import tts_service
import writing


def _create_user() -> int:
    email = f"writer_{uuid.uuid4().hex[:10]}@example.com"
    return auth_db.register_user(email, "password123")["user"]["id"]


class WritingLogicTests(unittest.TestCase):
    def test_word_count(self):
        self.assertEqual(writing.word_count("Bonjour tout le monde !"), 4)
        # Apostrophes count as separate words in TCF
        self.assertEqual(writing.word_count("J'ai un rendez-vous."), 4)
        self.assertEqual(writing.word_count("C'est l'heure de partir."), 6)

    def test_attempt_lifecycle(self):
        user_id = _create_user()
        subject = writing.SUBJECTS["T1"][0]
        attempt = writing.create_attempt(
            user_id, "T1", subject, "A1", "Bonjour, je vous invite à dîner vendredi.", 120
        )
        self.assertEqual(attempt["status"], "generating_1")
        self.assertEqual(attempt["user_id"], user_id)
        self.assertEqual(attempt["task"], "T1")

        # Feedback 1
        fb1 = {
            "word_count": {"actual": 7, "min": 60, "max": 120, "in_range": False, "note": "Too short"},
            "checklist": [{"point": "Date", "covered": True, "note": "Friday"}],
            "register": {"choice": "vous", "fits": True, "note": "Good"},
            "t3_comparison": None,
            "praise": "Clear invitation.",
            "errors": [
                {"span": "vendredi", "type": "spelling / accents", "hint": "Check capitalization in French."}
            ],
        }
        writing.set_attempt_feedback_1(attempt["id"], fb1)
        refreshed = writing.get_attempt(user_id, attempt["id"])
        self.assertEqual(refreshed["status"], "ready")
        self.assertEqual(refreshed["feedback_1"]["praise"], "Clear invitation.")

        # Round 2 update
        updated = writing.update_attempt_round2(
            user_id, attempt["id"], "Bonjour, je vous invite à dîner vendredi prochain chez moi.", 60
        )
        self.assertEqual(updated["status"], "generating_2")
        self.assertEqual(updated["seconds"], 180)

        # Feedback 2
        fb2 = {
            "fixed_errors": [{"span": "vendredi", "fixed": True, "comment": "Good"}],
            "remaining_errors": [],
            "corrected_text": "Bonjour, je vous invite à dîner vendredi prochain chez moi.",
            "sentences": [
                {
                    "original": "Bonjour, je vous invite à dîner vendredi prochain chez moi.",
                    "corrected": "Bonjour, je vous invite à dîner vendredi prochain chez moi.",
                    "explanation": "Correct phrasing.",
                    "chunk": "je vous invite à dîner",
                }
            ],
            "structures": [
                {"french": "Je vous invite à + infinitif", "english": "I invite you to...", "usage": "Invitation"}
            ],
        }
        writing.set_attempt_feedback_2(attempt["id"], fb2)
        final_att = writing.get_attempt(user_id, attempt["id"])
        self.assertEqual(final_att["status"], "ready")
        self.assertEqual(len(final_att["feedback_2"]["structures"]), 1)

    def test_parse_round1_sanitizes_leaked_corrections_and_limits_errors(self):
        raw = json.dumps({
            "word_count": {"actual": 10, "in_range": False},
            "checklist": [],
            "register": {"choice": "vous", "fits": True},
            "praise": "Great start!",
            "errors": [
                {"span": "j'ai aller", "type": "verb form", "hint": "Change to suis allé."},  # Leaked!
                {"span": "la problème", "type": "gender", "hint": "Problème is masculine."},
                {"span": "beaucoup des gens", "type": "wrong word", "hint": "Replace with beaucoup de gens."},  # Leaked!
            ] + [{"span": f"err_{i}", "type": "agreement", "hint": "Check rule"} for i in range(10)],
        })
        fb = writing.parse_round1_feedback(raw, "text", "T1", writing.SUBJECTS["T1"][0])
        self.assertLessEqual(len(fb["errors"]), 8)
        # Verify leaks sanitized
        self.assertNotIn("Change to", fb["errors"][0]["hint"])
        self.assertNotIn("Replace with", fb["errors"][2]["hint"])

    def test_parse_round2_limits_structures(self):
        raw = json.dumps({
            "fixed_errors": [],
            "remaining_errors": [],
            "corrected_text": "C'est un test.",
            "sentences": [{"original": "Test", "corrected": "Test", "explanation": "ok", "chunk": "Test"}],
            "structures": [
                {"french": f"Structure {i}", "english": "...", "usage": "..."} for i in range(6)
            ],
        })
        fb = writing.parse_round2_feedback(raw)
        self.assertLessEqual(len(fb["structures"]), 3)


class WritingEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user = auth_db.register_user(f"api_writer_{uuid.uuid4().hex[:8]}@example.com", "pass123")
        self.token = self.user["token"]
        self.user_id = self.user["user"]["id"]
        self.auth = {"Authorization": f"Bearer {self.token}"}

    def test_get_write_page(self):
        res = self.client.get("/write")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/html", res.headers["content-type"])

    def test_get_tasks(self):
        res = self.client.get("/api/write/tasks", headers=self.auth)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("recommended_task", data)
        self.assertIn("tasks", data)
        self.assertIn("subjects", data)

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_submit_attempt_and_poll(self, post_chat):
        # Mock Round 1 LLM response
        post_chat.return_value = ({}, json.dumps({
            "word_count": {"actual": 10, "min": 60, "max": 120, "in_range": False, "note": "Short"},
            "checklist": [{"point": "RSVP", "covered": True, "note": "yes"}],
            "register": {"choice": "vous", "fits": True, "note": "polite"},
            "praise": "Good opening.",
            "errors": [{"span": "inviter", "type": "verb form", "hint": "Check conjugated form"}],
        }))
        subject = writing.SUBJECTS["T1"][0]
        res = self.client.post(
            "/api/write/attempts",
            headers=self.auth,
            json={
                "task": "T1",
                "subject": subject,
                "level": "A1",
                "text": "Je vous inviter à venir chez moi vendredi.",
                "seconds": 45,
            },
        )
        self.assertEqual(res.status_code, 200)
        attempt_id = res.json()["id"]

        # Poll attempt
        poll_res = self.client.get(f"/api/write/attempts/{attempt_id}", headers=self.auth)
        self.assertEqual(poll_res.status_code, 200)
        self.assertEqual(poll_res.json()["status"], "ready")
        self.assertEqual(poll_res.json()["feedback_1"]["praise"], "Good opening.")

        # Submit Round 2
        post_chat.return_value = ({}, json.dumps({
            "fixed_errors": [{"span": "inviter", "fixed": True, "comment": "Conjugated correctly"}],
            "remaining_errors": [],
            "corrected_text": "Je vous invite à venir chez moi vendredi.",
            "sentences": [
                {
                    "original": "Je vous invite à venir chez moi vendredi.",
                    "corrected": "Je vous invite à venir chez moi vendredi.",
                    "explanation": "invite is first person singular present.",
                    "chunk": "Je vous invite à venir",
                }
            ],
            "structures": [
                {"french": "Je vous invite à + inf", "english": "I invite you to...", "usage": "Invitations"}
            ],
        }))
        r2_res = self.client.post(
            f"/api/write/attempts/{attempt_id}/round2",
            headers=self.auth,
            json={"text": "Je vous invite à venir chez moi vendredi.", "seconds": 30},
        )
        self.assertEqual(r2_res.status_code, 200)

        # Poll round 2
        poll_r2 = self.client.get(f"/api/write/attempts/{attempt_id}", headers=self.auth)
        self.assertEqual(poll_r2.status_code, 200)
        self.assertEqual(poll_r2.json()["status"], "ready")
        self.assertEqual(len(poll_r2.json()["feedback_2"]["sentences"]), 1)
