import unittest
import uuid
from unittest.mock import patch

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi.testclient import TestClient

import auth_db
import tts_service


def _email() -> str:
    return f"inv_{uuid.uuid4().hex[:12]}@example.com"


class InviteRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        patcher = patch.object(auth_db, "ALLOW_REGISTRATION", False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _register(self, invite=None, email=None):
        body = {"email": email or _email(), "password": "password123"}
        if invite is not None:
            body["invite_code"] = invite
        return self.client.post("/api/auth/register", json=body)

    def test_closed_registration_without_invite_is_403(self):
        self.assertEqual(self._register().status_code, 403)
        self.assertEqual(self._register(invite="   ").status_code, 403)

    def test_bad_invite_is_400(self):
        response = self._register(invite="NOSUCHCODE")
        self.assertEqual(response.status_code, 400)
        self.assertIn("邀请码", response.json()["detail"]["message"])

    def test_valid_invite_registers_trial_and_counts_use(self):
        invite = auth_db.create_invite("xhs-test")
        self.assertEqual(len(invite["code"]), auth_db.INVITE_LENGTH)
        response = self._register(invite=invite["code"].lower())  # codes are case-insensitive
        self.assertEqual(response.status_code, 200)
        user = response.json()["user"]
        self.assertEqual(user["plan"], "trial")
        self.assertEqual(user["days_left"], auth_db.TRIAL_DAYS)
        self.assertTrue(response.json()["token"])
        self.assertEqual(auth_db.peek_invite(invite["code"])["use_count"], 1)

    def test_capped_invite_stops_at_max_uses(self):
        invite = auth_db.create_invite("one-shot", max_uses=1)
        self.assertEqual(self._register(invite=invite["code"]).status_code, 200)
        second = self._register(invite=invite["code"])
        self.assertEqual(second.status_code, 400)
        self.assertIn("用完", second.json()["detail"]["message"])
        self.assertEqual(auth_db.peek_invite(invite["code"])["use_count"], 1)

    def test_unlimited_invite_allows_many(self):
        invite = auth_db.create_invite("live")
        self.assertIsNone(invite["max_uses"])
        for _ in range(3):
            self.assertEqual(self._register(invite=invite["code"]).status_code, 200)
        self.assertEqual(auth_db.peek_invite(invite["code"])["use_count"], 3)

    def test_failed_signup_does_not_burn_a_use(self):
        invite = auth_db.create_invite("dup", max_uses=2)
        email = _email()
        self.assertEqual(self._register(invite=invite["code"], email=email).status_code, 200)
        duplicate = self._register(invite=invite["code"], email=email)
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(auth_db.peek_invite(invite["code"])["use_count"], 1)

    def test_disabled_invite_is_rejected(self):
        invite = auth_db.create_invite("off")
        with auth_db.connect() as conn:
            conn.execute("UPDATE invite_codes SET disabled = 1 WHERE code = ?", (invite["code"],))
        self.assertEqual(self._register(invite=invite["code"]).status_code, 400)

    def test_register_user_requires_invite_when_closed(self):
        with self.assertRaises(ValueError):
            auth_db.register_user(_email(), "password123")

    def test_invite_list_and_trial_expiry_still_work(self):
        invite = auth_db.create_invite("listed", max_uses=5)
        self.assertIn(invite["code"], [row["code"] for row in auth_db.list_invites()])
        result = auth_db.register_user(_email(), "password123", invite_code=invite["code"])
        user_id = result["user"]["id"]
        with auth_db.connect() as conn:
            conn.execute("UPDATE users SET trial_expires_at = '2000-01-01T00:00:00' WHERE id = ?", (user_id,))
        status = auth_db.get_user_status(user_id)
        self.assertFalse(status["is_valid"])
        with auth_db.connect() as conn:
            conn.execute("UPDATE users SET plan = 'pro' WHERE id = ?", (user_id,))
        self.assertTrue(auth_db.get_user_status(user_id)["is_valid"])


class MembershipPageTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)

    def test_account_page_moved_into_the_app(self):
        for headers in ({}, testenv.session_headers()):
            response = self.client.get("/account", headers=headers, follow_redirects=False)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers["location"], "/app/settings/account")

    def test_invite_links_open_study_signup(self):
        for path in ("/?invite=ABC123", "/home?invite=ABC123", "/study?invite=ABC123"):
            response = self.client.get(path, follow_redirects=False)
            self.assertEqual(response.status_code, 302, path)
            self.assertEqual(response.headers["location"], "/app/login?invite=ABC123")
        self.assertEqual(self.client.get("/home", follow_redirects=False).status_code, 200)

if __name__ == "__main__":
    unittest.main()
