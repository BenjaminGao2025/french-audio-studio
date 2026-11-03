import base64
import json
import pathlib
import shutil
import subprocess
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import testenv  # noqa: F401  (sets up the isolated env before tts_service is imported)
import tts_service as host

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHOTO = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 64).decode()


def analysis_reply(**fields):
    return json.dumps({"sentences": [{"schemaVersion": 2, "words": [], **fields}]}, ensure_ascii=False)


def parse(raw, source):
    return host._parse_analysis_json(raw, source)["sentences"]


def chat_reply(reply):
    return patch.object(host, "_post_chat", new_callable=AsyncMock, return_value=({}, reply))


class AccentPromptTests(unittest.TestCase):
    def test_rule_restores_only_required_accents(self):
        rule = host.ACCENT_RULE
        for example in ("A pied → À pied", "A l'heure → À l'heure", "A Paris → À Paris", "A 8 heures → À 8 heures"):
            self.assertIn(example, rule)
        self.assertIn("Ecole → École", rule)
        self.assertIn("only where French spelling requires it", rule)
        self.assertIn("Change nothing else", rule)
        self.assertIn("correct text stays exactly as it is", rule)

    def test_rule_keeps_the_a_that_is_no_preposition(self):
        for kept in ("verb avoir (A-t-il fini ?)", "answer label (A., B))", "level (A1, A2)", "vitamine A"):
            self.assertIn(kept, host.ACCENT_RULE)

    def test_breakdown_prompt_explains_a_as_the_preposition(self):
        payload = host._analyze_payload(host.AnalyzeRequest(text="A pied"))
        prompt = payload["messages"][0]["content"]
        self.assertIn(host.ACCENT_RULE, prompt)
        self.assertIn('"accent_fixed_from": ""', prompt)
        self.assertIn("À is the preposition à with a capital letter", prompt)
        self.assertIn("lemma 'à'", prompt)
        self.assertIn("À pied = on foot", prompt)
        self.assertIn("Never a lone À = On", prompt)
        self.assertIn("Every other field uses the corrected text too", prompt)

    def test_extraction_prompts_no_longer_forbid_the_fix(self):
        clean = host._clean_input_payload("x")["messages"][0]["content"]
        for prompt in (clean, host.PHOTO_SYSTEM_PROMPT):
            with self.subTest(prompt=prompt[:30]):
                self.assertIn(host.ACCENT_RULE, prompt)
                self.assertIn("except for missing accents", prompt)
                self.assertNotIn("Do not translate, correct", prompt)
        self.assertIn('"accent_fixed_from":""', host.PHOTO_SYSTEM_PROMPT)
        self.assertIn("exactly as printed", host.PHOTO_SYSTEM_PROMPT)


class AccentFieldTests(unittest.TestCase):
    def test_accent_only_changes_keep_the_original(self):
        cases = (
            ("À pied", "A pied"),
            ("À l'heure", "A l'heure"),
            ("À 8 heures", "A 8 heures"),
            ("École à Paris", "Ecole a Paris"),
            ("À pied", "A pied"),  # decomposed reply
            ("À pied", "  A   pied "),
        )
        for fixed, original in cases:
            with self.subTest(fixed=fixed):
                self.assertEqual(host._accent_fixed_from(fixed, original), " ".join(original.split()))

    def test_anything_else_is_no_accent_fix(self):
        cases = (
            ("À pied", "À pied"),  # nothing changed
            ("À pied", "À pied"),  # same text, other encoding
            ("A pied", "À pied"),  # lost an accent
            ("mère", "mére"),  # swapped one
            ("À pied.", "A pied"),  # added punctuation
            ("À vélo", "A pied"),  # other words
            ("Je vais à Paris", "Je va a Paris"),  # grammar too
            ("cœur", "coeur"),  # a ligature, not an accent
            ("À pied", ""),
            ("À pied", None),
            ("À pied", 3),
            ("À pied", ["A pied"]),
        )
        for fixed, original in cases:
            with self.subTest(fixed=fixed, original=original):
                self.assertEqual(host._accent_fixed_from(fixed, original), "")

    def test_source_lookup_finds_the_wording_inside_a_longer_text(self):
        source = "## 交通方式 한글\n- **A pied** ou en bus\n| Ecole | 学校 |"
        self.assertEqual(host._accent_source_of("À pied", source), "A pied")
        self.assertEqual(host._accent_source_of("École", source), "Ecole")

    def test_source_lookup_stays_quiet_otherwise(self):
        self.assertEqual(host._accent_source_of("À pied", "À pied et A pied"), "")  # copied as is
        self.assertEqual(host._accent_source_of("A pied", "À pied"), "")  # lost an accent
        self.assertEqual(host._accent_source_of("je parle", "| je | parle |"), "")  # rebuilt line


class AnalysisFieldTests(unittest.TestCase):
    def test_reported_fix_is_kept(self):
        raw = analysis_reply(sentence="À pied", accent_fixed_from="A pied")
        s = parse(raw, "A pied")[0]
        self.assertEqual((s["sentence"], s["original"]), ("À pied", "À pied"))
        self.assertEqual(s["accent_fixed_from"], "A pied")

    def test_unreported_fix_is_found_in_the_source(self):
        s = parse(analysis_reply(sentence="À l'heure"), "A l'heure\nA Paris")[0]
        self.assertEqual(s["accent_fixed_from"], "A l'heure")

    def test_no_field_without_a_fix(self):
        for fields in ({"sentence": "À pied"}, {"sentence": "À pied", "accent_fixed_from": ""}):
            with self.subTest(fields=fields):
                self.assertNotIn("accent_fixed_from", parse(analysis_reply(**fields), "À pied")[0])

    def test_the_verb_a_is_left_alone(self):
        s = parse(analysis_reply(sentence="A-t-il fini ?"), "A-t-il fini ?")[0]
        self.assertEqual(s["sentence"], "A-t-il fini ?")
        self.assertNotIn("accent_fixed_from", s)

    def test_a_claim_that_is_not_about_accents_gives_no_note(self):
        raw = analysis_reply(sentence="À pied !", accent_fixed_from="A pied")
        self.assertNotIn("accent_fixed_from", parse(raw, "A pied")[0])

    def test_option_label_is_dropped_from_the_note_too(self):
        raw = analysis_reply(sentence="A. À pied", accent_fixed_from="A. A pied")
        s = parse(raw, "A. A pied")[0]
        self.assertEqual((s["label"], s["sentence"]), ("A", "À pied"))
        self.assertEqual(s["accent_fixed_from"], "A pied")

    def test_legacy_shape_gets_the_field(self):
        raw = json.dumps({"sentences": [{"sentence": "À pied", "accent_fixed_from": "A pied", "tokens": []}]})
        s = parse(raw, "A pied")[0]
        self.assertEqual(s["schemaVersion"], 1)
        self.assertEqual(s["accent_fixed_from"], "A pied")

    def test_endpoint_returns_the_field(self):
        reply = analysis_reply(sentence="À Paris", accent_fixed_from="A Paris")
        with chat_reply(reply):
            r = TestClient(host.app).post("/api/analyze", json={"text": "A Paris"}, headers=testenv.session_headers())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["sentences"][0]["accent_fixed_from"], "A Paris")


class ExtractionFieldTests(unittest.TestCase):
    def test_photo_item_carries_the_original_only_when_fixed(self):
        reply = {
            "items": [
                {"kind": "sentence", "fr": "À pied", "gloss": "", "accent_fixed_from": "A pied"},
                {"kind": "sentence", "fr": "Je parle.", "gloss": "", "accent_fixed_from": ""},
                {"kind": "sentence", "fr": "A vélo", "gloss": "", "accent_fixed_from": "A velo mais"},
            ]
        }
        with chat_reply(json.dumps(reply, ensure_ascii=False)):
            r = TestClient(host.app).post("/api/photo-extract", json={"image": PHOTO}, headers=testenv.session_headers())
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["text"], "À pied\nJe parle.\nA vélo")
        self.assertEqual(data["items"][0]["accent_fixed_from"], "A pied")
        self.assertNotIn("accent_fixed_from", data["items"][1])
        self.assertNotIn("accent_fixed_from", data["items"][2])

    def test_clean_input_reports_the_fixed_lines(self):
        lesson = "## 选项\n- A pied\n- A l'heure\n- Je parle.\n"
        with chat_reply("À pied\nÀ l'heure\nJe parle.\n"):
            r = TestClient(host.app).post("/api/clean-input", json={"text": lesson}, headers=testenv.session_headers())
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["cleaned"], "À pied\nÀ l'heure\nJe parle.")
        self.assertEqual(
            data["accent_fixes"],
            [
                {"fr": "À pied", "accent_fixed_from": "A pied"},
                {"fr": "À l'heure", "accent_fixed_from": "A l'heure"},
            ],
        )

    def test_clean_input_shape_is_unchanged_without_a_fix(self):
        with chat_reply("Je parle.\n"):
            r = TestClient(host.app).post("/api/clean-input", json={"text": "## 例句\nJe parle."}, headers=testenv.session_headers())
        self.assertEqual(r.json(), {"cleaned": "Je parle.", "count": 1, "changed": True})


class AccentPageTests(unittest.TestCase):
    def test_note_is_wired_through_the_study_page(self):
        js = (ROOT / "static/study.js").read_text(encoding="utf-8")
        css = (ROOT / "static/study.css").read_text(encoding="utf-8")
        self.assertEqual(js.count("accentFixedNote:"), 2)  # English and Chinese
        self.assertIn("accentFixedFrom: s.accent_fixed_from", js)
        self.assertIn("${accentNoteHtml(accentFixedFrom, sentenceText)}", js)
        self.assertIn("withAccentNotes(results.flat(), accentFixes)", js)
        self.assertIn("accentFixes: data.accent_fixes || []", js)
        self.assertIn(".filter(item => item.accent_fixed_from)", js)
        self.assertIn(".sentence-accent-note {", css)

    def test_note_rendering_in_node(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is needed")
        result = subprocess.run([node, "tests/test_accent_fix.cjs"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
