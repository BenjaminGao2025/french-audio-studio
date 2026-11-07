"""Fixed expressions on the study word card: matching, cleaning model output, the analysis field and
POST /api/phrase-context (auth, per-user cache of positive and negative answers, shared work, bounds)."""

import asyncio
import json
import pathlib
import unittest
import uuid
from unittest import mock

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi import HTTPException
from fastapi.testclient import TestClient

import analysis
import auth_db
import phrase_context
import tts_service
import web_common
from routers import tutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "phrase_cases.json").read_text(encoding="utf-8"))

SENTENCE = "À partir des sessions de 2026, il faut partir tôt."
A_PARTIR = {
    "text": "À partir des",
    "phrase": "à partir de",
    "meaning_zh": "从……起",
    "meaning_en": "starting from",
    "literal_zh": "partir 单独是“离开”，但 à partir de 是固定介词短语，表示起点；这里 des = de + les。",
}


def _session() -> tuple[int, dict]:
    reg = auth_db.register_user(f"phr_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


def _reply(phrases) -> tuple[dict, str]:
    return {}, json.dumps({"phrases": phrases}, ensure_ascii=False)


class MatchTests(unittest.TestCase):
    def test_shared_fixture(self):
        for case in FIXTURES["find"]:
            with self.subTest(pattern=case["pattern"], sentence=case["sentence"]):
                got = [case["sentence"][a:b] for a, b in phrase_context.find(case["pattern"], case["sentence"])]
                self.assertEqual(got, case["matches"])

    def test_fold_ignores_case_accents_and_apostrophes(self):
        self.assertEqual(phrase_context.fold("À l’Œuvre"), "a l'oeuvre")


class CleanTests(unittest.TestCase):
    def test_keeps_the_sentence_spelling_and_drops_what_is_not_there(self):
        raw = [
            dict(A_PARTIR, text="à partir des"),  # case differs: the sentence's own spelling wins
            {"text": "en fait", "phrase": "en fait", "meaning_zh": "其实"},  # not in the sentence
            {"text": "il faut", "phrase": "il faut", "meaning_zh": ""},  # no meaning at all
            "junk",
            {"text": ["x"], "meaning_zh": "x"},
        ]
        cleaned = phrase_context.clean_phrases(raw, SENTENCE)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0]["text"], "À partir des")
        self.assertEqual(cleaned[0]["phrase"], "à partir de")

    def test_overlapping_and_too_many_entries(self):
        raw = [A_PARTIR, dict(A_PARTIR, text="partir des", phrase="partir de")]
        self.assertEqual(len(phrase_context.clean_phrases(raw, SENTENCE)), 1)
        many = [dict(A_PARTIR)] * 40
        self.assertLessEqual(len(phrase_context.clean_phrases(many, SENTENCE)), phrase_context.MAX_PHRASES)

    def test_model_text_is_plain_and_bounded(self):
        raw = [dict(A_PARTIR, meaning_zh="<img src=x onerror=alert(1)>从起" + "长" * 100, literal_zh="\x00a<b>b</b>")]
        entry = phrase_context.clean_phrases(raw, SENTENCE)[0]
        for value in entry.values():
            self.assertNotIn("<", value)
            self.assertNotIn(">", value)
        self.assertLessEqual(len(entry["meaning_zh"]), phrase_context.FIELD_LIMITS["meaning_zh"])
        self.assertNotIn("\x00", entry["literal_zh"])

    def test_parse_reply(self):
        self.assertEqual(phrase_context.parse_ai_phrases('```json\n{"phrases": []}\n```', SENTENCE), [])
        self.assertIsNone(phrase_context.parse_ai_phrases("not json", SENTENCE))
        self.assertIsNone(phrase_context.parse_ai_phrases('{"other": 1}', SENTENCE))
        self.assertIsNone(phrase_context.parse_ai_phrases("{" + " " * 30000 + "}", SENTENCE))
        self.assertEqual(len(phrase_context.parse_ai_phrases(_reply([A_PARTIR])[1], SENTENCE)), 1)

    def test_cache_key_depends_on_sentence_and_version(self):
        key = phrase_context.cache_key(SENTENCE)
        self.assertEqual(key, phrase_context.cache_key("  à partir des sessions de 2026,  il faut partir tôt. "))
        self.assertNotEqual(key, phrase_context.cache_key("Il faut partir tôt."))
        with mock.patch.object(phrase_context, "VERSION", phrase_context.VERSION + 1):
            self.assertNotEqual(key, phrase_context.cache_key(SENTENCE))


class AnalysisTests(unittest.TestCase):
    def _parse(self, sentence_obj):
        return analysis._parse_analysis_json(json.dumps({"sentences": [sentence_obj]}), sentence_obj["sentence"])

    def test_prompt_asks_for_phrases(self):
        prompt = analysis._analyze_payload(analysis.AnalyzeRequest(text=SENTENCE))["messages"][0]["content"]
        self.assertIn('"phrases"', prompt)
        self.assertIn("literal_zh", prompt)

    def test_phrases_are_cleaned_when_present(self):
        out = self._parse({"schemaVersion": 2, "sentence": SENTENCE, "words": [], "phrases": [A_PARTIR, {"x": 1}]})
        self.assertEqual(out["sentences"][0]["phrases"][0]["text"], "À partir des")
        self.assertEqual(len(out["sentences"][0]["phrases"]), 1)

    def test_empty_list_means_none_and_missing_key_means_unknown(self):
        none = self._parse({"schemaVersion": 2, "sentence": SENTENCE, "words": [], "phrases": []})
        self.assertEqual(none["sentences"][0]["phrases"], [])
        unknown = self._parse({"schemaVersion": 2, "sentence": SENTENCE, "words": []})
        self.assertNotIn("phrases", unknown["sentences"][0])


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.user_id, self.headers = _session()

    def _post(self, sentence=SENTENCE, headers=None, **extra):
        return self.client.post(
            "/api/phrase-context", json={"sentence": sentence, **extra}, headers=headers or self.headers
        )

    def test_requires_login_and_spends_nothing(self):
        with mock.patch("services.ai.post_chat") as post_chat:
            self.assertEqual(self.client.post("/api/phrase-context", json={"sentence": SENTENCE}).status_code, 401)
            bad = {"Authorization": "Bearer not-a-session"}
            self.assertEqual(self._post(headers=bad).status_code, 401)
        post_chat.assert_not_called()

    def test_request_bounds(self):
        with mock.patch("services.ai.post_chat") as post_chat:
            self.assertEqual(self._post("x" * (phrase_context.SENTENCE_MAX_CHARS + 1)).status_code, 422)
            self.assertEqual(self._post("").status_code, 422)
            self.assertEqual(self._post("   ").status_code, 422)
            self.assertEqual(self._post(translation_zh="中" * 2000).status_code, 422)
        post_chat.assert_not_called()

    def test_positive_answer_is_cached_per_user(self):
        with mock.patch("services.ai.post_chat", return_value=_reply([A_PARTIR])) as post_chat:
            first = self._post(translation_zh="从 2026 年的考试起……")
            again = self._post()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["phrases"][0]["phrase"], "à partir de")
        self.assertFalse(first.json()["cached"])
        self.assertTrue(again.json()["cached"])
        self.assertEqual(again.json()["phrases"], first.json()["phrases"])
        self.assertEqual(post_chat.call_count, 1)
        # The sentence goes to the model as data, with the translation as a hint
        user_message = post_chat.call_args.args[1]["messages"][1]["content"]
        self.assertIn(SENTENCE, user_message)
        self.assertIn("2026 年", user_message)
        # Another user's cache is their own: a new call for them
        _, other = _session()
        with mock.patch("services.ai.post_chat", return_value=_reply([])) as post_chat:
            self.assertEqual(self._post(headers=other).json()["phrases"], [])
        self.assertEqual(post_chat.call_count, 1)

    def test_negative_answer_is_cached_too(self):
        sentence = "Les sessions commencent demain matin."
        with mock.patch("services.ai.post_chat", return_value=_reply([])) as post_chat:
            self.assertEqual(self._post(sentence).json(), {"phrases": [], "cached": False, "shared": False})
            self.assertEqual(self._post(sentence).json(), {"phrases": [], "cached": True})
        self.assertEqual(post_chat.call_count, 1)

    def test_invented_phrase_is_dropped_before_caching(self):
        sentence = "Les sessions commencent demain."
        invented = [{"text": "en fait", "phrase": "en fait", "meaning_zh": "其实", "meaning_en": "in fact"}]
        with mock.patch("services.ai.post_chat", return_value=_reply(invented)):
            self.assertEqual(self._post(sentence).json()["phrases"], [])
        key = phrase_context.cache_key(sentence)
        self.assertEqual(phrase_context.get_cached(self.user_id, key), [])

    def test_bad_reply_is_not_cached(self):
        sentence = "Il y a deux ans, j'habitais à Lyon."
        with mock.patch("services.ai.post_chat", return_value=({}, "Sorry, no JSON")):
            self.assertEqual(self._post(sentence).status_code, 502)
        self.assertIsNone(phrase_context.get_cached(self.user_id, phrase_context.cache_key(sentence)))
        reply = _reply([{"text": "Il y a", "phrase": "il y a", "meaning_zh": "……以前", "meaning_en": "ago"}])
        with mock.patch("services.ai.post_chat", return_value=reply) as post_chat:
            self.assertEqual(self._post(sentence).json()["phrases"][0]["text"], "Il y a")
        self.assertEqual(post_chat.call_count, 1)

    def test_rate_limit_and_entitlement_before_any_call(self):
        sentence = "Grâce aux efforts de tous, nous avons réussi."
        with mock.patch.dict(web_common.RATE_LIMITS, {"phrase_ai": (1.0, 0.0)}):
            with mock.patch("services.ai.post_chat", return_value=_reply([])) as post_chat:
                self.assertEqual(self._post(sentence).status_code, 200)
                limited = self._post("Une autre phrase sans expression.")
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(post_chat.call_count, 1)
        expired = HTTPException(status_code=403, detail={"code": "trial_expired", "message": "x"})
        _, fresh = _session()  # this user's phrase_ai bucket is now empty
        with mock.patch("services.ai.upstream_key", side_effect=expired):
            with mock.patch("services.ai.post_chat") as post_chat:
                self.assertEqual(self._post("Encore une phrase.", headers=fresh).status_code, 403)
        post_chat.assert_not_called()
        # A cached answer stays free (no AI bucket, no entitlement check)
        with mock.patch("services.ai.upstream_key", side_effect=expired):
            self.assertEqual(self._post(sentence).status_code, 200)

    def test_simultaneous_requests_share_one_call(self):
        sentence = "Au lieu de rester, pars."
        reply = _reply(
            [{"text": "Au lieu de", "phrase": "au lieu de", "meaning_zh": "而不是", "meaning_en": "instead of"}]
        )
        calls = 0

        async def slow_post(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return reply

        token = self.headers["Authorization"]

        async def run():
            request = tutor.PhraseContextRequest(sentence=sentence)
            return await asyncio.gather(*[tutor.phrase_context_for(request, token) for _ in range(3)])

        with mock.patch("services.ai.post_chat", side_effect=slow_post):
            results = asyncio.run(run())
        self.assertEqual(calls, 1)
        self.assertEqual([r["phrases"][0]["text"] for r in results], ["Au lieu de"] * 3)
        self.assertEqual(sorted(r["shared"] for r in results), [False, True, True])
        self.assertEqual(tutor._phrase_in_flight, {})


if __name__ == "__main__":
    unittest.main()
