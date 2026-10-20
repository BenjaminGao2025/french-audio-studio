import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class WordTapTargetTests(unittest.TestCase):
    def _node(self, script):
        node = shutil.which("node")
        if not node or not (ROOT / "frontend/node_modules/jsdom").exists():
            self.skipTest("node and the frontend's jsdom are needed")
        result = subprocess.run([node, script], cwd=ROOT, capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_hit_target_css_markup_and_popover_in_jsdom(self):
        self._node("tests/test_word_tap_targets.cjs")

    def test_french_click_handlers_in_jsdom(self):
        self._node("tests/test_french_clicks.cjs")

    def test_sentence_row_resolves_the_tapped_word_before_it_toggles(self):
        js = _read("static/study.js")
        # The open/close handler of the sentence row and the word delegation share one resolver, so a
        # tap beside a word can never expand or collapse the sentence
        head = js.split("head.addEventListener('click', (e) => {")[1].split("});")[0]
        self.assertIn("if (wordAtTap(e)) return;", head)
        self.assertNotIn("closest('.interactive-word')", head)
        self.assertIn("const interactiveWord = wordAtTap(e);", js)
        resolver = js.split("function wordAtTap(e) {")[1].split("\n    }\n")[0]
        self.assertIn("e.detail === 0", resolver)  # a keyboard click has no position
        self.assertIn("line.closest('.is-blind-mode')", resolver)  # never read out a hidden word
        self.assertIn("FrenchWordPopover.nearestElement(", resolver)
        self.assertIn("WORD_TAP_SLOP = 22", js)

    def test_word_tap_uses_click_only(self):
        # One click handler: no touchend/pointerup twin that could fire the popover twice on iPhone
        for path in ("static/study.js", "static/word-popover.js"):
            js = _read(path)
            self.assertNotIn("addEventListener('touchend'", js, path)
            self.assertNotIn("addEventListener('pointerup'", js, path)

    def test_words_keep_their_global_audio_path(self):
        js = _read("static/study.js")
        self.assertIn("speak: (text) => playFrenchSpeech(text, null, { once: true }),", js)
        self.assertIn("window.FrenchAudio.bind(audio,", js)


if __name__ == "__main__":
    unittest.main()
