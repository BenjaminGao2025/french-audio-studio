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
        for count, stars in [(0, 3), (1, 3), (4, 3), (5, 4), (7, 4), (9, 4), (10, 5), (30, 5)]:
            self.assertEqual(srs.importance_for_lookups(count), stars, count)


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

    def test_counts_are_per_user_and_each_five_lookups_after_saving_add_a_star(self):
        other_id, _ = _new_user()
        stars = []
        for i in range(13):
            result = srs.record_word_lookup(
                self.user_id, "très", now=self.now + datetime.timedelta(seconds=6 * i)
            )
            stars.append(result["importance"])
        # Auto-saved at the 3rd lookup with 3 stars, then +1 at the 8th and the 13th.
        self.assertEqual(stars, [0, 0, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5])
        self.assertEqual(result["count"], 13)
        self.assertEqual(srs.record_word_lookup(other_id, "très", now=self.now)["count"], 1)

        nine = srs.record_word_lookup(
            self.user_id, "beaucoup", now=self.now
        )
        self.assertEqual(nine["importance"], 0)
        for i in range(1, 9):
            result = srs.record_word_lookup(
                self.user_id, "beaucoup", now=self.now + datetime.timedelta(seconds=6 * i)
            )
        self.assertEqual((result["count"], result["importance"]), (9, 4))

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
            self.assertEqual(result["importance"], 0 if i < 2 else 3)
        cards = [c for c in srs.list_cards(self.user_id) if c["mode"] == "cloze"]
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["importance"], 3)
        srs.delete_card(self.user_id, cards[0]["id"])
        suppressed = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=11))
        self.assertEqual((suppressed["count"], suppressed["importance"], suppressed["incremented"]), (3, 0, False))
        self.assertEqual(srs.list_cards(self.user_id), [])
        later = srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=15))
        self.assertEqual((later["count"], later["importance"]), (4, 3))
        # Saved again at the 4th lookup: the climb counts from there, so the 9th adds the star.
        stars = [srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=20 + 6 * i))["importance"]
                 for i in range(5)]
        self.assertEqual(stars, [3, 3, 3, 3, 4])
        self.assertEqual(srs.list_cards(self.user_id)[0]["importance"], 4)

    def test_manual_save_uses_historical_counts_and_the_learner_choice_stands(self):
        with srs._connect() as conn:
            conn.execute("INSERT INTO word_lookup_counts VALUES (?, 'bonjour', 7, ?, ?)", (self.user_id, srs._iso(self.now), srs._iso(self.now)))
        self.assertEqual(srs.lookup_counts(self.user_id), {"bonjour": 7})
        self.assertEqual(srs.list_cards(self.user_id), [])
        note = srs.add_note(self.user_id, "Bonjour à tous.", targets=[{"text": "Bonjour", "mode": "cloze", "importance": 1}])
        card = note["cards"][0]
        self.assertEqual(card["importance"], 3)  # saving gives 3 stars, whatever the earlier lookups
        # The learner can pick another level, up or down; the next 5 lookups add one star to it.
        self.assertEqual(srs.set_importance(self.user_id, [card["id"]], 2), 1)
        self.assertEqual(srs.list_cards(self.user_id)[0]["importance"], 2)
        stars = [srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=6 * i))["importance"]
                 for i in range(1, 6)]
        self.assertEqual(stars, [2, 2, 2, 2, 3])  # lookups 8-12
        self.assertEqual(srs.set_importance(self.user_id, [card["id"]], 4), 1)
        stars = [srs.record_word_lookup(self.user_id, "bonjour", now=self.now + datetime.timedelta(seconds=6 * i))["importance"]
                 for i in range(6, 12)]
        self.assertEqual(stars, [4, 4, 4, 4, 5, 5])  # lookups 13-18; 5 is the top
        # Saving the word again from another sentence keeps the word's importance.
        other = srs.add_note(self.user_id, "Bonjour, madame.", targets=[{"text": "Bonjour", "mode": "cloze"}])
        self.assertEqual(other["cards"][0]["importance"], 5)

    def test_migration_recomputes_only_existing_cards_and_preserves_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "users.db"
            with patch("auth_db._get_db_path", return_value=path):
                srs.init_db()
                srs.add_note(self.user_id, "Bonjour à tous.", targets=[{"text": "Bonjour", "mode": "cloze", "meta": {"meaning_en": "Hello"}}])
                with srs._connect() as conn:
                    conn.execute("DELETE FROM srs_migrations WHERE name = 'importance-tiers-1.3.7'")
                    conn.execute("UPDATE srs_cards SET importance = 5")
                    for word, count in [("bonjour", 7), ("historical", 10)]:
                        conn.execute("INSERT INTO word_lookup_counts VALUES (?, ?, ?, ?, ?)", (self.user_id, word, count, srs._iso(self.now), srs._iso(self.now)))
                    before = [tuple(r) for r in conn.execute("SELECT id, note_id, target_json, fsrs_json, due FROM srs_cards")]
                srs._initialized_db_paths.discard(str(path))
                srs.init_db()
                with srs._connect() as conn:
                    self.assertEqual([tuple(r) for r in conn.execute("SELECT id, note_id, target_json, fsrs_json, due FROM srs_cards")], before)
                    self.assertEqual(conn.execute("SELECT importance FROM srs_cards").fetchone()[0], 4)
                    self.assertEqual(conn.execute("SELECT count(*) FROM word_lookup_counts").fetchone()[0], 2)
                    # As if saved before the first lookup: the climb continues from the last 5-lookup step.
                    self.assertEqual(dict(conn.execute("SELECT word, lookups FROM word_importance_base").fetchall()),
                                     {"bonjour": 5, "historical": 10})
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
