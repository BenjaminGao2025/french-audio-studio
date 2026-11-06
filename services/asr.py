"""Local speech-to-text (faster-whisper on CPU): loaded lazily, one transcription at a time, bounded queue."""

from __future__ import annotations

import io
import logging
import os
import re
import threading
from pathlib import Path

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from web_common import BASE_DIR

logger = logging.getLogger(__name__)


ASR_MODEL_DIR = Path(os.getenv("ASR_MODEL_DIR", str(BASE_DIR / "models" / "faster-whisper-large-v3-turbo")))
ASR_CPU_THREADS = int(os.getenv("ASR_CPU_THREADS", "8"))
ASR_MAX_BYTES = 15 * 1024 * 1024


# ---------------------------------------------------------------------------
# Speech-to-text for spoken explanations (Chinese with French words mixed in).
# Local faster-whisper on CPU, then an LLM pass that only fixes mis-heard words.
# ---------------------------------------------------------------------------
_asr_model = None
_asr_lock = threading.Lock()  # one transcription at a time; also guards lazy loading

# Whisper (trained on video subtitles) sometimes "hears" subtitle credits in trailing
# noise, e.g. "字幕由…提供", "请订阅", "谢谢观看".
ASR_HALLUCINATION_RE = re.compile(
    r"字幕|订阅|点赞|打赏|请不吝|谢谢(?:大家)?(?:收看|观看)|感谢(?:收看|观看)|明镜|amara", re.IGNORECASE
)
ASR_HALLUCINATION_MAX_CHARS = 30


def _clean_asr_segments(segments: list[tuple[str, float, float, float]]) -> str:
    """Join (text, no_speech_prob, avg_logprob, compression_ratio) segments, dropping likely noise."""
    kept = []
    for text, no_speech_prob, avg_logprob, compression_ratio in segments:
        text = text.strip()
        if not text:
            continue
        if no_speech_prob > 0.5 and avg_logprob < -0.8:
            continue  # probably no speech at all
        if compression_ratio > 2.4:
            continue  # repetition loop
        if len(text) <= ASR_HALLUCINATION_MAX_CHARS and ASR_HALLUCINATION_RE.search(text):
            continue
        kept.append(text)
    joined = " ".join(kept).strip()
    # A hallucinated clause glued to the end of the last real sentence
    match = re.search(r"^(.*[。！？!?.，,])\s*([^。！？!?.，,]+)$", joined, re.DOTALL)
    if match and len(match.group(2)) <= ASR_HALLUCINATION_MAX_CHARS and ASR_HALLUCINATION_RE.search(match.group(2)):
        joined = match.group(1).strip()
    return joined


def _transcribe_sync(audio: bytes, sentence: str, context: str = "", language: str = "zh") -> dict:
    global _asr_model
    with _asr_lock:
        if _asr_model is None:
            if not ASR_MODEL_DIR.is_dir():
                raise HTTPException(
                    status_code=503,
                    detail={"code": "asr_unavailable", "message": "服务器上还没有安装语音识别模型。"},
                )
            from faster_whisper import WhisperModel

            _asr_model = WhisperModel(
                str(ASR_MODEL_DIR), device="cpu", compute_type="int8", cpu_threads=ASR_CPU_THREADS
            )
        # Forcing Chinese is ~2x faster than auto-detect and still keeps English/French
        # words in Latin script; the text as prompt biases towards its French words.
        # Whisper keeps only the prompt's last ~220 tokens, so the current sentence goes last.
        if language == "fr":
            prompt = f"{context} {sentence}".strip() if (sentence or context) else None
        else:
            prompt = f"{context} 我在用中文讲解这句法语：{sentence}".strip() if sentence else None
        segments, info = _asr_model.transcribe(
            io.BytesIO(audio),
            language=language,
            beam_size=5,
            vad_filter=True,
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        text = _clean_asr_segments(
            [(seg.text, seg.no_speech_prob, seg.avg_logprob, seg.compression_ratio) for seg in segments]
        )
    return {"text": text, "duration": round(info.duration, 1)}


ASR_MAX_QUEUE = int(os.getenv("ASR_MAX_QUEUE", "4"))
_asr_waiting = 0


def looks_like_audio(data: bytes) -> bool:
    head = data[:16]
    return (
        head.startswith(b"\x1a\x45\xdf\xa3")  # webm / matroska
        or head.startswith(b"OggS")
        or (head.startswith(b"RIFF") and head[8:12] == b"WAVE")
        or head[4:8] == b"ftyp"  # mp4 / m4a (Safari)
        or head.startswith(b"ID3")
        or head.startswith(b"fLaC")
        or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)  # mp3 / aac frame
    )


async def transcribe(audio: bytes, sentence: str, context: str, language: str):
    """Transcribe, or 429 when ASR_MAX_QUEUE requests are already waiting for the one model."""
    global _asr_waiting
    if _asr_waiting >= ASR_MAX_QUEUE:
        raise HTTPException(
            status_code=429,
            detail={"code": "asr_busy", "message": "识别排队的人太多了，请过几秒再试。", "retry_after": 5},
            headers={"Retry-After": "5"},
        )
    _asr_waiting += 1
    try:
        return await _transcribe_admitted(audio, sentence, context, language)
    finally:
        _asr_waiting -= 1


async def _transcribe_admitted(audio: bytes, sentence: str, context: str, language: str):
    try:
        if language == "zh":
            return await run_in_threadpool(_transcribe_sync, audio, sentence.strip(), context.strip())
        return await run_in_threadpool(_transcribe_sync, audio, sentence.strip(), context.strip(), language=language)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Transcription failed: %s", exc)
        raise HTTPException(status_code=422, detail={"message": "录音无法识别，请再录一次。"}) from exc
