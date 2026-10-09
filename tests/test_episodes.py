import testenv  # noqa: F401  (must run before the app is imported)

import asyncio
import json
import unittest
import uuid
from unittest.mock import AsyncMock, patch

import av
import numpy as np
from fastapi.testclient import TestClient

import auth_db
import episodes
import srs
import tts_service

SENTENCES = [
    {"sentence": "Les cours commencent lundi matin.", "translation_en": "Classes start on Monday morning.",
     "build_up": [{"fr": "Les cours commencent.", "en": "Classes start."},
                  {"fr": "Les cours commencent lundi.", "en": "Classes start on Monday."},
                  {"fr": "Les cours commencent lundi matin.", "en": "Classes start on Monday morning."}],
     "words": [{"fr": "cours"}, {"fr": "commencent"}, {"fr": "lundi"}, {"fr": "matin"}]},
    {"sentence": "Objectifs", "translation_en": "Goals", "words": [{"fr": "Objectifs"}]},
    {"sentence": "Sans traduction anglaise.", "translation_en": "", "words": []},
]


def _user_with_material() -> int:
    user_id = auth_db.register_user(f"ep_{uuid.uuid4().hex[:10]}@example.com", "password123")["user"]["id"]
    auth_db.save_history_record(f"h_{uuid.uuid4().hex}", "study", "texte", {"sentences": SENTENCES}, user_id)
    srs.add_note(user_id, "Bon courage.", "加油", "Good luck.", modes=["listen"],
                 targets=[{"text": "courage", "meta": {}}])
    return user_id


async def fake_synth(text: str, voice: str, rate: str = "+0%") -> np.ndarray:
    seconds = 0.2 + 0.01 * len(text)
    t = np.arange(int(seconds * episodes.SAMPLE_RATE)) / episodes.SAMPLE_RATE
    return (np.sin(2 * np.pi * 220 * t) * 3000).astype(np.int16)


STORY = {"title_en": "At the test centre", "lines": [
    {"speaker": "A", "fr": "Bonjour, je viens pour le TCF.", "en": "Hello, I am here for the TCF."},
    {"speaker": "B", "fr": "Les cours commencent lundi.", "en": "Classes start on Monday."},
    {"speaker": "A", "fr": "Merci beaucoup.", "en": "Thank you very much."},
    {"speaker": "B", "fr": "Bon courage !", "en": "Good luck!"},
]}


class MaterialTests(unittest.TestCase):
    def test_merges_history_and_deck_and_needs_english(self):
        user_id = _user_with_material()
        material = {m["sentence"]: m for m in episodes.learning_material(user_id)}
        self.assertEqual(set(material), {"Les cours commencent lundi matin.", "Objectifs", "Bon courage."})
        self.assertTrue(material["Bon courage."]["in_deck"])
        self.assertEqual(material["Bon courage."]["words"], ["courage"])
        self.assertEqual(len(material["Les cours commencent lundi matin."]["build_up"]), 3)

        review, buildups = episodes.pick_material(user_id, list(material.values()))
        # saved-to-deck first, headings (<4 words) last
        self.assertEqual(review[0]["sentence"], "Bon courage.")
        self.assertEqual(review[-1]["sentence"], "Objectifs")
        self.assertEqual([b["sentence"] for b in buildups], ["Les cours commencent lundi matin."])

    def test_a1_gives_the_meaning_before_the_french(self):
        item = {"key": "k", "sentence": "Je viens de me réveiller.", "en": "I just woke up.", "build_up": [], "words": [], "in_deck": True}
        script = episodes.build_script(1, [item], [], [], episodes.episode_style("A1"))
        lines = [(seg.voice == episodes.EN_VOICE, seg.rate) for seg in script if seg.text in (item["sentence"], item["en"])]
        self.assertEqual(lines, [(True, "+0%"), (False, "-30%"), (False, "-30%"), (False, "+0%"), (False, "+0%")])
        # A2 keeps "try first": French, then the English
        script = episodes.build_script(1, [item], [], [], episodes.episode_style("A2"))
        first = next(seg for seg in script if seg.text in (item["sentence"], item["en"]))
        self.assertEqual(first.text, item["sentence"])

    def test_script_has_review_buildup_story_and_french_only_parts(self):
        user_id = _user_with_material()
        review, buildups = episodes.pick_material(user_id, episodes.learning_material(user_id))
        script = episodes.build_script(3, review, buildups, [STORY])
        english = [seg.text for seg in script if seg.voice == episodes.EN_VOICE]
        self.assertIn("French listening, episode 3", english[0])
        self.assertTrue(any("Part two" in t for t in english))
        self.assertTrue(any("At the test centre" in t for t in english))
        self.assertTrue(any(seg.shadow and seg.rate == episodes.SLOW_RATE for seg in script))
        long_item = {"key": "k", "sentence": " ".join(["mot"] * 20), "en": "words", "build_up": [], "words": [], "in_deck": True}
        slow_long = [seg for seg in episodes.build_script(1, [long_item], [], []) if seg.rate == episodes.SLOW_RATE]
        self.assertFalse(slow_long[0].shadow)
        story_voices = {seg.voice for seg in script if seg.text == "Merci beaucoup."}
        self.assertEqual(story_voices, {episodes.STORY_VOICES["A"]})
        french = [seg for seg in script if seg.voice != episodes.EN_VOICE]
        self.assertTrue({s.voice for s in french} & {"fr-CA-JeanNeural", "fr-CA-SylvieNeural"})


class LevelAndLengthTests(unittest.TestCase):
    def test_level_follows_study_hours(self):
        self.assertEqual(episodes.recommended_level(7), "A1")
        self.assertEqual(episodes.recommended_level(100), "A2")
        self.assertEqual(episodes.recommended_level(300), "B1")
        self.assertEqual(episodes.recommended_level(700), "B2")

    def test_request_adjusts_the_style(self):
        self.assertEqual(episodes.episode_style("A1", {"speed": "slower"})["slow"], "-40%")
        self.assertEqual(episodes.episode_style("B1", {"speed": "slower"})["slow"], "-20%")
        self.assertIsNone(episodes.episode_style("A2", {"speed": "faster"})["slow"])
        less = episodes.episode_style("A1", {"english": "less"})
        self.assertFalse(less["english"] or less["story_english"])

    def test_length_scales_the_content(self):
        style = episodes.episode_style("A1")
        short, long = episodes.episode_plan(20, style, 200), episodes.episode_plan(60, style, 200)
        self.assertGreater(long["review"], short["review"])
        self.assertGreater(long["stories"], short["stories"])
        # Few studied sentences: more stories fill the time
        self.assertGreater(episodes.episode_plan(60, style, 5)["stories"], long["stories"])
        self.assertLessEqual(episodes.episode_plan(60, style, 0)["stories"], episodes.MAX_STORIES)

    def test_b2_has_no_english_lines_or_slow_repeats(self):
        user_id = _user_with_material()
        review, buildups = episodes.pick_material(user_id, episodes.learning_material(user_id))
        script = episodes.build_script(1, review, buildups, [STORY], episodes.episode_style("B2"))
        english = [seg.text for seg in script if seg.voice == episodes.EN_VOICE]
        self.assertFalse(any(item["en"] in english for item in review))
        self.assertNotIn("Thank you very much.", english)
        self.assertFalse(any(seg.rate != "+0%" for seg in script if seg.voice != episodes.EN_VOICE))


class RenderTests(unittest.TestCase):
    def test_render_writes_mp3_and_subtitles(self):
        segments = [
            episodes.Segment("Bonjour.", "fr-FR-DeniseNeural", subtitle="Bonjour.\nHello.", pause_after=0.5),
            episodes.Segment("Hello.", episodes.EN_VOICE, pause_after=0.5),
            episodes.Segment("Bonjour.", "fr-FR-DeniseNeural", rate=episodes.SLOW_RATE, shadow=True),
        ]
        base = episodes.episodes_dir() / uuid.uuid4().hex
        duration = asyncio.run(episodes.render(segments, base, "Test", synth=fake_synth))
        self.assertGreater(duration, 1.5)
        container = av.open(str(base.with_suffix(".mp3")))
        self.assertAlmostEqual(float(container.duration) / av.time_base, duration, delta=0.2)
        srt = base.with_suffix(".srt").read_text()
        self.assertIn("00:00:00,000 --> ", srt)
        self.assertIn("Bonjour.\nHello.", srt)
        lrc = base.with_suffix(".lrc").read_text().splitlines()
        self.assertEqual(lrc[0], "[ti:Test]")
        self.assertEqual(lrc[1], "[00:00.00]Bonjour. / Hello.")
        self.assertEqual(len(lrc), 4)


class JobAndApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_listen_page_is_served(self):
        res = self.client.get("/listen")
        self.assertEqual(res.status_code, 200)
        self.assertIn(f"/static/listen.js?v={tts_service.ASSET_VERSION}", res.text)

    def test_endpoints_require_login(self):
        self.assertEqual(self.client.get("/api/episodes").status_code, 401)
        self.assertEqual(self.client.post("/api/episodes").status_code, 401)
        self.assertEqual(self.client.get("/episodes/not-an-id.mp3").status_code, 404)

    def test_story_parser_validates_lines(self):
        self.assertEqual(tts_service._parse_story(json.dumps(STORY))["lines"][1]["speaker"], "B")
        self.assertIsNone(tts_service._parse_story(json.dumps({"lines": STORY["lines"][:2]})))
        self.assertIsNone(tts_service._parse_story("nope"))

    def test_generate_episode_job_end_to_end(self):
        user_id = _user_with_material()
        episode = episodes.create_episode(user_id)
        with patch("episodes.synthesize", side_effect=fake_synth), \
                patch("tts_service._write_stories", new_callable=AsyncMock, return_value=[STORY]):
            asyncio.run(tts_service._generate_episode(user_id, episode["id"], "k", "gemini-3.8-flash"))
        ready = episodes.get_episode(user_id, episode["id"])
        self.assertEqual(ready["status"], "ready", ready["error"])
        self.assertEqual(ready["title"], "Episode 1 · At the test centre")
        self.assertGreater(ready["duration"], 10)

        token = auth_db._generate_token(user_id, "x@example.com", auth_db._start_session(user_id, "test"))
        listed = self.client.get("/api/episodes", headers={"Authorization": f"Bearer {token}"}).json()
        self.assertEqual(listed["episodes"][0]["id"], episode["id"])
        audio = self.client.get(f"/episodes/{episode['id']}.mp3")
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(audio.headers["content-type"], "audio/mpeg")
        lrc = self.client.get(f"/episodes/{episode['id']}.lrc?download=true")
        self.assertIn("attachment", lrc.headers["content-disposition"])

        # the next episode prefers material that was not played yet
        usage = episodes._sentence_usage(user_id)
        self.assertTrue(all(count == 1 for count in usage.values()))

        other = auth_db._generate_token(user_id + 999, "y@example.com", auth_db._start_session(user_id + 999, "test"))
        self.assertFalse(self.client.delete(f"/api/episodes/{episode['id']}", headers={"Authorization": f"Bearer {other}"}).json()["success"])
        self.assertTrue(self.client.delete(f"/api/episodes/{episode['id']}", headers={"Authorization": f"Bearer {token}"}).json()["success"])
        self.assertEqual(self.client.get(f"/episodes/{episode['id']}.mp3").status_code, 404)

    def test_settings_are_saved_and_a_remake_replaces_the_old_episode(self):
        user_id = _user_with_material()
        token = auth_db._generate_token(user_id, "x@example.com", auth_db._start_session(user_id, "test"))
        headers = {"Authorization": f"Bearer {token}"}
        old = episodes.create_episode(user_id, {"level": "A1", "minutes": 20})
        episodes.update_episode(old["id"], status="ready", title="Episode 1")
        with patch("tts_service._generate_episode", new_callable=AsyncMock) as job:
            res = self.client.post("/api/episodes", headers=headers,
                                   json={"level": "B1", "minutes": 45, "request": "more numbers", "replace_id": old["id"]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["settings"], {"level": "B1", "minutes": 45, "request": "more numbers"})
        self.assertEqual(job.await_args.args[5], old["id"])
        bad = self.client.post("/api/episodes", headers=headers, json={"minutes": 25})
        self.assertEqual(bad.status_code, 422)
        listed = self.client.get("/api/episodes", headers=headers).json()
        self.assertEqual(listed["recommended_level"], "A1")
        self.assertEqual(listed["lengths"], [20, 30, 45, 60])

        new = episodes.create_episode(user_id, {"level": "B1", "minutes": 45, "request": "more numbers"})
        with patch("episodes.synthesize", side_effect=fake_synth), \
                patch("tts_service._read_episode_request", new_callable=AsyncMock, return_value={"speed": "slower", "focus": "numbers"}), \
                patch("tts_service._write_stories", new_callable=AsyncMock, return_value=[STORY]) as stories:
            asyncio.run(tts_service._generate_episode(user_id, new["id"], "k", "gemini-3.8-flash",
                                                      {"level": "B1", "minutes": 45, "request": "more numbers"}, old["id"]))
        ready = episodes.get_episode(user_id, new["id"])
        self.assertEqual(ready["status"], "ready", ready["error"])
        self.assertEqual(ready["settings"]["adjust"], {"speed": "slower", "focus": "numbers"})
        self.assertEqual(stories.await_args.kwargs["level"], "B1")
        self.assertEqual(stories.await_args.kwargs["focus"], "numbers")
        with self.assertRaises(KeyError):
            episodes.get_episode(user_id, old["id"])

    def test_episode_request_is_read_into_style_changes(self):
        reply = (None, '{"speed": "slower", "english": "less", "focus": "numbers and dates", "extra": 1}')
        with patch("tts_service._post_chat", new_callable=AsyncMock, return_value=reply):
            adjust = asyncio.run(tts_service._read_episode_request("k", "too fast, more numbers, less English"))
        self.assertEqual(adjust, {"speed": "slower", "english": "less", "focus": "numbers and dates"})
        with patch("tts_service._post_chat", new_callable=AsyncMock, return_value=(None, "not json")):
            self.assertEqual(asyncio.run(tts_service._read_episode_request("k", "hm")), {})

    def test_job_without_material_fails_cleanly(self):
        user_id = auth_db.register_user(f"empty_{uuid.uuid4().hex[:10]}@example.com", "password123")["user"]["id"]
        episode = episodes.create_episode(user_id)
        asyncio.run(tts_service._generate_episode(user_id, episode["id"], None, "gemini-3.8-flash"))
        failed = episodes.get_episode(user_id, episode["id"])
        self.assertEqual(failed["status"], "failed")
        self.assertIn("No studied sentences", failed["error"])


if __name__ == "__main__":
    unittest.main()
