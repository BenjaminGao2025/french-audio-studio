import testenv  # noqa: F401

import json
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import auth_db
import speaking
import tts_service


def _create_user() -> int:
    email = f"speaker_{uuid.uuid4().hex[:10]}@example.com"
    return auth_db.register_user(email, "password123")["user"]["id"]


class SpeakingLogicTests(unittest.TestCase):
    def test_word_count_and_wpm(self):
        text = "Bonjour je m'appelle Pierre et j'habite à Montréal."
        wc = speaking.word_count(text)
        self.assertEqual(wc, 10)
        wpm = speaking.calculate_wpm(wc, 6.0)  # 9 words in 6 seconds = 90 WPM
        self.assertEqual(wpm, 100.0)

    def test_attempt_lifecycle(self):
        user_id = _create_user()
        subject = speaking.SUBJECTS["T1"][0]
        attempt = speaking.create_attempt(
            user_id, "T1", subject, "A1", "Bonjour, je m'appelle Thomas.", 20, 5.0
        )
        self.assertEqual(attempt["status"], "generating_1")
        self.assertEqual(attempt["user_id"], user_id)
        self.assertEqual(attempt["task"], "T1")

        # Feedback 1
        fb1 = {
            "stats": {"duration_sec": 5.0, "wpm": 48.0, "pace_note": "A bit slow"},
            "checklist": [{"point": "Nom", "covered": True, "note": "Thomas"}],
            "t2_questions": None,
            "t3_structure": None,
            "praise": "Clear pronunciation.",
            "errors": [
                {"span": "je m'appelle", "type": "verb form", "hint": "Check reflexive pronoun and verb ending."}
            ],
        }
        speaking.set_attempt_feedback_1(attempt["id"], fb1)
        refreshed = speaking.get_attempt(user_id, attempt["id"])
        self.assertEqual(refreshed["status"], "ready")
        self.assertEqual(refreshed["feedback_1"]["praise"], "Clear pronunciation.")

        # Round 2 update
        updated = speaking.update_attempt_round2(
            user_id, attempt["id"], "Bonjour, je m'appelle Thomas et j'habite à Montréal.", 30, 8.0
        )
        self.assertEqual(updated["status"], "generating_2")

        # Feedback 2
        fb2 = {
            "fixed_errors": [{"span": "je m'appelle", "fixed": True, "comment": "Good"}],
            "remaining_errors": [],
            "corrected_transcript": "Bonjour, je m'appelle Thomas et j'habite à Montréal.",
            "sentences": [
                {
                    "original": "Bonjour, je m'appelle Thomas et j'habite à Montréal.",
                    "corrected": "Bonjour, je m'appelle Thomas et j'habite à Montréal.",
                    "explanation": "Natural introduction.",
                    "chunk": "j'habite à Montréal",
                }
            ],
            "structures": [
                {"french": "Je m'appelle… et j'habite à…", "english": "My name is... and I live in...", "usage": "Introduction"}
            ],
        }
        speaking.set_attempt_feedback_2(attempt["id"], fb2)
        final_att = speaking.get_attempt(user_id, attempt["id"])
        self.assertEqual(final_att["status"], "ready")
        self.assertEqual(len(final_att["feedback_2"]["structures"]), 1)

    def test_parse_round1_sanitizes_leaks_and_limits_errors(self):
        raw = json.dumps({
            "stats": {"duration_sec": 10, "wpm": 80.0},
            "checklist": [],
            "praise": "Bien parlé!",
            "errors": [
                {"span": "je suis allé", "type": "verb form", "hint": "Say 'suis venu' instead."},  # Leaked!
            ] + [{"span": f"err_{i}", "type": "agreement", "hint": "Check rule"} for i in range(12)],
        })
        fb = speaking.parse_round1_feedback(raw, "transcript", "T1", speaking.SUBJECTS["T1"][0], 10.0, 80.0)
        self.assertLessEqual(len(fb["errors"]), 8)
        self.assertNotIn("Say", fb["errors"][0]["hint"])


class SpeakingEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user = auth_db.register_user(f"api_speaker_{uuid.uuid4().hex[:8]}@example.com", "pass123")
        self.token = self.user["token"]
        self.user_id = self.user["user"]["id"]
        self.auth = {"Authorization": f"Bearer {self.token}"}

    def test_get_speak_page(self):
        res = self.client.get("/speak")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/html", res.headers["content-type"])

    def test_get_tasks(self):
        res = self.client.get("/api/speak/tasks", headers=self.auth)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("recommended_task", data)
        self.assertIn("tasks", data)
        self.assertIn("subjects", data)

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_roleplay_reply(self, post_chat):
        post_chat.return_value = ({}, "Oui, notre centre sportif est ouvert de 7h à 22h tous les jours.")
        scenario = speaking.SUBJECTS["T2"][0]
        res = self.client.post(
            "/api/speak/roleplay/reply",
            headers=self.auth,
            json={
                "scenario": scenario,
                "history": [],
                "user_utterance": "Bonjour, quels sont vos horaires d'ouverture ?",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("ouvert de 7h", res.json()["reply"])

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_submit_speaking_attempt_and_poll(self, post_chat):
        post_chat.return_value = ({}, json.dumps({
            "stats": {"duration_sec": 12, "wpm": 75.0, "pace_note": "Steady pace"},
            "checklist": [{"point": "Horaires", "covered": True, "note": "Demande faite"}],
            "t2_questions": {"count": 2, "forms_ok": True, "note": "Good question structure"},
            "praise": "Clear intonation.",
            "errors": [{"span": "combien coûte", "type": "word order", "hint": "Check question word syntax"}],
        }))
        scenario = speaking.SUBJECTS["T2"][0]
        res = self.client.post(
            "/api/speak/attempts",
            headers=self.auth,
            json={
                "task": "T2",
                "subject": scenario,
                "level": "A2",
                "transcript": "Bonjour, quels sont vos tarifs et combien coûte l'abonnement ?",
                "seconds": 25,
                "audio_duration": 12.0,
            },
        )
        self.assertEqual(res.status_code, 200)
        attempt_id = res.json()["id"]

        # Poll
        poll_res = self.client.get(f"/api/speak/attempts/{attempt_id}", headers=self.auth)
        self.assertEqual(poll_res.status_code, 200)
        self.assertEqual(poll_res.json()["status"], "ready")
        self.assertEqual(poll_res.json()["feedback_1"]["praise"], "Clear intonation.")

        # Round 2
        post_chat.return_value = ({}, json.dumps({
            "fixed_errors": [{"span": "combien coûte", "fixed": True, "comment": "Perfect inversion"}],
            "remaining_errors": [],
            "corrected_transcript": "Bonjour, quels sont vos tarifs mensuels ?",
            "sentences": [
                {
                    "original": "Bonjour, quels sont vos tarifs mensuels ?",
                    "corrected": "Bonjour, quels sont vos tarifs mensuels ?",
                    "explanation": "Clear question.",
                    "chunk": "quels sont vos tarifs",
                }
            ],
            "structures": [
                {"french": "Quels sont vos tarifs pour… ?", "english": "What are your rates for...?", "usage": "Asking prices"}
            ],
        }))
        r2_res = self.client.post(
            f"/api/speak/attempts/{attempt_id}/round2",
            headers=self.auth,
            json={
                "transcript": "Bonjour, quels sont vos tarifs mensuels ?",
                "seconds": 15,
                "audio_duration": 8.0,
            },
        )
        self.assertEqual(r2_res.status_code, 200)

        poll_r2 = self.client.get(f"/api/speak/attempts/{attempt_id}", headers=self.auth)
        self.assertEqual(poll_r2.status_code, 200)
        self.assertEqual(poll_r2.json()["status"], "ready")
        self.assertEqual(len(poll_r2.json()["feedback_2"]["sentences"]), 1)
