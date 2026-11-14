"""A retried review is one FSRS event, including after a lost response or concurrent POSTs."""

import datetime
import os
import sqlite3
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import testenv  # noqa: F401
from fastapi.testclient import TestClient

import auth_db
import srs
import tts_service


class ReviewRequestTests(unittest.TestCase):
    def setUp(self):
        account = auth_db.register_user(f"retry_{uuid.uuid4().hex}@example.com", "password123")
        self.user_id = account["user"]["id"]
        self.headers = {"Authorization": f"Bearer {account['token']}"}
        note = srs.add_note(self.user_id, "Nous allons au marché.", modes=["listen"])
        self.card_id = note["cards"][0]["id"]
        self.client = TestClient(tts_service.app)
        self.path = f"/api/srs/cards/{self.card_id}/review"

    def count_reviews(self):
        with auth_db.connect() as conn:
            return conn.execute("SELECT count(*) FROM srs_reviews WHERE user_id = ?", (self.user_id,)).fetchone()[0]

    def test_lost_response_retry_replays_the_original_result(self):
        first = srs.review_card(self.user_id, self.card_id, 3, request_id="first")
        # The next genuine presentation has a different id and is allowed to advance the card.
        later = srs.review_card(self.user_id, self.card_id, 4, request_id="next")
        retry = srs.review_card(self.user_id, self.card_id, 3, request_id="first")
        self.assertEqual(first, retry)
        self.assertEqual(self.count_reviews(), 2)
        self.assertEqual(srs.list_cards(self.user_id)[0]["due"], later["due"])

    def test_concurrent_retries_schedule_only_once(self):
        def submit(_):
            return srs.review_card(self.user_id, self.card_id, 3, request_id="concurrent")

        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(submit, range(8)))
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(self.count_reviews(), 1)

    def test_request_id_is_private_and_cannot_be_reused_for_a_different_rating_or_card(self):
        first = self.client.post(self.path, headers=self.headers, json={"rating": 3, "request_id": "shared"})
        self.assertEqual(first.status_code, 200)
        conflict = self.client.post(self.path, headers=self.headers, json={"rating": 4, "request_id": "shared"})
        self.assertEqual(conflict.status_code, 409)
        other_card = srs.add_note(self.user_id, "Nous rentrons à pied.", modes=["listen"])["cards"][0]["id"]
        conflict = self.client.post(f"/api/srs/cards/{other_card}/review", headers=self.headers,
                                    json={"rating": 3, "request_id": "shared"})
        self.assertEqual(conflict.status_code, 409)
        other = auth_db.register_user(f"other_{uuid.uuid4().hex}@example.com", "password123")["user"]["id"]
        with self.assertRaises(KeyError):
            srs.review_card(other, self.card_id, 3, request_id="shared")
        own_card = srs.add_note(other, "Nous allons au marché.", modes=["listen"])["cards"][0]["id"]
        self.assertEqual(srs.review_card(other, own_card, 3, request_id="shared")["state"], "learning")
        self.assertEqual(self.count_reviews(), 1)

    def test_supplementary_feedback_failure_does_not_fail_a_saved_rating(self):
        with patch("routers.srs.game.review_feedback", side_effect=RuntimeError("feedback unavailable")):
            with self.assertLogs("routers.srs", level="ERROR"):
                response = self.client.post(self.path, headers=self.headers,
                                            json={"rating": 3, "request_id": "feedback"})
        self.assertEqual(response.status_code, 200)
        retry = self.client.post(self.path, headers=self.headers, json={"rating": 3, "request_id": "feedback"})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(response.json()["due"], retry.json()["due"])
        self.assertEqual(self.count_reviews(), 1)

    def test_failed_transaction_rolls_back_schedule_and_request_id_together(self):
        before = srs.list_cards(self.user_id)[0]
        with patch("srs._card_payload", side_effect=RuntimeError("response could not be built")):
            with self.assertRaises(RuntimeError):
                srs.review_card(self.user_id, self.card_id, 3, request_id="rollback")
        self.assertEqual(self.count_reviews(), 0)
        self.assertEqual(srs.list_cards(self.user_id)[0], before)
        self.assertEqual(srs.review_card(self.user_id, self.card_id, 3, request_id="rollback")["state"], "learning")

    def test_legacy_clients_without_request_ids_can_still_review(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        srs.review_card(self.user_id, self.card_id, 3, now=now)
        srs.review_card(self.user_id, self.card_id, 3, now=now + datetime.timedelta(minutes=10))
        self.assertEqual(self.count_reviews(), 2)

    def test_existing_review_history_is_preserved_by_migration(self):
        with tempfile.TemporaryDirectory(prefix="tts-legacy-review-") as directory:
            with sqlite3.connect(f"{directory}/users.db") as conn:
                conn.execute("""CREATE TABLE srs_reviews (
                    id INTEGER PRIMARY KEY, card_id TEXT, note_id TEXT, user_id INTEGER,
                    rating INTEGER, was_new INTEGER, reviewed_at TEXT, duration_ms INTEGER,
                    score INTEGER, answer TEXT)""")
                conn.execute("INSERT INTO srs_reviews VALUES (1, 'old', 'old', 1, 3, 1, '2026-01-01', 10, 100, 'oui')")
            with patch.dict(os.environ, {"OUTPUT_DIR": directory}):
                srs.init_db()
                with auth_db.connect() as conn:
                    row = conn.execute("SELECT * FROM srs_reviews WHERE id = 1").fetchone()
                self.assertEqual(row["answer"], "oui")
                self.assertIsNone(row["request_id"])
                self.assertIsNone(row["response_json"])


if __name__ == "__main__":
    unittest.main()
