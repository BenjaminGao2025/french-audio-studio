import testenv  # noqa: F401  (must run before the app is imported)

import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

import tts_service

AI_ROUTES = [
    ("post", "/api/transform", {"text": "你好", "style": "spoken", "level": "A1-A2", "locale": "fr-FR"}),
    ("post", "/api/analyze", {"text": "Bonjour"}),
    ("post", "/api/feynman", {"sentence": "Bonjour", "explanation": "x", "variation": ""}),
    ("post", "/api/transcribe/fix", {"text": "bonjour", "sentence": "Bonjour"}),
    ("post", "/api/ask", {"sentence": "Bonjour", "question": "why"}),
    ("get", "/api/lookup?word=bonjour", None),
    ("post", "/api/connection/test", {"model": tts_service.PERPLEXITY_MODEL}),
]


class SecurityFixTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_ai_routes_reject_anonymous_and_raw_keys(self):
        for method, path, body in AI_ROUTES:
            for headers in ({}, {"Authorization": "Bearer some-raw-upstream-key"}):
                kwargs = {"headers": headers}
                if body is not None:
                    kwargs["json"] = body
                res = getattr(self.client, method)(path, **kwargs)
                self.assertIn(res.status_code, (401, 422), (path, headers, res.status_code))
                if res.status_code == 422:
                    self.fail(f"{path}: validation ran before auth? body may be wrong")

    def test_raw_token_is_never_returned_as_api_key(self):
        with self.assertRaises(tts_service.HTTPException) as ctx:
            tts_service._authorization_token("Bearer raw-key")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_files_require_login(self):
        name = "TTS_fr-FR-DeniseNeural_sec_test.mp3"
        (tts_service.OUTPUT_DIR / name).write_bytes(b"ID3test")
        self.assertEqual(self.client.get(f"/files/{name}").status_code, 401)
        ok = self.client.get(f"/files/{name}", headers=testenv.session_headers())
        self.assertEqual(ok.status_code, 200)
        token = testenv.session_headers()["Authorization"].split(" ", 1)[1]
        self.client.cookies.set(tts_service.SESSION_COOKIE, token)
        self.assertEqual(self.client.get(f"/files/{name}").status_code, 200)

    def test_snippet_name_is_keyed(self):
        import hashlib
        name = tts_service._safe_timestamp(None, text="Bonjour", voice="fr-FR-DeniseNeural")
        plain = hashlib.sha256(b"fr-FR-DeniseNeural:Bonjour").hexdigest()[:16]
        self.assertTrue(name.startswith("snip_"))
        self.assertNotIn(plain, name)

    def test_forwarded_proto_only_trusted_from_loopback(self):
        def req(host, proto):
            r = MagicMock()
            r.client.host = host
            r.headers = {"x-forwarded-proto": proto}
            r.url.scheme = "http"
            return r
        self.assertTrue(tts_service._cookie_secure(req("127.0.0.1", "https")))
        self.assertFalse(tts_service._cookie_secure(req("203.0.113.9", "https")))


if __name__ == "__main__":
    unittest.main()
