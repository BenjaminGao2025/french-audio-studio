"""The image copies an explicit list of top-level modules (never COPY *.py), and that list must cover
every top-level module the app imports."""

import re
import sys
import unittest
from pathlib import Path

import testenv  # noqa: F401  (sets AUTH_SECRET / OUTPUT_DIR before the app is imported)

import tts_service  # noqa: F401  (imports every router, so sys.modules holds the whole app)

ROOT = Path(__file__).resolve().parent.parent


def _copied_modules() -> list[str]:
    text = (ROOT / "Dockerfile").read_text(encoding="utf-8").replace("\\\n", " ")
    names: list[str] = []
    for line in text.splitlines():
        parts = line.split()
        if parts[:1] == ["COPY"] and parts[-1] == "./":
            names += [p for p in parts[1:-1] if p.endswith(".py")]
    return names


class DockerfileTests(unittest.TestCase):
    def test_no_glob_copy_of_python_files(self):
        text = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"^COPY\s+\*\.py", text, re.M))
        self.assertIsNone(re.search(r"^COPY\s+\.\s", text, re.M))

    def test_listed_modules_exist(self):
        listed = _copied_modules()
        self.assertIn("tts_service.py", listed)
        self.assertEqual(len(listed), len(set(listed)))
        for name in listed:
            self.assertTrue((ROOT / name).is_file(), name)

    def test_every_imported_top_level_module_is_copied(self):
        listed = set(_copied_modules())
        imported = {
            Path(m.__file__).name
            for m in list(sys.modules.values())
            if getattr(m, "__file__", None) and Path(m.__file__).resolve().parent == ROOT
        }
        self.assertTrue(imported)
        self.assertEqual(sorted(imported - listed), [])

    def test_untracked_scratch_modules_stay_out(self):
        self.assertNotIn("eb_common.py", _copied_modules())
        ignored = (ROOT / ".dockerignore").read_text(encoding="utf-8").split()
        for pattern in ("eb_common*", ".env", ".claude/", "models/", "outputs/"):
            self.assertIn(pattern, ignored)


if __name__ == "__main__":
    unittest.main()
