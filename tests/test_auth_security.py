"""Password storage, sign-in rate limits, the trusted client IP and once-per-database schema setup."""

import hashlib
import sqlite3
import unittest
import uuid
from unittest.mock import patch

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient
from starlette.requests import Request

import auth_db
import tts_service
import web_common


def _email() -> str:
    return f"sec_{uuid.uuid4().hex[:12]}@example.com"


def _stored_hash(email: str) -> tuple[str, str]:
    with auth_db.connect() as conn:
        row = conn.execute("SELECT password_hash, salt FROM users WHERE email = ?", (email,)).fetchone()
    return row["password_hash"], row["salt"]


def _request(client_host: str, headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (client_host, 1234)})


class PasswordHashTests(unittest.TestCase):
    def test_production_default_is_600k_iterations(self):
        self.assertEqual(auth_db.DEFAULT_PBKDF2_ITERATIONS, 600_000)

    def test_new_accounts_store_the_iteration_count(self):
        email = _email()
        auth_db.register_user(email, "password123")
        stored, _ = _stored_hash(email)
        scheme, iterations, digest = stored.split("$")
        self.assertEqual((scheme, int(iterations)), ("pbkdf2_sha256", auth_db.PBKDF2_ITERATIONS))
        self.assertEqual(len(digest), 64)
        self.assertIn("token", auth_db.login_user(email, "password123"))

    def test_legacy_hash_signs_in_and_is_upgraded(self):
        email = _email()
        auth_db.register_user(email, "password123")
        legacy_salt = uuid.uuid4().hex
        legacy = hashlib.pbkdf2_hmac("sha256", b"password123", legacy_salt.encode(), 100_000).hex()
        with auth_db.connect() as conn:
            conn.execute("UPDATE users SET password_hash = ?, salt = ? WHERE email = ?", (legacy, legacy_salt, email))

        with patch.object(auth_db, "PBKDF2_ITERATIONS", 200_000):
            with self.assertRaises(ValueError):
                auth_db.login_user(email, "wrong-password")
            self.assertEqual(_stored_hash(email)[0], legacy)  # a failed attempt changes nothing

            self.assertIn("token", auth_db.login_user(email, "password123"))
            stored, salt = _stored_hash(email)
            self.assertTrue(stored.startswith("pbkdf2_sha256$200000$"))
            self.assertNotEqual(salt, legacy_salt)
            self.assertIn("token", auth_db.login_user(email, "password123"))  # the upgraded hash works

    def test_unknown_email_and_wrong_password_look_the_same(self):
        email = _email()
        auth_db.register_user(email, "password123")
        messages = []
        for address, password in ((email, "nope-nope"), (_email(), "password123")):
            with self.assertRaises(ValueError) as caught:
                auth_db.login_user(address, password)
            messages.append(str(caught.exception))
        self.assertEqual(messages[0], messages[1])


class SignInRateLimitTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        web_common._rate_buckets.clear()

    def tearDown(self):
        web_common._rate_buckets.clear()

    def test_login_attempts_are_limited_per_email(self):
        email = _email()
        auth_db.register_user(email, "password123")
        with patch.dict(web_common.RATE_LIMITS, {"auth_email": (2.0, 0.0001)}):
            for _ in range(2):
                self.assertEqual(
                    self.client.post("/api/auth/login", json={"email": email, "password": "bad-guess"}).status_code,
                    400,
                )
            blocked = self.client.post("/api/auth/login", json={"email": email.upper(), "password": "password123"})
            other = self.client.post("/api/auth/login", json={"email": _email(), "password": "bad-guess"})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()["detail"]["code"], "rate_limited")
        self.assertIn("Retry-After", blocked.headers)
        self.assertEqual(other.status_code, 400)  # another account is not locked out

    def test_register_attempts_are_limited_per_ip(self):
        with patch.dict(web_common.RATE_LIMITS, {"auth_ip": (1.0, 0.0001)}):
            first = self.client.post("/api/auth/register", json={"email": _email(), "password": "password123"})
            second = self.client.post("/api/auth/register", json={"email": _email(), "password": "password123"})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)


class ClientIpTests(unittest.TestCase):
    def test_tunnel_header_is_trusted_from_loopback_only(self):
        header = {"CF-Connecting-IP": "203.0.113.9"}
        self.assertEqual(web_common.client_ip(_request("127.0.0.1", header)), "203.0.113.9")
        self.assertEqual(web_common.client_ip(_request("::1", header)), "203.0.113.9")
        self.assertEqual(web_common.client_ip(_request("198.51.100.4", header)), "198.51.100.4")
        self.assertEqual(web_common.client_ip(_request("127.0.0.1", {})), "127.0.0.1")


class SchemaOnceTests(unittest.TestCase):
    def test_module_schema_runs_once_per_database(self):
        calls = []

        def create(conn: sqlite3.Connection) -> None:
            calls.append(1)
            conn.execute("CREATE TABLE IF NOT EXISTS schema_once_probe (id INTEGER)")

        owner = f"probe-{uuid.uuid4().hex}"
        for _ in range(3):
            with auth_db.connect() as conn:
                auth_db.ensure_schema(conn, owner, create)
        self.assertEqual(len(calls), 1)

    def test_core_schema_is_not_rerun_on_every_connection(self):
        auth_db.get_user_status(1)  # make sure this database is set up
        with patch.object(auth_db, "init_db", side_effect=AssertionError("init_db ran again")):
            auth_db.get_user_status(1)
            with auth_db.connect() as conn:
                conn.execute("SELECT 1")


if __name__ == "__main__":
    unittest.main()
