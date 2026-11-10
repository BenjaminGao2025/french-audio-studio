"""Imported first by every test module: isolate the app from real data and secrets."""

import os
import tempfile
import unittest

os.environ["OUTPUT_DIR"] = tempfile.mkdtemp(prefix="tts-tests-")
os.environ["AUTH_SECRET"] = "test-only-secret-" + "x" * 32
os.environ["ALLOW_REGISTRATION"] = "true"
# Dictionary tests use their own fixture; never read the operator’s production index.
os.environ["FRENCH_DICTIONARY_PATH"] = ""
os.environ["WEB2API_API_KEY"] = "server-test-key"
# Fast password hashing and roomy sign-in limits; tests that check either patch them back.
os.environ["PBKDF2_ITERATIONS"] = "1000"
os.environ["RATE_AUTH_IP_BURST"] = "100000"
os.environ["RATE_AUTH_EMAIL_BURST"] = "100000"


def session_headers() -> dict:
    """A real logged-in session: raw strings are no longer accepted as upstream API keys."""
    import uuid

    import auth_db

    token = auth_db.register_user(f"t_{uuid.uuid4().hex[:12]}@example.com", "password123")["token"]
    return {"Authorization": f"Bearer {token}"}


def function_tests(namespace: dict):
    """A load_tests hook so `python -m unittest` also runs a module's plain test_* functions.

    Usage, at the end of a pytest-style test module: load_tests = testenv.function_tests(globals())
    """

    def load_tests(loader, standard_tests, pattern):
        for name, fn in namespace.items():
            if name.startswith("test_") and callable(fn) and not isinstance(fn, type):
                standard_tests.addTest(unittest.FunctionTestCase(fn, description=f"{namespace['__name__']}.{name}"))
        return standard_tests

    return load_tests
