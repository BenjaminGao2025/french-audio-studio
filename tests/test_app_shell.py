"""Old /app bookmarks keep working after the React SPA was archived."""
import unittest

import testenv  # noqa: F401  (sets AUTH_SECRET / OUTPUT_DIR before the app is imported)
from fastapi.testclient import TestClient

import tts_service


class AppShellRedirectTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_every_app_url_redirects_to_study(self):
        for path in ("/app", "/app/", "/app/hours", "/app/cards?block=x", "/app/assets/x.js"):
            res = self.client.get(path, follow_redirects=False)
            self.assertEqual(res.status_code, 302, path)
            self.assertEqual(res.headers["location"], "/study", path)

    def test_head_redirects_too(self):
        res = self.client.head("/app", follow_redirects=False)
        self.assertEqual(res.status_code, 302)


if __name__ == "__main__":
    unittest.main()
