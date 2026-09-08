import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

import tts_service


class FrenchAudioStudioTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_health_endpoint(self):
        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["model"], tts_service.PERPLEXITY_MODEL)

    def test_transform_requires_api_key(self):
        response = self.client.post(
            "/api/transform",
            json={"text": "你好", "style": "spoken", "level": "B1-B2"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "missing_api_key")

    def test_models_endpoint_exposes_grok_as_default(self):
        response = self.client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["default"], "grok-4.6")
        self.assertEqual(response.json()["proofreader"]["id"], "gpt-5.6-terra")
        model_ids = {item["id"] for item in response.json()["models"]}
        self.assertEqual(
            model_ids,
            {"grok-4.6", "grok-4.6-thinking", "sonar-2"},
        )

    @patch(
        "tts_service.request_french_transform",
        new_callable=AsyncMock,
        return_value=(
            "A : Bonjour !",
            "grok-4.6",
            "translate",
            "proofread",
            "gpt-5.6-terra",
        ),
    )
    def test_transform_returns_editable_french(self, transform_mock):
        response = self.client.post(
            "/api/transform",
            headers={"Authorization": "Bearer test-key"},
            json={
                "text": "A：你好！",
                "style": "spoken",
                "level": "A1-A2",
                "locale": "fr-FR",
                "model": "grok-4.6",
                "task_mode": "translate",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "text": "A : Bonjour !",
                "model": "grok-4.6",
                "task_mode": "translate",
                "task_label": "忠实翻译",
                "proofread_model": "gpt-5.6-terra",
                "proofread_label": "GPT-5.6 Terra",
                "quality_check": "proofread",
            },
        )
        self.assertEqual(transform_mock.await_args.args[1], "test-key")
        self.assertEqual(transform_mock.await_args.args[0].model, "grok-4.6")
        self.assertEqual(transform_mock.await_args.args[0].task_mode, "translate")

    @patch(
        "tts_service.request_french_transform",
        new_callable=AsyncMock,
        return_value=(
            "J'apprends le fran\u00e7ais.",
            "grok-4.6",
            "translate",
            "proofread",
            "gpt-5.6-terra",
        ),
    )
    def test_connection_test_verifies_selected_model(self, transform_mock):
        response = self.client.post(
            "/api/connection/test",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "grok-4.6"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["connected"], True)
        self.assertEqual(response.json()["quality_check"], "proofread")
        self.assertEqual(response.json()["proofread_model"], "gpt-5.6-terra")
        self.assertEqual(response.json()["model"], "grok-4.6")
        self.assertEqual(transform_mock.await_args.args[0].model, "grok-4.6")
        self.assertEqual(transform_mock.await_args.args[0].task_mode, "translate")

    def test_prompt_contains_selected_style_level_and_locale(self):
        request = tts_service.TransformRequest(
            text="A: How are you?",
            style="formal",
            level="C1-C2",
            locale="fr-CA",
        )

        messages = tts_service._build_messages(request, "express")

        self.assertIn("Canadian French", messages[0]["content"])
        self.assertIn("C1-C2", messages[0]["content"])
        self.assertIn("formal writing", messages[0]["content"])
        self.assertIn("A: How are you?", messages[1]["content"])
        self.assertIn("Return only clean French", messages[0]["content"])
        self.assertNotIn("<FRENCH>", messages[0]["content"])
        self.assertNotIn("<TASK>", messages[0]["content"])

    def test_faithful_translation_uses_minimal_person_preserving_prompt(self):
        request = tts_service.TransformRequest(
            text="我今天下午去图书馆。",
            style="formal",
            level="C1-C2",
            locale="fr-CA",
            task_mode="translate",
        )

        messages = tts_service._build_messages(request, "translate")

        self.assertEqual(
            messages[0]["content"],
            "Translate the user text faithfully into natural Canadian French. Preserve "
            "meaning, person, tense and tone. Return only French.",
        )
        self.assertEqual(
            messages[1]["content"],
            "我今天下午去图书馆。",
        )
        self.assertNotIn("C1-C2", messages[1]["content"])
        self.assertNotIn("formal", messages[1]["content"])

    def test_generate_mode_treats_source_as_a_brief(self):
        request = tts_service.TransformRequest(
            text="Write a 100-word beginner explanation of conservatism.",
            task_mode="generate",
        )

        messages = tts_service._build_messages(request, "generate")

        self.assertIn("write the requested content", messages[0]["content"])
        self.assertIn("not a translation", messages[0]["content"])
        self.assertEqual(
            messages[1]["content"],
            "Write a 100-word beginner explanation of conservatism.",
        )
        self.assertNotIn("TASK:", messages[1]["content"])

    def test_quality_finalizer_receives_source_and_grok_draft(self):
        request = tts_service.TransformRequest(
            text="我今天下午去图书馆。",
            task_mode="translate",
        )

        payload = tts_service._proofread_payload(
            request,
            "translate",
            "Je vais au bibliotheque cet après-midi.",
        )

        self.assertEqual(payload["model"], "gpt-5.6-terra")
        self.assertIn("final French editor", payload["messages"][0]["content"])
        self.assertIn("我今天下午去图书馆。", payload["messages"][1]["content"])
        self.assertIn(
            "Je vais au bibliotheque cet après-midi.",
            payload["messages"][1]["content"],
        )

    def test_auto_mode_extracts_model_task_classification(self):
        result = tts_service._parse_task_classification("generate")

        self.assertEqual(result, "generate")

    def test_local_auto_mode_recognizes_creation_brief(self):
        result = tts_service._infer_task_mode_locally(
            "我想用简短的法语，了解一下什么是保守主义。"
            "100到150个单词，简单一点，适合初学者。"
        )

        self.assertEqual(result, "generate")

    def test_local_auto_mode_recognizes_rough_spoken_thoughts(self):
        result = tts_service._infer_task_mode_locally(
            "嗯就是我明天下班以后可能想去买点菜，然后顺便去趟银行。"
        )

        self.assertEqual(result, "express")

    def test_local_auto_mode_recognizes_existing_french(self):
        result = tts_service._infer_task_mode_locally(
            "Je va à le bibliothèque cette après midi."
        )

        self.assertEqual(result, "polish")

    def test_local_auto_mode_defaults_plain_source_text_to_translation(self):
        result = tts_service._infer_task_mode_locally("我今天下午去图书馆。")

        self.assertEqual(result, "translate")

    def test_auto_prompt_includes_concise_rules_for_every_task(self):
        request = tts_service.TransformRequest(
            text="请写一段简单的法语介绍保守主义。",
            task_mode="auto",
        )

        payload = tts_service._classification_payload(request)
        messages = payload["messages"]

        self.assertIn("Return exactly one lowercase word", messages[0]["content"])
        self.assertIn("generate =", messages[1]["content"])
        self.assertIn("translate =", messages[1]["content"])
        self.assertIn("express =", messages[1]["content"])
        self.assertIn("polish =", messages[1]["content"])
        self.assertEqual(payload["temperature"], 0)

    def test_auto_mode_rejects_missing_task_classification(self):
        with self.assertRaises(tts_service.HTTPException) as context:
            tts_service._parse_task_classification("I cannot decide.")

        self.assertEqual(context.exception.status_code, 502)
        self.assertEqual(
            context.exception.detail["code"],
            "missing_task_classification",
        )

    def test_multiple_task_classifications_are_rejected(self):
        with self.assertRaises(tts_service.HTTPException) as context:
            tts_service._parse_task_classification("generate or translate")

        self.assertEqual(
            context.exception.detail["code"],
            "invalid_task_classification",
        )

    def test_model_result_rejects_untranslated_source_script(self):
        request = tts_service.TransformRequest(
            text="请介绍保守主义",
            task_mode="auto",
        )

        with self.assertRaises(tts_service.HTTPException) as context:
            tts_service._validate_model_result(
                "<FRENCH>保守主义 est une idée.</FRENCH>",
                request,
            )

        self.assertEqual(
            context.exception.detail["code"],
            "non_french_upstream_response",
        )

    def test_requested_word_range_is_extracted_and_enforced(self):
        request = tts_service.TransformRequest(
            text="请用法语写一篇100到150个单词的介绍。",
            task_mode="generate",
        )

        self.assertEqual(tts_service._requested_word_range(request.text), (100, 150))
        messages = tts_service._build_messages(request, "generate")
        self.assertIn(
            "length target 125 french words",
            messages[0]["content"].lower(),
        )
        with self.assertRaises(tts_service.HTTPException) as context:
            tts_service._validate_model_result(
                " ".join(["bonjour"] * 99), request, "generate"
            )

        self.assertEqual(
            context.exception.detail["code"],
            "word_count_out_of_range",
        )
        valid = tts_service._validate_model_result(
            " ".join(["bonjour"] * 100), request, "generate"
        )
        self.assertEqual(tts_service._french_word_count(valid), 100)

    def test_upstream_5xx_is_retried_once(self):
        failed_response = Mock(status_code=500)
        successful_response = Mock(status_code=200)
        successful_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [{"message": {"content": "Bonjour."}}],
        }
        client = AsyncMock()
        client.post.side_effect = [failed_response, successful_response]

        body, text = asyncio.run(
            tts_service._post_chat(client, {"messages": []}, {"Authorization": "Bearer key"})
        )

        self.assertEqual(text, "Bonjour.")
        self.assertEqual(body["model"], "grok-4.6")
        self.assertEqual(client.post.await_count, 2)

    @patch("tts_service.httpx.AsyncClient")
    def test_contract_failure_retries_once(self, async_client_class):
        bad_response = Mock(status_code=200)
        bad_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [
                {
                    "message": {
                        "content": "保守主义 est une idée."
                    }
                }
            ],
        }
        good_response = Mock(status_code=200)
        good_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [
                {
                    "message": {
                        "content": "Le conservatisme est une idée."
                    }
                }
            ],
        }
        proofread_response = Mock(status_code=200)
        proofread_response.json.return_value = {
            "model": "gpt-5.6-terra",
            "choices": [
                {"message": {"content": "Le conservatisme est une idée."}}
            ],
        }
        client = AsyncMock()
        client.post.side_effect = [bad_response, good_response, proofread_response]
        async_client_class.return_value.__aenter__ = AsyncMock(return_value=client)
        async_client_class.return_value.__aexit__ = AsyncMock(return_value=None)
        request = tts_service.TransformRequest(
            text="请介绍保守主义",
            task_mode="generate",
        )

        result = asyncio.run(tts_service.request_french_transform(request, "test-key"))

        self.assertEqual(
            result,
            (
                "Le conservatisme est une idée.",
                "grok-4.6",
                "generate",
                "proofread",
                "gpt-5.6-terra",
            ),
        )
        self.assertEqual(client.post.await_count, 3)
        retry_payload = client.post.await_args_list[1].kwargs["json"]
        self.assertEqual(retry_payload["temperature"], 0.05)
        self.assertIn("Strict retry", retry_payload["messages"][0]["content"])
        self.assertEqual(len(retry_payload["messages"]), 2)

    @patch("tts_service.httpx.AsyncClient")
    def test_invalid_grok_draft_does_not_block_quality_finalizer(
        self, async_client_class
    ):
        bad_response = Mock(status_code=200)
        bad_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [{"message": {"content": "我明天去银行。"}}],
        }
        final_response = Mock(status_code=200)
        final_response.json.return_value = {
            "model": "gpt-5.6-terra",
            "choices": [{"message": {"content": "Demain, j’irai à la banque."}}],
        }
        client = AsyncMock()
        client.post.side_effect = [bad_response, bad_response, final_response]
        async_client_class.return_value.__aenter__ = AsyncMock(return_value=client)
        async_client_class.return_value.__aexit__ = AsyncMock(return_value=None)
        request = tts_service.TransformRequest(
            text="嗯，我明天可能去银行。",
            task_mode="express",
        )

        result = asyncio.run(tts_service.request_french_transform(request, "test-key"))

        self.assertEqual(
            result,
            (
                "Demain, j’irai à la banque.",
                "grok-4.6",
                "express",
                "proofread",
                "gpt-5.6-terra",
            ),
        )
        self.assertEqual(client.post.await_count, 3)

    @patch("tts_service.httpx.AsyncClient")
    def test_valid_grok_result_survives_failed_proofreader(
        self, async_client_class
    ):
        grok_response = Mock(status_code=200)
        grok_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [{"message": {"content": "Demain, je passerai à la banque."}}],
        }
        invalid_proofread = Mock(status_code=200)
        invalid_proofread.json.return_value = {
            "model": "gpt-5.6-terra",
            "choices": [{"message": {"content": "我明天去银行。"}}],
        }
        client = AsyncMock()
        client.post.side_effect = [
            grok_response,
            invalid_proofread,
            invalid_proofread,
        ]
        async_client_class.return_value.__aenter__ = AsyncMock(return_value=client)
        async_client_class.return_value.__aexit__ = AsyncMock(return_value=None)
        request = tts_service.TransformRequest(
            text="嗯，我明天可能去银行。",
            task_mode="express",
        )

        result = asyncio.run(tts_service.request_french_transform(request, "test-key"))

        self.assertEqual(
            result,
            (
                "Demain, je passerai à la banque.",
                "grok-4.6",
                "express",
                "passed",
                "gpt-5.6-terra",
            ),
        )
        self.assertEqual(client.post.await_count, 3)

    @patch("tts_service.httpx.AsyncClient")
    def test_auto_mode_uses_local_intent_before_generating(self, async_client_class):
        transform_response = Mock(status_code=200)
        transform_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [
                {
                    "message": {
                        "content": "Le conservatisme est une idée."
                    }
                }
            ],
        }
        proofread_response = Mock(status_code=200)
        proofread_response.json.return_value = {
            "model": "gpt-5.6-terra",
            "choices": [
                {"message": {"content": "Le conservatisme est une idée."}}
            ],
        }
        client = AsyncMock()
        client.post.side_effect = [
            transform_response,
            proofread_response,
        ]
        async_client_class.return_value.__aenter__ = AsyncMock(return_value=client)
        async_client_class.return_value.__aexit__ = AsyncMock(return_value=None)
        request = tts_service.TransformRequest(
            text="请简单介绍保守主义",
            task_mode="auto",
        )

        result = asyncio.run(tts_service.request_french_transform(request, "test-key"))

        self.assertEqual(
            result,
            (
                "Le conservatisme est une idée.",
                "grok-4.6",
                "generate",
                "proofread",
                "gpt-5.6-terra",
            ),
        )
        self.assertEqual(client.post.await_count, 2)
        transform_payload = client.post.await_args_list[0].kwargs["json"]
        self.assertIn("write the requested content", transform_payload["messages"][0]["content"])
        self.assertNotIn("<TASK>", transform_payload["messages"][0]["content"])
        proofread_payload = client.post.await_args_list[1].kwargs["json"]
        self.assertEqual(proofread_payload["model"], "gpt-5.6-terra")
        self.assertIn("write the requested content", proofread_payload["messages"][0]["content"])
        self.assertIn("请简单介绍保守主义", proofread_payload["messages"][1]["content"])

    @patch("tts_service._infer_task_mode_locally", return_value=None)
    @patch("tts_service.httpx.AsyncClient")
    def test_auto_mode_asks_model_when_local_rules_are_ambiguous(
        self, async_client_class, _local_classifier
    ):
        classification_response = Mock(status_code=200)
        classification_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [{"message": {"content": "translate"}}],
        }
        transform_response = Mock(status_code=200)
        transform_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [{"message": {"content": "Je vais à la bibliothèque."}}],
        }
        proofread_response = Mock(status_code=200)
        proofread_response.json.return_value = {
            "model": "gpt-5.6-terra",
            "choices": [{"message": {"content": "Je vais à la bibliothèque."}}],
        }
        client = AsyncMock()
        client.post.side_effect = [
            classification_response,
            transform_response,
            proofread_response,
        ]
        async_client_class.return_value.__aenter__ = AsyncMock(return_value=client)
        async_client_class.return_value.__aexit__ = AsyncMock(return_value=None)
        request = tts_service.TransformRequest(
            text="我今天下午去图书馆。",
            task_mode="auto",
        )

        result = asyncio.run(tts_service.request_french_transform(request, "test-key"))

        self.assertEqual(result[2], "translate")
        self.assertEqual(client.post.await_count, 3)

    @patch("tts_service.httpx.AsyncClient")
    def test_polish_mode_is_also_reviewed(self, async_client_class):
        transform_response = Mock(status_code=200)
        transform_response.json.return_value = {
            "model": "grok-4.6",
            "choices": [{"message": {"content": "Je vais à la bibliothèque."}}],
        }
        proofread_response = Mock(status_code=200)
        proofread_response.json.return_value = {
            "model": "gpt-5.6-terra",
            "choices": [{"message": {"content": "Je vais à la bibliothèque."}}],
        }
        client = AsyncMock()
        client.post.side_effect = [transform_response, proofread_response]
        async_client_class.return_value.__aenter__ = AsyncMock(return_value=client)
        async_client_class.return_value.__aexit__ = AsyncMock(return_value=None)
        request = tts_service.TransformRequest(
            text="Je va à le bibliothèque.",
            task_mode="polish",
        )

        result = asyncio.run(tts_service.request_french_transform(request, "test-key"))

        self.assertEqual(
            result,
            (
                "Je vais à la bibliothèque.",
                "grok-4.6",
                "polish",
                "proofread",
                "gpt-5.6-terra",
            ),
        )
        self.assertEqual(client.post.await_count, 2)

    def test_chat_payload_uses_selected_model(self):
        request = tts_service.TransformRequest(
            text="Bonjour",
            model="grok-4.6-thinking",
        )

        payload = tts_service._chat_payload(request, "polish")

        self.assertEqual(payload["model"], "grok-4.6-thinking")

    def test_non_french_script_detection(self):
        self.assertTrue(tts_service._contains_non_french_script("Bonjour, \u4f60\u597d"))
        self.assertTrue(tts_service._contains_non_french_script("\uc548\ub155, bonjour"))
        self.assertFalse(
            tts_service._contains_non_french_script(
                "A : Apr\u00e8s le travail, on va boire un caf\u00e9 ?"
            )
        )

    def test_code_fence_is_removed_from_model_text(self):
        self.assertEqual(
            tts_service._clean_model_text("```text\nBonjour.\n```"),
            "Bonjour.",
        )

    def test_trailing_model_offer_is_removed(self):
        cleaned = tts_service._clean_model_text(
            "Le conservatisme change lentement. "
            "Si tu veux, je peux aussi te donner des exemples simples."
        )

        self.assertEqual(cleaned, "Le conservatisme change lentement.")

    def test_french_block_is_extracted_from_explanatory_text(self):
        self.assertEqual(
            tts_service._clean_model_text(
                "Source ignored. <FRENCH>Je vais \u00e0 la biblioth\u00e8que.</FRENCH>"
            ),
            "Je vais \u00e0 la biblioth\u00e8que.",
        )

    def test_speech_rejects_unknown_voice_without_calling_edge(self):
        response = self.client.post(
            "/api/speech",
            json={"text": "Bonjour.", "voice": "unknown-voice"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "不支持所选语音。")

    def test_study_endpoint_serves_html(self):
        response = self.client.get("/study")
        self.assertEqual(response.status_code, 200)
        self.assertIn("法语拆解与跟读复述", response.text)

    def test_analyze_requires_api_key(self):
        response = self.client.post(
            "/api/analyze",
            json={"text": "Je vais au marché.", "model": "grok-4.6"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "missing_api_key")

    @patch(
        "tts_service.request_french_analysis",
        new_callable=AsyncMock,
        return_value={
            "sentences": [
                {
                    "original": "Je vais au marché.",
                    "translation_en": "I go to the market.",
                    "translation_cn": "我去集市。",
                    "tokens": [
                        {
                            "token": "vais",
                            "lemma": "aller",
                            "pos": "v.",
                            "phonetic": "/vɛ/",
                            "explanation_en": "go (1st person present)",
                            "explanation_cn": "去，走（现在时）",
                        }
                    ],
                }
            ]
        },
    )
    def test_analyze_returns_structured_breakdown(self, analyze_mock):
        response = self.client.post(
            "/api/analyze",
            headers={"Authorization": "Bearer test-key"},
            json={"text": "Je vais au marché.", "model": "grok-4.6"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("sentences", data)
        self.assertEqual(len(data["sentences"]), 1)
        self.assertEqual(data["sentences"][0]["original"], "Je vais au marché.")
        self.assertEqual(data["sentences"][0]["tokens"][0]["lemma"], "aller")

    def test_parse_analysis_json_handles_code_fences(self):
        raw = '```json\n{"sentences": [{"original": "Bonjour.", "translation_en": "Hello.", "translation_cn": "你好。", "tokens": []}]}\n```'
        parsed = tts_service._parse_analysis_json(raw, "Bonjour.")
        self.assertIn("sentences", parsed)
        self.assertEqual(parsed["sentences"][0]["original"], "Bonjour.")

    def test_parse_analysis_json_fallback_on_corrupt_output(self):
        raw = "Sorry I cannot output JSON today."
        parsed = tts_service._parse_analysis_json(raw, "Bonjour le monde.")
        self.assertIn("sentences", parsed)
        self.assertEqual(len(parsed["sentences"]), 1)
        self.assertEqual(parsed["sentences"][0]["original"], "Bonjour le monde.")
        self.assertTrue(len(parsed["sentences"][0]["tokens"]) > 0)

    def test_safe_timestamp_snippets_hashing(self):
        ts1 = tts_service._safe_timestamp(None, text="bonjour", voice="fr-FR-DeniseNeural")
        ts2 = tts_service._safe_timestamp(None, text="bonjour", voice="fr-FR-DeniseNeural")
        self.assertEqual(ts1, ts2)
        self.assertTrue(ts1.startswith("snip_"))

    def test_anki_js_served(self):
        response = self.client.get("/static/anki.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("AnkiDeck", response.text)
        self.assertIn("scheduleSM2", response.text)

    def test_parse_analysis_json_handles_direct_list_and_filters_punct_and_trivial(self):
        raw = json.dumps([
            {
                "original": "Elle comprend 40 questions portant sur des documents de la vie quotidienne.",
                "translation_en": "She understands 40 questions.",
                "translation_cn": "她理解40个问题。",
                "tokens": [
                    {"token": "Elle", "lemma": "elle", "pos": "pron.", "explanation_en": "she", "explanation_cn": "她"},
                    {"token": "comprend", "lemma": "comprendre", "pos": "v.", "explanation_en": "includes", "explanation_cn": "包含"},
                    {"token": "40", "lemma": "40", "pos": "num.", "explanation_en": "forty", "explanation_cn": "四十"},
                    {"token": "portant sur", "lemma": "porter sur", "pos": "loc. verb.", "explanation_en": "dealing with", "explanation_cn": "涉及"},
                    {"token": "de la vie quotidienne", "lemma": "de la vie quotidienne", "pos": "loc. adj.", "explanation_en": "of daily life", "explanation_cn": "日常生活的"},
                    {"token": ".", "lemma": ".", "pos": "punct", "explanation_en": "", "explanation_cn": ""},
                ]
            }
        ])
        parsed = tts_service._parse_analysis_json(raw, "Elle comprend 40 questions portant sur des documents de la vie quotidienne.")
        self.assertIn("sentences", parsed)
        tokens = parsed["sentences"][0]["tokens"]
        token_names = [t["token"] for t in tokens]
        # Punctuation '.' and number '40' and trivial 'Elle' must be filtered out
        self.assertNotIn(".", token_names)
        self.assertNotIn("40", token_names)
        self.assertNotIn("Elle", token_names)
        # Collocations and content verbs must be preserved
        self.assertIn("comprend", token_names)
        self.assertIn("portant sur", token_names)
        self.assertIn("de la vie quotidienne", token_names)


    def test_auth_register_and_login_flow(self):
        test_email = f"test_user_{int(asyncio.get_event_loop().time() * 1000)}@example.com"
        # 1. Register
        reg_res = self.client.post(
            "/api/auth/register",
            json={"email": test_email, "password": "securepassword123"},
        )
        self.assertEqual(reg_res.status_code, 200)
        data = reg_res.json()
        self.assertIn("token", data)
        self.assertEqual(data["user"]["email"], test_email)
        self.assertEqual(data["user"]["plan"], "trial")
        self.assertEqual(data["user"]["days_left"], 60)
        token = data["token"]

        # 2. Get /api/auth/me
        me_res = self.client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.json()
        self.assertEqual(me_data["email"], test_email)
        self.assertTrue(me_data["is_valid"])
        self.assertEqual(me_data["days_left"], 60)

        # 3. Login
        login_res = self.client.post(
            "/api/auth/login",
            json={"email": test_email, "password": "securepassword123"},
        )
        self.assertEqual(login_res.status_code, 200)
        self.assertIn("token", login_res.json())

        # 4. Duplicate register fails
        dup_res = self.client.post(
            "/api/auth/register",
            json={"email": test_email, "password": "securepassword123"},
        )
        self.assertEqual(dup_res.status_code, 400)

    def test_authorization_token_resolves_user_session_token(self):
        import auth_db
        test_email = f"session_test_{int(asyncio.get_event_loop().time() * 1000)}@example.com"
        reg = auth_db.register_user(test_email, "mypassword123")
        token = reg["token"]

        # Passing user token into _authorization_token should resolve to SERVER_WEB2API_KEY
        resolved = tts_service._authorization_token(f"Bearer {token}")
        self.assertEqual(resolved, tts_service.SERVER_WEB2API_KEY)


if __name__ == "__main__":
    unittest.main()


