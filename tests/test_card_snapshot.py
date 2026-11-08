import contextlib
import importlib.util
import io
import pathlib
import unittest
import uuid

import testenv  # noqa: F401  (must run before the app is imported)

import auth_db
import srs
import word_context

ROOT = pathlib.Path(__file__).resolve().parent.parent
SENTENCE = "Désolé je préfère partir tout de suite."
SNAPSHOT = {
    "snap": "1",
    "dict_zh": "更喜欢；偏爱",
    "dict_en": "prefer",
    "ctx_zh": "宁愿",
    "ctx_en": "would rather",
    "why_zh": "préfère 后接不定式 partir。",
}


def _user() -> int:
    return auth_db.register_user(f"snap_{uuid.uuid4().hex[:10]}@example.com", "password123")["user"]["id"]


def _meta(user_id: int, target: str = "préfère") -> dict:
    card = next(c for c in srs.list_cards(user_id) if c["target"] == target)
    return card["target_meta"]


def _load_script():
    spec = importlib.util.spec_from_file_location("backfill_card_snapshots", ROOT / "scripts/backfill_card_snapshots.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SnapshotStoreTests(unittest.TestCase):
    def test_snapshot_keys_are_kept_with_the_card(self):
        user_id = _user()
        meta = {"meaning_zh": "宁愿", "lemma": "préférer", **SNAPSHOT, "ignored": "x"}
        srs.add_note(user_id, SENTENCE, targets=[{"text": "préfère", "meta": meta}])
        got = _meta(user_id)
        for key, value in SNAPSHOT.items():
            self.assertEqual(got[key], value)
        self.assertNotIn("ignored", got)

    def test_long_snapshot_text_is_bounded(self):
        user_id = _user()
        srs.add_note(user_id, SENTENCE, targets=[{"text": "préfère", "meta": {"why_zh": "长" * 5000}}])
        self.assertLessEqual(len(_meta(user_id)["why_zh"]), srs.SNAPSHOT_MAX_CHARS)


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.script = _load_script()
        self.user_id = _user()
        self.email = auth_db.get_user_status(self.user_id)["email"]

    def _run(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.script.main(["--user", self.email, *args])
        return out.getvalue()

    def test_dry_run_writes_nothing_and_apply_fills_missing_snapshots_once(self):
        srs.add_note(self.user_id, SENTENCE, targets=[{"text": "préfère", "meta": {"meaning_zh": "更喜欢", "lemma": "préférer"}}])
        # A cached 语境 for the same word in the same sentence, as /api/word-context would have stored it
        key = word_context.cache_key(SENTENCE, "préfère", 0)
        word_context.save_cached(
            self.user_id, key, SENTENCE, "préfère", 0,
            {"meaning_zh": "宁愿", "meaning_en": "would rather", "why_zh": "préfère 后接不定式。"},
        )
        self.assertIn("1 without a snapshot", self._run())
        self.assertNotIn("snap", _meta(self.user_id))
        self.assertIn("Dry run", self._run())

        self.assertIn("Updated 1 cards", self._run("--apply"))
        got = _meta(self.user_id)
        self.assertEqual(got["snap"], "1")
        self.assertEqual((got["ctx_zh"], got["ctx_en"]), ("宁愿", "would rather"))
        self.assertEqual(got["dict_zh"], "更喜欢")  # the card's old meaning differs from the 语境: it was the dictionary's
        self.assertEqual(got["lemma"], "préférer")  # existing keys stay
        self.assertIn("0 without a snapshot", self._run())  # idempotent

    def test_cards_with_a_snapshot_are_untouched(self):
        srs.add_note(self.user_id, SENTENCE, targets=[{"text": "préfère", "meta": dict(SNAPSHOT)}])
        self.assertIn("0 without a snapshot", self._run())
        self.assertEqual(_meta(self.user_id)["dict_zh"], SNAPSHOT["dict_zh"])


class ClientSourceTests(unittest.TestCase):
    def test_review_page_uses_the_snapshot_without_a_lookup(self):
        source = (ROOT / "static/review.js").read_text(encoding="utf-8")
        self.assertIn("snapshotContext(target) ||", source)
        self.assertIn("meta.dict_zh", source)
        self.assertIn("meaningSnapshot", (ROOT / "static/word-popover.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
