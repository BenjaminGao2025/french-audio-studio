"""Conjugation index build and word-card tables, from a tiny Kaikki-shaped fixture."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import testenv  # noqa: F401
from fastapi.testclient import TestClient

import conjugation
import tts_service
from scripts import build_conjugation

PERSONS = [("first-person", "singular"), ("second-person", "singular"), ("third-person", "singular"),
           ("first-person", "plural"), ("second-person", "plural"), ("third-person", "plural")]
MOODS = {"present": ["indicative", "present"], "imperfect": ["indicative", "imperfect"],
         "future": ["indicative", "future"], "subj_present": ["subjunctive", "present"]}


def verb(word, aux, ipa=None, pp="", ppr="", reflexive=False, **tenses):
    forms = [{"form": word, "tags": ["infinitive"], "source": "conjugation"}]
    forms += [{"form": a, "tags": ["infinitive", "multiword-construction"], "source": "conjugation"} for a in aux]
    forms += [{"form": pp, "tags": ["participle", "past"], "source": "conjugation"},
              {"form": ppr, "tags": ["participle", "present"], "source": "conjugation"}]
    for tense, cells in tenses.items():
        if tense == "imperative":
            forms += [{"form": f, "tags": ["imperative", *PERSONS[i]], "source": "conjugation"}
                      for i, f in zip((1, 3, 4), cells)]
            continue
        for i, f in enumerate(cells):
            forms.append({"form": f, "tags": [*MOODS[tense], *PERSONS[i]], "source": "conjugation",
                          "ipa": f"/{ipa[i]}/" if ipa and tense == "present" else ""})
    if reflexive:  # the reflexive block that follows must never overwrite the plain one
        forms += [{"form": "se " + word, "tags": ["infinitive"], "source": "conjugation"},
                  {"form": "laisse-toi", "tags": ["imperative", *PERSONS[1]], "source": "conjugation"}]
    return {"word": word, "lang_code": "fr", "pos": "verb", "forms": forms}


FIXTURE = [
    verb("être", ["avoir + past participle"], pp="été", ppr="étant",
         present=["suis", "es", "est", "sommes", "êtes", "sont"],
         imperfect=["étais", "étais", "était", "étions", "étiez", "étaient"]),
    verb("avoir", ["avoir + past participle"], pp="eu", ppr="ayant",
         present=["ai", "as", "a", "avons", "avez", "ont"],
         imperfect=["avais", "avais", "avait", "avions", "aviez", "avaient"]),
    verb("suivre", ["avoir + past participle"], pp="suivi", ppr="suivant",
         present=["suis", "suis", "suit", "suivons", "suivez", "suivent"]),
    verb("aller", ["être + past participle"], pp="allé", ppr="allant",
         present=["vais", "vas", "va", "allons", "allez", "vont"],
         subj_present=["aille", "ailles", "aille", "allions", "alliez", "aillent"]),
    verb("laisser", ["avoir + past participle"], ipa=["lɛs", "lɛs", "lɛs", "lɛ.sɔ̃", "lɛ.se", "lɛs"],
         pp="laissé", ppr="laissant", reflexive=True,
         present=["laisse", "laisses", "laisse", "laissons", "laissez", "laissent"],
         imperfect=["laissais", "laissais", "laissait", "laissions", "laissiez", "laissaient"],
         subj_present=["laisse", "laisses", "laisse", "laissions", "laissiez", "laissent"],
         imperative=["laisse", "laissons", "laissez"]),
    verb("monter", ["avoir", "être + past participle"], pp="monté", ppr="montant",
         present=["monte", "montes", "monte", "montons", "montez", "montent"]),
    verb("haïr", ["avoir + past participle"], pp="haï", ppr="haïssant",
         present=["hais", "hais", "hait", "haïssons", "haïssez", "haïssent"]),
]
FIXTURE.append(verb("payer", ["avoir + past participle"], pp="payé", ppr="payant",
                    present=["paie", "paies", "paie", "payons", "payez", "paient"]))
FIXTURE[-1]["forms"].append({"form": "paye", "tags": ["indicative", "present", *PERSONS[0]], "source": "conjugation"})
# A record that leaks IPA into the form field keeps the real spelling.
FIXTURE[4]["forms"].insert(5, {"form": "lɛs", "tags": ["indicative", "present", *PERSONS[0]], "source": "conjugation"})
LEXIQUE = "ortho\tlemme\tcgram\tfreqlemfilms2\nsuis\têtre\tAUX\t9000\nsuis\tsuivre\tVER\t80\nlaisse\tlaisser\tVER\t300\n"


class ConjugationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        (root / "raw.jsonl").write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in FIXTURE) + "{\"pos\": \"verb\", bad\n")
        (root / "lex.tsv").write_text(LEXIQUE)
        cls.path = root / "conjugation.sqlite"
        cls.metrics = build_conjugation.build(root / "raw.jsonl", root / "lex.tsv", cls.path)
        cls.env = patch.dict(os.environ, {"CONJUGATION_PATH": str(cls.path)})
        cls.env.start()

    @classmethod
    def tearDownClass(cls):
        cls.env.stop()
        cls.temp.cleanup()

    def tense(self, result, key):
        return next(t for t in result["tenses"] if t["key"] == key)

    def test_build_counts_and_refuses_to_overwrite(self):
        self.assertEqual((self.metrics["verbs"], self.metrics["malformed"]), (8, 1))
        self.assertTrue(self.path.with_suffix(".manifest.json").exists())
        with self.assertRaises(ValueError):
            build_conjugation.build(Path(self.temp.name) / "raw.jsonl", Path(self.temp.name) / "lex.tsv", self.path)

    def test_frequency_and_dictionary_lemma_pick_the_verb(self):
        self.assertEqual(conjugation.conjugation("suis")["lemma"], "être")
        self.assertEqual(conjugation.conjugation("suis", "VERB", "suivre")["lemma"], "suivre")
        self.assertEqual(conjugation.conjugation("Suis", "", "chose")["lemma"], "être")

    def test_tapped_form_sets_focus_and_current_cells(self):
        result = conjugation.conjugation("laissais", "VERB")
        self.assertEqual((result["lemma"], result["focus"], result["aux"]), ("laisser", "imperfect", "avoir"))
        current = [c["say"] for t in result["tenses"] for c in t["cells"] if c["current"]]
        self.assertEqual(current, ["je laissais", "tu laissais"])
        # laisse is a present first, also a subjunctive and an imperative.
        result = conjugation.conjugation("laisse")
        self.assertEqual(result["focus"], "present")
        self.assertEqual([c["say"] for c in self.tense(result, "subj_present")["cells"] if c["current"]],
                         ["que je laisse", "qu'il laisse"])
        self.assertEqual([c["form"] for c in self.tense(result, "imperative")["cells"]], ["laisse", "laissons", "laissez"])
        self.assertEqual(self.tense(result, "present")["cells"][0]["ipa"], "lɛs")

    def test_compound_tenses_use_the_auxiliary(self):
        laisser = conjugation.conjugation("laisse")
        self.assertEqual([c["say"] for c in self.tense(laisser, "passe_compose")["cells"]][:2], ["j'ai laissé", "tu as laissé"])
        self.assertEqual(self.tense(laisser, "plus_que_parfait")["cells"][0]["say"], "j'avais laissé")
        aller = conjugation.conjugation("vais")
        cells = self.tense(aller, "passe_compose")["cells"]
        self.assertEqual((cells[0]["form"], cells[0]["say"]), ("suis allé(e)", "je suis allé"))
        self.assertEqual((cells[3]["form"], cells[3]["say"]), ("sommes allé(e)s", "nous sommes allés"))
        self.assertEqual(self.tense(aller, "plus_que_parfait")["cells"][0]["say"], "j'étais allé")
        self.assertEqual(self.tense(aller, "subj_present")["cells"][0]["say"], "que j'aille")
        self.assertEqual(conjugation.conjugation("monte")["also"], "je suis monté(e)")
        self.assertEqual(self.tense(conjugation.conjugation("hais"), "present")["cells"][0]["say"], "je hais")

    def test_elided_inverted_and_capitalised_clicks(self):
        for word, lemma in (("j'ai", "avoir"), ("n’a", "avoir"), ("avez-vous", "avoir"), ("a-t-il", "avoir"),
                            ("Laissez", "laisser"), ("c'est", "être")):
            self.assertEqual(conjugation.conjugation(word)["lemma"], lemma, word)

    def test_a_cell_keeps_both_spellings(self):
        result = conjugation.conjugation("paye")
        first = self.tense(result, "present")["cells"][0]
        self.assertEqual((first["form"], first["say"], first["current"]), ("paie / paye", "je paye", True))
        self.assertEqual(self.tense(conjugation.conjugation("paie"), "present")["cells"][0]["say"], "je paie")
        self.assertEqual(result["source_url"], "https://en.wiktionary.org/wiki/payer#French")

    def test_participles_and_infinitives_have_a_role(self):
        for word in ("allées", "allé"):
            result = conjugation.conjugation(word, "VERB")
            self.assertEqual((result["lemma"], result["role"], result["focus"]), ("aller", "past participle", ""))
        self.assertEqual(conjugation.conjugation("laisser")["role"], "infinitive")

    def test_non_verbs_and_missing_index_are_hidden(self):
        self.assertIsNone(conjugation.conjugation("été", "NOUN"))
        self.assertIsNone(conjugation.conjugation("table"))
        self.assertIsNone(conjugation.conjugation("il est"))
        with patch.dict(os.environ, {"CONJUGATION_PATH": str(self.path) + ".missing"}):
            self.assertIsNone(conjugation.conjugation("suis"))

    def test_api_lookup_adds_the_table_for_verb_readings_only(self):
        client = TestClient(tts_service.app)
        headers = testenv.session_headers()
        found = {"lemma": "être", "pos": "verb", "entries": []}
        with patch("routers.tutor.request_word_lookup", AsyncMock(return_value=found)):
            body = client.get("/api/lookup", params={"word": "suis"}, headers=headers).json()
            self.assertEqual(body["conjugation"]["lemma"], "être")
            self.assertNotIn("conjugation", client.get("/api/lookup", params={"word": "suis", "pos": "NOUN"},
                                                       headers=headers).json())
        summer = {"lemma": "été", "pos": "noun", "entries": []}
        with patch("routers.tutor.request_word_lookup", AsyncMock(return_value=summer)):
            self.assertNotIn("conjugation", client.get("/api/lookup", params={"word": "été"}, headers=headers).json())


if __name__ == "__main__":
    unittest.main()
