import unittest
import uuid

import testenv  # noqa: F401  (must run before the app is imported)
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth_db
import routers.auth
import services.ai
import tts_service

PHONE_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"


class DeviceLimitTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.email = f"devices_{uuid.uuid4().hex[:10]}@example.com"
        auth_db.register_user(self.email, "password123")

    def _login(self, user_agent: str = PHONE_UA) -> str:
        response = self.client.post(
            "/api/auth/login",
            json={"email": self.email, "password": "password123"},
            headers={"user-agent": user_agent},
        )
        self.assertEqual(response.status_code, 200)
        self.client.cookies.clear()  # each login stands for a separate device
        return response.json()["token"]

    def _me(self, token: str):
        return self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    def test_fourth_device_signs_out_the_least_recently_used(self):
        tokens = [self._login() for _ in range(4)]  # registration made one more session
        for token in tokens[:1]:
            response = self._me(token)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["detail"]["code"], "session_revoked")
        for token in tokens[1:]:
            self.assertEqual(self._me(token).status_code, 200)

        devices = self.client.get("/api/auth/devices", headers={"Authorization": f"Bearer {tokens[-1]}"}).json()
        self.assertEqual(devices["max_devices"], 3)
        self.assertEqual(len(devices["devices"]), 3)
        self.assertEqual(sum(d["current"] for d in devices["devices"]), 1)
        self.assertEqual(devices["devices"][0]["device"], "Chrome · Android")

    def test_signing_out_a_device_from_another(self):
        first, second = self._login(), self._login()
        headers = {"Authorization": f"Bearer {second}"}
        devices = self.client.get("/api/auth/devices", headers=headers).json()["devices"]
        first_id = auth_db._signed_payload(first)["sid"]
        self.assertIn(first_id, [d["id"] for d in devices])

        self.assertTrue(self.client.delete(f"/api/auth/devices/{first_id}", headers=headers).json()["success"])
        self.assertEqual(self._me(first).status_code, 401)
        self.assertEqual(self._me(second).status_code, 200)

    def test_logout_ends_this_device_only(self):
        first, second = self._login(), self._login()
        self.client.post("/api/auth/logout", headers={"Authorization": f"Bearer {first}"})
        self.assertEqual(self._me(first).status_code, 401)
        self.assertEqual(self._me(second).status_code, 200)

    def test_tokens_without_a_session_are_rejected(self):
        payload = auth_db._signed_payload(self._login())
        legacy = auth_db._generate_token(payload["sub"], self.email, "")
        self.assertIsNone(auth_db.verify_token(legacy))
        self.assertEqual(self._me(legacy).status_code, 401)

    def test_signed_out_token_is_not_used_as_an_api_key(self):
        token = self._login()
        auth_db.end_session(auth_db._signed_payload(token)["sub"], auth_db._signed_payload(token)["sid"])
        with self.assertRaises(HTTPException) as caught:
            services.ai.upstream_key(f"Bearer {token}")
        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(caught.exception.detail["code"], "session_revoked")

    def test_device_labels(self):
        self.assertEqual(routers.auth._device_label(PHONE_UA), "Chrome · Android")
        iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile Safari/604.1"
        self.assertEqual(routers.auth._device_label(iphone), "Safari · iPhone")
        self.assertEqual(routers.auth._device_label(""), "Unknown device")


if __name__ == "__main__":
    unittest.main()

class NoDeviceLimitTests(unittest.TestCase):
    setUp = DeviceLimitTests.setUp
    _login = DeviceLimitTests._login
    _me = DeviceLimitTests._me

    def test_device_limit_zero_keeps_every_device(self):
        with auth_db.connect() as conn:
            conn.execute("INSERT INTO user_device_limits (user_id, device_limit) SELECT id, 0 FROM users WHERE email = ?", (self.email,))
        tokens = [self._login() for _ in range(6)]
        for token in tokens:
            self.assertEqual(self._me(token).status_code, 200)
        devices = self.client.get("/api/auth/devices", headers={"Authorization": f"Bearer {tokens[-1]}"}).json()
        self.assertIsNone(devices["max_devices"])
        self.assertEqual(len(devices["devices"]), 7)

    def test_device_limit_can_be_raised(self):
        with auth_db.connect() as conn:
            conn.execute("INSERT INTO user_device_limits (user_id, device_limit) SELECT id, 5 FROM users WHERE email = ?", (self.email,))
        tokens = [self._login() for _ in range(5)]
        self.assertEqual(self._me(tokens[0]).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/devices", headers={"Authorization": f"Bearer {tokens[0]}"}).json()["max_devices"], 5)
        self._login()
        self.assertEqual(self._me(tokens[0]).status_code, 401)


class GoogleSignInTests(unittest.TestCase):
    CLIENT = "test-client.apps.googleusercontent.com"

    def setUp(self):
        self.client = TestClient(tts_service.app)
        self.email = f"google_{uuid.uuid4().hex[:10]}@example.com"
        self._client_id = routers.auth.GOOGLE_CLIENT_ID
        self._tokeninfo = routers.auth._google_tokeninfo
        routers.auth.GOOGLE_CLIENT_ID = self.CLIENT
        self.info = {
            "aud": self.CLIENT,
            "iss": "https://accounts.google.com",
            "email": self.email,
            "email_verified": "true",
            "exp": str(int(__import__("time").time()) + 600),
        }

        async def fake(credential):
            return dict(self.info) if credential == "good" else {}

        routers.auth._google_tokeninfo = fake

    def tearDown(self):
        routers.auth.GOOGLE_CLIENT_ID = self._client_id
        routers.auth._google_tokeninfo = self._tokeninfo

    def _google(self, credential="good", invite=""):
        return self.client.post("/api/auth/google", json={"credential": credential, "invite_code": invite}, headers={"user-agent": PHONE_UA})

    def test_options_name_the_client(self):
        self.assertEqual(self.client.get("/api/auth/options").json(), {"google_client_id": self.CLIENT})

    def test_existing_account_signs_in_by_email(self):
        auth_db.register_user(self.email, "password123")
        self.info["email"] = self.email.upper()
        response = self._google()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["email"], self.email)
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {response.json()['token']}"}).status_code, 200)

    def test_new_email_needs_an_invite(self):
        self.addCleanup(setattr, auth_db, "ALLOW_REGISTRATION", auth_db.ALLOW_REGISTRATION)
        auth_db.ALLOW_REGISTRATION = False
        response = self._google()
        self.assertEqual(response.status_code, 400)
        self.assertIn("invite code", response.json()["detail"]["message"])
        code = auth_db.create_invite("google-test", 1)["code"]
        response = self._google(invite=code)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["email"], self.email)

    def test_rejects_tokens_not_meant_for_this_site(self):
        auth_db.register_user(self.email, "password123")
        for change in ({"aud": "someone-else"}, {"iss": "evil.example"}, {"email_verified": "false"}, {"exp": "1"}):
            with self.subTest(change=change):
                saved = dict(self.info)
                self.info.update(change)
                self.assertEqual(self._google().status_code, 400)
                self.info = saved
        self.assertEqual(self._google("forged").status_code, 400)

    def test_hidden_without_a_client_id(self):
        routers.auth.GOOGLE_CLIENT_ID = ""
        self.assertEqual(self.client.get("/api/auth/options").json(), {"google_client_id": None})
        self.assertEqual(self._google().status_code, 404)
