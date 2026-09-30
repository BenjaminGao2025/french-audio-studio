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

        token = auth_db._generate_token(user_id, "x@example.com")
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

        other = auth_db._generate_token(user_id + 999, "y@example.com")
        self.assertFalse(self.client.delete(f"/api/episodes/{episode['id']}", headers={"Authorization": f"Bearer {other}"}).json()["success"])
        self.assertTrue(self.client.delete(f"/api/episodes/{episode['id']}", headers={"Authorization": f"Bearer {token}"}).json()["success"])
        self.assertEqual(self.client.get(f"/episodes/{episode['id']}.mp3").status_code, 404)

    def test_job_without_material_fails_cleanly(self):
        user_id = auth_db.register_user(f"empty_{uuid.uuid4().hex[:10]}@example.com", "password123")["user"]["id"]
        episode = episodes.create_episode(user_id)
        asyncio.run(tts_service._generate_episode(user_id, episode["id"], None, "gemini-3.8-flash"))
        failed = episodes.get_episode(user_id, episode["id"])
        self.assertEqual(failed["status"], "failed")
        self.assertIn("No studied sentences", failed["error"])


if __name__ == "__main__":
    unittest.main()
