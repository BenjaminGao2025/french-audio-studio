"""The retired /app mobile SPA and /coach page only redirect to Study."""

import re
import unittest
from pathlib import Path

import testenv  # noqa: F401  (sets AUTH_SECRET / OUTPUT_DIR before the app is imported)
from fastapi.testclient import TestClient

import tts_service

STATIC = Path(tts_service.STATIC_DIR)


class RetiredPagesTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_retired_urls_redirect_to_study(self):
        for path in ("/app", "/app/", "/app/hours", "/app/assets/index-x.js", "/coach"):
            with self.subTest(path=path):
                res = self.client.get(path, follow_redirects=False)
                self.assertEqual(res.status_code, 302)
                self.assertEqual(res.headers["location"], "/study")

    def test_head_request_redirects(self):
        res = self.client.head("/coach", follow_redirects=False)
        self.assertEqual(res.status_code, 302)

    def test_study_still_serves(self):
        self.assertEqual(self.client.get("/study").status_code, 200)

    def test_no_page_links_to_retired_urls(self):
        for page in STATIC.glob("*.html"):
            html = page.read_text(encoding="utf-8")
            with self.subTest(page=page.name):
                self.assertIsNone(re.search(r'href="/(app|coach)(/|")', html))
                self.assertNotIn("coach-reminders.js", html)

    def test_service_worker_no_longer_lists_coach(self):
        self.assertNotIn("'/coach'", (STATIC / "sw.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
