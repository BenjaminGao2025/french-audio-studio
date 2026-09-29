import testenv  # noqa: F401  (must run before the app is imported)

import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import auth_db
import tts_service


def _login_headers() -> dict:
    token = auth_db.register_user(f"asr_{uuid.uuid4().hex[:10]}@example.com", "password123")["token"]
    return {"Authorization": f"Bearer {token}"}


class TranscribeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_requires_login(self):
        res = self.client.post("/api/transcribe", content=b"audio")
        self.assertEqual(res.status_code, 401)

    def test_rejects_empty_and_oversized_audio(self):
        headers = _login_headers()
        self.assertEqual(self.client.post("/api/transcribe", content=b"", headers=headers).status_code, 422)
        with patch.object(tts_service, "ASR_MAX_BYTES", 10):
            res = self.client.post("/api/transcribe", content=b"x" * 11, headers=headers)
        self.assertEqual(res.status_code, 413)

    @patch("tts_service._transcribe_sync")
    def test_passes_audio_and_sentence_to_model(self, transcribe):
        transcribe.return_value = {"text": "à partir de 是固定搭配", "duration": 3.2}
        res = self.client.post(
            "/api/transcribe",
            params={"sentence": "À partir de lundi."},
            content=b"webm-bytes",
            headers={**_login_headers(), "Content-Type": "audio/webm"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["text"], "à partir de 是固定搭配")
        transcribe.assert_called_once_with(b"webm-bytes", "À partir de lundi.")

    def test_missing_model_returns_503(self):
        with patch.object(tts_service, "ASR_MODEL_DIR", tts_service.BASE_DIR / "no-such-model"), \
                patch.object(tts_service, "_asr_model", None):
            res = self.client.post("/api/transcribe", content=b"abc", headers=_login_headers())
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["detail"]["code"], "asr_unavailable")

    @patch("tts_service._post_chat", new_callable=AsyncMock)
    def test_fix_uses_sentence_and_falls_back_on_runaway_output(self, post_chat):
        body = {"sentence": "À partir de lundi.", "text": "a part or die 是固定搭配"}
        post_chat.return_value = ({}, "à partir de 是固定搭配")
        res = self.client.post("/api/transcribe/fix", json=body, headers={"Authorization": "Bearer k"})
        self.assertEqual(res.json()["text"], "à partir de 是固定搭配")
        self.assertIn("À partir de lundi.", post_chat.call_args.args[1]["messages"][0]["content"])

        post_chat.return_value = ({}, "Here is a long essay " * 50)
        res = self.client.post("/api/transcribe/fix", json=body, headers={"Authorization": "Bearer k"})
        self.assertEqual(res.json()["text"], body["text"])


if __name__ == "__main__":
    unittest.main()
