import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class StudyInputTests(unittest.TestCase):
    def setUp(self):
        self.js = _read("static/study.js")

    def test_placeholder_is_bilingual_and_translated_by_i18n(self):
        html = _read("static/study.html")
        zh = "粘贴法语文字或截图，或点 📷 上传"
        en = "Paste French text or a screenshot, or tap 📷 to upload"
        self.assertIn(f'placeholder="{zh}" data-i18n-placeholder="inputPlaceholder"', html)
        self.assertIn(f"inputPlaceholder: '{zh}'", self.js)
        self.assertIn(f"inputPlaceholder: '{en}'", self.js)

    def test_programmatic_fills_all_refit_the_box(self):
        # Each write refreshes the height and the counter
        self.assertEqual(re.findall(r"frenchInput\.value = (.+);", self.js), ["text", "data.text"])
        self.assertIn(
            "frenchInput.value = data.text;\n            frenchInput.scrollTop = 0;\n            updateFrenchInput();",
            self.js,
        )
        self.assertIn("window.addEventListener('resize', fitFrenchInput);", self.js)
        self.assertIn("document.addEventListener('study:modechange', fitFrenchInput);", self.js)

    def test_box_can_grow_inside_the_panel(self):
        rule = re.search(r"\.study-input-panel textarea \{(.*?)\}", _read("static/study.css"), re.S).group(1)
        # flex: 1 from .editor-panel would make the browser ignore the height set in study.js
        self.assertIn("flex: none;", rule)

    def test_button_paste_and_drop_share_the_photo_flow(self):
        self.assertEqual(self.js.count("startPhotoExtract(file);"), 1)
        self.assertEqual(self.js.count("startPhotoExtract(image);"), 2)
        self.assertEqual(self.js.count("/api/photo-extract"), 1)
        # Text wins over an image on the clipboard
        paste = self.js.index("addEventListener('paste'")
        self.assertLess(self.js.index("getData('text/plain')", paste), self.js.index("preventDefault", paste))


if __name__ == "__main__":
    unittest.main()
