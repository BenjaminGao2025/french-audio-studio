import testenv  # noqa: F401  (must run before the app is imported)

import datetime
import unittest
import uuid

from fastapi.testclient import TestClient

import auth_db
import srs
import tts_service

UTC = datetime.timezone.utc


def _new_user() -> tuple[int, dict]:
    reg = auth_db.register_user(f"srs_{uuid.uuid4().hex[:10]}@example.com", "password123")
    return reg["user"]["id"], {"Authorization": f"Bearer {reg['token']}"}


class StudyDayTests(unittest.TestCase):
    def test_day_starts_at_4am_local(self):
        # 02:00 local (UTC-4) still belongs to the previous study day.
        now = datetime.datetime(2026, 9, 30, 6, 0, tzinfo=UTC)  # 02:00 EDT
        start = srs.study_day_start(now, tz_offset_minutes=240)
        self.assertEqual(start, datetime.datetime(2026, 9, 29, 8, 0, tzinfo=UTC))

        later = datetime.datetime(2026, 9, 30, 9, 0, tzinfo=UTC)  # 05:00 EDT
        self.assertEqual(
            srs.study_day_start(later, 240), datetime.datetime(2026, 9, 30, 8, 0, tzinfo=UTC)
        )


class TargetMatchTests(unittest.TestCase):
    def test_whole_word_matching(self):
        self.assertFalse(srs.target_in_sentence("Je prends le train.", "en"))
        self.assertTrue(srs.target_in_sentence("Je prends le train.", "le train"))
        self.assertTrue(srs.target_in_sentence("L'homme arrive.", "l'"))
        self.assertTrue(srs.target_in_sentence("Aucune dispense n'est autorisée.", "N'EST"))


class SrsStoreTests(unittest.TestCase):
    def setUp(self):
        self.user_id, _ = _new_user()

    def test_add_note_is_idempotent_and_dedupes_sentences(self):
        first = srs.add_note(self.user_id, "Les cours commencent lundi.", "课程周一开始。", modes=["listen", "speak"])
        again = srs.add_note(
            self.user_id,
            "les  cours commencent lundi.",
            modes=["listen"],
            targets=[{"text": "commencent", "meta": {"meaning_zh": "开始"}}],
        )
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(again["translation_zh"], "课程周一开始。")
        modes = sorted((c["mode"], c["target"]) for c in again["cards"])
        self.assertEqual(modes, [("cloze", "commencent"), ("listen", ""), ("speak", "")])
        cloze = next(c for c in again["cards"] if c["mode"] == "cloze")
        self.assertEqual(cloze["target_meta"], {"meaning_zh": "开始"})
        self.assertTrue(all(c["state"] == "new" for c in again["cards"]))

    def test_queue_buries_siblings_and_orders_listen_first(self):
        srs.add_note(self.user_id, "Je vais au marché.", modes=["speak", "listen"])
        queue = srs.build_queue(self.user_id)
        self.assertEqual([c["mode"] for c in queue["cards"]], ["listen"])
        self.assertEqual(queue["counts"]["new"], 1)
        self.assertIn("note", queue["cards"][0])
        self.assertEqual(set(queue["cards"][0]["intervals"]), {"1", "2", "3", "4"})

    def test_new_limit_counts_cards_started_today(self):
        for i in range(4):
            srs.add_note(self.user_id, f"Phrase numéro {i}.", modes=["listen"])
        queue = srs.build_queue(self.user_id, new_limit=2)
        self.assertEqual(len(queue["cards"]), 2)

        srs.review_card(self.user_id, queue["cards"][0]["id"], 4)  # Easy graduates it
        queue = srs.build_queue(self.user_id, new_limit=2)
        self.assertEqual(queue["counts"]["new_today"], 1)
        self.assertEqual(queue["counts"]["new"], 1)

    def test_again_keeps_card_in_learning_and_in_queue(self):
        note = srs.add_note(self.user_id, "Bon courage.", modes=["listen", "speak"])
        listen = next(c for c in note["cards"] if c["mode"] == "listen")
        reviewed = srs.review_card(self.user_id, listen["id"], 1, duration_ms=4000, answer="加油")
        self.assertEqual(reviewed["state"], "learning")
        self.assertLessEqual(reviewed["intervals"]["1"], 600)

        queue = srs.build_queue(self.user_id)
        # The learning card comes back; its sibling "speak" stays buried today.
        self.assertEqual([c["id"] for c in queue["cards"]], [listen["id"]])

    def test_good_review_schedules_into_future(self):
        note = srs.add_note(self.user_id, "Merci beaucoup.", modes=["listen"])
        card_id = note["cards"][0]["id"]
        now = datetime.datetime.now(UTC)
        for minutes in (0, 2, 15):
            card = srs.review_card(self.user_id, card_id, 3, now=now + datetime.timedelta(minutes=minutes))
        self.assertEqual(card["state"], "review")
        self.assertGreater(card["due"], (now + datetime.timedelta(hours=12)).isoformat())

    def test_review_card_due_later_today_is_in_todays_queue(self):
        note = srs.add_note(self.user_id, "On se voit demain.", modes=["listen"])
        card_id = note["cards"][0]["id"]
        # Graduate at 09:00 local (UTC-7) so the next due time is ~09:00 on a later day.
        first = datetime.datetime(2026, 9, 1, 16, 0, tzinfo=UTC)
        card = srs.review_card(self.user_id, card_id, 4, now=first)
        due = datetime.datetime.fromisoformat(card["due"])
        self.assertEqual(card["state"], "review")
        # On the due day at 08:30 local the card is not yet past its exact due time,
        # but it belongs to that study day and must be offered.
        morning = due.replace(hour=15, minute=30)
        queue = srs.build_queue(self.user_id, tz_offset_minutes=420, now=morning)
        self.assertEqual([c["id"] for c in queue["cards"]], [card_id])
        # The evening before (previous study day) it is not due yet.
        evening_before = morning - datetime.timedelta(hours=14)
        queue = srs.build_queue(self.user_id, tz_offset_minutes=420, now=evening_before)
        self.assertEqual(queue["cards"], [])

    def test_cloze_target_missing_from_sentence_becomes_recognize(self):
        note = srs.add_note(self.user_id, "Je prends le train.", targets=[{"text": "en"}, {"text": "train"}])
        modes = sorted((c["mode"], c["target"]) for c in note["cards"])
        self.assertEqual(modes, [("cloze", "train"), ("recognize", "en")])

    def test_cards_are_private_per_user(self):
        other_id, _ = _new_user()
        note = srs.add_note(self.user_id, "C'est à moi.", modes=["listen"])
        card_id = note["cards"][0]["id"]
        self.assertEqual(srs.build_queue(other_id)["cards"], [])
        self.assertFalse(srs.delete_card(other_id, card_id))
        with self.assertRaises(KeyError):
            srs.review_card(other_id, card_id, 3)
        self.assertEqual(srs.lookup_notes(other_id, ["C'est à moi."]), [])

    def test_deleting_last_card_removes_note(self):
        note = srs.add_note(self.user_id, "Au revoir.", modes=["listen"])
        self.assertTrue(srs.delete_card(self.user_id, note["cards"][0]["id"]))
        self.assertEqual(srs.lookup_notes(self.user_id, ["Au revoir."]), [])

    def test_import_legacy_cards(self):
        result = srs.import_legacy_cards(self.user_id, [
            {"token": "dispense", "sentence": "Aucune dispense n'est autorisée.", "sentence_cn": "不允许任何豁免。",
             "explanation_en": "exemption", "phonetic": "[dispɑ̃s]"},
            {"token": "aucune … ne", "sentence": "Aucune dispense n'est autorisée.",
             "explanation_cn": "\U0001F4A1 aucune 已经表示否定", "hook": "Aucun problème!"},
            {"token": "ouvrés"},
            {"token": "  "},
        ])
        self.assertEqual(result, {"imported": 3, "skipped": 1})
        notes = srs.lookup_notes(self.user_id, ["Aucune dispense n'est autorisée.", "ouvrés"])
        cards = sorted((c["mode"], c["target"]) for n in notes for c in n["cards"])
        self.assertEqual(
            cards,
            [("cloze", "dispense"), ("recognize", "aucune … ne"), ("recognize", "ouvrés")],
        )
        pattern = next(c for n in notes for c in n["cards"] if c["target"] == "aucune … ne")
        self.assertEqual(pattern["target_meta"]["meaning_zh"], "aucune 已经表示否定")


class SrsApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        _, self.headers = _new_user()

    def test_srs_endpoints_require_login(self):
        self.assertEqual(self.client.get("/api/srs/queue").status_code, 401)
        self.assertEqual(self.client.post("/api/srs/notes", json={"sentence": "x"}).status_code, 401)

    def test_add_review_and_list_flow(self):
        res = self.client.post("/api/srs/notes", headers=self.headers, json={
            "sentence": "Les étudiants doivent être ponctuels.",
            "translation_zh": "学生们必须准时。",
            "modes": ["listen", "speak"],
            "targets": [{"text": "ponctuels", "meta": {"meaning_zh": "准时的"}}],
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()["cards"]), 3)

        queue = self.client.get("/api/srs/queue?tz_offset=240", headers=self.headers).json()
        self.assertEqual(queue["counts"]["total"], 1)
        card = queue["cards"][0]
        self.assertEqual(card["mode"], "listen")

        reviewed = self.client.post(
            f"/api/srs/cards/{card['id']}/review", headers=self.headers,
            json={"rating": 3, "duration_ms": 5000},
        )
        self.assertEqual(reviewed.status_code, 200)
        self.assertEqual(reviewed.json()["state"], "learning")

        bad = self.client.post(f"/api/srs/cards/{card['id']}/review", headers=self.headers, json={"rating": 5})
        self.assertEqual(bad.status_code, 422)

        listed = self.client.get("/api/srs/cards?q=ponctuels", headers=self.headers).json()["cards"]
        self.assertEqual(len(listed), 3)

        lookup = self.client.post(
            "/api/srs/notes/lookup", headers=self.headers,
            json={"sentences": ["Les étudiants doivent être ponctuels."]},
        ).json()["notes"]
        self.assertEqual(len(lookup), 1)

    def test_review_page_is_served(self):
        res = self.client.get("/review")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("__ASSET_VERSION__", res.text)


if __name__ == "__main__":
    unittest.main()
