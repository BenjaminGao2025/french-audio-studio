"""Edge TTS synthesis into outputs/: supported voices, cache-friendly file names, safe file serving."""
from __future__ import annotations

import datetime
import hashlib
import hmac
import os
import re
import uuid
from pathlib import Path

import edge_tts
from fastapi import HTTPException
from fastapi.responses import FileResponse

import auth_db
from web_common import OUTPUT_DIR, _normalized_text

TTS_SNIPPET_MAX_CHARS = 600


SUPPORTED_VOICES = {
    "en-US-AvaNeural",
    "en-US-AndrewNeural",
    "en-GB-SoniaNeural",
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "fr-FR-DeniseNeural",
    "fr-FR-HenriNeural",
    "fr-FR-VivienneMultilingualNeural",
    "fr-FR-RemyMultilingualNeural",
    "fr-CA-SylvieNeural",
    "fr-CA-JeanNeural",
    "fr-CA-AntoineNeural",
}


def _timestamp() -> str:
    # 128-bit id. These files are fetched by URL with no auth header (audio players),
    # so a 6-hex suffix was the whole secret.
    now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{now}_{uuid.uuid4().hex}"


def safe_timestamp(
    value: str | None, text: str | None = None, voice: str | None = None
) -> str:
    if value and re.fullmatch(r"[0-9A-Za-z_-]{1,48}", value):
        return value
    if text and voice and len(text) <= TTS_SNIPPET_MAX_CHARS:
        # Keyed hash: still cacheable per (voice, text), but not computable without AUTH_SECRET.
        h = hmac.new(
            auth_db.AUTH_SECRET.encode("utf-8"),
            f"{voice}:{text.strip()}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:32]
        return f"snip_{h}"
    return _timestamp()


def validate_voice(voice: str) -> str:
    if voice not in SUPPORTED_VOICES:
        raise HTTPException(status_code=422, detail="不支持所选语音。")
    return voice


def snippet_cached(text: str, voice: str, rate: float = 1.0) -> bool:
    try:
        content = _normalized_text(text)
        stamp = safe_timestamp(None, text=content, voice=validate_voice(voice) if rate == 1 else f"{validate_voice(voice)}@{rate:g}")
    except HTTPException:
        return False
    base = OUTPUT_DIR / f"TTS_{voice}_{stamp}"
    return base.with_suffix(".mp3").exists() and base.with_suffix(".srt").exists()


async def create_speech_files(
    text: str, voice: str, timestamp: str | None = None, *, rate: float = 1.0
) -> tuple[str, str]:
    content = _normalized_text(text)
    selected_voice = validate_voice(voice)
    if not .5 <= rate <= 1.5:
        raise HTTPException(422, "Rate must be between 0.5 and 1.5")
    job_timestamp = safe_timestamp(timestamp, text=content, voice=selected_voice if rate == 1 else f"{selected_voice}@{rate:g}")
    safe_voice = selected_voice.replace("/", "_").replace("\\", "_")
    base_filename = f"TTS_{safe_voice}_{job_timestamp}"
    audio_filename = f"{base_filename}.mp3"
    srt_filename = f"{base_filename}.srt"
    audio_path = OUTPUT_DIR / audio_filename
    srt_path = OUTPUT_DIR / srt_filename

    if not audio_path.exists() or not srt_path.exists():
        # Write to unique temp files and rename, so concurrent requests for the
        # same cached snippet can never leave a truncated file behind.
        tmp_suffix = f".{uuid.uuid4().hex[:8]}.part"
        tmp_audio = audio_path.with_name(audio_filename + tmp_suffix)
        tmp_srt = srt_path.with_name(srt_filename + tmp_suffix)
        communicate = (edge_tts.Communicate(content, selected_voice) if rate == 1 else
                       edge_tts.Communicate(content, selected_voice, rate=f"{round((rate - 1) * 100):+d}%"))
        submaker = edge_tts.SubMaker()
        try:
            with tmp_audio.open("wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "SentenceBoundary":
                        submaker.feed(chunk)
            tmp_srt.write_text(submaker.get_srt(), encoding="utf-8")
            os.replace(tmp_audio, audio_path)
            os.replace(tmp_srt, srt_path)
        finally:
            tmp_audio.unlink(missing_ok=True)
            tmp_srt.unlink(missing_ok=True)

    return audio_filename, srt_filename


def output_file(
    filename: str, download: bool = False, cache_seconds: int = 0
) -> FileResponse:
    if Path(filename).name != filename or Path(filename).suffix not in {".mp3", ".srt"}:
        raise HTTPException(status_code=404, detail="文件不存在。")
    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在。")
    media_type = "audio/mpeg" if path.suffix == ".mp3" else "application/x-subrip"
    return FileResponse(
        path,
        media_type=media_type,
        filename=filename if download else None,
        headers={
            "Access-Control-Expose-Headers": "Content-Disposition",
            **({"Cache-Control": f"private, max-age={cache_seconds}"} if cache_seconds else {}),
        },
    )
