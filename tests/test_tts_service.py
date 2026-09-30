import testenv  # noqa: F401  (must run before the app is imported)

import asyncio
import json
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

import auth_db
import tts_service


def _unique_email(prefix: str = "user") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"


class FrenchAudioStudioTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def _login_headers(self) -> dict:
        token = auth_db.register_user(_unique_email(), "password123")["token"]
        return {"Authorization": f"Bearer {token}"}

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

    def test_models_endpoint_exposes_default_model(self):
        response = self.client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["default"], "gpt-6-1-sol-thinking")
        self.assertEqual(response.json()["proofreader"]["id"], "gemini-3.8-flash")
        model_ids = {item["id"] for item in response.json()["models"]}
        self.assertEqual(
            model_ids,
            {"gpt-6-1-sol-thinking", "gpt-6-1-sol", "claude-5-5-sonnet-thinking", "claude-5-5-sonnet", "grok-4-7", "gemini-3.8-flash"},
        )

    @patch(
        "tts_service.request_french_transform",
        new_callable=AsyncMock,
        return_value=(
            "A : Bonjour !",
            "gpt-6-1-sol-thinking",
            "translate",
            "proofread",
            "gemini-3.8-flash",
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
                "model": "gpt-6-1-sol-thinking",
                "task_mode": "translate",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "text": "A : Bonjour !",
                "model": "gpt-6-1-sol-thinking",
                "task_mode": "translate",
                "task_label": "忠实翻译",
                "proofread_model": "gemini-3.8-flash",
                "proofread_label": "Gemini 3.8 Flash (AGY)",
                "quality_check": "proofread",
            },
        )
        self.assertEqual(transform_mock.await_args.args[1], "test-key")
        self.assertEqual(transform_mock.await_args.args[0].model, "gpt-6-1-sol-thinking")
        self.assertEqual(transform_mock.await_args.args[0].task_mode, "translate")

    @patch(
        "tts_service.request_french_transform",
        new_callable=AsyncMock,
        return_value=(
            "J'apprends le fran\u00e7ais.",
            "gpt-6-1-sol-thinking",
            "translate",
            "proofread",
            "gemini-3.8-flash",
        ),
    )
    def test_connection_test_verifies_selected_model(self, transform_mock):
        response = self.client.post(
            "/api/connection/test",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "gpt-6-1-sol-thinking"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["connected"], True)
        self.assertEqual(response.json()["quality_check"], "proofread")
        self.assertEqual(response.json()["proofread_model"], "gemini-3.8-flash")
        self.assertEqual(response.json()["model"], "gpt-6-1-sol-thinking")
        self.assertEqual(transform_mock.await_args.args[0].model, "gpt-6-1-sol-thinking")
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

        self.assertEqual(payload["model"], "gemini-3.8-flash-low")
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
            "model": "gpt-6-1-sol-thinking",
            "choices": [{"message": {"content": "Bonjour."}}],
        }
        client = AsyncMock()
        client.post.side_effect = [failed_response, successful_response]

        body, text = asyncio.run(
            tts_service._post_chat(client, {"messages": []}, {"Authorization": "Bearer key"})
        )

        self.assertEqual(text, "Bonjour.")
        self.assertEqual(body["model"], "gpt-6-1-sol-thinking")
        self.assertEqual(client.post.await_count, 2)

    @patch("tts_service.httpx.AsyncClient")
    def test_contract_failure_retries_once(self, async_client_class):
        bad_response = Mock(status_code=200)
        bad_response.json.return_value = {
            "model": "gpt-6-1-sol-thinking",
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
            "model": "gpt-6-1-sol-thinking",
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
            "model": "gemini-3.8-flash",
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
                "gpt-6-1-sol-thinking",
                "generate",
                "proofread",
                "gemini-3.8-flash",
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
            "model": "gpt-6-1-sol-thinking",
            "choices": [{"message": {"content": "我明天去银行。"}}],
        }
        final_response = Mock(status_code=200)
        final_response.json.return_value = {
            "model": "gemini-3.8-flash",
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
                "gpt-6-1-sol-thinking",
                "express",
                "proofread",
                "gemini-3.8-flash",
            ),
        )
        self.assertEqual(client.post.await_count, 3)

    @patch("tts_service.httpx.AsyncClient")
    def test_valid_grok_result_survives_failed_proofreader(
        self, async_client_class
    ):
        grok_response = Mock(status_code=200)
        grok_response.json.return_value = {
            "model": "gpt-6-1-sol-thinking",
            "choices": [{"message": {"content": "Demain, je passerai à la banque."}}],
        }
        invalid_proofread = Mock(status_code=200)
        invalid_proofread.json.return_value = {
            "model": "gemini-3.8-flash",
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
                "gpt-6-1-sol-thinking",
                "express",
                "passed",
                "gemini-3.8-flash",
            ),
        )
        self.assertEqual(client.post.await_count, 3)

    @patch("tts_service.httpx.AsyncClient")
    def test_auto_mode_uses_local_intent_before_generating(self, async_client_class):
        transform_response = Mock(status_code=200)
        transform_response.json.return_value = {
            "model": "gpt-6-1-sol-thinking",
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
            "model": "gemini-3.8-flash",
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
                "gpt-6-1-sol-thinking",
                "generate",
                "proofread",
                "gemini-3.8-flash",
            ),
        )
        self.assertEqual(client.post.await_count, 2)
        transform_payload = client.post.await_args_list[0].kwargs["json"]
        self.assertIn("write the requested content", transform_payload["messages"][0]["content"])
        self.assertNotIn("<TASK>", transform_payload["messages"][0]["content"])
        proofread_payload = client.post.await_args_list[1].kwargs["json"]
        self.assertEqual(proofread_payload["model"], "gemini-3.8-flash-low")
        self.assertIn("write the requested content", proofread_payload["messages"][0]["content"])
        self.assertIn("请简单介绍保守主义", proofread_payload["messages"][1]["content"])

    @patch("tts_service._infer_task_mode_locally", return_value=None)
    @patch("tts_service.httpx.AsyncClient")
    def test_auto_mode_asks_model_when_local_rules_are_ambiguous(
        self, async_client_class, _local_classifier
    ):
        classification_response = Mock(status_code=200)
        classification_response.json.return_value = {
            "model": "gpt-6-1-sol-thinking",
            "choices": [{"message": {"content": "translate"}}],
        }
        transform_response = Mock(status_code=200)
        transform_response.json.return_value = {
            "model": "gpt-6-1-sol-thinking",
            "choices": [{"message": {"content": "Je vais à la bibliothèque."}}],
        }
        proofread_response = Mock(status_code=200)
        proofread_response.json.return_value = {
            "model": "gemini-3.8-flash",
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
            "model": "gpt-6-1-sol-thinking",
            "choices": [{"message": {"content": "Je vais à la bibliothèque."}}],
        }
        proofread_response = Mock(status_code=200)
        proofread_response.json.return_value = {
            "model": "gemini-3.8-flash",
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
                "gpt-6-1-sol-thinking",
                "polish",
                "proofread",
                "gemini-3.8-flash",
            ),
        )
        self.assertEqual(client.post.await_count, 2)

    def test_chat_payload_uses_selected_model(self):
        request = tts_service.TransformRequest(
            text="Bonjour",
            model="claude-5-5-sonnet-thinking",
        )

        payload = tts_service._chat_payload(request, "polish")

        self.assertEqual(payload["model"], "claude-5-5-sonnet-thinking")

    def test_models_are_routed_to_their_upstream(self):
        gemini = tts_service._map_upstream_model("gemini-3.8-flash")
        self.assertEqual(tts_service._upstream_base_url(gemini), tts_service.AGY_BASE_URL)
        sol = tts_service._map_upstream_model("gpt-6-1-sol-thinking")
        self.assertEqual(sol, "gpt-6-1-sol-thinking")
        self.assertEqual(tts_service._upstream_base_url(sol), tts_service.PERPLEXITY_BASE_URL)

    def test_expired_perplexity_login_is_a_clear_error(self):
        client = AsyncMock()
        client.post.return_value = Mock(
            status_code=200,
            json=Mock(return_value={"choices": [{"message": {"content": "Sign up and repeat your request."}}]}),
        )
        with self.assertRaises(tts_service.HTTPException) as ctx:
            asyncio.run(tts_service._post_chat(client, {"model": "gpt-6-1-sol-thinking"}, {}))
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.detail["code"], "perplexity_login_expired")
        self.assertIn("8004", client.post.await_args.args[0])

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
            headers=self._login_headers(),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "不支持所选语音。")

    def test_study_endpoint_serves_html(self):
        response = self.client.get("/study")
        self.assertEqual(response.status_code, 200)
        self.assertIn("法语拆解与跟读复述", response.text)
        self.assertNotIn("__ASSET_VERSION__", response.text)
        self.assertIn(f"/static/study.js?v={tts_service.ASSET_VERSION}", response.text)

    def test_analyze_requires_api_key(self):
        response = self.client.post(
            "/api/analyze",
            json={"text": "Je vais au marché.", "model": "gpt-6-1-sol-thinking"},
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
            json={"text": "Je vais au marché.", "model": "gpt-6-1-sol-thinking"},
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

    def test_speech_eval_js_served(self):
        response = self.client.get("/static/speech-eval.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("evaluateFrenchPronunciation", response.text)

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
        test_email = _unique_email("test_user")
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
        test_email = _unique_email("session_test")
        reg = auth_db.register_user(test_email, "mypassword123")
        token = reg["token"]

        # Passing user token into _authorization_token should resolve to SERVER_WEB2API_KEY
        resolved = tts_service._authorization_token(f"Bearer {token}")
        self.assertEqual(resolved, tts_service.SERVER_WEB2API_KEY)

    @patch("tts_service.request_word_lookup", new_callable=AsyncMock)
    def test_quick_lookup_endpoint(self, lookup_mock):
        lookup_mock.return_value = {
            "token": "bonjour",
            "lemma": "bonjour",
            "pos": "n.m.",
            "phonetic": "/bɔ̃.ʒuʁ/",
            "explanation_cn": "你好，问候语",
            "explanation_en": "hello, good morning",
        }
        res = self.client.get(
            "/api/lookup?word=bonjour",
            headers={"Authorization": "Bearer test-key"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["token"], "bonjour")
        self.assertEqual(data["pos"], "n.m.")
        self.assertEqual(data["explanation_cn"], "你好，问候语")

    def test_quick_lookup_requires_auth(self):
        res = self.client.get("/api/lookup?word=bonjour")
        self.assertEqual(res.status_code, 401)

    def test_history_crud_flow(self):
        headers = self._login_headers()
        # 1. Clear any prior test records
        res_clear = self.client.delete("/api/history", headers=headers)
        self.assertEqual(res_clear.status_code, 200)

        # 2. Save a TTS record
        tts_payload = {
            "id": "hist_tts_test_001",
            "type": "tts",
            "text": "Bonjour tout le monde",
            "payload": {
                "voice": "fr-FR-DeniseNeural",
                "audioUrl": "/files/test.mp3",
                "srtUrl": "/files/test.srt",
            },
        }
        res_post_tts = self.client.post("/api/history", json=tts_payload, headers=headers)
        self.assertEqual(res_post_tts.status_code, 200)

        # 3. Save a Study record
        study_payload = {
            "id": "hist_study_test_002",
            "type": "study",
            "text": "Je mange du pain",
            "payload": {
                "sentenceCount": 1,
                "tokenCount": 4,
                "sentences": [{"original": "Je mange du pain"}],
            },
        }
        res_post_study = self.client.post("/api/history", json=study_payload, headers=headers)
        self.assertEqual(res_post_study.status_code, 200)

        # 4. List all records
        res_all = self.client.get("/api/history", headers=headers)
        self.assertEqual(res_all.status_code, 200)
        data_all = res_all.json()
        self.assertGreaterEqual(data_all["count"], 2)
        ids = [r["id"] for r in data_all["records"]]
        self.assertIn("hist_tts_test_001", ids)
        self.assertIn("hist_study_test_002", ids)

        # 5. Filter by type
        res_tts_only = self.client.get("/api/history?type=tts", headers=headers)
        self.assertEqual(res_tts_only.status_code, 200)
        tts_records = res_tts_only.json()["records"]
        self.assertTrue(all(r["type"] == "tts" for r in tts_records))
        self.assertIn("hist_tts_test_001", [r["id"] for r in tts_records])

        # 6. Delete single record
        res_del = self.client.delete("/api/history/hist_tts_test_001", headers=headers)
        self.assertEqual(res_del.status_code, 200)
        self.assertTrue(res_del.json()["success"])

        # 7. Verify deletion
        res_after_del = self.client.get("/api/history", headers=headers)
        ids_after = [r["id"] for r in res_after_del.json()["records"]]
        self.assertNotIn("hist_tts_test_001", ids_after)
        self.assertIn("hist_study_test_002", ids_after)

        # 8. Clear all
        res_clear_final = self.client.delete("/api/history", headers=headers)
        self.assertEqual(res_clear_final.status_code, 200)
        res_empty = self.client.get("/api/history", headers=headers)
        self.assertEqual(res_empty.json()["count"], 0)



    def test_history_requires_login(self):
        self.assertEqual(self.client.get("/api/history").status_code, 401)
        self.assertEqual(self.client.delete("/api/history").status_code, 401)
        self.assertEqual(self.client.delete("/api/history/any-id").status_code, 401)
        self.assertEqual(
            self.client.post("/api/history", json={"id": "x", "text": "t"}).status_code,
            401,
        )

    def test_history_is_isolated_between_users(self):
        alice, bob = self._login_headers(), self._login_headers()
        record = {"id": "hist_shared_id", "type": "study", "text": "Bonjour Alice", "payload": {}}
        self.assertEqual(self.client.post("/api/history", json=record, headers=alice).status_code, 200)

        # Bob neither sees, overwrites, deletes nor clears Alice's record.
        self.assertEqual(self.client.get("/api/history", headers=bob).json()["count"], 0)
        hijack = {**record, "text": "Hijacked by Bob"}
        self.client.post("/api/history", json=hijack, headers=bob)
        self.assertFalse(
            self.client.delete("/api/history/hist_shared_id", headers=bob).json()["success"]
        )
        self.client.delete("/api/history", headers=bob)

        alice_records = self.client.get("/api/history", headers=alice).json()["records"]
        self.assertEqual([r["text"] for r in alice_records], ["Bonjour Alice"])

    def test_forged_token_is_rejected(self):
        import base64
        import hashlib
        import hmac

        payload = base64.urlsafe_b64encode(b'{"sub":1,"email":"x","exp":9999999999}').decode().rstrip("=")
        sig = hmac.new(b"french_audio_studio_secret_salt_2026", payload.encode(), hashlib.sha256).hexdigest()
        response = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {payload}.{sig}"})
        self.assertEqual(response.status_code, 401)

    def test_registration_can_be_closed(self):
        with patch.object(auth_db, "ALLOW_REGISTRATION", False):
            response = self.client.post(
                "/api/auth/register",
                json={"email": _unique_email(), "password": "password123"},
            )
        self.assertEqual(response.status_code, 403)

    def test_speech_requires_login(self):
        response = self.client.post(
            "/api/speech", json={"text": "Bonjour.", "voice": "fr-FR-DeniseNeural"}
        )
        self.assertEqual(response.status_code, 401)

    @patch("tts_service.create_speech_files", new_callable=AsyncMock)
    def test_tts_snippet_is_content_cached(self, create_mock):
        path = tts_service.OUTPUT_DIR / "TTS_fr-FR-DeniseNeural_snip_test.mp3"
        path.write_bytes(b"ID3")
        create_mock.return_value = (path.name, "unused.srt")
        response = self.client.get("/tts", params={"text": "Bonjour", "t": "attacker_chosen"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("max-age=", response.headers["cache-control"])
        # The client can no longer choose the cache file name.
        create_mock.assert_awaited_once_with("Bonjour", "fr-FR-DeniseNeural")

    def test_snippets_up_to_limit_use_stable_hash_names(self):
        long_text = "Phrase assez longue. " * 12  # ~250 chars, above the old 150 limit
        a = tts_service._safe_timestamp(None, text=long_text, voice="fr-FR-DeniseNeural")
        b = tts_service._safe_timestamp(None, text=long_text, voice="fr-FR-DeniseNeural")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("snip_"))

    def test_tts_snippet_rejects_long_text(self):
        response = self.client.get("/tts", params={"text": "a" * 601})
        self.assertEqual(response.status_code, 422)

    def test_session_token_without_server_key_returns_503(self):
        headers = self._login_headers()
        with patch.object(tts_service, "SERVER_WEB2API_KEY", ""):
            response = self.client.post(
                "/api/analyze", json={"text": "Bonjour."}, headers=headers
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "server_key_missing")


if __name__ == "__main__":
    unittest.main()
