import json
import pathlib
import re
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CA = ["fr-CA-SylvieNeural", "fr-CA-JeanNeural", "fr-CA-AntoineNeural"]
SAMPLES = ["Bonjour.", "  Bonjour.  ", "la sûreté", "Ces droits sont la liberté, la propriété, la sûreté, et la résistance à l'oppression.", "", "Ça va ?"]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def voice_for(text):
    """Reference FNV-1a (32-bit) over UTF-16 code units of the trimmed text, like the JS versions.
    (djb2 would not do: its multiplier 33 is divisible by 3, so h % 3 would only depend on the
    last character and nearly every sentence, ending in ".", would get the same voice.)"""
    key = text.strip()
    h = 0x811C9DC5
    data = key.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h = ((h ^ int.from_bytes(data[i:i + 2], "little")) * 16777619) & 0xFFFFFFFF
    return CA[h % 3]


def _function(src, name):
    start = src.index(f"function {name}(")
    end = src.index("\n    }\n", start) + 6
    return src[start:end]


class CanadianVoiceTests(unittest.TestCase):
    """Study, review and app playback use a Canadian voice chosen by a stable hash of the text."""

    def test_sources_use_the_stable_canadian_voice(self):
        for path in ("static/study.js", "static/review.js", "frontend/src/api/real.ts"):
            src = _read(path)
            self.assertNotIn("fr-FR-DeniseNeural", src, path)
            self.assertNotIn("Math.random", src, path)
            self.assertEqual(re.findall(r"fr-CA-\w+Neural", src)[:3], CA, path)
            self.assertIn("Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0", src, path)

    def test_reference_hash_is_deterministic_and_varies(self):
        for text in SAMPLES:
            self.assertEqual(voice_for(text), voice_for(text))
        self.assertEqual(voice_for("Bonjour."), voice_for("  Bonjour.  "))
        # Sentences ending alike still spread over all three voices
        self.assertEqual(len({voice_for(f"Phrase numéro {i}.") for i in range(30)}), 3)

    def test_js_implementations_agree(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is needed")
        study = _function(_read("static/study.js"), "frenchVoiceFor")
        review = _function(_read("static/review.js"), "voiceFor")
        script = (
            f"const CA_VOICES = {json.dumps(CA)}; const VOICES = CA_VOICES;\n{study}\n{review}\n"
            f"const s = {json.dumps(SAMPLES)};\n"
            "console.log(JSON.stringify(s.map(t => [frenchVoiceFor(t), voiceFor(t)])));"
        )
        out = subprocess.run([node, "-e", script], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        for text, (a, b) in zip(SAMPLES, json.loads(out.stdout)):
            self.assertEqual(a, voice_for(text), text)
            self.assertEqual(b, voice_for(text), text)

    def test_built_app_matches_source(self):
        built = "".join(p.read_text(encoding="utf-8") for p in (ROOT / "static/app/assets").glob("*.js"))
        self.assertNotIn("fr-FR-DeniseNeural", built)
        for voice in CA:
            self.assertIn(voice, built)
        self.assertIn("16777619", built)

    def test_server_accepts_the_voices(self):
        src = _read("tts_service.py")
        start = src.index("SUPPORTED_VOICES = {")
        block = src[start:src.index("}", start)]
        for voice in CA:
            self.assertIn(f'"{voice}"', block)


if __name__ == "__main__":
    unittest.main()
