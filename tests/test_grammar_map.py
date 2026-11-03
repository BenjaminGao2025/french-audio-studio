import testenv  # noqa: F401
import contextlib
import io
import json
import pathlib
import re
import shutil
import subprocess
import unittest
import uuid

from fastapi.testclient import TestClient

import auth_db
import grammar
import tts_service

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIELDS = ("id", "block", "zh", "fr", "en", "explain_zh", "level", "focus")


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def _user():
    u = auth_db.register_user(f"g_{uuid.uuid4().hex[:12]}@example.com", "password123")
    return u["user"]["id"], {"Authorization": f"Bearer {u['token']}"}


def _analysis(sentence, structure=None, grammar_ids=None):
    s = {"schemaVersion": 2, "sentence": sentence, "words": [{"fr": "Tu"}],
         "grammar_points": [{"title": "pouvoir", "explanation": "can", "hook": "h"}]}
    if structure is not None:
        s["structure"] = structure
    if grammar_ids is not None:
        s["grammar_ids"] = grammar_ids
    return tts_service._parse_analysis_json(json.dumps({"sentences": [s]}), sentence)["sentences"][0]


class InventoryTests(unittest.TestCase):
    def test_inventory_is_valid(self):
        data = json.loads(_read("data/grammar_inventory.json"))
        points = data["points"]
        self.assertTrue(60 <= len(points) <= 80, len(points))
        ids = [p["id"] for p in points]
        self.assertEqual(len(ids), len(set(ids)), "ids are unique")
        self.assertEqual(set(data["blocks"]), {"N", "V", "S"})
        for p in points:
            with self.subTest(gid=p["id"]):
                self.assertEqual(set(p), set(FIELDS))
                self.assertIn(p["block"], ("N", "V", "S"))
                self.assertTrue(p["id"].startswith(p["block"] + "."), "id starts with its block")
                self.assertRegex(p["id"], r"^[NVS](\.[a-z_]+)+$")
                self.assertIn(p["level"], ("A1", "A2", "B1"))
                self.assertIsInstance(p["focus"], bool)
                for field in ("zh", "fr", "en", "explain_zh"):
                    self.assertIsInstance(p[field], str)
                    self.assertTrue(p[field].strip(), field)
                self.assertNotIn("\n", p["explain_zh"], "one line")
                # Focus means présent and passé composé
                self.assertEqual(p["focus"], p["id"].startswith(("V.present.", "V.pc.")))
        for block in ("N", "V", "S"):
            self.assertGreaterEqual(sum(p["block"] == block for p in points), 15, block)
        for gid in ("N.article.partitive", "V.present.er", "V.pc.etre", "S.neg.ne_pas"):
            self.assertIn(gid, grammar.BY_ID)


class StructureValidationTests(unittest.TestCase):
    def test_valid_gid(self):
        self.assertEqual(grammar.valid_gid(" V.present.pouvoir "), "V.present.pouvoir")
        for bad in ("V.present.nope", "", None, 3, ["V.present.er"], "v.present.er"):
            self.assertIsNone(grammar.valid_gid(bad), bad)

    def test_structure_is_normalized(self):
        s = _analysis("Tu peux m'aider ?", structure=[
            {"text": "Tu", "block": "N", "role": "主语代词", "detail": "tu", "gid": "N.pronoun.subject"},
            {"text": "peux", "block": "v", "role": "情态动词", "detail": "pouvoir · tu · 直陈式现在时", "gid": "V.present.pouvoir"},
            {"text": "m’", "block": "N", "gid": "N.invented"},  # typographic apostrophe, unknown gid
            {"text": "aider", "block": "X", "gid": "V.verb_infinitive"},  # invalid block: dropped
            {"text": "voiture", "block": "N"},  # not in the sentence: dropped
            {"block": "S"}, "junk", None,
            {"text": "?", "block": "S", "role": "x" * 500, "detail": "<b>ok</b>", "gid": "S.question.intonation"},
        ], grammar_ids=["V.present.pouvoir", "made.up", 7, "V.present.pouvoir", "S.neg.ne_pas"])
        spans = s["structure"]
        self.assertEqual([sp["text"] for sp in spans], ["Tu", "peux", "m’", "?"])
        self.assertEqual([sp["block"] for sp in spans], ["N", "V", "N", "S"])
        self.assertIsNone(spans[2]["gid"])
        self.assertNotIn("gid_zh", spans[2])
        self.assertEqual(spans[1]["gid_zh"], grammar.BY_ID["V.present.pouvoir"]["zh"])
        self.assertEqual(spans[2]["role"], "")
        self.assertEqual(len(spans[3]["role"]), grammar.MAX_ROLE)
        self.assertEqual(spans[3]["detail"], "<b>ok</b>", "kept as text; the page escapes it")
        # Unknown ids dropped, duplicates removed, span ids added after the listed ones
        self.assertEqual(s["grammar_ids"], ["V.present.pouvoir", "S.neg.ne_pas", "N.pronoun.subject", "S.question.intonation"])
        # grammar_points stay as they were
        self.assertEqual(s["grammar_points"], [{"title": "pouvoir", "explanation": "can", "hook": "h"}])

    def test_missing_or_broken_structure_is_fine(self):
        for structure, ids in ((None, None), ("nope", "nope"), ({"text": "Tu"}, {"a": 1})):
            s = _analysis("Tu peux.", structure=structure, grammar_ids=ids)
            self.assertEqual(s["structure"], [])
            self.assertEqual(s["grammar_ids"], [])
        too_many = [{"text": "Tu", "block": "N"}] * 100
        self.assertEqual(len(_analysis("Tu peux.", structure=too_many)["structure"]), grammar.MAX_SPANS)

    def test_prompt_lists_the_inventory_and_examples_use_real_ids(self):
        prompt = tts_service._analyze_payload(tts_service.AnalyzeRequest(text="Tu peux m'aider ?"))["messages"][0]["content"]
        self.assertIn('"structure"', prompt)
        self.assertIn('"grammar_ids"', prompt)
        self.assertIn("Never invent an id.", prompt)
        for gid in grammar.BY_ID:
            self.assertIn(gid, prompt)
        used = set(re.findall(r'"gid": "([^"]+)"', prompt)) | {
            gid for ids in re.findall(r'"grammar_ids": \[([^\]]*)\]', prompt) for gid in re.findall(r'"([^"]+)"', ids)}
        self.assertTrue(used)
        self.assertEqual(used - set(grammar.BY_ID), set(), "examples only use inventory ids")
        # The grammar_points rules stay
        self.assertIn("Grammar points:\n- 1–3 points", prompt)

    def test_hits_from_sentences(self):
        sentences = [
            {"sentence": "Tu  peux.", "grammar_ids": ["V.present.pouvoir", "bogus"], "structure": [{"gid": "N.pronoun.subject"}, "x"]},
            {"sentence": "", "grammar_ids": ["V.present.er"]},
            {"sentence": "Old analysis without ids."},
            "junk",
        ]
        self.assertEqual(grammar.hits_from_sentences(sentences),
                         [("V.present.pouvoir", "Tu peux."), ("N.pronoun.subject", "Tu peux.")])
        self.assertEqual(grammar.hits_from_sentences(None), [])


class GrammarHitsTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_hits_are_deduplicated_per_user_and_sentence(self):
        uid, _ = _user()
        other, _ = _user()
        hits = [("V.present.pouvoir", "Tu peux m'aider ?"), ("S.question.intonation", "Tu peux m'aider ?")]
        self.assertEqual(auth_db.record_grammar_hits(uid, hits, "hist_1"), 2)
        self.assertEqual(auth_db.record_grammar_hits(uid, hits, "hist_2"), 0, "same sentence again: ignored")
        self.assertEqual(auth_db.record_grammar_hits(uid, [("V.present.pouvoir", "Je peux venir.")]), 1)
        self.assertEqual(auth_db.record_grammar_hits(other, hits), 2, "another user counts separately")
        self.assertEqual(auth_db.record_grammar_hits(uid, []), 0)
        self.assertEqual(auth_db.grammar_hit_counts(uid), {"V.present.pouvoir": 2, "S.question.intonation": 1})
        rows = auth_db.grammar_hit_sentences(uid, "V.present.pouvoir")
        self.assertEqual({r["sentence"] for r in rows}, {"Tu peux m'aider ?", "Je peux venir."})
        self.assertIn("hist_1", {r["history_id"] for r in rows}, "the first save keeps its history id")
        self.assertIn(None, {r["history_id"] for r in rows})

    def test_table_is_additive(self):
        with auth_db.connect() as conn:
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(grammar_hits)")]
            indexes = {r["name"]: r["unique"] for r in conn.execute("PRAGMA index_list(grammar_hits)")}
            history_cols = [r["name"] for r in conn.execute("PRAGMA table_info(history_records)")]
        self.assertEqual(cols, ["id", "user_id", "gid", "sentence_text", "history_id", "ts"])
        self.assertEqual(indexes.get("idx_grammar_hits_unique"), 1)
        self.assertEqual(history_cols, ["id", "user_id", "record_type", "text", "payload_json", "created_at"])
        schema = _read("auth_db.py")
        self.assertIn("CREATE TABLE IF NOT EXISTS grammar_hits", schema)
        self.assertIn("INSERT OR IGNORE INTO grammar_hits", schema)
        self.assertNotIn("ALTER TABLE", schema)

    def test_saving_study_history_records_hits(self):
        uid, auth = _user()
        sentence = _analysis("Tu peux m'aider ?", structure=[
            {"text": "peux", "block": "V", "gid": "V.present.pouvoir"}], grammar_ids=["S.question.intonation", "nope"])
        old = {"schemaVersion": 2, "sentence": "Bonjour.", "grammar_points": []}  # history from before this feature
        payload = {"id": "hist_study_1", "type": "study", "sentences": [sentence, old]}
        res = self.client.post("/api/history", headers=auth, json={"id": "hist_study_1", "type": "study", "text": "Tu peux m'aider ?", "payload": payload})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(auth_db.grammar_hit_counts(uid), {"S.question.intonation": 1, "V.present.pouvoir": 1})
        self.assertEqual(auth_db.grammar_hit_sentences(uid, "V.present.pouvoir")[0]["history_id"], "hist_study_1")
        # Saving it again (or restoring) does not count it twice; tts records never count
        self.client.post("/api/history", headers=auth, json={"id": "hist_study_2", "type": "study", "text": "Tu peux m'aider ?", "payload": payload})
        self.client.post("/api/history", headers=auth, json={"id": "tts_1", "type": "tts", "text": "x", "payload": {"sentences": [{"sentence": "Je vais.", "grammar_ids": ["V.present.aller"]}]}})
        self.assertEqual(auth_db.grammar_hit_counts(uid), {"S.question.intonation": 1, "V.present.pouvoir": 1})
        # A malformed payload never breaks saving history
        res = self.client.post("/api/history", headers=auth, json={"id": "hist_study_3", "type": "study", "text": "y", "payload": {"sentences": "oops"}})
        self.assertEqual(res.status_code, 200)


class GrammarPageTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_page_is_served_like_the_other_pages(self):
        res = self.client.get("/grammar")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["Content-Security-Policy"], tts_service.CONTENT_SECURITY_POLICY)
        self.assertIn("no-store", res.headers["Cache-Control"])
        html = res.text
        v = tts_service.ASSET_VERSION
        for asset in ("grammar.js", "grammar.css", "i18n.js", "tokens.css", "header-ui.js"):
            self.assertIn(f"/static/{asset}?v={v}", html)
        self.assertNotIn("__ASSET_VERSION__", html)
        self.assertNotIn("<script>", html, "no inline scripts (CSP)")
        self.assertIn('href="/coach" class="nav-tab', html)
        self.assertIn('href="/grammar" class="nav-tab active" aria-current="page"', html)
        self.assertIn('id="grammar-login"', html)
        self.assertIn("'/grammar'", _read("static/sw.js"))

    def test_study_links_to_the_grammar_map(self):
        self.assertIn('href="/grammar" class="nav-tab"', _read("static/study.html"))
        self.assertIn("'/listen', '/grammar', '/'", _read("static/header-ui.js"))
        js = _read("static/study.js")
        self.assertIn("navGrammar: 'Grammar map'", js)
        self.assertIn("navGrammar: '语法地图'", js)

    def test_api_requires_login(self):
        self.assertEqual(self.client.get("/api/grammar/map").status_code, 401)
        self.assertEqual(self.client.get("/api/grammar/V.present.er/sentences").status_code, 401)
        bad = {"Authorization": "Bearer nope"}
        self.assertEqual(self.client.get("/api/grammar/map", headers=bad).status_code, 401)

    def test_map_counts_and_sentences_are_per_user(self):
        uid, auth = _user()
        other, other_auth = _user()
        auth_db.record_grammar_hits(uid, [("V.present.pouvoir", "Tu peux m'aider ?"), ("V.present.pouvoir", "<b>Je peux.</b>"), ("N.gender", "La table.")])
        auth_db.record_grammar_hits(other, [("S.neg.ne_pas", "Je ne sais pas.")])
        data = self.client.get("/api/grammar/map", headers=auth).json()
        self.assertEqual([b["id"] for b in data["blocks"]], ["N", "V", "S"])
        self.assertEqual([b["zh"] for b in data["blocks"]], ["名词组", "动词", "句子怎么组织"])
        self.assertEqual(sum(len(b["points"]) for b in data["blocks"]), len(grammar.POINTS))
        self.assertEqual(data["seen"], 2)
        counts = {p["id"]: p["count"] for b in data["blocks"] for p in b["points"]}
        self.assertEqual(counts["V.present.pouvoir"], 2)
        self.assertEqual(counts["N.gender"], 1)
        self.assertEqual(counts["S.neg.ne_pas"], 0, "another user's hits never show")
        verbs = data["blocks"][1]["points"]
        focus = [p["focus"] for p in verbs]
        self.assertEqual(focus, sorted(focus, reverse=True), "focus points first")
        self.assertTrue(focus[0])

        res = self.client.get("/api/grammar/V.present.pouvoir/sentences", headers=auth).json()
        self.assertEqual(res["point"]["id"], "V.present.pouvoir")
        self.assertEqual({s["sentence"] for s in res["sentences"]}, {"Tu peux m'aider ?", "<b>Je peux.</b>"})
        self.assertEqual(self.client.get("/api/grammar/S.neg.ne_pas/sentences", headers=auth).json()["sentences"], [])
        self.assertEqual(self.client.get("/api/grammar/V.nope/sentences", headers=auth).status_code, 404)

    def test_grammar_page_escapes_what_it_renders(self):
        js = _read("static/grammar.js")
        self.assertIn("escapeHtml(s.sentence)", js)
        self.assertIn("escapeHtml(point.explain_zh)", js)
        self.assertIn("escapeHtml(pick(p.zh, p.en))", js)
        self.assertIn("encodeURIComponent(btn.dataset.gid)", js)


class StudyMarkupTests(unittest.TestCase):
    def test_sentence_header_has_a_repeat_switch(self):
        # Short sentences (<= 5 words) have no build-up steps, so the header carries Repeat itself
        js = _read("static/study.js")
        head = js.split("function sentenceHeadHtml(")[1].split("\n    }\n")[0]
        self.assertIn("window.FrenchPlayback.toggleHtml('btn-step-repeat btn-head-repeat')", head)
        self.assertLess(head.index("btn-speak-round"), head.index("btn-head-repeat"), "right after Listen")
        handler = js.split("// 1b. Sentence Repeat")[1].split("// 2. Token Pronunciation Buttons")[0]
        self.assertIn("card.querySelector('.btn-head-repeat')", handler)
        self.assertIn("window.FrenchPlayback.repeat()) playFrenchSpeech(targetSentence)", handler)
        self.assertIn("setTimeout(", handler, "reads the setting after playback.js has flipped it")
        css = _read("static/study.css")
        self.assertIn(".sentence-head-actions .btn-repeat-toggle.btn-head-repeat", css)
        self.assertIn(".sentence-card:not(.is-open) .btn-head-repeat { display: none; }", css)

    def test_structure_bar_is_wired_into_the_sentence_body(self):
        js = _read("static/study.js")
        body = js.split("const bodyHtml = `")[1].split("`;")[0]
        self.assertLess(body.index("${structureBarHtml(s.structure)}"), body.index('class="card-tabs-bar"'), "above the tabs")
        self.assertIn("bindStructureBar(card, s.structure);", js)
        for text in ("structureBlock: { N: 'Noun group', V: 'Verb', S: 'Sentence building' }",
                     "structureBlock: { N: '名词组', V: '动词', S: '句子怎么组织' }"):
            self.assertIn(text, js)
        bar = js.split("function structureBarHtml(structure) {")[1].split("\n    }\n")[0]
        self.assertIn("escapeHtml(span.text)", bar)
        self.assertIn('<button class="structure-span" type="button"', bar)
        css = _read("static/study.css")
        for token in ("--grammar-n", "--grammar-v", "--grammar-s"):
            self.assertIn(f"var({token})", css)
            self.assertEqual(_read("static/tokens.css").count(f"{token}:"), 2, "light and dark")

    def test_structure_and_grammar_map_in_jsdom(self):
        node = shutil.which("node")
        if not node or not (ROOT / "frontend/node_modules/jsdom").exists():
            self.skipTest("node and the frontend's jsdom are needed")
        result = subprocess.run([node, "tests/test_grammar_structure.cjs"], cwd=ROOT, capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class BackfillScriptTests(unittest.TestCase):
    def test_backfill_is_a_dry_run_by_default(self):
        source = _read("scripts/backfill_grammar_hits.py")
        self.assertIn("Dry run by default", source)
        self.assertIn('add_argument("--apply", action="store_true"', source)
        self.assertIn("mode=ro", source)

    def test_backfill_dry_run_then_apply(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("backfill_grammar_hits", ROOT / "scripts/backfill_grammar_hits.py")
        backfill = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backfill)
        uid, _ = _user()
        email = auth_db.get_user_status(uid)["email"]
        record = {"sentences": [{"sentence": "Je vais au cinéma.", "grammar_ids": ["V.present.aller", "N.article.contraction"]}]}
        auth_db.save_history_record("hist_backfill", "study", "Je vais au cinéma.", record, uid)
        def run(*args):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                backfill.main(["--user", email, *args])
            return out.getvalue()
        self.assertIn("Dry run: nothing written.", run())
        self.assertEqual(auth_db.grammar_hit_counts(uid), {}, "dry run writes nothing")
        self.assertIn("Added 2 new hits.", run("--apply"))
        self.assertEqual(auth_db.grammar_hit_counts(uid), {"V.present.aller": 1, "N.article.contraction": 1})
        self.assertIn("Added 0 new hits.", run("--apply"))
        self.assertEqual(auth_db.grammar_hit_sentences(uid, "V.present.aller")[0]["history_id"], "hist_backfill")


if __name__ == "__main__":
    unittest.main()
