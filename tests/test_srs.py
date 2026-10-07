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


class EnglishBackfillTests(unittest.TestCase):
    def test_backfill_fills_missing_english_only(self):
        import asyncio
        import json
        from unittest.mock import AsyncMock, patch

        user_id, _ = _new_user()
        keep = srs.add_note(user_id, "Bonjour.", "你好。", "Hello.", modes=["listen"])
        old = srs.add_note(user_id, "Délivrance des résultats", "成绩发放",
                           targets=[{"text": "Délivrance", "meta": {"meaning_zh": "发放"}}])
        card_id = old["cards"][0]["id"]
        missing = srs.missing_english(user_id)
        self.assertEqual([n["id"] for n in missing["notes"]], [old["id"]])
        self.assertEqual([c["id"] for c in missing["cards"]], [card_id])

        replies = [
            ({}, json.dumps({"items": [{"id": old["id"], "en": "Release of results"}, {"id": "bogus", "en": "x"}]})),
            ({}, json.dumps({"items": [{"id": card_id, "en": "release, issuing"}]})),
        ]
        with patch("tts_service._post_chat", new_callable=AsyncMock, side_effect=replies):
            result = asyncio.run(tts_service.backfill_english(user_id, "k"))
        self.assertEqual(result, {"missing_notes": 1, "missing_cards": 1, "updated": 2})
        notes = {n["id"]: n for n in srs.lookup_notes(user_id, ["Bonjour.", "Délivrance des résultats"])}
        self.assertEqual(notes[old["id"]]["translation_en"], "Release of results")
        self.assertEqual(notes[keep["id"]]["translation_en"], "Hello.")
        self.assertEqual(notes[old["id"]]["cards"][0]["target_meta"]["meaning_en"], "release, issuing")
        self.assertEqual(srs.missing_english(user_id), {"notes": [], "cards": []})


class ImportanceAndWordsTests(unittest.TestCase):
    def setUp(self):
        self.user_id, self.headers = _new_user()

    def test_default_importance_filter_and_order(self):
        low = srs.add_note(self.user_id, "Phrase peu importante.", targets=[{"text": "peu", "importance": 1}])
        high = srs.add_note(self.user_id, "Phrase très importante.", targets=[{"text": "très", "importance": 5}])
        mid = srs.add_note(self.user_id, "Phrase normale.", modes=["listen"])
        self.assertEqual(mid["cards"][0]["importance"], 3)

        queue = srs.build_queue(self.user_id)
        self.assertEqual([c["importance"] for c in queue["cards"]], [5, 3, 1])  # important first
        only_top = srs.build_queue(self.user_id, min_importance=4)
        self.assertEqual([c["target"] for c in only_top["cards"]], ["très"])

        other_id, _ = _new_user()
        self.assertEqual(srs.set_importance(other_id, [low["cards"][0]["id"]], 5), 0)
        self.assertEqual(srs.set_importance(self.user_id, [low["cards"][0]["id"]], 9), 1)  # clamped to 5
        self.assertEqual(srs.build_queue(self.user_id, min_importance=5)["counts"]["total"], 2)
        self.assertEqual(high["cards"][0]["importance"], 5)

    def test_saved_words_span_all_sentences(self):
        srs.add_note(self.user_id, "Voici l'examen.", targets=[{"text": "Voici"}])
        srs.add_note(self.user_id, "Bonjour.", modes=["listen"])
        words = srs.saved_words(self.user_id)
        self.assertEqual([(w["text"], w["sentence"]) for w in words], [("Voici", "Voici l'examen.")])

    def test_api_importance_and_words(self):
        note = self.client_post({"sentence": "Voici le test.", "targets": [{"text": "Voici", "importance": 4}]})
        card_id = note["cards"][0]["id"]
        self.assertEqual(note["cards"][0]["importance"], 4)
        from fastapi.testclient import TestClient
        client = TestClient(tts_service.app)
        res = client.post("/api/srs/importance", headers=self.headers, json={"card_ids": [card_id], "importance": 2})
        self.assertEqual(res.json(), {"updated": 1})
        words = client.get("/api/srs/words", headers=self.headers).json()["words"]
        self.assertEqual([(w["text"], w["importance"]) for w in words], [("Voici", 2)])
        self.assertEqual(client.get("/api/srs/queue?min_importance=3", headers=self.headers).json()["counts"]["total"], 0)

    def client_post(self, body):
        from fastapi.testclient import TestClient
        return TestClient(tts_service.app).post("/api/srs/notes", headers=self.headers, json=body).json()

    def test_old_database_gets_importance_column(self):
        import sqlite3
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        path = Path(tempfile.mkdtemp()) / "users.db"
        with sqlite3.connect(path) as conn:
            conn.execute("CREATE TABLE srs_cards (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, user_id INTEGER NOT NULL, "
                         "mode TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', target_json TEXT NOT NULL DEFAULT '{}', "
                         "fsrs_json TEXT NOT NULL, due TEXT NOT NULL, is_new INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)")
            conn.execute("INSERT INTO srs_cards VALUES ('c1', 'n1', 1, 'listen', '', '{}', '{}', 'x', 1, 'x')")
        with patch("auth_db._get_db_path", return_value=path):
            srs.init_db()
        with sqlite3.connect(path) as conn:
            self.assertEqual(conn.execute("SELECT importance FROM srs_cards WHERE id = 'c1'").fetchone()[0], 3)


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


class CardBalanceTests(unittest.TestCase):
    def setUp(self):
        self.user_id, self.headers = _new_user()
        self.client = TestClient(tts_service.app)

    def test_sentence_word_count(self):
        self.assertEqual(srs.sentence_word_count("Bonjour tout le monde !"), 4)
        self.assertEqual(srs.sentence_word_count("J'ai un rendez-vous."), 4)
        self.assertEqual(srs.sentence_word_count("C'est l'heure de partir."), 6)

    def test_expand_function_word(self):
        # Content word remains unchanged
        self.assertEqual(srs.expand_function_word("Je vais à la gare.", "gare"), "gare")
        # Function word expands to neighbouring chunk (2-4 words)
        self.assertEqual(srs.expand_function_word("Je vais à la gare.", "à"), "à la gare")
        self.assertEqual(srs.expand_function_word("Je prends le train.", "le"), "le train")
        self.assertEqual(srs.expand_function_word("Je ne sais pas.", "ne"), "ne sais pas")
        self.assertEqual(srs.expand_function_word("Je ne sais pas.", "pas"), "ne sais pas")
        self.assertEqual(srs.expand_function_word("C'est à moi.", "à"), "à moi")
        # With extra phrase/grammar
        self.assertEqual(
            srs.expand_function_word("C'est tout de suite.", "de", extra={"phrase": "tout de suite"}),
            "tout de suite",
        )

    def test_auto_listen_added_for_short_sentence_with_cloze(self):
        note = srs.add_note(
            self.user_id,
            "Je prends le train pour aller à Paris.",
            targets=[{"text": "train"}],
            auto_listen=True,
        )
        modes = sorted(c["mode"] for c in note["cards"])
        self.assertEqual(modes, ["cloze", "listen"])

    def test_auto_listen_not_added_for_long_sentence(self):
        long_sentence = (
            "Un deux trois quatre cinq six sept huit neuf dix "
            "onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt "
            "vingt-et-un vingt-deux vingt-trois vingt-quatre vingt-cinq vingt-six."
        )
        self.assertGreater(srs.sentence_word_count(long_sentence), 25)
        note = srs.add_note(
            self.user_id,
            long_sentence,
            targets=[{"text": "trois"}],
            auto_listen=True,
        )
        modes = [c["mode"] for c in note["cards"]]
        self.assertEqual(modes, ["cloze"])

    def test_auto_listen_function_word_chunked_in_add_note(self):
        note = srs.add_note(
            self.user_id,
            "Je vais à la gare.",
            targets=[{"text": "à"}],
            auto_listen=True,
        )
        cloze_card = next(c for c in note["cards"] if c["mode"] == "cloze")
        self.assertEqual(cloze_card["target"], "à la gare")
        self.assertTrue(any(c["mode"] == "listen" for c in note["cards"]))

    def test_api_notes_auto_listen_and_chunk(self):
        res = self.client.post(
            "/api/srs/notes",
            headers=self.headers,
            json={
                "sentence": "Je prends le train.",
                "targets": [{"text": "le"}],
                "auto_listen": True,
            },
        )
        self.assertEqual(res.status_code, 200)
        cards = res.json()["cards"]
        cloze_card = next(c for c in cards if c["mode"] == "cloze")
        self.assertEqual(cloze_card["target"], "le train")
        self.assertTrue(any(c["mode"] == "listen" for c in cards))
        self.assertFalse(any(c["mode"] == "speak" for c in cards))

    def test_backfill_listen_cards(self):
        user_id, _ = _new_user()
        # Note 1: short sentence, only cloze -> eligible
        note1 = srs.add_note(user_id, "Je vais au supermarché.", targets=[{"text": "supermarché"}], auto_listen=False)
        self.assertEqual([c["mode"] for c in note1["cards"]], ["cloze"])

        # Note 2: long sentence, only cloze -> skipped
        long_sentence = (
            "Un deux trois quatre cinq six sept huit neuf dix "
            "onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt "
            "vingt-et-un vingt-deux vingt-trois vingt-quatre vingt-cinq vingt-six."
        )
        srs.add_note(user_id, long_sentence, targets=[{"text": "quatre"}], auto_listen=False)

        # Note 3: already has listen card -> not touched
        srs.add_note(user_id, "Bonjour tout le monde.", modes=["listen"])

        # Dry run
        dry = srs.backfill_listen_cards(user_id=user_id, dry_run=True)
        self.assertEqual(dry["eligible"], 1)
        self.assertEqual(dry["created"], 0)
        self.assertEqual(dry["skipped_too_long"], 1)

        # Real run
        real = srs.backfill_listen_cards(user_id=user_id, dry_run=False)
        self.assertEqual(real["eligible"], 1)
        self.assertEqual(real["created"], 1)
        self.assertEqual(real["skipped_too_long"], 1)

        # Verify note 1 now has listen card
        updated_note1 = srs.get_note(user_id, note1["id"])
        updated_modes = sorted(c["mode"] for c in updated_note1["cards"])
        self.assertEqual(updated_modes, ["cloze", "listen"])

        # Idempotent: second run does nothing
        second = srs.backfill_listen_cards(user_id=user_id, dry_run=False)
        self.assertEqual(second["eligible"], 0)
        self.assertEqual(second["created"], 0)


if __name__ == "__main__":
    unittest.main()

