"""Studio routes: models, transform, speech files, analysis, cleaning pasted text and photos, /tts snippets."""
from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

import analysis
import intake
import transform
from services import ai, speech
from web_common import MAX_TEXT_CHARS, _require_user_id, rate_limit

router = APIRouter()


class ConnectionTestRequest(BaseModel):
    model: ai.TransformModel = ai.DEFAULT_MODEL


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    voice: str = "fr-FR-DeniseNeural"


class CleanInputRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


@router.post("/api/clean-input")
async def clean_input(
    request: CleanInputRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    return await intake.request_clean_input(request.text, api_key)


@router.post("/api/photo-extract")
async def photo_extract(
    request: Request,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    # Read by hand: a body model would parse any size first, and its 422 echoes the input back
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > intake.PHOTO_MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail=intake.PHOTO_TOO_LARGE_DETAIL)
    payload = intake.photo_payload(intake.photo_data_uri(bytes(body)))
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=90) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    items = intake.parse_photo_items(raw_text)
    if items is None:
        raise HTTPException(
            status_code=502,
            detail={"code": "photo_bad_output", "message": "照片识别失败，请拍清楚一点再试。"},
        )
    if not items:
        raise HTTPException(
            status_code=422,
            detail={"code": "photo_no_french", "message": "照片里没有识别到法语内容。"},
        )
    return {"items": items, "text": "\n".join(item["fr"] for item in items), "count": len(items)}


@router.get("/api/models")
async def available_models():
    return {
        "default": ai.DEFAULT_MODEL,
        "proofreader": {"id": ai.DEFAULT_MODEL, "label": ai.MODEL_LABELS[ai.DEFAULT_MODEL]},
        "models": [
            {
                "id": ai.DEFAULT_MODEL,
                "label": ai.MODEL_LABELS[ai.DEFAULT_MODEL],
                "description": "AGY (low thinking); fastest.",
                "recommended": True,
            }
        ],
    }


@router.post("/api/connection/test")
async def test_connection(
    request: ConnectionTestRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    sample_request = transform.TransformRequest(
        text="\u6211\u6b63\u5728\u5b66\u4e60\u6cd5\u8bed\u3002",
        style="spoken",
        level="A1-A2",
        locale="fr-FR",
        model=request.model,
        task_mode="translate",
    )
    text, model, _, quality_check, proofread_model = await transform.request_french_transform(
        sample_request, api_key
    )
    return {
        "connected": True,
        "requested_model": request.model,
        "model": model,
        "label": ai.MODEL_LABELS[ai.DEFAULT_MODEL],
        "proofread_model": proofread_model,
        "proofread_label": ai.MODEL_LABELS.get(proofread_model, proofread_model),
        "sample": text,
        "quality_check": quality_check,
    }


@router.post("/api/transform")
async def transform_to_french(
    request: transform.TransformRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    text, model, task_mode, quality_check, proofread_model = (
        await transform.request_french_transform(request, api_key)
    )
    return {
        "text": text,
        "model": model,
        "task_mode": task_mode,
        "task_label": transform.TASK_MODE_LABELS[task_mode],
        "proofread_model": proofread_model,
        "proofread_label": ai.MODEL_LABELS.get(proofread_model, proofread_model),
        "quality_check": quality_check,
    }


@router.post("/api/speech")
async def generate_speech(
    request: SpeechRequest,
    authorization: str | None = Header(default=None),
):
    rate_limit(_require_user_id(authorization), "speech")
    audio_filename, srt_filename = await speech.create_speech_files(
        request.text, request.voice
    )
    return {
        "audio_url": f"/files/{audio_filename}",
        "srt_url": f"/files/{srt_filename}",
        "audio_filename": audio_filename,
        "srt_filename": srt_filename,
        "voice": request.voice,
    }


@router.get("/files/{filename}")
async def get_output_file(
    request: Request, filename: str, download: bool = Query(default=False)
):
    # <audio src> sends the same-origin HttpOnly session cookie; API clients may use Bearer.
    _require_user_id(request.headers.get("authorization"), request)
    return speech.output_file(filename, download=download)


@router.post("/api/analyze")
async def analyze_french(
    request: analysis.AnalyzeRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    result = await analysis.request_french_analysis(request, api_key)
    return result


@router.get("/tts")
async def generate_tts(
    request: Request,
    text: str,
    voice: str = "fr-FR-DeniseNeural",
    format: Literal["mp3", "srt"] = "mp3",
    download: bool = False,
    rate: float = Query(default=1.0, ge=.5, le=1.5),
):
    # <audio> cannot send an Authorization header. Same-origin cookie is the credential.
    # Anonymous calls used to be an open Edge-TTS proxy on the public site.
    user_id = _require_user_id(request.headers.get("authorization"), request)
    if len(text) > speech.TTS_SNIPPET_MAX_CHARS:
        raise HTTPException(status_code=422, detail="文本过长，请使用音频工作台生成。")
    if not speech.snippet_cached(text, voice, rate):  # cache hits (prefetch, replays) are free
        rate_limit(user_id, "speech")
    # Snippets are cached by (voice, text) hash, so the same URL always returns the same audio.
    audio_filename, srt_filename = (await speech.create_speech_files(text, voice) if rate == 1 else
                                    await speech.create_speech_files(text, voice, rate=rate))
    filename = srt_filename if format == "srt" else audio_filename
    return speech.output_file(filename, download=download, cache_seconds=30 * 86400)
