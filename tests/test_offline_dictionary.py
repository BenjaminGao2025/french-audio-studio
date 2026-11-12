"""Source definitions, inflected forms and failure modes without live data or AI."""

import gzip
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
        self.env = patch.dict(os.environ, {"FRENCH_DICTIONARY_PATH": str(self.path), "ENGLISH_DICTIONARY_PATH": ""})
        self.env.start()
        self.addCleanup(self.env.stop)
        dictionary._lookup.cache_clear()

    def add_entry(self, path, word, senses, *, refs=None, pos="noun"):
        with sqlite3.connect(path) as conn:
            conn.execute("INSERT INTO entries VALUES(NULL,?,?,?,?,?,?,?,?)",
                         (word, word, pos, pos, "", "", json.dumps(senses), json.dumps(refs or [])))
        dictionary._lookup.cache_clear()

    def enable_english(self):
        self.english = Path(self.temp.name) / "english.sqlite"
        with sqlite3.connect(self.path) as src, sqlite3.connect(self.english) as dst:
            src.backup(dst)
            dst.execute("DELETE FROM entries")
            dst.execute("DELETE FROM lexique")
            dst.execute("INSERT INTO metadata VALUES('gloss_language','en')")
        os.environ["ENGLISH_DICTIONARY_PATH"] = str(self.english)
        # Glosses below are selected from the downloaded Kaikki French corpus.
        self.add_entry(self.english, "correction", ["correction (all senses)"])
        self.add_entry(self.english, "objectif", ["objective, goal, aim"])
        self.add_entry(self.english, "objectifs", ["plural of objectif"], refs=["objectif"])
        self.add_entry(self.english, "différent", ["different"], pos="adj")
        self.add_entry(self.english, "différents", ["masculine plural of différent"], refs=["différent"], pos="adj")
        self.add_entry(self.path, "correction", ["Action de corriger."])

    def ma_indexes(self):
        self.enable_english()
        for path, senses in ((self.path, ["Déterminant possessif."]),
                             (self.english, ["feminine singular of mon (my)"])):
            with sqlite3.connect(path) as conn:
                for lemma, pos, gloss, refs in (("MA", "prep", ["abbreviation of meilleur avant: BB"], []),
                                                ("Ma", "name", ["A name"], []),
                                                ("ma", "det", senses, ["mon"])):
                    conn.execute("INSERT INTO entries VALUES(NULL,?,?,?,?,?,?,?,?)",
                                 ("ma", lemma, pos, pos, "", "", json.dumps(gloss), json.dumps(refs)))
        dictionary._lookup.cache_clear()

    def test_ma_exact_case_in_both_indexes_and_uppercase_fallback(self):
        self.ma_indexes()
        for query, expected in (("ma", "ma"), ("MA", "MA"), ("Ma", "Ma")):
            result = dictionary.lookup(query)
            self.assertEqual(result["lemma"], expected)
            for lang in ("en", "fr"):
                self.assertEqual(result["entries_" + lang][0]["lemma"], expected)
            if query == "ma":
                self.assertTrue(all(e["pos"] == "det" for e in result["entries"]))
                self.assertNotIn("meilleur avant", str(result["entries"]))

    def test_ma_sentence_pos_api_and_single_corpus(self):
        self.ma_indexes()
        client = TestClient(tts_service.app)
        for pos in ("det", "determiner", "ADJ:pos"):
            result = client.get("/api/lookup", params={"word": "ma", "pos": pos},
                                headers=testenv.session_headers()).json()
            self.assertEqual((result["lemma"], result["pos"]), ("ma", "det"))
        for env in ("ENGLISH_DICTIONARY_PATH", "FRENCH_DICTIONARY_PATH"):
            with patch.dict(os.environ, {env: ""}):
                self.assertEqual(dictionary.lookup("ma", "ADJ:pos")["pos"], "det")

    def test_sentence_pos_precedes_corpus_and_frequency_with_same_case(self):
        self.enable_english()
        self.add_entry(self.english, "test", ["a noun"], pos="noun")
        self.add_entry(self.path, "test", ["a determiner"], pos="det")
        self.assertEqual(dictionary.lookup("test", "determiner")["pos"], "det")

    def test_english_first_with_french_senses_and_correct_source(self):
        self.enable_english()
        result = dictionary.lookup("correction")
        self.assertEqual(result["entries_en"][0]["senses"], ["correction (all senses)"])
        self.assertEqual([e["language"] for e in result["entries"]], ["en", "fr"])
        self.assertEqual(result["entries_fr"][0]["senses"], ["Action de corriger."])
        self.assertEqual(result["entries"][0]["source_url"], "https://en.wiktionary.org/wiki/correction#French")
        self.assertIn("English Wiktionary", result["attribution"])
        self.assertIn("Lexique", result["attribution"])

    def test_recorrection_is_labelled_related_correction(self):
        self.enable_english()
        result = dictionary.lookup("recorrection")
        self.assertEqual((result["token"], result["match_type"], result["related"]),
                         ("recorrection", "related", "correction"))
        self.assertTrue(result["entries_en"])
        self.assertTrue(result["entries_fr"])
        self.assertEqual(result["phonetic"], "")

    def test_related_works_with_only_french(self):
        self.add_entry(self.path, "correction", ["Action de corriger."])
        self.assertEqual(dictionary.lookup("recorrection")["related"], "correction")

    def test_phrase_components_use_english_lemmas(self):
        self.enable_english()
        result = dictionary.lookup("objectifs différents")
        self.assertEqual(result["match_type"], "components")
        self.assertEqual([p["token"] for p in result["components"]], ["objectifs", "différents"])
        self.assertEqual([p["entries_en"][0]["lemma"] for p in result["components"]], ["objectif", "différent"])

    def test_exact_in_either_dictionary_precedes_related_or_components(self):
        self.enable_english()
        self.add_entry(self.path, "objectifs différents", ["Fixture phrase entry."])
        self.add_entry(self.path, "recorrection", ["Fixture exact entry."])
        for word in ("objectifs différents", "recorrection"):
            result = dictionary.lookup(word)
            self.assertEqual(result["match_type"], "exact")
            self.assertNotIn("components", result)
            self.assertNotIn("related", result)

    def test_phrase_related_precedes_components(self):
        self.add_entry(self.path, "correction complète", ["Fixture phrase entry."])
        result = dictionary.lookup("recorrection complète")
        self.assertEqual(result["match_type"], "related")
        self.assertEqual(result["related"], "correction complète")
        self.assertNotIn("components", result)

    def test_phrase_partial_miss_skips_missing_stopwords_and_resolves_related(self):
        self.enable_english()
        result = dictionary.lookup("de recorrection unknownzzz")
        parts = result["components"]
        self.assertEqual([p["token"] for p in parts], ["recorrection", "unknownzzz"])
        self.assertEqual(parts[0]["related"], "correction")
        self.assertEqual(parts[1]["dictionary_state"], "not_found")

    def test_english_only_and_true_miss_without_ai(self):
        self.enable_english()
        with patch.dict(os.environ, {"FRENCH_DICTIONARY_PATH": ""}):
            self.assertEqual(dictionary.lookup("objectifs")["lemma"], "objectif")
            self.assertIsNone(dictionary.lookup("unknownzzz"))

    def test_api_returns_english_related_and_phrase_entries_without_ai(self):
        self.enable_english()
        client = TestClient(tts_service.app)
        headers = testenv.session_headers()
        with patch("services.ai.post_chat", side_effect=AssertionError("No AI dictionary")):
            related = client.get("/api/lookup", params={"word": "recorrection"}, headers=headers).json()
            self.assertEqual(related["related"], "correction")
            self.assertTrue(related["entries_en"])
            phrase = client.get("/api/lookup", params={"word": "objectifs différents"}, headers=headers).json()
            self.assertEqual(len(phrase["components"]), 2)
            miss = client.get("/api/lookup", params={"word": "unknownzzz"}, headers=headers).json()
            self.assertEqual(miss["dictionary_state"], "not_found")

    def test_builder_plain_and_gzip_metadata_filtering_and_readback(self):
        from scripts.build_english_dictionary import build

        # Source gloss from Kaikki, plus a non-French record and malformed line.
        raw_data = (json.dumps({"word": "correction", "lang_code": "fr", "pos": "noun",
                                "senses": [{"glosses": ["correction (all senses)"]}]}) + "\n" +
                    json.dumps({"word": "recorrection", "lang_code": "en", "senses": []}) + "\ninvalid\n").encode()
        for suffix in (".jsonl", ".jsonl.gz"):
            with self.subTest(suffix=suffix):
                raw = Path(self.temp.name) / ("source" + suffix)
                raw.write_bytes(gzip.compress(raw_data) if suffix.endswith("gz") else raw_data)
                output = Path(self.temp.name) / ("built" + suffix + ".sqlite")
                metrics = build(raw, output)
                self.assertEqual(metrics["entries"], 1)
                self.assertEqual(metrics["malformed"], 1)
                self.assertFalse(metrics["recorrection_in_kaikki"])
                self.assertEqual(metrics["sources"]["license"], "CC BY-SA 4.0")
                with patch.dict(os.environ, {"ENGLISH_DICTIONARY_PATH": str(output)}):
                    self.assertEqual(dictionary.lookup("correction")["entries_en"][0]["senses"],
                                     ["correction (all senses)"])
                with self.assertRaises(ValueError):
                    build(raw, output)
                self.assertTrue(output.with_suffix(".manifest.json").is_file())

    def test_cache_detects_atomic_english_index_replacement(self):
        self.enable_english()
        self.assertEqual(dictionary.lookup("recorrection")["match_type"], "related")
        replacement = Path(self.temp.name) / "replacement.sqlite"
        with sqlite3.connect(self.english) as src, sqlite3.connect(replacement) as dst:
            src.backup(dst)
        self.add_entry(replacement, "recorrection", ["Fixture exact entry."])
        # Populate the old file's cache again, then replace with a different inode.
        dictionary.lookup("recorrection")
        replacement.replace(self.english)
        self.assertEqual(dictionary.lookup("recorrection")["match_type"], "exact")

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

    def test_sentence_pos_selects_inflected_verb_before_same_case_adjective(self):
        self.assertEqual(dictionary.lookup("réservé", "verb")["lemma"], "réserver")
        self.assertEqual(dictionary.lookup("réservé", "adjective")["lemma"], "réservé")

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
