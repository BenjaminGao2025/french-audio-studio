import unittest
from unittest.mock import AsyncMock, patch

import testenv  # noqa: F401
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth_db
import services.ai
import tts_service


class EtymologyApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_shared_persistent_cache_skips_llm_and_upstream_key(self):
        chat = AsyncMock(return_value=({}, "<think>reasoning</think>Word parts: empêcher.\nMemory: blocked."))
        with patch.object(services.ai, "post_chat", chat):
            first = self.client.post(
                "/api/etymology",
                headers=testenv.session_headers(),
                json={"word": "empêché", "lemma": " Empêcher "},
            )
            self.assertEqual(first.status_code, 200)
            self.assertEqual(
                first.json(),
                {"text": "Word parts: empêcher.\nMemory: blocked.", "cached": False},
            )
            chat.assert_awaited_once()
            self.assertIn("simple English only", chat.call_args.args[1]["messages"][0]["content"])
            self.assertEqual(
                chat.call_args.args[1]["model"],
                services.ai.AGY_MODEL,
            )
            self.assertEqual(auth_db.get_etymology("empêcher"), first.json()["text"])

            other_user = testenv.session_headers()
            with patch.object(services.ai, "SERVER_WEB2API_KEY", ""):
                second = self.client.post(
                    "/api/etymology",
                    headers=other_user,
                    json={"word": "empêchée", "lemma": "EMPÊCHER"},
                )
            self.assertEqual(second.status_code, 200)
            self.assertEqual(second.json(), {**first.json(), "cached": True})
            chat.assert_awaited_once()

    def test_old_chinese_cache_is_regenerated_in_english(self):
        auth_db.set_etymology("old-chinese", "old-chinese", "", "旧的中文词源")
        chat = AsyncMock(return_value=({}, "Origin unknown. Memory: a simple picture."))
        with patch.object(services.ai, "post_chat", chat):
            response = self.client.post(
                "/api/etymology", headers=testenv.session_headers(), json={"word": "old-chinese"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["cached"])
        self.assertEqual(auth_db.get_etymology("old-chinese"), response.json()["text"])
        chat.assert_awaited_once()

    def test_login_required_even_on_cache_hit(self):
        auth_db.set_etymology("étymo-login-hit", "étymo-login-hit", "", "词源")
        chat = AsyncMock()
        with patch.object(services.ai, "post_chat", chat):
            for headers in ({}, {"Authorization": "Bearer invalid-session"}):
                response = self.client.post("/api/etymology", headers=headers, json={"word": "étymo-login-hit"})
                self.assertEqual(response.status_code, 401)
        chat.assert_not_awaited()

    def test_login_required_on_cache_miss(self):
        chat = AsyncMock()
        with patch.object(services.ai, "post_chat", chat):
            response = self.client.post("/api/etymology", json={"word": "étymo-login-miss"})
            self.assertEqual(response.status_code, 401)
        chat.assert_not_awaited()

    def test_word_fallback_and_blank_validation(self):
        chat = AsyncMock(return_value=({}, "Origin: Latin."))
        headers = testenv.session_headers()
        with patch.object(services.ai, "post_chat", chat):
            for body in (
                {"word": " ÉtymoUnique ", "lemma": " "},
                {"word": "ÉTYMOUNIQUE"},
            ):
                self.assertEqual(
                    self.client.post("/api/etymology", headers=headers, json=body).status_code,
                    200,
                )
            chat.assert_awaited_once()
            blank = self.client.post("/api/etymology", headers=headers, json={"word": " "})
            self.assertIn(blank.status_code, (400, 422))

    def test_empty_model_reply_is_not_cached_and_can_retry(self):
        key_word = "étymo-empty-reply"
        chat = AsyncMock(return_value=({}, "<think>reasoning only</think>"))
        headers = testenv.session_headers()
        with patch.object(services.ai, "post_chat", chat):
            self.assertEqual(
                self.client.post("/api/etymology", headers=headers, json={"word": key_word}).status_code,
                502,
            )
            self.assertIsNone(auth_db.get_etymology(key_word))
            chat.return_value = ({}, "Origin: Latin.")
            response = self.client.post("/api/etymology", headers=headers, json={"word": key_word})
            self.assertEqual(response.status_code, 200)
            self.assertIs(response.json()["cached"], False)

    def test_upstream_failure_is_not_cached_and_can_retry(self):
        key_word = "étymo-upstream-fail"
        chat = AsyncMock(side_effect=HTTPException(status_code=502, detail={"message": "AGY unavailable"}))
        headers = testenv.session_headers()
        with patch.object(services.ai, "post_chat", chat):
            self.assertEqual(
                self.client.post("/api/etymology", headers=headers, json={"word": key_word}).status_code,
                502,
            )
            self.assertIsNone(auth_db.get_etymology(key_word))
            chat.side_effect = None
            chat.return_value = ({}, "Origin: Latin.")
            response = self.client.post("/api/etymology", headers=headers, json={"word": key_word})
            self.assertEqual(response.status_code, 200)
            self.assertIs(response.json()["cached"], False)


if __name__ == "__main__":
    unittest.main()
