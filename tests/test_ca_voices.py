import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CA = {"fr-CA-SylvieNeural", "fr-CA-JeanNeural", "fr-CA-AntoineNeural"}


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class CanadianVoiceTests(unittest.TestCase):
    """Study and review playback pick a random Canadian French voice (no fixed fr-FR voice)."""

    def test_pages_use_random_canadian_voices(self):
        for path in ("static/study.js", "static/review.js", "frontend/src/api/real.ts"):
            src = _read(path)
            self.assertNotIn("fr-FR-DeniseNeural", src, path)
            self.assertEqual(set(re.findall(r"fr-CA-\w+Neural", src)), CA, path)
            self.assertIn("Math.random()", src, path)

    def test_built_app_matches_source(self):
        built = "".join(p.read_text(encoding="utf-8") for p in (ROOT / "static/app/assets").glob("*.js"))
        self.assertNotIn("fr-FR-DeniseNeural", built)
        for voice in CA:
            self.assertIn(voice, built)

    def test_server_accepts_the_voices(self):
        src = _read("tts_service.py")
        start = src.index("SUPPORTED_VOICES = {")
        block = src[start:src.index("}", start)]
        for voice in CA:
            self.assertIn(f'"{voice}"', block)


if __name__ == "__main__":
    unittest.main()
