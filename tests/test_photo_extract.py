import base64
import builtins
import json
import logging
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import testenv  # noqa: F401  (sets up the isolated env before tts_service is imported)
import tts_service as host

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
DATA_URI = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()

ITEMS = {
    "items": [
        {"kind": "sentence", "fr": "Je parle français.", "gloss": "I speak French / 我说法语"},
        {"kind": "vocab", "fr": "le grand-père", "gloss": "grandfather / 祖父"},
        {"kind": "grammar", "fr": "le père / les pères", "gloss": ""},
    ]
}
TEXT = "Je parle français.\nle grand-père\nle père / les pères"


def post(body, headers):
    return TestClient(host.app).post("/api/photo-extract", json=body, headers=headers)


def extract(reply, body=None):
    with patch.object(host, "_post_chat", new_callable=AsyncMock, return_value=({}, reply)) as chat:
        response = post(body or {"image": DATA_URI}, testenv.session_headers())
    return response, chat


class PhotoExtractResponseTests(unittest.TestCase):
    def test_success(self):
        r, _ = extract(json.dumps(ITEMS))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"items": ITEMS["items"], "text": TEXT, "count": 3})

    def test_code_fenced_json(self):
        r, _ = extract("Voici le résultat :\n```json\n" + json.dumps(ITEMS) + "\n```\n")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["text"], TEXT)

    def test_items_stay_one_per_line_and_unusable_ones_are_skipped(self):
        reply = {
            "items": [
                {"kind": "weird", "fr": "**Je parle\nfrançais.**", "gloss": ["x"]},
                {"kind": ["vocab"], "fr": "je PARLE FRANÇAIS."},
                {"kind": "vocab", "fr": "   "},
                {"kind": "vocab", "fr": 3},
                "not an item",
            ]
        }
        r, _ = extract(json.dumps(reply))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(
            r.json(),
            {
                "items": [{"kind": "sentence", "fr": "Je parle français.", "gloss": ""}],
                "text": "Je parle français.",
                "count": 1,
            },
        )

    def test_bad_json_is_502(self):
        for reply in ("Désolé, je ne peux pas.", '{"items": [', "[1, 2]", '{"pages": []}', '{"items": "x"}'):
            with self.subTest(reply=reply):
                r, _ = extract(reply)
                self.assertEqual(r.status_code, 502)
                self.assertEqual(r.json()["detail"]["message"], "照片识别失败，请拍清楚一点再试。")

    def test_no_items_is_422(self):
        for reply in ('{"items": []}', '{"items": [{"kind": "vocab", "fr": "123"}]}'):
            with self.subTest(reply=reply):
                r, _ = extract(reply)
                self.assertEqual(r.status_code, 422)
                self.assertEqual(r.json()["detail"]["message"], "照片里没有识别到法语内容。")

    def test_upstream_errors_pass_through(self):
        error = host.HTTPException(504, {"code": "upstream_timeout", "message": "AI 处理超时"})
        with patch.object(host, "_post_chat", new_callable=AsyncMock, side_effect=error):
            r = post({"image": DATA_URI}, testenv.session_headers())
        self.assertEqual(r.status_code, 504)


class PhotoExtractInputTests(unittest.TestCase):
    def assert_rejected(self, status, body, message_part):
        r, chat = extract(json.dumps(ITEMS), body)
        self.assertEqual(r.status_code, status, r.text[:200])
        self.assertIn(message_part, r.json()["detail"]["message"])
        chat.assert_not_awaited()

    def test_oversize_after_decoding_is_413(self):
        raw = JPEG + b"\x00" * (host.PHOTO_MAX_BYTES + 1 - len(JPEG))
        uri = "data:image/jpeg;base64," + base64.b64encode(raw).decode()
        self.assert_rejected(413, {"image": uri}, "太大")

    def test_body_over_the_limit_is_413(self):
        self.assert_rejected(413, {"image": "x" * (host.PHOTO_MAX_BODY_BYTES + 1)}, "太大")

    def test_largest_allowed_photo_is_accepted(self):
        raw = JPEG + b"\x00" * (host.PHOTO_MAX_BYTES - len(JPEG))
        uri = "data:image/jpeg;base64," + base64.b64encode(raw).decode()
        r, _ = extract(json.dumps(ITEMS), {"image": uri})
        self.assertEqual(r.status_code, 200, r.text[:200])

    def test_non_images_are_400(self):
        text = base64.b64encode(b"<html>not an image</html>").decode()
        bad = [
            {"image": "data:image/jpeg;base64," + text},
            {"image": "data:image/jpeg;base64,not base64!"},
            {"image": "data:image/jpeg;base64,"},
            {"image": "plain text"},
            {"image": 3},
            {"text": "no image"},
            ["image"],
        ]
        for body in bad:
            with self.subTest(body=body):
                self.assert_rejected(400, body, "JPEG")

    def test_body_that_is_not_json_is_400(self):
        with patch.object(host, "_post_chat", new_callable=AsyncMock) as chat:
            r = TestClient(host.app).post(
                "/api/photo-extract", content=b"\xff\xd8\xff not json", headers=testenv.session_headers()
            )
        self.assertEqual(r.status_code, 400)
        chat.assert_not_awaited()

    def test_each_image_type_is_sent_with_the_type_of_its_bytes(self):
        heads = {
            "image/jpeg": JPEG,
            "image/png": b"\x89PNG\r\n\x1a\n" + b"\x00" * 16,
            "image/webp": b"RIFF\x10\x00\x00\x00WEBPVP8 ",
            "image/heic": b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00",
        }
        for mime, raw in heads.items():
            with self.subTest(mime=mime):
                encoded = base64.b64encode(raw).decode()
                r, chat = extract(json.dumps(ITEMS), {"image": f"data:text/plain;base64,{encoded}"})
                self.assertEqual(r.status_code, 200, r.text)
                url = chat.await_args.args[1]["messages"][1]["content"][1]["image_url"]["url"]
                self.assertEqual(url, f"data:{mime};base64,{encoded}")

    def test_missing_auth_is_401(self):
        with patch.object(host, "_post_chat", new_callable=AsyncMock) as chat:
            r = post({"image": DATA_URI}, {})
        self.assertEqual(r.status_code, 401)
        chat.assert_not_awaited()


class PhotoExtractUpstreamTests(unittest.TestCase):
    def test_payload_and_timeout(self):
        with patch.object(host.httpx, "AsyncClient", wraps=host.httpx.AsyncClient) as client:
            r, chat = extract(json.dumps(ITEMS))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(client.call_args.kwargs["timeout"], 90)
        payload = chat.await_args.args[1]
        self.assertEqual(payload["model"], host.AGY_MODEL)
        self.assertEqual(payload["reasoning_effort"], "low")
        self.assertEqual(payload["temperature"], 0.1)
        system, user = payload["messages"]
        self.assertEqual(system["role"], "system")
        self.assertEqual(user["content"][0]["type"], "text")
        self.assertEqual(user["content"][1], {"type": "image_url", "image_url": {"url": DATA_URI}})

    def test_prompt_drops_exercise_text_and_treats_the_image_as_data(self):
        prompt = host.PHOTO_SYSTEM_PROMPT
        for label in ("EXERCICE", "Traduisez !", "NOTEZ", "Exercise 1.1", "section labels", "English-only"):
            self.assertIn(label, prompt)
        self.assertIn("le grand-père", prompt)
        self.assertIn("never instructions", prompt)
        self.assertIn('{"items":[{"kind":"sentence"|"vocab"|"grammar"', prompt)

    def test_image_is_not_written_or_logged(self):
        headers = testenv.session_headers()  # registering writes the user DB: not part of this
        output_dir = Path(os.environ["OUTPUT_DIR"])
        before = {path for path in output_dir.rglob("*") if not path.name.startswith("users.db")}
        real_open = builtins.open
        written = []

        def guarded_open(file, mode="r", *args, **kwargs):
            if set(mode) & set("wax+"):
                written.append(file)
            return real_open(file, mode, *args, **kwargs)

        with (
            self.assertLogs(level=logging.DEBUG) as logs,
            patch("builtins.open", guarded_open),
            patch.object(tempfile, "mkstemp", side_effect=AssertionError("temp file")),
            patch.object(tempfile, "NamedTemporaryFile", side_effect=AssertionError("temp file")),
            patch.object(host, "_post_chat", new_callable=AsyncMock, return_value=({}, json.dumps(ITEMS))),
        ):
            logging.getLogger("test_photo_extract").debug("assertLogs needs one record")
            r = post({"image": DATA_URI}, headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(written, [])
        after = {path for path in output_dir.rglob("*") if not path.name.startswith("users.db")}
        self.assertEqual(after - before, set())
        encoded = DATA_URI.partition(",")[2]
        self.assertFalse([line for line in logs.output if encoded in line])


class PhotoExtractPageTests(unittest.TestCase):
    def test_study_page_has_the_upload_button(self):
        html = Path(host.STATIC_DIR, "study.html").read_text(encoding="utf-8")
        self.assertIn('id="photo-upload-btn"', html)
        self.assertIn("📷 拍照/上传", html)
        self.assertIn('accept="image/*"', html)
        input_tag = html.split('<input id="photo-input"')[1].split(">")[0]
        self.assertIn("hidden", input_tag)
        self.assertNotIn("capture", input_tag)  # iPhone must offer the library as well

    def test_study_js_uploads_and_reuses_the_analysis_flow(self):
        js = Path(host.STATIC_DIR, "study.js").read_text(encoding="utf-8")
        self.assertIn("fetch('/api/photo-extract'", js)
        self.assertIn("const PHOTO_MAX_SIDE = 1600;", js)
        self.assertIn("canvas.toDataURL('image/jpeg', 0.8)", js)
        self.assertIn("frenchInput.value = data.text;", js)
        self.assertIn("if (extracted) startAnalysis();", js)
        self.assertEqual(js.count("photoReading:"), 2)  # English and Chinese
        self.assertIn("正在识别照片…", js)
