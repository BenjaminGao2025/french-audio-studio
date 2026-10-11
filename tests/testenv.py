"""Imported first by every test module: isolate the app from real data and secrets."""
import os
import tempfile

os.environ["OUTPUT_DIR"] = tempfile.mkdtemp(prefix="tts-tests-")
os.environ["AUTH_SECRET"] = "test-only-secret-" + "x" * 32
os.environ["ALLOW_REGISTRATION"] = "true"
os.environ["WEB2API_API_KEY"] = "server-test-key"
# Legacy routing tests cover both upstreams; AGY-only mode is tested explicitly.
os.environ["AGY_ONLY"] = "false"


def session_headers() -> dict:
    """A real logged-in session: raw strings are no longer accepted as upstream API keys."""
    import uuid
    import auth_db
    token = auth_db.register_user(f"t_{uuid.uuid4().hex[:12]}@example.com", "password123")["token"]
    return {"Authorization": f"Bearer {token}"}
