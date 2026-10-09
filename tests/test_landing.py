import testenv  # noqa: F401  (must run before the app is imported)

import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import auth_db
import tts_service


def _waitlist_rows():
    with auth_db.connect() as conn:
        return conn.execute("SELECT * FROM waitlist ORDER BY id").fetchall()


class LandingTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        tts_service._waitlist_hits.clear()

    def test_public_pages_render(self):
        for path, marker in [
            ("/home", "lead-form"),
            ("/for-institutions", 'data-kind="institution"'),
            ("/privacy", "prose"),
        ]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn(marker, response.text)
            self.assertNotIn("__ASSET_VERSION__", response.text)

    def test_root_shows_landing_only_on_landing_hosts(self):
        with patch.object(tts_service, "LANDING_HOSTS", {"1000h.app"}):
            landing = self.client.get("/", headers={"host": "1000h.app"})
            workbench = self.client.get("/", headers={"host": "tts.gaoyuze.com"})
        self.assertIn("lead-form", landing.text)
        self.assertNotIn("lead-form", workbench.text)

    def test_waitlist_stores_learner_application(self):
        before = len(_waitlist_rows())
        response = self.client.post(
            "/api/waitlist",
            json={"contact": " me@example.com ", "level": "A1", "exam": "2027H1", "note": "", "lang": "en"},
        )
        self.assertEqual(response.status_code, 200)
        rows = _waitlist_rows()
        self.assertEqual(len(rows), before + 1)
        row = rows[-1]
        self.assertEqual(row["kind"], "learner")
        self.assertEqual(row["contact"], "me@example.com")
        self.assertEqual(row["lang"], "en")
        self.assertEqual(json.loads(row["details_json"]), {"level": "A1", "exam": "2027H1"})

    def test_waitlist_institution_needs_org(self):
        response = self.client.post("/api/waitlist", json={"kind": "institution", "contact": "wx123"})
        self.assertEqual(response.status_code, 422)

    def test_waitlist_honeypot_is_not_stored(self):
        before = len(_waitlist_rows())
        response = self.client.post("/api/waitlist", json={"contact": "bot@example.com", "website": "spam"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(_waitlist_rows()), before)

    def test_waitlist_rate_limits_per_ip(self):
        headers = {"cf-connecting-ip": "203.0.113.9"}
        for _ in range(tts_service.WAITLIST_LIMIT):
            self.assertEqual(
                self.client.post("/api/waitlist", json={"contact": "x@example.com"}, headers=headers).status_code,
                200,
            )
        response = self.client.post("/api/waitlist", json={"contact": "x@example.com"}, headers=headers)
        self.assertEqual(response.status_code, 429)


if __name__ == "__main__":
    unittest.main()
