"""
French Audio Studio - Minimalist Account & 60-day Trial System
Self-contained SQLite storage, PBKDF2 password hashing, and HMAC-SHA256 token verification.
"""

from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

AUTH_SECRET = os.getenv("AUTH_SECRET", "")
if len(AUTH_SECRET) < 32:
    raise RuntimeError("AUTH_SECRET must be set to a random string of at least 32 characters.")
ALLOW_REGISTRATION = os.getenv("ALLOW_REGISTRATION", "false").strip().lower() == "true"
TRIAL_DAYS = 60  # New customers automatically receive 2 months (60 days) free
MAX_DEVICES = 3  # Logging in on a fourth device signs out the one used least recently
SESSION_TOUCH_SECONDS = 600  # How often last_seen_at is refreshed, to avoid a write per request


def _get_db_path() -> Path:
    output_dir = Path(os.getenv("OUTPUT_DIR", "./outputs")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / "users.db"


def _open_connection() -> sqlite3.Connection:
    # timeout is the lock wait; busy_timeout is what sqlite actually honors per connection.
    conn = sqlite3.connect(_get_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    conn = _open_connection()
    try:
        # WAL lets a background episode job write while review and history read.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL,
                trial_expires_at TEXT NOT NULL,
                plan TEXT NOT NULL DEFAULT 'trial',
                status TEXT NOT NULL DEFAULT 'active'
            );
            CREATE TABLE IF NOT EXISTS history_records (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                record_type TEXT NOT NULL,
                text TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_user ON history_records(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_history_type ON history_records(record_type, created_at DESC);
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                device TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_seen_at DESC);
            CREATE TABLE IF NOT EXISTS waitlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                contact TEXT NOT NULL,
                details_json TEXT NOT NULL,
                lang TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS grammar_hits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                gid TEXT NOT NULL,
                sentence_text TEXT NOT NULL,
                history_id TEXT,
                ts TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_grammar_hits_unique ON grammar_hits(user_id, gid, sentence_text);
            CREATE TABLE IF NOT EXISTS etymology_cache (
                key TEXT PRIMARY KEY,
                word TEXT NOT NULL,
                lemma TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invite_codes (
                code TEXT PRIMARY KEY,
                label TEXT NOT NULL DEFAULT '',
                max_uses INTEGER,
                use_count INTEGER NOT NULL DEFAULT 0,
                disabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


# Schemas already created, per database file: (path, owner). Every module's CREATE TABLE IF NOT EXISTS
# used to run on every connection, which made each request pay for a dozen no-op DDL statements.
_schema_ready: set[tuple[str, str]] = set()
_schema_lock = threading.RLock()


def ensure_schema(conn: sqlite3.Connection, owner: str, create: Callable[[sqlite3.Connection], None]) -> None:
    """Run `create(conn)` (idempotent CREATE / ALTER statements) once per database file for `owner`.

    Runs again if the file disappears (a test or restore swapped it out).
    """
    path = _get_db_path()
    key = (str(path), owner)
    if key in _schema_ready and path.exists():
        return
    with _schema_lock:
        if key in _schema_ready and path.exists():
            return
        create(conn)
        conn.commit()
        _schema_ready.add(key)


def _ensure_core_schema() -> None:
    path = _get_db_path()
    key = (str(path), "auth_db")
    if key in _schema_ready and path.exists():
        return
    with _schema_lock:
        if key in _schema_ready and path.exists():
            return
        init_db()
        _schema_ready.add(key)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    _ensure_core_schema()
    conn = _open_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_etymology(key: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT text FROM etymology_cache WHERE key = ?", (key,)).fetchone()
    return row["text"] if row else None


def set_etymology(key: str, word: str, lemma: str, text: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO etymology_cache (key, word, lemma, text, created_at) VALUES (?, ?, ?, ?, ?)",
            (key, word, lemma, text, _now_iso()),
        )


# OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Stored as "pbkdf2_sha256$<iterations>$<hex>" so the count can rise
# later; a bare hex hash is the original 100,000-iteration format and is upgraded at the next login.
DEFAULT_PBKDF2_ITERATIONS = 600_000
PBKDF2_ITERATIONS = int(os.getenv("PBKDF2_ITERATIONS", str(DEFAULT_PBKDF2_ITERATIONS)))
_LEGACY_PBKDF2_ITERATIONS = 100_000
_HASH_PREFIX = "pbkdf2_sha256"


def _pbkdf2(password: str, salt: str, iterations: int) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()


def _hash_password(password: str, salt: str) -> str:
    return f"{_HASH_PREFIX}${PBKDF2_ITERATIONS}${_pbkdf2(password, salt, PBKDF2_ITERATIONS)}"


def _check_password(password: str, salt: str, stored: str) -> tuple[bool, bool]:
    """(the password matches, the stored hash should be redone at today's iteration count)."""
    if stored.startswith(_HASH_PREFIX + "$"):
        _, iterations_text, digest = stored.split("$", 2)
        iterations = int(iterations_text)
    else:
        iterations, digest = _LEGACY_PBKDF2_ITERATIONS, stored
    matches = hmac.compare_digest(_pbkdf2(password, salt, iterations), digest)
    return matches, matches and iterations < PBKDF2_ITERATIONS


def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat(timespec="seconds")


def _start_session(user_id: int, device: str) -> str:
    """Record a new signed-in device and sign out the least recently used beyond MAX_DEVICES."""
    session_id = uuid.uuid4().hex
    now = _now_iso()
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, device, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, user_id, (device or "")[:120], now, now),
        )
        # Keep the new session plus the most recently used others, up to MAX_DEVICES in all
        conn.execute(
            """
            DELETE FROM sessions WHERE user_id = ? AND id != ? AND id NOT IN (
                SELECT id FROM sessions WHERE user_id = ? AND id != ?
                ORDER BY last_seen_at DESC, rowid DESC LIMIT ?
            )
            """,
            (user_id, session_id, user_id, session_id, MAX_DEVICES - 1),
        )
    return session_id


def list_sessions(user_id: int) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, device, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def end_session(user_id: int, session_id: str) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
        return cursor.rowcount > 0


def _generate_token(user_id: int, email: str, session_id: str) -> str:
    # Token valid for 90 days, and only while its session (device) still exists
    exp = (datetime.datetime.utcnow() + datetime.timedelta(days=90)).timestamp()
    payload = {"sub": user_id, "email": email, "sid": session_id, "exp": int(exp)}
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8").rstrip("=")
    sig = hmac.new(
        AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_token(token: str) -> dict[str, Any] | None:
    """The payload of a signed, unexpired token whose device is still signed in; otherwise None."""
    payload = _signed_payload(token)
    if not payload or not payload.get("sid"):
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT last_seen_at FROM sessions WHERE id = ? AND user_id = ?",
            (payload["sid"], payload["sub"]),
        ).fetchone()
        if not row:
            return None
        try:
            idle = datetime.datetime.utcnow() - datetime.datetime.fromisoformat(row["last_seen_at"])
        except ValueError:
            idle = datetime.timedelta(seconds=SESSION_TOUCH_SECONDS)
        if idle.total_seconds() >= SESSION_TOUCH_SECONDS:
            conn.execute("UPDATE sessions SET last_seen_at = ? WHERE id = ?", (_now_iso(), payload["sid"]))
    return payload


def is_signed_out_token(token: str) -> bool:
    """A genuine, unexpired token whose device was signed out (e.g. by a login on another device)."""
    payload = _signed_payload(token)
    return bool(payload) and verify_token(token) is None


def _signed_payload(token: str) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    try:
        payload_b64, sig = token.split(".", 1)
        expected_sig = hmac.new(
            AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None

        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
        if datetime.datetime.utcnow().timestamp() > payload.get("exp", 0):
            return None
        return payload
    except Exception:
        return None


INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, easy to read aloud on a livestream
INVITE_LENGTH = 10


def _clean_invite(code: str | None) -> str:
    return (code or "").strip().upper()


def create_invite(label: str = "", max_uses: int | None = None) -> dict[str, Any]:
    """A new shareable invite code; max_uses None or 0 means unlimited."""
    code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))
    row = {
        "code": code,
        "label": (label or "").strip(),
        "max_uses": max_uses if max_uses and max_uses > 0 else None,
        "use_count": 0,
        "disabled": 0,
        "created_at": _now_iso(),
    }
    with connect() as conn:
        conn.execute(
            "INSERT INTO invite_codes (code, label, max_uses, use_count, disabled, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (row["code"], row["label"], row["max_uses"], 0, 0, row["created_at"]),
        )
    return row


def list_invites() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM invite_codes ORDER BY created_at, code").fetchall()
    return [dict(row) for row in rows]


def peek_invite(code: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM invite_codes WHERE code = ?", (_clean_invite(code),)).fetchone()
    return dict(row) if row else None


def _consume_invite(conn: sqlite3.Connection, code: str) -> None:
    """Use one invite inside the caller's transaction, so a failed sign-up rolls it back."""
    clean = _clean_invite(code)
    cursor = conn.execute(
        """
        UPDATE invite_codes SET use_count = use_count + 1
        WHERE code = ? AND disabled = 0 AND (max_uses IS NULL OR max_uses <= 0 OR use_count < max_uses)
        """,
        (clean,),
    )
    if cursor.rowcount == 1:
        return
    row = conn.execute("SELECT disabled FROM invite_codes WHERE code = ?", (clean,)).fetchone()
    if not row or row["disabled"]:
        raise ValueError("邀请码无效，请检查后重试。")
    raise ValueError("这个邀请码的名额已用完。")


def consume_invite(code: str) -> None:
    with connect() as conn:
        _consume_invite(conn, code)


def register_user(
    email: str, password: str, device: str = "", invite_code: str | None = None
) -> dict[str, Any]:
    clean_email = email.strip().lower()
    if not clean_email or not re.match(r"^[^@]+@[^@]+\.[^@]+$", clean_email):
        raise ValueError("请输入有效的邮箱地址。")
    if len(password) < 6:
        raise ValueError("密码长度至少需 6 位。")
    if not ALLOW_REGISTRATION and not _clean_invite(invite_code):
        raise ValueError("本站暂不开放注册，请使用邀请码。")

    salt = uuid.uuid4().hex
    pwd_hash = _hash_password(password, salt)
    now = datetime.datetime.utcnow()
    trial_expires = now + datetime.timedelta(days=TRIAL_DAYS)
    created_at_iso = now.isoformat()
    trial_expires_iso = trial_expires.isoformat()

    try:
        with connect() as conn:
            cursor = conn.cursor()
            if _clean_invite(invite_code):
                _consume_invite(conn, invite_code)
            cursor.execute(
                """
                INSERT INTO users (email, password_hash, salt, created_at, trial_expires_at, plan, status)
                VALUES (?, ?, ?, ?, ?, 'trial', 'active')
                """,
                (clean_email, pwd_hash, salt, created_at_iso, trial_expires_iso),
            )
            user_id = cursor.lastrowid
            conn.commit()
    except sqlite3.IntegrityError:
        raise ValueError("该邮箱已被注册，请直接登录。")

    token = _generate_token(user_id, clean_email, _start_session(user_id, device))
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": clean_email,
            "plan": "trial",
            "trial_expires_at": trial_expires_iso,
            "days_left": TRIAL_DAYS,
            "is_valid": True,
        },
    }


def login_user(email: str, password: str, device: str = "") -> dict[str, Any]:
    clean_email = email.strip().lower()
    with connect() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (clean_email,))
        row = cursor.fetchone()

    if not row:
        _pbkdf2(password, "no-such-user", PBKDF2_ITERATIONS)  # same cost, so timing does not reveal the email
        raise ValueError("邮箱或密码错误，请重新输入。")

    matches, needs_rehash = _check_password(password, row["salt"], row["password_hash"])
    if not matches:
        raise ValueError("邮箱或密码错误，请重新输入。")
    if needs_rehash:
        salt = uuid.uuid4().hex
        with connect() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
                (_hash_password(password, salt), salt, row["id"]),
            )

    token = _generate_token(row["id"], clean_email, _start_session(row["id"], device))
    user_info = get_user_status(row["id"])
    return {"token": token, "user": user_info}


def get_user_status(user_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()

    if not row:
        return None

    try:
        expires_at = datetime.datetime.fromisoformat(row["trial_expires_at"])
    except Exception:
        expires_at = datetime.datetime.utcnow()

    now = datetime.datetime.utcnow()
    diff = (expires_at - now).total_seconds()
    days_left = max(0, math.ceil(diff / 86400))
    is_valid = diff > 0 or row["plan"] == "pro"

    return {
        "id": row["id"],
        "email": row["email"],
        "plan": row["plan"],
        "created_at": row["created_at"],
        "trial_expires_at": row["trial_expires_at"],
        "days_left": days_left,
        "is_valid": is_valid,
    }


def _normalize_history_text(text: str) -> str:
    return re.sub(r"[^\w]+", "", (text or "").lower())


def _is_similar_history_text(t1: str, t2: str) -> bool:
    if not t1 or not t2:
        return False
    if t1.strip() == t2.strip():
        return True
    n1 = _normalize_history_text(t1)
    n2 = _normalize_history_text(t2)
    if not n1 or not n2:
        return False
    if n1 == n2:
        return True
    min_len = min(len(n1), len(n2))
    max_len = max(len(n1), len(n2))
    if min_len >= 12 and (n1 in n2 or n2 in n1) and (max_len - min_len <= 5):
        return True
    return False


def save_history_record(
    record_id: str,
    record_type: str,
    text: str,
    payload: dict[str, Any],
    user_id: int,
) -> dict[str, Any]:
    """
    Save or update a unified history record (TTS audio or Study analysis).
    Automatically deduplicates records with identical or near-identical text for the user.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    clean_type = (record_type or "unknown").strip().lower()
    clean_text = (text or "").strip()
    payload_str = json.dumps(payload, ensure_ascii=False)

    with connect() as conn:
        cursor = conn.cursor()
        # Find existing duplicate record for user and delete old ones
        cursor.execute(
            "SELECT id, text FROM history_records WHERE user_id = ? AND record_type = ?",
            (user_id, clean_type),
        )
        existing_rows = cursor.fetchall()
        for row_id, row_text in existing_rows:
            if row_id == record_id or _is_similar_history_text(row_text, clean_text):
                cursor.execute("DELETE FROM history_records WHERE id = ?", (row_id,))

        cursor.execute(
            """
            INSERT INTO history_records (id, user_id, record_type, text, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                record_type=excluded.record_type,
                text=excluded.text,
                payload_json=excluded.payload_json,
                created_at=excluded.created_at
            WHERE history_records.user_id = excluded.user_id;
            """,
            (record_id, user_id, clean_type, clean_text, payload_str, now_iso),
        )
        conn.commit()

    return {
        "id": record_id,
        "user_id": user_id,
        "record_type": clean_type,
        "text": clean_text,
        "created_at": now_iso,
    }


def get_history_records(
    user_id: int,
    record_type: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    Retrieve unified history records ordered by created_at DESC with deduplication.
    """
    query = "SELECT id, user_id, record_type, text, payload_json, created_at FROM history_records WHERE user_id = ?"
    params: list[Any] = [user_id]

    if record_type:
        query += " AND record_type = ?"
        params.append(record_type.strip().lower())

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(limit * 2, 400)))

    results: list[dict[str, Any]] = []

    with connect() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        rows = cursor.fetchall()
        for r in rows:
            clean_text = (r["text"] or "").strip()
            # Check if duplicate of already selected result
            is_dup = False
            for acc in results:
                if acc["type"] == r["record_type"] and _is_similar_history_text(acc["text"], clean_text):
                    is_dup = True
                    break
            if is_dup:
                continue

            try:
                payload = json.loads(r["payload_json"])
            except Exception:
                payload = {}
            results.append({
                "id": r["id"],
                "user_id": r["user_id"],
                "type": r["record_type"],
                "text": clean_text,
                "created_at": r["created_at"],
                **payload,
            })
            if len(results) >= limit:
                break

    return results


def delete_history_record(record_id: str, user_id: int) -> bool:
    """
    Delete a single history record by ID.
    """
    query = "DELETE FROM history_records WHERE id = ? AND user_id = ?"
    params: list[Any] = [record_id, user_id]

    with connect() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        return cursor.rowcount > 0


def clear_history_records(user_id: int, record_type: str | None = None) -> int:
    """
    Clear history records.
    """
    query = "DELETE FROM history_records WHERE user_id = ?"
    params: list[Any] = [user_id]
    if record_type:
        query += " AND record_type = ?"
        params.append(record_type.strip().lower())

    with connect() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        return cursor.rowcount


def add_waitlist_entry(kind: str, contact: str, details: dict[str, str], lang: str) -> int:
    """Store a beta application (kind 'learner') or a partnership request (kind 'institution')."""
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO waitlist (kind, contact, details_json, lang, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                kind,
                contact,
                json.dumps(details, ensure_ascii=False),
                lang,
                datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
            ),
        )
        return int(cursor.lastrowid)


def record_grammar_hits(user_id: int, hits: list[tuple[str, str]], history_id: str | None = None) -> int:
    """Store (gid, sentence_text) pairs once per user; returns how many were new."""
    if not hits:
        return 0
    now = datetime.datetime.utcnow().isoformat(timespec="seconds")
    with connect() as conn:
        before = conn.total_changes
        conn.executemany(
            "INSERT OR IGNORE INTO grammar_hits (user_id, gid, sentence_text, history_id, ts) VALUES (?, ?, ?, ?, ?)",
            [(user_id, gid, text, history_id, now) for gid, text in hits],
        )
        return conn.total_changes - before


def grammar_hit_counts(user_id: int) -> dict[str, int]:
    """How many different sentences of this user showed each grammar point."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT gid, COUNT(*) AS n FROM grammar_hits WHERE user_id = ? GROUP BY gid", (user_id,)
        ).fetchall()
    return {row["gid"]: row["n"] for row in rows}


def grammar_hit_sentences(user_id: int, gid: str, limit: int = 100) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT sentence_text, history_id, ts FROM grammar_hits WHERE user_id = ? AND gid = ? ORDER BY ts DESC, id DESC LIMIT ?",
            (user_id, gid, limit),
        ).fetchall()
    return [{"sentence": row["sentence_text"], "history_id": row["history_id"], "ts": row["ts"]} for row in rows]


def _user_id_by_email(conn: sqlite3.Connection, email: str) -> int:
    row = conn.execute(
        "SELECT id FROM users WHERE email = ?", (email.strip().lower(),)
    ).fetchone()
    if not row:
        raise SystemExit(f"No user with email {email!r}.")
    return row[0]


def _admin_cli(argv: list[str]) -> None:
    """Owner maintenance commands, e.g. inside the container:
    python auth_db.py set-password you@example.com
    python auth_db.py set-plan you@example.com pro
    python auth_db.py claim-anonymous-history you@example.com
    python auth_db.py list-waitlist
    python auth_db.py create-invite --label xhs-live [--max-uses 50]
    python auth_db.py list-invites
    """
    import argparse
    import getpass

    parser = argparse.ArgumentParser(prog="auth_db.py")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("set-password").add_argument("email")
    plan_parser = sub.add_parser("set-plan")
    plan_parser.add_argument("email")
    plan_parser.add_argument("plan", choices=["trial", "pro"])
    sub.add_parser("claim-anonymous-history").add_argument("email")
    sub.add_parser("list-waitlist")
    invite_parser = sub.add_parser("create-invite")
    invite_parser.add_argument("--label", default="")
    invite_parser.add_argument("--max-uses", type=int, default=None, help="omit or 0 for unlimited")
    sub.add_parser("list-invites")
    args = parser.parse_args(argv)

    if args.command == "create-invite":
        invite = create_invite(args.label, args.max_uses)
        limit = invite["max_uses"] or "unlimited"
        print(f"{invite['code']}\tlabel={invite['label'] or '-'}\tmax_uses={limit}")
        return

    if args.command == "list-invites":
        invites = list_invites()
        for row in invites:
            limit = row["max_uses"] or "unlimited"
            state = "disabled" if row["disabled"] else "active"
            print(f"{row['code']}\t{row['created_at']}\t{row['label'] or '-'}\t{row['use_count']}/{limit}\t{state}")
        print(f"{len(invites)} invites.")
        return

    if args.command == "list-waitlist":
        with connect() as conn:
            rows = conn.execute("SELECT * FROM waitlist ORDER BY id").fetchall()
        for row in rows:
            print(f"{row['id']}\t{row['created_at']}\t{row['kind']}\t{row['contact']}\t{row['details_json']}")
        print(f"{len(rows)} entries.")
        return

    with connect() as conn:
        user_id = _user_id_by_email(conn, args.email)
        if args.command == "set-password":
            password = getpass.getpass("New password: ")
            if len(password) < 6:
                raise SystemExit("Password must be at least 6 characters.")
            if password != getpass.getpass("Repeat password: "):
                raise SystemExit("Passwords do not match.")
            salt = uuid.uuid4().hex
            conn.execute(
                "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
                (_hash_password(password, salt), salt, user_id),
            )
            # A new password signs out every device
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            print("Password updated; all devices signed out.")
        elif args.command == "set-plan":
            conn.execute("UPDATE users SET plan = ? WHERE id = ?", (args.plan, user_id))
            print(f"Plan set to {args.plan}.")
        elif args.command == "claim-anonymous-history":
            cursor = conn.execute(
                "UPDATE history_records SET user_id = ? WHERE user_id IS NULL OR user_id = 0",
                (user_id,),
            )
            print(f"Assigned {cursor.rowcount} anonymous history records.")
        conn.commit()


if __name__ == "__main__":
    import sys

    _admin_cli(sys.argv[1:])
