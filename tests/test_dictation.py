"""Dictation (默写 / 听写): local grading, server-derived targets, per-user history and the optional AI review."""

import json
import pathlib
import sqlite3
import unittest
import uuid
from unittest import mock

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth_db
import dictation
import tts_service
import web_common

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "dictation_cases.json").read_text(encoding="utf-8"))

SENTENCE = "Les autorités canadiennes n'autorisent aucune dispense."
TRANSLATION = "The Canadian authorities authorize no exemption."
BUILD_UP = [
    {"fr": "Les autorités autorisent.", "en": "The authorities authorize.", "new": "Trunk: who + does what."},
    {"fr": "Les autorités canadiennes autorisent.", "en": "", "new": "canadiennes = Canadian."},
    {"fr": SENTENCE, "en": "", "new": "aucune = no / not any."},
]


def _session() -> tuple[int, dict]:
    reg = auth_db.register_user(f"dict_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


def _kinds(result):
    return [(op["kind"], op["expected"], op["actual"]) for op in result["ops"]]


class TokenizeTests(unittest.TestCase):
    def test_elision_splits_and_one_word_exceptions(self):
        words = [
            t["text"] for t in dictation.tokenize("« Lorsqu'il arrive, jusqu'à l'aube » quelqu'un dit aujourd'hui")
        ]
        self.assertEqual(
            words, ["Lorsqu'", "il", "arrive", "jusqu'", "à", "l'", "aube", "quelqu'un", "dit", "aujourd'hui"]
        )

    def test_typographic_apostrophes_normalize(self):
        self.assertEqual([t["norm"] for t in dictation.tokenize("J’ai d‘abord")], ["j'", "ai", "d'", "abord"])

    def test_elided_word_before_a_space_keeps_its_apostrophe(self):
        self.assertEqual([t["norm"] for t in dictation.tokenize("qu' il")], ["qu'", "il"])

    def test_quotes_and_punctuation_are_not_words(self):
        self.assertEqual([t["norm"] for t in dictation.tokenize("'Bonjour' — dit-il… !")], ["bonjour", "dit", "il"])

    def test_fixture_tokens(self):
        for case in FIXTURES["tokenize"]:
            tokens = dictation.tokenize(case["text"])
            self.assertEqual([t["text"] for t in tokens], case["tokens"], case["text"])
            self.assertEqual([t["norm"] for t in tokens], case["norms"], case["text"])


class GradeTests(unittest.TestCase):
    def test_case_punctuation_and_spacing_ignored(self):
        result = dictation.grade("Bonjour, Marie !", "  bonjour   MARIE ")
        self.assertTrue(result["correct"])
        self.assertEqual(result["accuracy"], 100)

    def test_typographic_apostrophe_counts_as_correct(self):
        self.assertTrue(dictation.grade("J'ai faim.", "J’ai faim")["correct"])

    def test_accent_mistake_is_its_own_kind_with_partial_credit(self):
        result = dictation.grade("Il a été là.", "il a ete la")
        self.assertEqual(_kinds(result)[2:], [("accent", "été", "ete"), ("accent", "là", "la")])
        self.assertEqual(result["counts"]["accent"], 2)
        self.assertEqual(result["counts"]["wrong"], 0)
        self.assertEqual(result["accuracy"], round(100 * (2 + 2 * dictation.ACCENT_CREDIT) / 4))
        self.assertTrue(result["accent_only"])
        self.assertFalse(result["correct"])

    def test_accent_scores_above_a_wrong_word_and_below_correct(self):
        accent = dictation.grade("Ça va.", "ca va")["accuracy"]
        wrong = dictation.grade("Ça va.", "la va")["accuracy"]
        self.assertGreater(accent, wrong)
        self.assertLess(accent, 100)

    def test_missing_apostrophe_is_minor(self):
        self.assertEqual(_kinds(dictation.grade("L'homme est là.", "l homme est là"))[0], ("accent", "L'", "l"))

    def test_merged_elision_is_a_missing_apostrophe_not_a_wrong_word(self):
        result = dictation.grade("J'ai faim.", "jai faim")
        self.assertEqual(_kinds(result), [("accent", "J'", "j"), ("ok", "ai", "ai"), ("ok", "faim", "faim")])

    def test_one_word_elision_exception(self):
        self.assertTrue(dictation.grade("Aujourd'hui, il fait beau.", "aujourd’hui il fait beau")["correct"])
        self.assertEqual(dictation.grade("Aujourd'hui", "aujourdhui")["counts"]["accent"], 1)

    def test_ligature_and_hyphen(self):
        self.assertTrue(dictation.grade("C'est un œuf.", "c'est un oeuf")["correct"])
        self.assertTrue(dictation.grade("Est-ce que tu viens ?", "est ce que tu viens")["correct"])

    def test_missing_extra_and_wrong_words(self):
        missing = dictation.grade("Je suis très content.", "je suis content")
        self.assertEqual(missing["counts"]["missing"], 1)
        self.assertIn(("missing", "très", ""), _kinds(missing))
        extra = dictation.grade("Je suis content.", "je suis très très content")
        self.assertEqual(extra["counts"]["extra"], 2)
        self.assertEqual(extra["accuracy"], 60)  # 3 right out of 3 expected + 2 extra
        wrong = dictation.grade(SENTENCE, "les autorités canadiennes n'autorisent pas dispense")
        self.assertIn(("wrong", "aucune", "pas"), _kinds(wrong))

    def test_empty_answer_misses_every_word(self):
        result = dictation.grade("Merci beaucoup.", " … ")
        self.assertEqual(result["accuracy"], 0)
        self.assertEqual(result["counts"]["missing"], 2)

    def test_fixture_results(self):
        self.assertEqual(FIXTURES["accent_credit"], dictation.ACCENT_CREDIT)
        for case in FIXTURES["grade"]:
            self.assertEqual(dictation.grade(case["expected"], case["answer"]), case["result"], case["name"])


class PunctuationTests(unittest.TestCase):
    """Sentence punctuation is never a mistake; apostrophes inside a word are spelling."""

    def test_joyeux_noel_is_an_accent_mistake_only(self):
        result = dictation.grade("Joyeux Noël !", "Joyeux Nöel")
        self.assertEqual([op["kind"] for op in result["ops"]], ["ok", "accent"])
        self.assertTrue(result["accent_only"])
        self.assertNotIn("!", [op["expected"] for op in result["ops"]])

    def test_a_missing_final_mark_is_fully_correct(self):
        for answer in ("Joyeux Noël", "Joyeux Noël!", "joyeux noël .", "« Joyeux Noël »"):
            self.assertTrue(dictation.grade("Joyeux Noël !", answer)["correct"], answer)

    def test_quotes_guillemets_and_marks_never_count(self):
        expected = "« Oui », dit-il ; puis : “Non, merci.” Tu viens ? Oui !"
        answer = 'Oui dit-il puis "Non merci" tu viens oui'
        result = dictation.grade(expected, answer)
        self.assertTrue(result["correct"])
        self.assertEqual(result["accuracy"], 100)

    def test_quote_apostrophe_before_an_elision_is_punctuation(self):
        self.assertEqual([t["text"] for t in dictation.tokenize("'J'ai faim'")], ["J'", "ai", "faim"])
        self.assertTrue(dictation.grade("« J'ai faim », dit-il.", "'J'ai faim', dit-il")["correct"])

    def test_elision_apostrophes_are_still_spelling(self):
        self.assertEqual([k for k, _, _ in _kinds(dictation.grade("J'ai faim.", "jai faim"))], ["accent", "ok", "ok"])
        self.assertTrue(dictation.grade("L'homme est là ?", "l’homme est là")["correct"])
        self.assertEqual(_kinds(dictation.grade("L'homme est là.", "le homme est là"))[0], ("wrong", "L'", "le"))

    def test_ai_prompt_says_punctuation_is_not_a_mistake(self):
        system = dictation.ai_payload("m", "write", "Joyeux Noël !", "Joyeux Nöel", "Merry Christmas!")["messages"][0]
        self.assertIn("punctuation is never graded", system["content"])
        self.assertIn("apostrophe inside a word", system["content"])

    def test_ai_points_about_punctuation_only_are_dropped(self):
        reply = {
            "summary": "只差重音。",
            "points": [
                {"wrong": "Joyeux Noël", "right": "Joyeux Noël !", "why": "少了感叹号"},
                {"wrong": "« Oui »", "right": '"Oui"', "why": "引号"},
                {"wrong": "Nöel", "right": "Noël", "why": "重音放错了"},
                {"wrong": "jai", "right": "j'ai", "why": "省音要写撇号"},
            ],
            "tip": "",
        }
        feedback = dictation.parse_ai_feedback(json.dumps(reply, ensure_ascii=False))
        self.assertEqual([p["right"] for p in feedback["points"]], ["Noël", "j'ai"])


class TargetTests(unittest.TestCase):
    def _item(self, translation=TRANSLATION, steps=None):
        return {"sentence": SENTENCE, "translation_en": translation, "steps": BUILD_UP if steps is None else steps}

    def test_step_prompts_are_the_step_english(self):
        found = dictation.targets(self._item())
        self.assertEqual([t["step"] for t in found], [0, 1, 2, 3])
        self.assertEqual(found[0]["prompt_en"], TRANSLATION)
        self.assertEqual(found[1]["prompt_en"], "The authorities authorize.")
        self.assertEqual(found[1]["expected"], "Les autorités autorisent.")

    def test_step_without_english_never_borrows_the_sentence_translation(self):
        found = dictation.targets(self._item())
        self.assertEqual(found[2]["prompt_en"], "")  # a partial step: no prompt rather than the wrong one
        self.assertEqual(found[3]["prompt_en"], TRANSLATION)  # the last step is the whole sentence

    def test_whole_sentence_prompt_falls_back_to_last_step_english(self):
        steps = [dict(BUILD_UP[0]), {"fr": SENTENCE, "en": "No exemption, say the authorities.", "new": ""}]
        self.assertEqual(dictation.targets(self._item(translation="", steps=steps))[0]["prompt_en"], steps[1]["en"])
        self.assertEqual(dictation.targets(self._item(translation="", steps=[]))[0]["prompt_en"], "")

    def test_out_of_range_step(self):
        self.assertIsNone(dictation.target_for(self._item(), 4))
        self.assertIsNone(dictation.target_for(self._item(), -1))


class SchemaTests(unittest.TestCase):
    def test_migration_is_idempotent_and_additive(self):
        with auth_db.connect() as conn:
            before = {
                r["name"]: r["sql"]
                for r in conn.execute("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'dictation%'")
            }
            users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            dictation._create_tables(conn)
            dictation._create_tables(conn)  # a second run (another process, a restart) changes nothing
            after = {
                r["name"]: r["sql"]
                for r in conn.execute("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'dictation%'")
            }
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0], users)
        self.assertEqual(before, after)
        self.assertTrue({"dictation_items", "dictation_attempts", "dictation_ai_cache"} <= tables)

    def test_migration_on_a_fresh_file(self):
        path = pathlib.Path(web_common.OUTPUT_DIR) / f"fresh-{uuid.uuid4().hex}.db"
        conn = sqlite3.connect(path)
        try:
            dictation._create_tables(conn)
            dictation._create_tables(conn)
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        finally:
            conn.close()
            path.unlink()


class ItemStorageTests(unittest.TestCase):
    def test_same_content_returns_the_same_item(self):
        user_id, _ = _session()
        first = dictation.register_item(user_id, SENTENCE, TRANSLATION, BUILD_UP)
        again = dictation.register_item(user_id, SENTENCE, TRANSLATION, BUILD_UP)
        self.assertEqual(first["id"], again["id"])
        other_user, _ = _session()
        self.assertNotEqual(dictation.register_item(other_user, SENTENCE, TRANSLATION, BUILD_UP)["id"], first["id"])

    def test_single_step_build_up_means_no_steps(self):
        user_id, _ = _session()
        item = dictation.register_item(user_id, SENTENCE, TRANSLATION, [{"fr": SENTENCE, "en": "", "new": ""}])
        self.assertEqual(item["steps"], [])

    def test_control_characters_are_cleaned(self):
        user_id, _ = _session()
        item = dictation.register_item(user_id, "Bonjour\u0000 tout\n le monde‮ !", "", [])
        self.assertEqual(item["sentence"], "Bonjour tout le monde !")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user_id, self.headers = _session()

    def _register(self, headers=None, **overrides):
        body = {"sentence": SENTENCE, "translation_en": TRANSLATION, "build_up": BUILD_UP, **overrides}
        return self.client.post("/api/dictation/items", headers=headers or self.headers, json=body)

    def _attempt(self, item_id, answer, mode="write", step=0, headers=None):
        return self.client.post(
            "/api/dictation/attempts",
            headers=headers or self.headers,
            json={"item_id": item_id, "mode": mode, "step": step, "answer": answer},
        )

    def test_every_route_needs_a_session(self):
        item_id = "0" * 32
        for method, url, body in (
            ("post", "/api/dictation/items", {"sentence": SENTENCE}),
            ("get", f"/api/dictation/items/{item_id}", None),
            ("post", "/api/dictation/attempts", {"item_id": item_id, "mode": "write", "answer": "x"}),
            ("get", f"/api/dictation/attempts?item_id={item_id}&mode=write", None),
            ("post", f"/api/dictation/attempts/{item_id}/ai", None),
        ):
            res = getattr(self.client, method)(url, json=body) if body else getattr(self.client, method)(url)
            self.assertEqual(res.status_code, 401, url)

    def test_item_response_carries_prompts_but_no_french(self):
        res = self._register()
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["has_steps"])
        self.assertEqual([t["step"] for t in data["targets"]], [0, 1, 2, 3])
        self.assertEqual([t["has_prompt"] for t in data["targets"]], [True, True, False, True])
        text = json.dumps(data, ensure_ascii=False)
        for french in ("autorités", "canadiennes", "autorisent", "aucune", "dispense", "Trunk"):
            self.assertNotIn(french, text)
        self.assertEqual(data["summary"]["write"]["0"]["attempts"], 0)

    def test_attempt_is_graded_against_the_server_target(self):
        item_id = self._register().json()["item_id"]
        res = self._attempt(item_id, "Les autorités autorisent", step=1)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["correct"])
        self.assertTrue(data["saved"])
        self.assertEqual(data["expected"], "Les autorités autorisent.")
        self.assertEqual(data["note"], "Trunk: who + does what.")
        self.assertEqual(data["summary"]["attempts"], 1)
        # The whole-sentence target is a different answer
        self.assertFalse(self._attempt(item_id, "Les autorités autorisent", step=0).json()["correct"])

    def test_spoofed_targets_and_user_ids_are_rejected(self):
        item_id = self._register().json()["item_id"]
        for extra in ({"expected": "x"}, {"user_id": 1}, {"sentence": "x"}, {"target": "x"}):
            res = self.client.post(
                "/api/dictation/attempts",
                headers=self.headers,
                json={"item_id": item_id, "mode": "write", "step": 0, "answer": "x", **extra},
            )
            self.assertEqual(res.status_code, 422, extra)
        res = self._register(user_id=1)
        self.assertEqual(res.status_code, 422)

    def test_items_and_attempts_are_isolated_per_user(self):
        item_id = self._register().json()["item_id"]
        attempt_id = self._attempt(item_id, "les autorités").json()["attempt_id"]
        _, intruder = _session()
        self.assertEqual(self.client.get(f"/api/dictation/items/{item_id}", headers=intruder).status_code, 404)
        self.assertEqual(self._attempt(item_id, SENTENCE, headers=intruder).status_code, 404)
        res = self.client.get(f"/api/dictation/attempts?item_id={item_id}&mode=write", headers=intruder)
        self.assertEqual(res.status_code, 404)
        with mock.patch("services.ai.post_chat") as post_chat:
            res = self.client.post(f"/api/dictation/attempts/{attempt_id}/ai", headers=intruder)
        self.assertEqual(res.status_code, 404)
        post_chat.assert_not_called()
        # The intruder's own history of the same sentence starts empty
        own = self.client.post(
            "/api/dictation/items", headers=intruder, json={"sentence": SENTENCE, "translation_en": TRANSLATION}
        ).json()
        self.assertEqual(own["summary"]["write"]["0"]["attempts"], 0)

    def test_input_bounds(self):
        item_id = self._register().json()["item_id"]
        cases = [
            self._register(sentence="x" * (dictation.SENTENCE_MAX_CHARS + 1)),
            self._register(sentence=""),
            self._register(build_up=[{"fr": "a b", "en": "", "new": ""}] * (dictation.MAX_STEPS + 1)),
            self._register(translation_en="x" * (dictation.PROMPT_MAX_CHARS + 1)),
            self._attempt(item_id, "x" * (dictation.ANSWER_MAX_CHARS + 1)),
            self._attempt(item_id, ""),
            self._attempt(item_id, "   "),
            self._attempt(item_id, "x", mode="speak"),
            self._attempt(item_id, "x", step=-1),
            self._attempt(item_id, "x", step=dictation.MAX_STEPS + 1),
            self._attempt("not-an-id", "x"),
            self._register(sentence="… !"),
        ]
        for res in cases:
            self.assertEqual(res.status_code, 422, res.text[:200])
        self.assertEqual(self._attempt(item_id, "x", step=4).status_code, 404)  # past the last step
        self.assertEqual(self._attempt(uuid.uuid4().hex, "x").status_code, 404)

    def test_history_and_scoring(self):
        item_id = self._register().json()["item_id"]
        self._attempt(item_id, "les autorites canadiennes n'autorisent aucune dispense")  # accent only
        self._attempt(item_id, "les autorités")
        self._attempt(item_id, SENTENCE)
        self._attempt(item_id, SENTENCE, mode="listen")
        res = self.client.get(
            f"/api/dictation/attempts?item_id={item_id}&mode=write&step=0&limit=2", headers=self.headers
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual([a["accuracy"] for a in data["attempts"]], [100, data["attempts"][1]["accuracy"]])
        self.assertEqual(len(data["attempts"]), 2)
        summary = data["summary"]
        self.assertEqual(summary["attempts"], 3)
        self.assertEqual(summary["best"], 100)
        self.assertEqual(summary["last"], 100)
        self.assertEqual(summary["correct"], 1)
        self.assertEqual(summary["accent_only"], 1)
        item = self.client.get(f"/api/dictation/items/{item_id}", headers=self.headers).json()
        self.assertEqual(item["summary"]["listen"]["0"]["attempts"], 1)
        # The last step is the same words as the whole sentence, so it shares that history
        self.assertEqual(item["summary"]["write"]["3"]["attempts"], 3)
        self.assertEqual(item["summary"]["write"]["1"]["attempts"], 0)

    def test_history_write_failure_keeps_the_grade(self):
        item_id = self._register().json()["item_id"]
        with mock.patch("dictation.record_attempt", side_effect=sqlite3.OperationalError("disk I/O error")):
            res = self._attempt(item_id, "les autorites")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["saved"])
        self.assertIsNone(data["attempt_id"])
        self.assertEqual(data["expected"], SENTENCE)
        self.assertEqual(data["counts"]["accent"], 1)
        self.assertGreater(data["counts"]["missing"], 0)

    def test_checks_are_rate_limited(self):
        item_id = self._register().json()["item_id"]
        with mock.patch.dict(web_common.RATE_LIMITS, {"dictation": (2.0, 0.0)}):
            codes = [self._attempt(item_id, "les").status_code for _ in range(4)]
        self.assertEqual(codes[-1], 429)

    def test_checks_never_call_the_ai(self):
        with mock.patch("services.ai.post_chat") as post_chat:
            item_id = self._register().json()["item_id"]
            self._attempt(item_id, "les autorites")
            self.client.get(f"/api/dictation/items/{item_id}", headers=self.headers)
        post_chat.assert_not_called()


class AiReviewTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user_id, self.headers = _session()
        res = self.client.post(
            "/api/dictation/items", headers=self.headers, json={"sentence": SENTENCE, "translation_en": TRANSLATION}
        )
        self.item_id = res.json()["item_id"]

    def _attempt(self, answer):
        return self.client.post(
            "/api/dictation/attempts",
            headers=self.headers,
            json={"item_id": self.item_id, "mode": "listen", "step": 0, "answer": answer},
        ).json()

    def _ai(self, attempt_id, headers=None):
        return self.client.post(f"/api/dictation/attempts/{attempt_id}/ai", headers=headers or self.headers)

    def test_review_is_explicit_chinese_and_cached(self):
        reply = {
            "summary": "整体不错，注意否定。",
            "points": [{"wrong": "pas", "right": "aucune", "why": "aucune 本身就是否定，不能再加 pas。"}],
            "tip": "记住 aucun(e) = 一个都没有。",
        }
        attempt = self._attempt("les autorités canadiennes n'autorisent pas dispense")
        with mock.patch("services.ai.post_chat", return_value=({}, json.dumps(reply, ensure_ascii=False))) as post_chat:
            first = self._ai(attempt["attempt_id"])
            second = self._ai(attempt["attempt_id"])
            # The same answer in a new attempt reuses the cached review
            repeat = self._attempt("les autorités canadiennes n'autorisent pas dispense")
            third = self._ai(repeat["attempt_id"])
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["feedback"], reply)
        self.assertFalse(first.json()["cached"])
        self.assertTrue(second.json()["cached"])
        self.assertTrue(third.json()["cached"])
        self.assertEqual(post_chat.call_count, 1)
        payload = post_chat.call_args.args[1]
        prompt = "\n".join(m["content"] for m in payload["messages"])
        self.assertIn("简体中文", prompt)
        self.assertIn(SENTENCE, prompt)  # the server target, not anything the client sent
        stored = dictation.get_attempt(self.user_id, attempt["attempt_id"])
        self.assertEqual(stored["ai"], reply)

    def test_correct_answer_needs_no_ai(self):
        attempt = self._attempt(SENTENCE)
        with mock.patch("services.ai.post_chat") as post_chat:
            res = self._ai(attempt["attempt_id"])
        self.assertEqual(res.status_code, 200)
        post_chat.assert_not_called()

    def test_ai_output_is_bounded_and_kept_as_text(self):
        reply = {
            "summary": "<img src=x onerror=alert(1)>" + "长" * 500,
            "points": [{"wrong": "<b>x</b>", "right": "y", "why": "z"}] * 20,
            "tip": "",
        }
        attempt = self._attempt("les autorités")
        with mock.patch("services.ai.post_chat", return_value=({}, json.dumps(reply, ensure_ascii=False))):
            feedback = self._ai(attempt["attempt_id"]).json()["feedback"]
        self.assertEqual(len(feedback["summary"]), dictation.AI_FIELD_MAX)
        self.assertTrue(feedback["summary"].startswith("<img"))  # escaped by the browser renderer, never parsed here
        self.assertEqual(len(feedback["points"]), dictation.AI_POINTS_MAX)

    def test_bad_ai_output_is_not_cached(self):
        attempt = self._attempt("les autorités")
        with mock.patch("services.ai.post_chat", return_value=({}, "not json")):
            self.assertEqual(self._ai(attempt["attempt_id"]).status_code, 502)
        self.assertIsNone(dictation.get_attempt(self.user_id, attempt["attempt_id"])["ai"])

    def test_ai_review_is_rate_limited_and_checks_the_account(self):
        attempt = self._attempt("les autorités")
        expired = HTTPException(status_code=403, detail={"code": "trial_expired", "message": "x"})
        with mock.patch("services.ai.upstream_key", side_effect=expired):
            with mock.patch("services.ai.post_chat") as post_chat:
                self.assertEqual(self._ai(attempt["attempt_id"]).status_code, 403)
        post_chat.assert_not_called()
        with mock.patch.dict(web_common.RATE_LIMITS, {"dictation_ai": (0.0, 0.0)}):
            with mock.patch("services.ai.post_chat") as post_chat:
                self.assertEqual(self._ai(attempt["attempt_id"]).status_code, 429)
        post_chat.assert_not_called()

    def test_a_review_in_flight_is_not_started_twice(self):
        import routers.dictation as routes

        attempt = self._attempt("les autorités")
        routes._ai_in_flight.add((self.user_id, attempt["attempt_id"]))
        try:
            with mock.patch("services.ai.post_chat") as post_chat:
                self.assertEqual(self._ai(attempt["attempt_id"]).status_code, 409)
            post_chat.assert_not_called()
        finally:
            routes._ai_in_flight.discard((self.user_id, attempt["attempt_id"]))


class StudyPageWiringTests(unittest.TestCase):
    STUDY_JS = (ROOT / "static" / "study.js").read_text(encoding="utf-8")
    STUDY_HTML = (ROOT / "static" / "study.html").read_text(encoding="utf-8")

    def test_dictation_script_loads_before_study(self):
        self.assertLess(self.STUDY_HTML.index("/static/dictation.js"), self.STUDY_HTML.index("/static/study.js"))

    def test_modes_sit_next_to_show_all_and_test_me(self):
        self.assertIn('data-mode="normal"', self.STUDY_JS)
        self.assertIn('data-mode="blind"', self.STUDY_JS)
        self.assertIn('data-mode="write"', self.STUDY_JS)
        self.assertIn('data-mode="listen"', self.STUDY_JS)
        # The Show all / Test me handler leaves the new modes alone
        self.assertIn("if (mode === 'write' || mode === 'listen') return;", self.STUDY_JS)

    def test_audio_uses_the_sentence_voice(self):
        self.assertIn("voice: frenchVoiceFor(sentenceText)", self.STUDY_JS)
        self.assertIn("const voice = options.voice || frenchVoiceFor(cleanText);", self.STUDY_JS)

    def test_dictation_module_ships_in_the_image(self):
        self.assertIn("dictation.py", (ROOT / "Dockerfile").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
