"""Shared lookup identity and conservative, reversible word-only migration on fixture DBs."""
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


class ElisionMigrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "fixture.db"
        self.patcher = patch("auth_db._get_db_path", return_value=self.path)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.addCleanup(srs._initialized_db_paths.discard, str(self.path))
        srs.init_db()
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)

    def snapshot(self, table):
        return [dict(r) for r in self.conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]

    def seed_words(self, words, user_id=1):
        for i, word in enumerate(words, 1):
            self.conn.execute("INSERT INTO word_lookup_counts VALUES (?,?,?,?,?)",
                              (user_id, word, i, f"2026-10-{i:02d}", f"2026-11-{i:02d}"))
            self.conn.execute("INSERT INTO word_favorites VALUES (?,?,?)",
                              (user_id, word, f"2026-10-{i:02d}"))

    def migrate(self):
        self.conn.execute("DELETE FROM srs_migrations WHERE name='elision-keys-1.3.4'")
        self.conn.commit()
        srs._initialized_db_paths.discard(str(self.path))
        srs.init_db()

    def seed_cards(self, targets, mode="cloze"):
        for i, target in enumerate(targets):
            note_id, card_id = f"note-{i}", f"card-{i}"
            sentence = f"Contexte distinct {i}: {target}."
            self.conn.execute("INSERT INTO srs_notes VALUES (?,1,?,?, '译文','translation','{}','2026-10-01')",
                              (note_id, sentence, sentence.lower()))
            self.conn.execute(
                "INSERT INTO srs_cards (id,note_id,user_id,mode,target,target_json,fsrs_json,"
                "due,is_new,created_at,importance,archived_at) VALUES (?,?,1,?,?,?,?,'2026-11-01',0,'2026-10-01',3,?)",
                (card_id, note_id, mode, target,
                 json.dumps({"meaning_en": "preserved", "index": i}),
                 json.dumps({"stability": i + 1}), "2026-10-31" if i % 2 else None))
            for rating in (2, 3):
                self.conn.execute(
                    "INSERT INTO srs_reviews (card_id,note_id,user_id,rating,was_new,reviewed_at,answer) "
                    "VALUES (?,?,1,?,0,'2026-11-01','original answer')", (card_id, note_id, rating))

    def assert_sentence_history_preserved(self, targets):
        self.seed_cards(targets)
        self.seed_words(dict.fromkeys(targets))
        cards, reviews, notes = (self.snapshot(t) for t in ("srs_cards", "srs_reviews", "srs_notes"))
        # Fail even if an UPDATE/DELETE would happen to leave the same final values.
        self.conn.executescript("""
            CREATE TRIGGER forbid_card_delete BEFORE DELETE ON srs_cards
            BEGIN SELECT RAISE(ABORT, 'sentence card deletion'); END;
            CREATE TRIGGER forbid_card_rewrite BEFORE UPDATE OF id,note_id,user_id,mode,target,
                target_json,fsrs_json,due,is_new,created_at,archived_at ON srs_cards
            BEGIN SELECT RAISE(ABORT, 'sentence card rewrite'); END;
            CREATE TRIGGER forbid_review_update BEFORE UPDATE ON srs_reviews
            BEGIN SELECT RAISE(ABORT, 'review reassignment'); END;
            CREATE TRIGGER forbid_review_delete BEFORE DELETE ON srs_reviews
            BEGIN SELECT RAISE(ABORT, 'review deletion'); END;
        """)
        self.migrate()
        after = self.snapshot("srs_cards")
        self.assertEqual(len(after), len(cards))
        for before_card, after_card in zip(cards, after):
            self.assertEqual({k: v for k, v in before_card.items() if k != "importance"},
                             {k: v for k, v in after_card.items() if k != "importance"})
        self.assertEqual(self.snapshot("srs_reviews"), reviews)
        self.assertEqual(self.snapshot("srs_notes"), notes)

    def test_est_sentence_cards_and_reviews_stay_separate(self):
        self.assert_sentence_history_preserved(["n’est", "C'est", "est"])

    def test_multiple_a_clozes_and_jusqua_stay_separate(self):
        self.assert_sentence_history_preserved(["à", "à", "à", "jusqu'à"])

    def test_arrive_sentence_cards_and_reviews_stay_separate(self):
        self.assert_sentence_history_preserved(["n'arrive", "J'arrive", "arrive"])

    def test_il_sentence_cards_and_reviews_stay_separate(self):
        self.assert_sentence_history_preserved(["s'il", "qu'il", "il"])

    def test_elle_sentence_cards_and_reviews_stay_separate(self):
        self.assert_sentence_history_preserved(["Elle", "qu’elle"])

    def test_ambiguous_word_counts_and_stars_keep_prefixes(self):
        words = ["à", "jusqu'à", "est", "n’est", "C'est", "arrive", "n'arrive", "J'arrive",
                 "il", "s'il", "qu'il", "elle", "qu’elle", "y", "j'y", "ai", "n'ai", "était", "c'était",
                 "c'homme", "n'homme", "homme", "j'oubli", "n'oubli", "oubli", "s'image", "qu'image"]
        self.seed_words(words)
        self.migrate()
        counts = {r["word"]: r["count"] for r in self.snapshot("word_lookup_counts")}
        expected = {srs._normalize_word_surface(w): i for i, w in enumerate(words, 1)}
        self.assertEqual(counts, expected)
        self.assertEqual({r["word"] for r in self.snapshot("word_favorites")}, set(expected))

    def test_competing_prefixes_across_tables_and_users(self):
        self.conn.execute("INSERT INTO word_lookup_counts VALUES (1,?,2,'first','last')", ("c'image",))
        self.conn.execute("INSERT INTO word_favorites VALUES (1,?,'first')", ("n’image",))
        self.seed_words(["l'image", "image"], user_id=2)
        self.migrate()
        self.assertEqual([(r["user_id"], r["word"], r["count"]) for r in self.snapshot("word_lookup_counts")],
                         [(1, "c'image", 2), (2, "image", 3)])
        self.assertEqual({(r["user_id"], r["word"]) for r in self.snapshot("word_favorites")},
                         {(1, "n'image"), (2, "image")})

    def test_content_aliases_merge_reversibly_and_idempotently(self):
        words = ["homme", "l'homme", "l’homme", "oubli", "l'oubli", "l’oubli", "l'image", "l’image",
                 "été", "l'été", "expression", "d'expression", "aider", "m'aider", "italie", "l'italie",
                 "n’est", "n'est"]
        self.seed_words(words)
        self.seed_cards(["homme", "l'homme", "l’homme"], mode="recognize")
        originals = {t: self.snapshot(t) for t in ("word_lookup_counts", "word_favorites")}
        cards, reviews = self.snapshot("srs_cards"), self.snapshot("srs_reviews")
        self.migrate()
        counts = {r["word"]: r for r in self.snapshot("word_lookup_counts")}
        for key, aliases in {"homme": words[:3], "oubli": words[3:6], "image": words[6:8],
                             "été": words[8:10], "expression": words[10:12], "aider": words[12:14],
                             "italie": words[14:16], "n'est": words[16:]}.items():
            source = [r for r in originals["word_lookup_counts"] if r["word"] in aliases]
            self.assertEqual(counts[key]["count"], sum(r["count"] for r in source))
            self.assertEqual(counts[key]["first_looked_at"], min(r["first_looked_at"] for r in source))
            self.assertEqual(counts[key]["last_looked_at"], max(r["last_looked_at"] for r in source))
            favorite = next(r for r in self.snapshot("word_favorites") if r["word"] == key)
            self.assertEqual(favorite["created_at"], min(r["first_looked_at"] for r in source))
        self.assertEqual(len(self.snapshot("srs_cards")), len(cards))
        self.assertTrue(all(r["importance"] == 5 for r in self.snapshot("srs_cards")))
        self.assertEqual([{k: v for k, v in r.items() if k != "importance"} for r in cards],
                         [{k: v for k, v in r.items() if k != "importance"}
                          for r in self.snapshot("srs_cards")])
        self.assertEqual(self.snapshot("srs_reviews"), reviews)
        tables = ("word_lookup_counts", "word_favorites", "srs_cards", "srs_reviews",
                  "srs_notes", "srs_migrations", "srs_elision_merge_backup")
        migrated = {t: self.snapshot(t) for t in tables}
        srs._initialized_db_paths.discard(str(self.path))
        srs.init_db()
        self.assertEqual({t: self.snapshot(t) for t in tables}, migrated)
        # The helper itself is also a no-op on the canonical output.
        srs._merge_elided_keys(self.conn)
        self.assertEqual({t: self.snapshot(t) for t in tables}, migrated)
        # Restore only affected keys from the additive recovery rows.
        for table in originals:
            backups = [json.loads(r["row_json"]) for r in self.snapshot("srs_elision_merge_backup")
                       if r["source_table"] == table]
            self.assertEqual(sorted(backups, key=lambda r: r["word"]),
                             sorted(originals[table], key=lambda r: r["word"]))
            self.conn.execute(f"DELETE FROM {table}")
            for row in backups:
                self.conn.execute(f"INSERT INTO {table} (" + ",".join(row) + ") VALUES ("
                                  + ",".join("?" for _ in row) + ")", tuple(row.values()))
            self.assertEqual(sorted(self.snapshot(table), key=lambda r: r["word"]),
                             sorted(originals[table], key=lambda r: r["word"]))
