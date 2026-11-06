"""Adding to review is manual: starring a word never creates sentence cards.

Regression cover for a word star sending auto_listen=true (the server then added a
listen card to the sentence note) while the sentence button counted that listen card
as "In review", so the button looked active before it was ever clicked.
"""

import pathlib
import re
import unittest
import uuid

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient

import auth_db
import srs
import tts_service

ROOT = pathlib.Path(__file__).resolve().parent.parent
STUDY_JS = (ROOT / "static" / "study.js").read_text(encoding="utf-8")
POPOVER_JS = (ROOT / "static" / "word-popover.js").read_text(encoding="utf-8")


def _new_user() -> int:
    return auth_db.register_user(f"manual_{uuid.uuid4().hex[:10]}@example.com", "password123")["user"]["id"]


class AddNoteDefaultsTests(unittest.TestCase):
    def test_targets_alone_create_no_listen_card(self):
        note = srs.add_note(_new_user(), "Je prends le train.", targets=[{"text": "train"}])
        self.assertEqual([c["mode"] for c in note["cards"]], ["cloze"])

    def test_targets_alone_create_no_speak_card(self):
        note = srs.add_note(_new_user(), "Je prends le train.", targets=[{"text": "train"}])
        self.assertFalse(any(c["mode"] == "speak" for c in note["cards"]))

    def test_api_defaults_to_no_listen_card(self):
        token = auth_db.register_user(f"manual_{uuid.uuid4().hex[:10]}@example.com", "password123")["token"]
        res = TestClient(tts_service.app).post(
            "/api/srs/notes",
            headers={"Authorization": f"Bearer {token}"},
            json={"sentence": "Je prends le train.", "targets": [{"text": "train"}]},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual([c["mode"] for c in res.json()["cards"]], ["cloze"])

    def test_explicit_auto_listen_still_supported(self):
        # The server parameter keeps working; only the frontend stops sending it.
        note = srs.add_note(_new_user(), "Je prends le train.", targets=[{"text": "train"}], auto_listen=True)
        self.assertEqual(sorted(c["mode"] for c in note["cards"]), ["cloze", "listen"])


class FrontendIsManualTests(unittest.TestCase):
    def test_word_popover_no_longer_requests_auto_listen(self):
        self.assertNotIn("auto_listen", POPOVER_JS)
        self.assertNotIn("autoListen", POPOVER_JS)

    def test_sentence_button_counts_only_sentence_level_modes(self):
        match = re.search(r"function sentenceCards\(sentence\) \{(.*?)\n    \}", STUDY_JS, re.S)
        self.assertIsNotNone(match, "sentenceCards source")
        body = match.group(1)
        self.assertIn("SENTENCE_CARD_MODES", body)
        modes = re.search(r"SENTENCE_CARD_MODES = new Set\(\[([^\]]*)\]\)", STUDY_JS)
        self.assertIsNotNone(modes, "SENTENCE_CARD_MODES definition")
        self.assertEqual(
            {part.strip().strip("'\"") for part in modes.group(1).split(",") if part.strip()},
            {"listen", "speak"},
        )
        for word_mode in ("'cloze'", "'recognize'", "'grammar'"):
            self.assertNotIn(word_mode, body)

    def test_sentence_button_removes_only_sentence_level_cards(self):
        match = re.search(r"async function toggleSentenceCards\(sentence\) \{(.*?)\n    \}", STUDY_JS, re.S)
        self.assertIsNotNone(match, "toggleSentenceCards source")
        body = match.group(1)
        self.assertIn("const existing = sentenceCards(sentence);", body)
        self.assertIn("for (const card of existing)", body)
        self.assertNotIn("cloze", body)
        self.assertNotIn("recognize", body)
        self.assertNotIn("grammar", body)

    def test_sentence_button_labels_and_tooltip_exist_in_both_languages(self):
        self.assertIn("sentenceInReview: 'In review ✓'", STUDY_JS)
        self.assertIn("sentenceInReview: '已加入复习 ✓'", STUDY_JS)
        self.assertIn("sentenceRemove: 'Click to remove'", STUDY_JS)
        self.assertIn("sentenceRemove: '点击移除'", STUDY_JS)
        self.assertIn("btn.title = saved ? T.sentenceRemove : T.sentenceAdd;", STUDY_JS)
        self.assertIn("label.textContent = saved ? T.sentenceInReview : T.addToReview;", STUDY_JS)


if __name__ == "__main__":
    unittest.main()
