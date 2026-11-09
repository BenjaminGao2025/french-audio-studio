"""Adding to review is manual: starring a word never creates sentence cards.

Regression cover for a word star sending auto_listen=true (the server then added a
listen card to the sentence note) while the sentence button counted that listen card
as "In review", so the button looked active before it was ever clicked.
"""

import unittest
import uuid

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient

import auth_db
import srs
import tts_service


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


if __name__ == "__main__":
    unittest.main()
