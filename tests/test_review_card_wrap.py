import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / "static" / "review.css"
JS = ROOT / "static" / "review.js"

# The sentence and its speaker button share one flex row in the card library:
# .deck-note-fr > (sentence text | speak button). The text must be the only
# shrinkable child, otherwise a long sentence pushes the button out of the card.


def _rule(css, selector):
    """Return the declaration block of `selector`, whitespace-normalised."""
    match = re.search(r"(?:^|\n)\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", css)
    if not match:
        raise AssertionError(f"missing CSS rule: {selector}")
    return re.sub(r"\s+", " ", match.group(1))


class ReviewCardWrapTests(unittest.TestCase):
    def setUp(self):
        self.css = CSS.read_text(encoding="utf-8")
        self.js = JS.read_text(encoding="utf-8")

    def test_sentence_text_shrinks_and_wraps(self):
        block = _rule(self.css, ".deck-note-sentence")
        self.assertIn("min-width: 0;", block)
        self.assertIn("overflow-wrap: anywhere;", block)
        self.assertNotIn("white-space: nowrap", block)

    def test_speak_button_keeps_its_width(self):
        block = _rule(self.css, ".deck-note-fr .btn-play")
        self.assertIn("flex-shrink: 0;", block)

    def test_sentence_is_wrapped_in_its_own_flex_child(self):
        # The rule above only helps if the words sit in a single child next to the button
        self.assertIn(
            '<span class="deck-note-sentence">${clickableFr(note.sentence)}</span>',
            self.js,
        )
        # Tap-word spans are unchanged: clickableFr still emits .fr-word around each word
        self.assertIn('class="fr-word" lang="fr"', self.js)


if __name__ == "__main__":
    unittest.main()
