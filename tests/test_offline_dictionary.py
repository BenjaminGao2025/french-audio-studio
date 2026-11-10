"""Source definitions, inflected forms and failure modes without live data or AI."""

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import testenv  # noqa: F401
from fastapi.testclient import TestClient

import offline_dictionary as dictionary
import tts_service


class OfflineDictionaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "dictionary.sqlite"
        with sqlite3.connect(self.path) as conn:
            conn.executescript(
                "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);"
                "CREATE TABLE entries(id INTEGER PRIMARY KEY,word TEXT,lemma TEXT,pos TEXT,pos_title TEXT,gender TEXT,ipa TEXT,senses TEXT,form_of TEXT);"
                "CREATE TABLE lexique(word TEXT,lemma TEXT,pos TEXT,gender TEXT,number TEXT,frequency REAL,info TEXT);"
            )
            conn.executemany("INSERT INTO metadata VALUES(?,?)", [("schema_version", "1"), ("dataset", "fixture")])
            rows = [
                (
                    "réserver",
                    "réserver",
                    "verb",
                    "Verbe",
                    "",
                    "ʁe.zɛʁ.ve",
                    ["S’engager à l’avance à utiliser une ressource."],
                    [],
                ),
                ("réservé", "réservé", "adj", "Adjectif", "", "ʁe.zɛʁ.ve", ["Discret, timide."], []),
                ("au", "au", "article", "Forme d’article", "", "o", ["Contraction de à et le."], ["article"]),
                ("d'accord", "d’accord", "intj", "Interjection", "", "d‿a.kɔʁ", ["J’y consens."], []),
                ("aller", "aller", "verb", "Verbe", "", "a.le", ["Se déplacer."], []),
                ("manger", "manger", "verb", "Verbe", "", "mɑ̃.ʒe", ["Consommer un aliment."], []),
                ("irons", "irons", "verb", "Forme de verbe", "", "i.ʁɔ̃", ["Forme de aller."], ["aller"]),
            ]
            for row in rows:
                conn.execute(
                    "INSERT INTO entries VALUES(NULL,?,?,?,?,?,?,?,?)",
                    (*row[:6], json.dumps(row[6]), json.dumps(row[7])),
                )
            conn.executemany(
                "INSERT INTO lexique VALUES(?,?,?,?,?,?,?)",
                [
                    ("réservé", "réserver", "VER", "m", "s", 20, "par:pas;"),
                    ("réservé", "réservé", "ADJ", "m", "s", 2, ""),
                    ("au", "au", "ART:def", "m", "s", 100, ""),
                    ("vais", "aller", "VER", "", "", 50, "ind:pre:1s;"),
                ],
            )
        self.env = patch.dict(os.environ, {"FRENCH_DICTIONARY_PATH": str(self.path)})
        self.env.start()
        self.addCleanup(self.env.stop)
        dictionary._lookup.cache_clear()

    def test_lemmas_multiple_pos_and_source_attribution(self):
        result = dictionary.lookup(" Réservé ")
        self.assertEqual([e["lemma"] for e in result["entries"]], ["réserver", "réservé"])
        self.assertEqual(result["entries"][0]["senses"], ["S’engager à l’avance à utiliser une ressource."])
        self.assertIn("r%C3%A9server", result["entries"][0]["source_url"])
        self.assertIn("action=history", result["entries"][0]["history_url"])
        self.assertEqual(result["dictionary_source"], "wiktionnaire")
        self.assertIn("creativecommons.org", result["license_url"])
        result["entries"][0]["senses"].clear()
        self.assertTrue(dictionary.lookup("réservé")["entries"][0]["senses"])

    def test_contraction_expression_and_inflection(self):
        self.assertEqual(dictionary.lookup("au")["entries"][0]["senses"], ["Contraction de à et le."])
        self.assertEqual(dictionary.lookup("D’ACCORD")["entries"][0]["lemma"], "d’accord")
        self.assertEqual(dictionary.lookup("vais")["lemma"], "aller")
        self.assertEqual(dictionary.lookup("vais")["phonetic"], "")  # no IPA for this surface form in fixture
        self.assertEqual(dictionary.lookup("irons")["lemma"], "aller")

    def test_unknown_and_sql_injection_are_misses(self):
        self.assertIsNone(dictionary.lookup("inventedwordzzz"))
        self.assertIsNone(dictionary.lookup("'; DROP TABLE entries; --"))
        self.assertIsNotNone(dictionary.lookup("manger"))

    def test_missing_or_corrupt_index_is_unavailable(self):
        for path in (str(self.path) + ".missing", "", "relative.sqlite"):
            with (
                patch.dict(os.environ, {"FRENCH_DICTIONARY_PATH": path}),
                self.assertRaises(dictionary.DictionaryUnavailable),
            ):
                dictionary.lookup("manger")
        bad = Path(self.temp.name) / "bad.sqlite"
        bad.write_text("not a sqlite database")
        with (
            patch.dict(os.environ, {"FRENCH_DICTIONARY_PATH": str(bad)}),
            self.assertRaises(dictionary.DictionaryUnavailable),
        ):
            dictionary.lookup("manger")

    def test_api_reads_without_upstream_credentials_or_generated_fallback(self):
        client = TestClient(tts_service.app)
        headers = testenv.session_headers()
        chat = AsyncMock()
        with (
            patch("services.ai.post_chat", chat),
            patch("services.ai.upstream_key", side_effect=AssertionError("No AI for dictionary")),
        ):
            self.assertEqual(client.get("/api/lookup?word=au").status_code, 401)
            res = client.get("/api/lookup?word=au", headers=headers)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["entries"][0]["senses"], ["Contraction de à et le."])
            self.assertEqual(
                client.get("/api/lookup?word=unknownzzz", headers=headers).json()["dictionary_state"], "not_found"
            )
            with patch.dict(os.environ, {"FRENCH_DICTIONARY_PATH": ""}):
                self.assertEqual(client.get("/api/lookup?word=au", headers=headers).status_code, 503)
        chat.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
