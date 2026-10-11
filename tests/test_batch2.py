import testenv  # noqa: F401  (must run before the app is imported)

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import speaking
import tts_service
import writing

T1_SUBJECT = {"id": "t", "title": "Sujet test", "prompt": "Écrivez."}


class Batch2Tests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        tts_service._rate_buckets.clear()

    def _user(self):
        headers = testenv.session_headers()
        return headers, tts_service._require_user_id(headers["Authorization"])

    # --- rate limiting ---
    def test_rate_limit_returns_429_with_chinese_message(self):
        _, uid = self._user()
        with patch.dict(tts_service.RATE_LIMITS, {"ai": (2.0, 0.0001)}):
            tts_service._rate_limit(uid, "ai")
            tts_service._rate_limit(uid, "ai")
            with self.assertRaises(tts_service.HTTPException) as ctx:
                tts_service._rate_limit(uid, "ai")
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("太频繁", ctx.exception.detail["message"])
        self.assertIn("Retry-After", ctx.exception.headers)

    def test_ai_endpoint_rate_limited_via_http(self):
        headers, _ = self._user()
        with patch.dict(tts_service.RATE_LIMITS, {"ai": (1.0, 0.0001)}), \
                patch("tts_service.request_word_lookup", new_callable=AsyncMock, return_value={"word": "x"}):
            self.assertEqual(self.client.get("/api/lookup?word=bonjour", headers=headers).status_code, 200)
            res = self.client.get("/api/lookup?word=salut", headers=headers)
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.json()["detail"]["code"], "rate_limited")

    def test_transcribe_rejects_non_audio_and_full_queue(self):
        headers, _ = self._user()
        self.assertEqual(self.client.post("/api/transcribe", content=b"<html>", headers=headers).status_code, 415)
        with patch.object(tts_service, "_asr_waiting", tts_service.ASR_MAX_QUEUE):
            res = self.client.post("/api/transcribe", content=b"OggS....", headers=headers)
        self.assertEqual(res.status_code, 429)

    def test_one_episode_at_a_time(self):
        headers, uid = self._user()
        tts_service._episode_users.add(uid)
        try:
            res = self.client.post("/api/episodes", headers=headers, json={})
        finally:
            tts_service._episode_users.discard(uid)
        self.assertEqual(res.status_code, 429)
        self.assertIn("正在生成", res.json()["detail"]["message"])

    # --- trial ended / no key ---
    def test_no_api_key_marks_attempt_failed_without_upstream(self):
        _, uid = self._user()
        att = writing.create_attempt(uid, "T1", T1_SUBJECT, "A1", "Bonjour", 10)
        with patch("tts_service._post_chat", new_callable=AsyncMock) as post_chat:
            asyncio.run(tts_service._generate_write_feedback_1(uid, att["id"], None, "gemini-3.8-flash"))
        post_chat.assert_not_called()
        got = writing.get_attempt(uid, att["id"])
        self.assertEqual(got["status"], "failed")
        self.assertIn("试用已结束", got["error"])

    def test_upstream_error_is_not_shown_raw(self):
        _, uid = self._user()
        att = writing.create_attempt(uid, "T1", T1_SUBJECT, "A1", "Bonjour", 10)
        with patch("tts_service._post_chat", new_callable=AsyncMock, side_effect=RuntimeError("secret upstream trace")):
            asyncio.run(tts_service._generate_write_feedback_1(uid, att["id"], "k", "gemini-3.8-flash"))
        got = writing.get_attempt(uid, att["id"])
        self.assertEqual(got["status"], "failed")
        self.assertNotIn("secret", got["error"])

    # --- status race + startup recovery ---
    def test_late_round1_does_not_clobber_round2(self):
        _, uid = self._user()
        att = writing.create_attempt(uid, "T1", T1_SUBJECT, "A1", "Bonjour", 10)
        writing.set_attempt_feedback_1(att["id"], {"errors": []})
        writing.update_attempt_round2(uid, att["id"], "Bonjour !", 5)
        writing.set_attempt_feedback_1(att["id"], {}, error="late failure")
        self.assertEqual(writing.get_attempt(uid, att["id"])["status"], "generating_2")

    def test_late_round1_success_keeps_round1_feedback(self):
        _, uid = self._user()
        att = writing.create_attempt(uid, "T1", T1_SUBJECT, "A1", "Bonjour", 10)
        writing.set_attempt_feedback_1(att["id"], {"errors": [{"span": "a"}]})
        writing.update_attempt_round2(uid, att["id"], "Bonjour !", 5)
        writing.set_attempt_feedback_1(att["id"], {"errors": [{"span": "late"}]})
        got = writing.get_attempt(uid, att["id"])
        self.assertEqual(got["feedback_1"]["errors"][0]["span"], "a")

    def test_startup_marks_interrupted_attempts_failed(self):
        _, uid = self._user()
        w = writing.create_attempt(uid, "T1", T1_SUBJECT, "A1", "Bonjour", 10)
        s = speaking.create_attempt(uid, "T1", T1_SUBJECT, "A1", "Bonjour", 10, 5.0)
        asyncio.run(tts_service._recover_interrupted_feedback())
        self.assertEqual(writing.get_attempt(uid, w["id"])["status"], "failed")
        self.assertEqual(speaking.get_attempt(uid, s["id"])["status"], "failed")

    # --- CSP ---
    def test_csp_header_present(self):
        csp = self.client.get("/healthz").headers["content-security-policy"]
        self.assertIn("script-src 'self'", csp)
        self.assertNotIn("'unsafe-inline' https", csp)


if __name__ == "__main__":
    unittest.main()
