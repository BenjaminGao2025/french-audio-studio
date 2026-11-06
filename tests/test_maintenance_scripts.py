"""scripts/prune_outputs.py and scripts/backup_db.py."""

import importlib.util
import io
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SNIP = "TTS_fr-FR-DeniseNeural_snip_" + "a" * 32


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _age(path: Path, days: float) -> None:
    stamp = time.time() - days * 86400
    os.utime(path, (stamp, stamp))


class PruneOutputsTests(unittest.TestCase):
    def setUp(self):
        self.prune = _load("prune_outputs")
        self.dir = Path(tempfile.mkdtemp(prefix="prune-"))
        conn = sqlite3.connect(self.dir / "users.db")
        conn.execute("CREATE TABLE history_records (payload_json TEXT)")
        kept = "TTS_fr-FR-HenriNeural_snip_" + "b" * 32
        conn.execute("INSERT INTO history_records VALUES (?)", (f'{{"audio_url": "/files/{kept}.mp3"}}',))
        conn.commit()
        conn.close()
        self.files = {
            "old_snippet": self.dir / f"{SNIP}.mp3",
            "old_snippet_srt": self.dir / f"{SNIP}.srt",
            "new_snippet": self.dir / ("TTS_fr-CA-JeanNeural_snip_" + "c" * 32 + ".mp3"),
            "referenced": self.dir / f"{kept}.mp3",
            "history_audio": self.dir / "TTS_fr-FR-DeniseNeural_20260101_120000_0123456789abcdef.mp3",
            "stale_part": self.dir / f"{SNIP}.mp3.deadbeef.part",
        }
        for name, path in self.files.items():
            path.write_bytes(b"x" * 1000)
            _age(path, 1 if name == "new_snippet" else 90)

    def _run(self, *args: str) -> str:
        out = io.StringIO()
        with patch.dict(os.environ, {"OUTPUT_DIR": str(self.dir)}), redirect_stdout(out):
            self.assertEqual(self.prune.main(list(args)), 0)
        return out.getvalue()

    def test_dry_run_deletes_nothing(self):
        report = self._run()
        self.assertIn("Would delete 3 files", report)
        self.assertTrue(all(path.exists() for path in self.files.values()))

    def test_apply_keeps_recent_referenced_and_non_snippet_files(self):
        self._run("--apply")
        gone = {name for name, path in self.files.items() if not path.exists()}
        self.assertEqual(gone, {"old_snippet", "old_snippet_srt", "stale_part"})
        self.assertTrue((self.dir / "users.db").exists())

    def test_missing_database_fails_and_deletes_nothing(self):
        (self.dir / "users.db").unlink()
        err = io.StringIO()
        with patch.dict(os.environ, {"OUTPUT_DIR": str(self.dir)}), redirect_stderr(err):
            self.assertEqual(self.prune.main(["--apply"]), 1)
        self.assertIn("users.db", err.getvalue())
        self.assertTrue(all(path.exists() for path in self.files.values()))
        with self.assertRaises(FileNotFoundError):
            self.prune.candidates(self.dir, 60)

    def test_missing_database_exits_nonzero_from_the_command_line(self):
        (self.dir / "users.db").unlink()
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "prune_outputs.py"), "--apply"],
            env={**os.environ, "OUTPUT_DIR": str(self.dir)},
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(all(path.exists() for path in self.files.values()))


class BackupDbTests(unittest.TestCase):
    def test_backup_copies_the_database_and_keeps_the_newest(self):
        backup_db = _load("backup_db")
        directory = Path(tempfile.mkdtemp(prefix="backup-"))
        conn = sqlite3.connect(directory / "users.db")
        conn.execute("CREATE TABLE users (email TEXT)")
        conn.execute("INSERT INTO users VALUES ('a@example.com')")
        conn.commit()
        conn.close()
        backups = directory / "backups"
        backups.mkdir()
        for day in range(1, 4):
            (backups / f"users-2020010{day}T000000Z.db").write_bytes(b"old")

        target = backup_db.backup(directory, label="abc123", keep=2)

        self.assertTrue(target.name.endswith("-abc123.db"))
        copy = sqlite3.connect(target)
        self.assertEqual(copy.execute("SELECT email FROM users").fetchall(), [("a@example.com",)])
        copy.close()
        self.assertEqual(sorted(p.name for p in backups.iterdir()), ["users-20200103T000000Z.db", target.name])

    def test_missing_database_is_an_error(self):
        backup_db = _load("backup_db")
        directory = Path(tempfile.mkdtemp(prefix="backup-"))
        with self.assertRaises(FileNotFoundError):
            backup_db.backup(directory)
        err = io.StringIO()
        with patch.dict(os.environ, {"OUTPUT_DIR": str(directory)}), redirect_stderr(err):
            self.assertEqual(backup_db.main(["--label", "x"]), 1)
        self.assertIn("users.db", err.getvalue())
        self.assertFalse((directory / "backups").exists())

    def test_missing_database_exits_nonzero_from_the_command_line(self):
        directory = Path(tempfile.mkdtemp(prefix="backup-"))
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "backup_db.py"), "--label", "x"],
            env={**os.environ, "OUTPUT_DIR": str(directory)},
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((directory / "backups").exists())

    def test_main_succeeds_with_a_database(self):
        backup_db = _load("backup_db")
        directory = Path(tempfile.mkdtemp(prefix="backup-"))
        sqlite3.connect(directory / "users.db").close()
        out = io.StringIO()
        with patch.dict(os.environ, {"OUTPUT_DIR": str(directory)}), redirect_stdout(out):
            self.assertEqual(backup_db.main([]), 0)
        self.assertEqual(len(list((directory / "backups").glob("users-*.db"))), 1)


if __name__ == "__main__":
    unittest.main()
