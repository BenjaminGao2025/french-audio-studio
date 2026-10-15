import testenv  # noqa: F401  (must run before the app is imported)

import pathlib
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

import auth_db
import tts_service

# What iPhone Safari's MediaRecorder produces: fragmented MP4 (ftyp iso5) with AAC audio
SAMPLE = pathlib.Path(__file__).parent / "fixtures" / "ios_safari_sample.m4a"


class IosShadowingTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        tts_service._rate_buckets.clear()

    def test_ios_mp4_recording_is_accepted_and_transcribed_in_french(self):
        audio = SAMPLE.read_bytes()
        self.assertEqual(audio[4:8], b"ftyp")
        self.assertTrue(tts_service._looks_like_audio(audio))
        token = auth_db.register_user(f"ios_{uuid.uuid4().hex[:10]}@example.com", "password123")["token"]
        with patch("tts_service._transcribe_sync", return_value={"text": "Je viens de Pékin, en Chine.", "duration": 2.6}) as asr:
            res = self.client.post(
                "/api/transcribe?language=fr",
                content=audio,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "audio/mp4"},
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["text"], "Je viens de Pékin, en Chine.")
        args, kwargs = asr.call_args
        self.assertEqual(args[0], audio)
        self.assertEqual(kwargs.get("language"), "fr")


def _study_js():
    with open("static/study.js", encoding="utf-8") as fh:
        return fh.read()


def test_shadowing_falls_back_to_server_and_never_shows_a_fake_zero():
    js = _study_js()
    # the recorded blob keeps Safari's real type (audio/mp4)
    assert "new Blob(audioChunks, { type: 'audio/webm' })" not in js
    assert "recorderForStop.mimeType || 'audio/webm'" in js
    # empty browser transcript -> the recording is transcribed on the server
    score = js.split("async function finishAndScore(stopped)")[1].split("function showScoreError")[0]
    assert "fetch('/api/transcribe?language=fr'" in score
    assert "showScoreError(T.scoreNoAudio)" in score
    assert "showScoreError(`${T.scoreFailed}${err.message}`)" in score
    assert "evaluateAndDisplay(transcript)" in score
    assert js.count("scoreNoAudio:") == 2 and js.count("scoreNotScored:") == 2
