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
import os
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

AUTH_SECRET = os.getenv("AUTH_SECRET", "french_audio_studio_secret_salt_2026")
TRIAL_DAYS = 60  # New customers automatically receive 2 months (60 days) free


def _get_db_path() -> Path:
    output_dir = Path(os.getenv("OUTPUT_DIR", "./outputs")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / "users.db"


def init_db() -> None:
    db_path = _get_db_path()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
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
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS history_records (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                record_type TEXT NOT NULL,
                text TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_history_user ON history_records(user_id, created_at DESC);
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_history_type ON history_records(record_type, created_at DESC);
            """
        )
        conn.commit()


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000
    ).hex()


def _generate_token(user_id: int, email: str) -> str:
    # Token valid for 90 days
    exp = (datetime.datetime.utcnow() + datetime.timedelta(days=90)).timestamp()
    payload = {"sub": user_id, "email": email, "exp": int(exp)}
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8").rstrip("=")
    sig = hmac.new(
        AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_token(token: str) -> dict[str, Any] | None:
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


def register_user(email: str, password: str) -> dict[str, Any]:
    clean_email = email.strip().lower()
    if not clean_email or not re.match(r"^[^@]+@[^@]+\.[^@]+$", clean_email):
        raise ValueError("请输入有效的邮箱地址。")
    if len(password) < 6:
        raise ValueError("密码长度至少需 6 位。")

    init_db()
    db_path = _get_db_path()
    salt = uuid.uuid4().hex
    pwd_hash = _hash_password(password, salt)
    now = datetime.datetime.utcnow()
    trial_expires = now + datetime.timedelta(days=TRIAL_DAYS)
    created_at_iso = now.isoformat()
    trial_expires_iso = trial_expires.isoformat()

    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
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

    token = _generate_token(user_id, clean_email)
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


def login_user(email: str, password: str) -> dict[str, Any]:
    clean_email = email.strip().lower()
    init_db()
    db_path = _get_db_path()

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (clean_email,))
        row = cursor.fetchone()

    if not row:
        raise ValueError("邮箱或密码错误，请重新输入。")

    expected_hash = _hash_password(password, row["salt"])
    if not hmac.compare_digest(row["password_hash"], expected_hash):
        raise ValueError("邮箱或密码错误，请重新输入。")

    token = _generate_token(row["id"], clean_email)
    user_info = get_user_status(row["id"])
    return {"token": token, "user": user_info}


def get_user_status(user_id: int) -> dict[str, Any] | None:
    init_db()
    db_path = _get_db_path()

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()

    if not row:
        return None

    try:
        expires_at = datetime.datetime.fromisoformat(row["trial_expires_at"])
    except Exception:
        expires_at = datetime.datetime.utcnow()

    import math

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
    user_id: int | None = None,
) -> dict[str, Any]:
    """
    Save or update a unified history record (TTS audio or Study analysis).
    Automatically deduplicates records with identical or near-identical text for the user.
    """
    init_db()
    db_path = _get_db_path()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    clean_type = (record_type or "unknown").strip().lower()
    clean_text = (text or "").strip()
    payload_str = json.dumps(payload, ensure_ascii=False)

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        # Find existing duplicate record for user and delete old ones
        if user_id is not None:
            cursor.execute(
                "SELECT id, text FROM history_records WHERE user_id = ? AND record_type = ?",
                (user_id, clean_type),
            )
        else:
            cursor.execute(
                "SELECT id, text FROM history_records WHERE (user_id IS NULL OR user_id = 0) AND record_type = ?",
                (clean_type,),
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
                created_at=excluded.created_at;
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
    user_id: int | None = None,
    record_type: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    Retrieve unified history records ordered by created_at DESC with deduplication.
    """
    init_db()
    db_path = _get_db_path()
    query = "SELECT id, user_id, record_type, text, payload_json, created_at FROM history_records WHERE 1=1"
    params: list[Any] = []

    if user_id is not None:
        query += " AND (user_id = ? OR user_id IS NULL)"
        params.append(user_id)

    if record_type:
        query += " AND record_type = ?"
        params.append(record_type.strip().lower())

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(limit * 2, 400)))

    results: list[dict[str, Any]] = []

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
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


def delete_history_record(record_id: str, user_id: int | None = None) -> bool:
    """
    Delete a single history record by ID.
    """
    init_db()
    db_path = _get_db_path()
    query = "DELETE FROM history_records WHERE id = ?"
    params: list[Any] = [record_id]
    if user_id is not None:
        query += " AND (user_id = ? OR user_id IS NULL)"
        params.append(user_id)

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor.rowcount > 0


def clear_history_records(user_id: int | None = None, record_type: str | None = None) -> int:
    """
    Clear history records.
    """
    init_db()
    db_path = _get_db_path()
    query = "DELETE FROM history_records WHERE 1=1"
    params: list[Any] = []
    if user_id is not None:
        query += " AND (user_id = ? OR user_id IS NULL)"
        params.append(user_id)
    if record_type:
        query += " AND record_type = ?"
        params.append(record_type.strip().lower())

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor.rowcount
