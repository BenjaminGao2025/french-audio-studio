import testenv  # noqa: F401  (must run before the app is imported)

import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import tts_service

REQUEST = {
    "sentence": "Aucune dispense n'est autorisée.",
    "translation_zh": "不允许任何豁免。",
    "grammar_points": [{"title": "aucune … ne", "explanation": "aucune already means no"}],
    "explanation": "这句说不允许豁免，n'est 是否定。",
    "variation": "Aucune dispense n'est pas autorisée.",
}


class FeynmanTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_requires_key_or_login(self):
        self.assertEqual(self.client.post("/api/feynman", json=REQUEST).status_code, 401)

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_feedback_is_parsed_and_learner_text_is_sent(self, post_chat):
        post_chat.return_value = ({}, "```json\n" + json.dumps({
            "verdict": "partial",
            "got_right": ["意思说对了：不允许豁免"],
            "gaps": ["aucune 本身就是否定，不能再加 pas"],
            "variation": {"ok": False, "corrected": "Aucune dispense n'est autorisée.", "note": "aucune 不和 pas 连用"},
            "follow_up": "为什么这里没有 pas？",
        }, ensure_ascii=False) + "\n```")
        res = self.client.post("/api/feynman", json=REQUEST, headers={"Authorization": "Bearer user-key"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["verdict"], "partial")
        self.assertEqual(data["gaps"], ["aucune 本身就是否定，不能再加 pas"])
        self.assertFalse(data["variation"]["ok"])

        payload = post_chat.call_args.args[1]
        user_message = payload["messages"][1]["content"]
        self.assertIn(REQUEST["explanation"], user_message)
        self.assertIn("aucune already means no", user_message)
        self.assertEqual(post_chat.call_args.args[2]["Authorization"], "Bearer user-key")
        self.assertIn("simple English", payload["messages"][0]["content"])

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_variation_is_dropped_when_learner_wrote_none(self, post_chat):
        post_chat.return_value = ({}, json.dumps({
            "verdict": "weird", "got_right": "not a list", "gaps": [], "variation": {"ok": True}, "follow_up": "",
        }))
        res = self.client.post(
            "/api/feynman", json={**REQUEST, "variation": ""}, headers={"Authorization": "Bearer k"}
        )
        data = res.json()
        self.assertEqual(data["verdict"], "partial")
        self.assertEqual(data["got_right"], [])
        self.assertIsNone(data["variation"])

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_unparseable_output_returns_502(self, post_chat):
        post_chat.return_value = ({}, "Sorry, I cannot help.")
        res = self.client.post("/api/feynman", json=REQUEST, headers={"Authorization": "Bearer k"})
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["detail"]["code"], "feynman_bad_output")


ASK = {
    "sentence": "Exemples d'épreuves du TCF",
    "translation_zh": "TCF 考试样题",
    "grammar_points": [{"title": "du = de + le", "explanation": "de and le join."}],
    "history": [
        {"role": "tutor", "content": "Question for you: du comes from which two words?"},
        {"role": "learner", "content": "de + le"},
        {"role": "tutor", "content": "Right!"},
    ],
    "question": "那 de + la 呢？",
}


class AskTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_requires_key_or_login(self):
        self.assertEqual(self.client.post("/api/ask", json=ASK).status_code, 401)

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_answer_uses_sentence_and_history(self, post_chat):
        post_chat.return_value = ({}, "## Answer\n**de + la** stays **de la**. No change.\nExample: de la ville = of the city.")
        res = self.client.post("/api/ask", json=ASK, headers={"Authorization": "Bearer k"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["answer"], "Answer\nde + la stays de la. No change.\nExample: de la ville = of the city.")

        messages = post_chat.call_args.args[1]["messages"]
        self.assertIn("Exemples d'épreuves du TCF", messages[0]["content"])
        self.assertIn("simple English", messages[0]["content"])
        self.assertEqual([m["role"] for m in messages[1:]], ["assistant", "user", "assistant", "user"])
        self.assertEqual(messages[-1]["content"], "那 de + la 呢？")

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_empty_answer_returns_502(self, post_chat):
        post_chat.return_value = ({}, "<think>hmm</think>   ")
        res = self.client.post("/api/ask", json=ASK, headers={"Authorization": "Bearer k"})
        self.assertEqual(res.status_code, 502)


if __name__ == "__main__":
    unittest.main()
