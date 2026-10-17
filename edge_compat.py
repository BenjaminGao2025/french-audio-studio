"""Keep edge-tts working after Microsoft moved Edge "Read Aloud" synthesis.

Since 2026-10-12 (rolled out region by region) the legacy WebSocket host
speech.platform.bing.com refuses every synthesis handshake with HTTP 403, and
edge-tts 7.2.8 (latest release) still hard-codes it. Edge itself now uses
api.msedgeservices.com, which accepts the same client token and the legacy
Sec-MS-GEC token, and returns the same mp3 (24 kHz mono 48 kbps).
See https://github.com/rany2/edge-tts/issues/490.

Import this module once, before any synthesis. It
- points edge-tts at the new host (edge_tts.communicate.WSS_URL is the name the
  library actually reads; edge_tts.constants.WSS_URL is only a copy), and
- retries a refused/throttled handshake (the new host answers 429 to bursts)
  a couple of times with backoff, but only before any audio was produced.
"""
from __future__ import annotations

import asyncio
import logging
import os

import aiohttp
import edge_tts
from edge_tts import communicate as _communicate
from edge_tts.constants import TRUSTED_CLIENT_TOKEN

logger = logging.getLogger(__name__)

LEGACY_WSS_URL = _communicate.WSS_URL
EDGE_WSS_URL = os.getenv(
    "EDGE_TTS_WSS_URL",
    "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
    f"?Ocp-Apim-Subscription-Key={TRUSTED_CLIENT_TOKEN}",
)
RETRY_STATUSES = {403, 429, 500, 502, 503, 504}
RETRY_DELAYS = (1.5, 4.0)

_original_stream = edge_tts.Communicate.stream


async def _stream_with_retry(self):
    for attempt in range(len(RETRY_DELAYS) + 1):
        produced = False
        try:
            async for message in _original_stream(self):
                produced = True
                yield message
            return
        except aiohttp.ClientResponseError as exc:
            if produced or exc.status not in RETRY_STATUSES or attempt == len(RETRY_DELAYS):
                raise
            logger.warning("Edge TTS handshake %s, retrying (%s)", exc.status, attempt + 1)
            await asyncio.sleep(RETRY_DELAYS[attempt])


def install() -> None:
    _communicate.WSS_URL = EDGE_WSS_URL
    if edge_tts.Communicate.stream is not _stream_with_retry:
        edge_tts.Communicate.stream = _stream_with_retry


install()
