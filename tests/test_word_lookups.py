"""Lookup counts ("已查 N 次"): normalization, debounce, tiers and the additive table."""

from __future__ import annotations

import datetime
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient

import auth_db
import srs
import tts_service

UTC = datetime.timezone.utc


def _new_user() -> tuple[int, dict]:
    reg = auth_db.register_user(f"lookup_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


class NormalizeTests(unittest.TestCase):
    def test_curly_apostrophe_nbsp_case_and_spaces(self):
        self.assertEqual(srs.normalize_lookup_word("  D’ACCORD "), "accord")
        self.assertEqual(srs.normalize_lookup_word("accord"), "accord")
        self.assertEqual(srs.normalize_lookup_word("il y a"), "il y a")
        self.assertEqual(srs.normalize_lookup_word("Bonjour"), "bonjour")

    def test_importance_tiers(self):
        self.assertEqual(srs.importance_for_lookups(1), 3)
        self.assertEqual(srs.importance_for_lookups(3), 4)
        self.assertEqual(srs.importance_for_lookups(5), 5)
        self.assertEqual(srs.importance_for_lookups(9), 5)
        self.assertEqual(srs.importance_for_lookups(10), 5)


class RecordLookupTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()
        self.now = datetime.datetime(2026, 11, 7, 9, 0, tzinfo=UTC)

    def test_same_word_counts_once_across_spellings_and_sentences(self):
        first = srs.record_word_lookup(self.user_id, "D’accord", now=self.now)
        self.assertEqual((first["word"], first["count"], first["incremented"]), ("accord", 1, True))
        # A different sentence, a curly apostrophe and NBSP still land on the same row.
        later = self.now + datetime.timedelta(seconds=6)
        second = srs.record_word_lookup(self.user_id, "d'accord ", now=later)
        self.assertEqual((second["word"], second["count"]), ("accord", 2))

    def test_repeated_opens_within_five_seconds_are_debounced(self):
        srs.record_word_lookup(self.user_id, "bonjour", now=self.now)
        again = srs.record_word_lookup(self.user_id, "Bonjour", now=self.now + datetime.timedelta(seconds=4))
        self.assertEqual((again["count"], again["incremented"]), (1, False))
        after = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=5))
        self.assertEqual((after["count"], after["incremented"]), (2, True))

    def test_counts_are_per_user_and_reach_the_importance_tiers(self):
        other_id, _ = _new_user()
        for i in range(10):
            result = srs.record_word_lookup(
                self.user_id, "très", now=self.now + datetime.timedelta(seconds=6 * i)
            )
        self.assertEqual(result["count"], 10)
        self.assertEqual(result["importance"], 5)
        self.assertEqual(srs.record_word_lookup(other_id, "très", now=self.now)["count"], 1)

        nine = srs.record_word_lookup(
            self.user_id, "beaucoup", now=self.now
        )
        self.assertEqual(nine["importance"], 0)
        for i in range(1, 9):
            result = srs.record_word_lookup(
                self.user_id, "beaucoup", now=self.now + datetime.timedelta(seconds=6 * i)
            )
        self.assertEqual((result["count"], result["importance"]), (9, 5))

    def test_en_debounce_does_not_slide_and_count_persists(self):
        for seconds, count, incremented in [(0, 1, True), (1, 1, False), (4, 1, False), (5, 2, True), (9, 2, False), (10, 3, True)]:
            result = srs.record_word_lookup(self.user_id, "en", now=self.now + datetime.timedelta(seconds=seconds))
            self.assertEqual((result["count"], result["incremented"]), (count, incremented))
            self.assertEqual(srs.lookup_counts(self.user_id)["en"], count)

    def test_empty_word_is_rejected(self):
        with self.assertRaises(ValueError):
            srs.record_word_lookup(self.user_id, "   ")

    def test_api_requires_login_and_returns_count(self):
        client = TestClient(tts_service.app)
        self.assertEqual(client.post("/api/srs/lookups", json={"word": "bonjour"}).status_code, 401)
        _, headers = _new_user()
        res = client.post("/api/srs/lookups", headers=headers, json={"word": "Bonjour"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["word"], "bonjour")
        self.assertGreaterEqual(res.json()["count"], 1)

    def test_autosave_unstar_suppression_and_later_resave(self):
        for i in range(3):
            result = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=5*i), sentence="Bonjour à tous.")
            self.assertEqual(result["importance"], 0 if i < 2 else 4)
        cards = [c for c in srs.list_cards(self.user_id) if c["mode"] == "cloze"]
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["importance"], 4)
        srs.delete_card(self.user_id, cards[0]["id"])
        suppressed = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=11))
        self.assertEqual((suppressed["count"], suppressed["importance"], suppressed["incremented"]), (3, 0, False))
        self.assertEqual(srs.list_cards(self.user_id), [])
        later = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=15))
        self.assertEqual((later["count"], later["importance"]), (4, 4))
        top = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=20))
        self.assertEqual((top["count"], top["importance"]), (5, 5))
        self.assertEqual(srs.list_cards(self.user_id)[0]["importance"], 5)

    def test_manual_save_uses_historical_counts_without_autosaving_on_read(self):
        with srs._connect() as conn:
            conn.execute("INSERT INTO word_lookup_counts VALUES (?, 'bonjour', 5, ?, ?)", (self.user_id, srs._iso(self.now), srs._iso(self.now)))
        self.assertEqual(srs.lookup_counts(self.user_id), {"bonjour": 5})
        self.assertEqual(srs.list_cards(self.user_id), [])
        note = srs.add_note(self.user_id, "Bonjour à tous.", targets=[{"text": "Bonjour", "mode": "cloze", "importance": 1}])
        card = note["cards"][0]
        self.assertEqual(card["importance"], 5)
        srs.set_importance(self.user_id, [card["id"]], 1)
        self.assertEqual(srs.list_cards(self.user_id)[0]["importance"], 5)

    def test_migration_recomputes_only_existing_cards_and_preserves_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "users.db"
            with patch("auth_db._get_db_path", return_value=path):
                srs.init_db()
                srs.add_note(self.user_id, "Bonjour à tous.", targets=[{"text": "Bonjour", "mode": "cloze", "meta": {"meaning_en": "Hello"}}])
                with srs._connect() as conn:
                    conn.execute("DELETE FROM srs_migrations WHERE name = 'importance-1.3.4'")
                    conn.execute("UPDATE srs_cards SET importance = 1")
                    for word, count in [("bonjour", 3), ("historical", 10)]:
                        conn.execute("INSERT INTO word_lookup_counts VALUES (?, ?, ?, ?, ?)", (self.user_id, word, count, srs._iso(self.now), srs._iso(self.now)))
                    before = [tuple(r) for r in conn.execute("SELECT id, note_id, target_json, fsrs_json, due FROM srs_cards")]
                srs._initialized_db_paths.discard(str(path))
                srs.init_db()
                with srs._connect() as conn:
                    self.assertEqual([tuple(r) for r in conn.execute("SELECT id, note_id, target_json, fsrs_json, due FROM srs_cards")], before)
                    self.assertEqual(conn.execute("SELECT importance FROM srs_cards").fetchone()[0], 4)
                    self.assertEqual(conn.execute("SELECT count(*) FROM word_lookup_counts").fetchone()[0], 2)
                srs._initialized_db_paths.discard(str(path))
                srs.init_db()
                self.assertEqual(len(srs.list_cards(self.user_id)), 1)

    def test_old_database_gets_the_additive_table(self):
        path = Path(tempfile.mkdtemp()) / "users.db"
        with sqlite3.connect(path) as conn:
            conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        with patch("auth_db._get_db_path", return_value=path):
            srs.init_db()
        with sqlite3.connect(path) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertIn("word_lookup_counts", tables)
        self.assertIn("users", tables)  # existing data is untouched


if __name__ == "__main__":
    unittest.main()
