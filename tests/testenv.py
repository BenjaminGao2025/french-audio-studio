"""Imported first by every test module: isolate the app from real data and secrets."""
import os
import tempfile

os.environ["OUTPUT_DIR"] = tempfile.mkdtemp(prefix="tts-tests-")
os.environ["AUTH_SECRET"] = "test-only-secret-" + "x" * 32
os.environ["ALLOW_REGISTRATION"] = "true"
os.environ["WEB2API_API_KEY"] = "server-test-key"
