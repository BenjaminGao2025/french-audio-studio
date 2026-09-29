import testenv  # noqa: F401  (must run before the app is imported)

import json
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import auth_db
import srs
import tts_service

GOOD = {
    "prompt_fr": "Les étudiants ____ un diplôme peuvent s'inscrire.",
    "answer": "ayant",
    "hint": "avoir → ?",
    "full_fr": "Les étudiants ayant un diplôme peuvent s'inscrire.",
    "full_en": "Students having a degree can register.",
}
REQUEST = {
    "sentence": "Elle comprend 40 questions portant sur des documents et ayant des objectifs différents.",
    "translation_zh": "它包含40道题。",
    "grammar": {"title": "-ant words work like English -ing words", "explanation": "ayant = having.", "hook": "-ant = -ing"},
}


def _login() -> tuple[int, dict]:
    reg = auth_db.register_user(f"gram_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


class ParseTests(unittest.TestCase):
    def test_accepts_consistent_exercise(self):
        item = tts_service._parse_grammar_exercise("```json\n" + json.dumps(GOOD, ensure_ascii=False) + "\n```")
        self.assertEqual(item["answer"], "ayant")

    def test_rejects_blank_that_does_not_rebuild_the_sentence(self):
        bad = {**GOOD, "answer": "avant"}
        self.assertIsNone(tts_service._parse_grammar_exercise(json.dumps(bad)))
        self.assertIsNone(tts_service._parse_grammar_exercise(json.dumps({**GOOD, "prompt_fr": "No blank here."})))
        self.assertIsNone(tts_service._parse_grammar_exercise("not json"))


class GrammarCardApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_requires_login(self):
        self.assertEqual(self.client.post("/api/srs/grammar", json=REQUEST).status_code, 401)

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_retries_once_then_saves_grammar_card(self, post_chat):
        user_id, headers = _login()
        post_chat.side_effect = [({}, "sorry"), ({}, json.dumps(GOOD, ensure_ascii=False))]
        res = self.client.post("/api/srs/grammar", json=REQUEST, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(post_chat.await_count, 2)
        card = next(c for c in res.json()["cards"] if c["mode"] == "grammar")
        self.assertEqual(card["target"], REQUEST["grammar"]["title"])
        self.assertEqual(card["target_meta"]["answer"], "ayant")
        self.assertEqual(card["target_meta"]["rule"], "ayant = having.")
        self.assertIn("____", card["target_meta"]["prompt_fr"])
        # it is a new card in today's queue
        queue = srs.build_queue(user_id)
        self.assertEqual([c["mode"] for c in queue["cards"]], ["grammar"])

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_gives_up_after_two_bad_outputs(self, post_chat):
        _, headers = _login()
        post_chat.return_value = ({}, "{}")
        res = self.client.post("/api/srs/grammar", json=REQUEST, headers=headers)
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()["detail"]["code"], "grammar_exercise_failed")


if __name__ == "__main__":
    unittest.main()
