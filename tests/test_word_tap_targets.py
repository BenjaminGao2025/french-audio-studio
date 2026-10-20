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

    def test_read_selection_in_jsdom(self):
        self._node("tests/test_read_selection.cjs")

    def test_french_click_handlers_in_jsdom(self):
        self._node("tests/test_french_clicks.cjs")

    def test_read_selection_is_wired_into_the_study_page(self):
        html = _read("static/study.html")
        js = _read("static/study.js")
        rs = _read("static/read-selection.js")
        self.assertIn('read-selection.js?v=__ASSET_VERSION__', html)
        self.assertIn("window.FrenchReadSelection.create({", js)
        # Selecting text shows the read bar instead of the phrase popover
        self.assertIn("selectionPopover: false,", js)
        # Reading goes through the page's own French speech (global audio controller)
        self.assertIn("speak: (text, onEnd) => playFrenchSpeech(text, onEnd),", js)
        self.assertIn("meaning: (text, anchor, context) => wordPopover.show(text, anchor, context),", js)
        # A per-sentence "Select words" toggle starts range mode
        self.assertIn("data-range-toggle", js)
        self.assertIn("selectWordsTitle", js)
        # The mouse drag is painted by read-selection.js, not by the browser
        self.assertIn("e.preventDefault();", rs)
        self.assertIn("paintDrag(dragFrom", rs)
        # The hit area sits behind the word text, so a drag on the word selects from inside it
        self.assertIn("z-index: -1;", _read("static/study.css"))
        self.assertIn("isolation: isolate;", _read("static/study.css"))

    def test_a_single_selected_word_no_longer_opens_the_popover(self):
        js = _read("static/word-popover.js")
        # A selection of two or more words opens the phrase; one word does not (a tap still does)
        self.assertIn("if (options.selectionPopover === false) return;", js)
        self.assertIn("if (!selected || !selected.includes(' ')) { lastPhrase = ''; return; }", js)

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
