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

    def test_legacy_english_regenerates_structured_chinese_and_preserves_forms(self):
        import json
        word = "étymo-language"
        auth_db.set_etymology(word, word, "", "An English compound.")
        auth_db.set_etymology(f"en:{word}", word, "", "From Latin.")
        detail = {
            "construction": [{"form": "à", "gloss_zh": "到"}, {"form": "fin", "gloss_zh": "终点"}],
            "source": [{"lang": "拉丁语", "form": "ad + finem", "from_form": "finis"}],
            "sense_history_zh": "由终点引申为目的。", "memory_zh": "把目的想成终点（联想）。",
        }
        chat = AsyncMock(return_value=({}, json.dumps(detail, ensure_ascii=False)))
        headers = testenv.session_headers()
        with patch.object(services.ai, "post_chat", chat):
            # Old clients requesting English also receive the Chinese explanation.
            body = {"word": word, "language": "en"}
            first = self.client.post("/api/etymology", headers=headers, json=body)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["construction"], detail["construction"])
            self.assertEqual(first.json()["source"], detail["source"])
            self.assertEqual(first.json()["lang"], "zh")
            self.assertIn("简体中文", chat.call_args.args[1]["messages"][0]["content"])
            second = self.client.post("/api/etymology", headers=headers, json=body)
            self.assertTrue(second.json()["cached"])
            self.assertEqual(second.json()["source"], detail["source"])
            chat.assert_awaited_once()
            self.assertEqual(auth_db.get_etymology(word), "An English compound.")

    def test_invalid_english_reply_is_not_cached(self):
        chat = AsyncMock(return_value=({}, '{"construction":[],"source":[],"memory_zh":"A compound"}'))
        with patch.object(services.ai, "post_chat", chat):
            response = self.client.post("/api/etymology", headers=testenv.session_headers(), json={"word": "invalid-origin"})
        self.assertEqual(response.status_code, 502)
        self.assertIsNone(auth_db.get_etymology("zh:v2:invalid-origin"))

    def test_shared_persistent_cache_skips_llm_and_upstream_key(self):
        chat = AsyncMock(return_value=({}, "<think>reasoning</think>构词：empêcher。\n记忆：被阻挡。"))
        with patch.object(services.ai, "post_chat", chat):
            first = self.client.post(
                "/api/etymology",
                headers=testenv.session_headers(),
                json={"word": "empêché", "lemma": " Empêcher "},
            )
            self.assertEqual(first.status_code, 200)
            self.assertEqual(
                first.json(),
                {"text": "构词：empêcher。\n记忆：被阻挡。", "cached": False, "lang": "zh", "schema_version": 2},
            )
            chat.assert_awaited_once()
            self.assertEqual(
                chat.call_args.args[1]["model"],
                services.ai.AGY_MODEL,
            )
            self.assertEqual(auth_db.get_etymology("zh:v2:empêcher"), first.json()["text"])

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

    def test_login_required_even_on_cache_hit(self):
        auth_db.set_etymology("zh:v2:étymo-login-hit", "étymo-login-hit", "", "词源")
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
        chat = AsyncMock(return_value=({}, "词源：拉丁语。"))
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
            self.assertIsNone(auth_db.get_etymology(f"zh:v2:{key_word}"))
            chat.return_value = ({}, "词源：拉丁语。")
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
            self.assertIsNone(auth_db.get_etymology(f"zh:v2:{key_word}"))
            chat.side_effect = None
            chat.return_value = ({}, "词源：拉丁语。")
            response = self.client.post("/api/etymology", headers=headers, json={"word": key_word})
            self.assertEqual(response.status_code, 200)
            self.assertIs(response.json()["cached"], False)


if __name__ == "__main__":
    unittest.main()
