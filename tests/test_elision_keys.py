"""Task 6: single lemma identity and a reversible migration on a fixture DB backup only."""
import datetime
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import testenv  # noqa: F401
import srs


class ElisionKeysTests(unittest.TestCase):
    def test_all_task5_prefixes_and_apostrophes(self):
        for prefix in ("l", "d", "j", "n", "m", "t", "s", "c", "qu", "jusqu", "lorsqu", "puisqu"):
            for apostrophe in ("'", "’"):
                self.assertEqual(srs.normalize_lookup_word(f" {prefix.upper()}{apostrophe}HOMME "), "homme")
        self.assertEqual(srs.normalize_lookup_word("droits de l’homme"), "droits de l'homme")
        self.assertNotEqual(srs.normalize_lookup_word("failli"), srs.normalize_lookup_word("faillir"))
        self.assertEqual(srs.normalize_lookup_word("l'e\u0301te\u0301"), "été")

    def test_counts_saved_word_and_importance_share_identity(self):
        with tempfile.TemporaryDirectory() as directory, patch("auth_db._get_db_path", return_value=Path(directory) / "fixture.db"):
            now = datetime.datetime(2026, 11, 11, tzinfo=datetime.timezone.utc)
            for i, surface in enumerate(("l'homme", "homme", "l’homme")):
                result = srs.record_word_lookup(1, surface, now=now + datetime.timedelta(seconds=i * 6), sentence="Il voit l'homme ici.")
            self.assertEqual(srs.lookup_counts(1), {"homme": 3})
            self.assertEqual(result["importance"], 4)
            cards = srs.list_cards(1)
            self.assertEqual(len(cards), 1)
            self.assertEqual(cards[0]["target"], "l’homme")
            srs.add_note(1, "Cet homme arrive.", targets=[{"text": "homme", "mode": "cloze"}])
            self.assertEqual(len(srs.list_cards(1)), 1)
            srs.set_favorite(1, "l’homme", True)
            self.assertEqual(srs.favorite_words(1), ["homme"])
            srs.set_favorite(1, "homme", False)
            self.assertEqual(srs.favorite_words(1), [])

    def test_migration_on_fixture_backup_preserves_history_and_payloads(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "fixture-source.db"
            backup = Path(directory) / "users-backup.db"
            with patch("auth_db._get_db_path", return_value=source):
                note = srs.add_note(1, "Il voit l'homme ici.", targets=[{"text": "homme", "mode": "recognize", "meta": {"meaning_en": "man"}}])
                with srs._connect() as conn:
                    row = conn.execute("SELECT * FROM srs_cards").fetchone()
                    original = dict(row)
                    duplicate = dict(row, id="legacy-surface", target="l'homme", mode="cloze", is_new=0, archived_at="2026-11-01")
                    conn.execute("INSERT INTO srs_cards (" + ",".join(duplicate) + ") VALUES (" + ",".join("?" for _ in duplicate) + ")", tuple(duplicate.values()))
                    conn.execute("INSERT INTO srs_reviews (card_id,note_id,user_id,rating,was_new,reviewed_at,answer) VALUES (?,?,1,3,1,'2026-11-01','kept answer')", (original["id"], note["id"]))
                    for word, count in (("homme", 2), ("l'homme", 3), ("l’homme", 1)):
                        conn.execute("INSERT INTO word_lookup_counts VALUES (1,?,?,?,?)", (word, count, "2026-10-01", "2026-11-01"))
                    conn.execute("INSERT INTO word_favorites VALUES (1, ?, '2026-10-01')", ("l'homme",))
                    conn.execute("DELETE FROM srs_migrations WHERE name = 'elision-keys-1.3.4'")
                with sqlite3.connect(source) as src, sqlite3.connect(backup) as dst:
                    src.backup(dst)
            with patch("auth_db._get_db_path", return_value=backup):
                srs.init_db()
                self.assertEqual(srs.lookup_counts(1), {"homme": 6})
                self.assertEqual(srs.favorite_words(1), ["homme"])
                cards = srs.list_cards(1)
                self.assertEqual(len(cards), 1)
                self.assertEqual(cards[0]["id"], "legacy-surface")
                self.assertEqual(cards[0]["importance"], 5)
                with srs._connect() as conn:
                    self.assertIsNone(conn.execute("SELECT archived_at FROM srs_cards").fetchone()[0])
                    review = conn.execute("SELECT card_id, answer FROM srs_reviews").fetchone()
                    self.assertEqual(tuple(review), ("legacy-surface", "kept answer"))
                    recovered = json.loads(conn.execute("SELECT row_json FROM srs_elision_merge_backup WHERE source_table='srs_cards' AND source_key=?", (original["id"],)).fetchone()[0])
                    self.assertEqual(recovered, original)
                    before = conn.execute("SELECT count(*) FROM srs_elision_merge_backup").fetchone()[0]
                srs._initialized_db_paths.discard(str(backup))
                srs.init_db()
                self.assertEqual(srs.lookup_counts(1), {"homme": 6})
                with srs._connect() as conn:
                    self.assertEqual(conn.execute("SELECT count(*) FROM srs_elision_merge_backup").fetchone()[0], before)
            with sqlite3.connect(source) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM srs_cards").fetchone()[0], 2)
                self.assertEqual(conn.execute("SELECT count(*) FROM word_lookup_counts").fetchone()[0], 3)
