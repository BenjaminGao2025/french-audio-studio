import testenv  # noqa: F401  (must run before the app is imported)

import asyncio
import unittest
from unittest.mock import patch

import aiohttp
import edge_tts
from edge_tts import communicate

import edge_compat
import episodes  # noqa: F401  (every synthesis path imports the fix)
import tts_service  # noqa: F401


def _refused(status):
    return aiohttp.WSServerHandshakeError(None, (), status=status, message="Invalid response status")


class EdgeCompatTests(unittest.TestCase):
    def test_synthesis_uses_the_new_microsoft_host(self):
        # speech.platform.bing.com answers 403 to every handshake since 2026-10-12
        self.assertIn("api.msedgeservices.com", communicate.WSS_URL)
        self.assertNotIn("speech.platform.bing.com", communicate.WSS_URL)
        self.assertIs(edge_tts.Communicate.stream, edge_compat._stream_with_retry)

    def test_refused_handshake_is_retried_before_any_audio(self):
        calls = []

        async def flaky(self):
            calls.append(1)
            if len(calls) == 1:
                raise _refused(429)
            yield {"type": "audio", "data": b"mp3"}

        async def run():
            out = []
            async for m in edge_tts.Communicate("Bonjour", "fr-FR-DeniseNeural").stream():
                out.append(m)
            return out

        with patch.object(edge_compat, "_original_stream", flaky), \
                patch.object(edge_compat, "RETRY_DELAYS", (0, 0)):
            out = asyncio.run(run())
        self.assertEqual(len(calls), 2)
        self.assertEqual(out[0]["data"], b"mp3")

    def test_gives_up_after_retries(self):
        async def always(self):
            raise _refused(403)
            yield  # pragma: no cover

        async def run():
            async for _ in edge_tts.Communicate("Bonjour", "fr-FR-DeniseNeural").stream():
                pass

        with patch.object(edge_compat, "_original_stream", always), \
                patch.object(edge_compat, "RETRY_DELAYS", (0, 0)):
            with self.assertRaises(aiohttp.ClientResponseError):
                asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
