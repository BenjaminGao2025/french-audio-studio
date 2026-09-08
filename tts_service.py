from __future__ import annotations

import datetime
import os
import re
import uuid
from pathlib import Path
from typing import Literal

import edge_tts
import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(BASE_DIR / "outputs"))).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PERPLEXITY_BASE_URL = os.getenv(
    "PERPLEXITY_BASE_URL", "http://127.0.0.1:8002/v1"
).rstrip("/")
PERPLEXITY_MODEL = os.getenv("PERPLEXITY_MODEL", "grok-4.6")
PERPLEXITY_PROOFREAD_MODEL = os.getenv(
    "PERPLEXITY_PROOFREAD_MODEL", "gpt-5.6-terra"
)
PERPLEXITY_TIMEOUT_SECONDS = float(os.getenv("PERPLEXITY_TIMEOUT_SECONDS", "120"))
MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "15000"))

TRANSFORM_MODELS = {
    "grok-4.6": {
        "label": "Grok 4.6",
        "description": "Fast mode; recommended for clean French transformation.",
        "recommended": True,
    },
    "grok-4.6-thinking": {
        "label": "Grok 4.6 Thinking",
        "description": "Reasoning mode; slower and more likely to add explanatory text.",
        "recommended": False,
    },
    "sonar-2": {
        "label": "Sonar 2",
        "description": "Perplexity fallback model.",
        "recommended": False,
    },
}
MODEL_LABELS = {
    **{model_id: details["label"] for model_id, details in TRANSFORM_MODELS.items()},
    "gpt-5.6-terra": "GPT-5.6 Terra",
}
if PERPLEXITY_MODEL not in TRANSFORM_MODELS:
    raise RuntimeError(f"Unsupported PERPLEXITY_MODEL: {PERPLEXITY_MODEL}")

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

STYLE_INSTRUCTIONS = {
    "spoken": "spoken",
    "neutral": "standard",
    "formal": "formal writing",
    "polished": "polished writing",
}

TASK_MODE_LABELS = {
    "generate": "按要求生成",
    "translate": "忠实翻译",
    "express": "自然表达",
    "polish": "润色法语",
}

LEVEL_INSTRUCTIONS = {
    "A1-A2": "A1-A2",
    "B1-B2": "B1-B2",
    "C1-C2": "C1-C2",
}

LOCALE_INSTRUCTIONS = {
    "fr-FR": "France French",
    "fr-CA": "Canadian French",
}

NON_FRENCH_SCRIPT_RE = re.compile(
    r"[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]"
)
UPSTREAM_META_RE = re.compile(
    r"\b(cannot perform|tool actions?|i will provide|here is the translation|"
    r"je traduis le texte|voici la traduction|texte traduit)\b",
    re.IGNORECASE,
)
FRENCH_BLOCK_RE = re.compile(r"<FRENCH>\s*(.*?)\s*</FRENCH>", re.IGNORECASE | re.DOTALL)
TRAILING_OFFER_RE = re.compile(
    r"\s+(?:si\s+tu\s+veux|si\s+vous\s+voulez),?\s+je\s+peux\b"
    r"[^.!?]*(?:[.!?]|$)\s*$",
    re.IGNORECASE,
)
TASK_CLASSIFICATION_RE = re.compile(
    r"\b(generate|translate|express|polish)\b", re.IGNORECASE
)
CHINESE_GENERATE_RE = re.compile(
    r"(?:请|请你|帮我|给我|我要|我想|我需要|能否|可以).{0,48}"
    r"(?:写|创作|生成|介绍|解释|说明|讲解|概述|总结|列出|编写|设计|制作|"
    r"回答|告诉|了解)"
    r"|^(?:写|创作|生成|介绍|解释|说明|讲解|概述|总结|列出|编写|设计|"
    r"制作|回答|告诉)"
    r"|\d+\s*(?:到|至|[-~—])\s*\d+\s*(?:个)?(?:词|单词|字)",
    re.IGNORECASE,
)
LATIN_GENERATE_RE = re.compile(
    r"^\s*(?:please\s+)?(?:write|create|generate|explain|describe|introduce|"
    r"summarize|draft|compose|give me|tell me|ecris|redige|explique|decris)",
    re.IGNORECASE,
)
ROUGH_SPEECH_RE = re.compile(
    r"嗯|呃|额|就是|那个|怎么说|然后|顺便|反正|大概|可能吧|之类的|就算了|"
    r"\b(?:um+|uh+|you know|i mean|kind of|sort of)\b",
    re.IGNORECASE,
)
FRENCH_SIGNAL_RE = re.compile(
    r"\b(?:je|tu|il|elle|nous|vous|ils|elles|le|la|les|un|une|des|du|de|"
    r"et|est|suis|vais|avec|pour|dans|ce|cet|cette|mon|ma|mes)\b|[àâçéèêëîïôùûüÿœ]",
    re.IGNORECASE,
)
REQUESTED_WORD_RANGE_RE = re.compile(
    r"(?<!\d)(\d{1,4})\s*(?:到|至|[-~—])\s*(\d{1,4})\s*"
    r"(?:个)?(?:单词|词|mots?|words?)",
    re.IGNORECASE,
)
FRENCH_WORD_RE = re.compile(
    r"[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:[’'-][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)*"
)

TransformModel = Literal["grok-4.6", "grok-4.6-thinking", "sonar-2"]
TaskMode = Literal["auto", "generate", "translate", "express", "polish"]
ResolvedTaskMode = Literal["generate", "translate", "express", "polish"]
QualityCheck = Literal["passed", "proofread"]


class TransformRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    style: Literal["spoken", "neutral", "formal", "polished"] = "spoken"
    level: Literal["A1-A2", "B1-B2", "C1-C2"] = "B1-B2"
    locale: Literal["fr-FR", "fr-CA"] = "fr-FR"
    model: TransformModel = PERPLEXITY_MODEL
    task_mode: TaskMode = "auto"


class ConnectionTestRequest(BaseModel):
    model: TransformModel = PERPLEXITY_MODEL


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    voice: str = "fr-FR-DeniseNeural"


app = FastAPI(title="French Audio Studio", version="2.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _normalized_text(value: str) -> str:
    text = value.strip()
    if not text:
        raise HTTPException(status_code=422, detail="请输入需要处理的文本。")
    return text


def _authorization_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "missing_api_key",
                "message": "请先填写 Perplexity web2api 的 API Key。",
            },
        )
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "missing_api_key",
                "message": "请先填写 Perplexity web2api 的 API Key。",
            },
        )
    return token


def _clean_model_text(value: str) -> str:
    text = value.strip()
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            text = "\n".join(lines[1:-1]).strip()
    french_block = FRENCH_BLOCK_RE.search(text)
    if french_block:
        text = french_block.group(1).strip()
    text = TRAILING_OFFER_RE.sub("", text).strip()
    return text


def _contains_non_french_script(value: str) -> bool:
    return NON_FRENCH_SCRIPT_RE.search(value) is not None


def _parse_task_classification(value: str) -> ResolvedTaskMode:
    matches = {match.lower() for match in TASK_CLASSIFICATION_RE.findall(value)}
    if not matches:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "missing_task_classification",
                "message": "Grok 未返回可验证的处理方式，请重试或手动选择一种处理方式。",
            },
        )
    if len(matches) != 1:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "invalid_task_classification",
                "message": "Grok 返回了无法识别的处理方式，请重试或手动选择一种处理方式。",
            },
        )
    return matches.pop()


def _infer_task_mode_locally(value: str) -> ResolvedTaskMode | None:
    text = _normalized_text(value)
    if CHINESE_GENERATE_RE.search(text) or LATIN_GENERATE_RE.search(text):
        return "generate"

    rough_markers = ROUGH_SPEECH_RE.findall(text)
    starts_as_rough_speech = bool(
        re.match(r"^\s*(?:嗯|呃|额|那个|就是|um+\b|uh+\b)", text, re.IGNORECASE)
    )
    if starts_as_rough_speech or len(rough_markers) >= 2:
        return "express"

    if len(FRENCH_SIGNAL_RE.findall(text)) >= 2:
        return "polish"

    return "translate"


def _requested_word_range(value: str) -> tuple[int, int] | None:
    match = REQUESTED_WORD_RANGE_RE.search(value)
    if not match:
        return None
    minimum, maximum = (int(number) for number in match.groups())
    if minimum < 1 or maximum < minimum or maximum > 5000:
        return None
    return minimum, maximum


def _french_word_count(value: str) -> int:
    return len(FRENCH_WORD_RE.findall(value))


def _generation_length_instruction(value: str) -> str:
    requested_range = _requested_word_range(value)
    if not requested_range:
        return ""
    minimum, maximum = requested_range
    target = (minimum + maximum) // 2
    return (
        f"length target {target} French words; final count must stay between "
        f"{minimum} and {maximum} words"
    )


def _classification_payload(request: TransformRequest) -> dict:
    return {
        "model": request.model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Classify the user's intent for a French writing tool. Return exactly one "
                    "lowercase word: generate, translate, express, or polish."
                ),
            },
            {
                "role": "user",
                "content": (
                    "generate = an explicit request to write, create, introduce or explain new "
                    "content; translate = a complete Chinese or English source sentence with no "
                    "creation request; express = rough speech with fillers, fragments or repetition; "
                    "polish = existing French needing correction. Never choose generate merely "
                    "because the tool will produce French.\n\n"
                    f"INPUT:\n{_normalized_text(request.text)}"
                ),
            },
        ],
        "stream": False,
        "temperature": 0,
    }


def _proofread_payload(
    request: TransformRequest,
    task_mode: ResolvedTaskMode,
    draft: str,
) -> dict:
    task_instruction = _build_messages(request, task_mode)[0]["content"]
    candidate = draft.strip() or "No usable draft is available; produce the final French."
    return {
        "model": PERPLEXITY_PROOFREAD_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the final French editor. Use the original user input as the source "
                    "of truth and revise the draft. Fix grammar, articles, agreement, accents, "
                    "idiom and task compliance. Do not mention the source or draft. "
                    "Do not add offers, follow-up questions or commentary. "
                    f"Task requirement: {task_instruction}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Original user input:\n{_normalized_text(request.text)}\n\n"
                    f"Draft to review:\n{candidate}"
                ),
            },
        ],
        "stream": False,
        "temperature": 0.05,
    }


def _build_messages(
    request: TransformRequest, task_mode: ResolvedTaskMode
) -> list[dict[str, str]]:
    source_text = _normalized_text(request.text)
    if task_mode == "translate":
        system_prompt = (
            f"Translate the user text faithfully into natural "
            f"{LOCALE_INSTRUCTIONS[request.locale]}. Preserve meaning, person, tense and tone. "
            "Return only French."
        )
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": source_text},
        ]

    locale = LOCALE_INSTRUCTIONS[request.locale]
    level = LEVEL_INSTRUCTIONS[request.level]
    style = STYLE_INSTRUCTIONS[request.style]
    if task_mode == "generate":
        length_instruction = _generation_length_instruction(source_text)
        length_prompt = f" {length_instruction.capitalize()}." if length_instruction else ""
        system_prompt = (
            "Follow the user's request and write the requested content, not a translation of "
            f"the request. Use {locale} at {level} level in a {style} register."
            f"{length_prompt} Do not add offers or follow-up questions. Return only the finished "
            "French."
        )
    elif task_mode == "express":
        system_prompt = (
            f"Express the intended meaning as idiomatic {locale} at {level} level in a {style} "
            "register. Preserve uncertainty, person and facts; organize fragments without "
            "inventing details. Return only clean French."
        )
    else:
        system_prompt = (
            f"Correct and polish the user's French as idiomatic {locale} at {level} level in a "
            f"{style} register. Preserve meaning and voice. Return only the finished French."
        )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": source_text},
    ]


def _chat_payload(request: TransformRequest, task_mode: ResolvedTaskMode) -> dict:
    temperatures = {
        "generate": 0.5,
        "translate": 0.15,
        "express": 0.3,
        "polish": 0.2,
    }
    return {
        "model": request.model,
        "messages": _build_messages(request, task_mode),
        "stream": False,
        "temperature": temperatures[task_mode],
    }


def _upstream_error(response: httpx.Response) -> HTTPException:
    code = "upstream_error"
    message = f"Perplexity web2api 返回 HTTP {response.status_code}。"
    try:
        payload = response.json()
        error = payload.get("error", {}) if isinstance(payload, dict) else {}
        if isinstance(error, dict):
            code = str(error.get("code") or code)
            message = str(error.get("message") or message)
    except ValueError:
        pass

    if response.status_code == 401 and code in {
        "perplexity_auth_failed",
        "upstream_auth_failed",
    }:
        return HTTPException(
            status_code=503,
            detail={
                "code": code,
                "message": (
                    "Perplexity 登录态已失效或账号当前不可用。请在 7840 更新 "
                    "PERPLEXITY_COOKIES 后重试。"
                ),
            },
        )
    if response.status_code == 401:
        return HTTPException(
            status_code=401,
            detail={"code": code, "message": "web2api API Key 不正确。"},
        )
    if response.status_code == 429:
        return HTTPException(
            status_code=429,
            detail={"code": code, "message": "Perplexity 请求过多，请稍后重试。"},
        )
    return HTTPException(
        status_code=502,
        detail={"code": code, "message": message},
    )


async def _post_chat(
    client: httpx.AsyncClient, payload: dict, headers: dict[str, str]
) -> tuple[dict, str]:
    for upstream_attempt in range(2):
        try:
            response = await client.post(
                f"{PERPLEXITY_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail={
                    "code": "upstream_timeout",
                    "message": "Perplexity 处理超时，请缩短文本或稍后重试。",
                },
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "upstream_unreachable",
                    "message": "无法连接 7840 上的 Perplexity web2api。",
                },
            ) from exc
        if response.status_code >= 500 and upstream_attempt == 0:
            continue
        break

    if response.status_code >= 400:
        raise _upstream_error(response)

    try:
        body = response.json()
        raw_text = str(body["choices"][0]["message"]["content"])
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "invalid_upstream_response",
                "message": "Perplexity 返回了无法识别的内容。",
            },
        ) from exc
    return body, raw_text


def _validate_model_result(
    raw_text: str,
    request: TransformRequest,
    task_mode: ResolvedTaskMode | None = None,
) -> str:
    result = _clean_model_text(raw_text)
    if not result:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "empty_upstream_response",
                "message": "Perplexity 没有返回法语文本。",
            },
        )
    if _contains_non_french_script(result):
        model_label = TRANSFORM_MODELS[request.model]["label"]
        raise HTTPException(
            status_code=502,
            detail={
                "code": "non_french_upstream_response",
                "message": f"{model_label} 返回了双语或非法语内容，纯法语检查未通过。",
            },
        )
    if UPSTREAM_META_RE.search(result):
        raise HTTPException(
            status_code=502,
            detail={
                "code": "upstream_meta_response",
                "message": "Grok 返回了内部说明而不是法语正文，已拒绝该结果。",
            },
        )
    requested_range = (
        _requested_word_range(request.text) if task_mode == "generate" else None
    )
    if requested_range:
        word_count = _french_word_count(result)
        minimum, maximum = requested_range
        if not minimum <= word_count <= maximum:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "word_count_out_of_range",
                    "message": (
                        f"生成结果为 {word_count} 词，没有满足 {minimum}–{maximum} 词的要求。"
                    ),
                },
            )
    return result


def _contract_retry_payload(payload: dict, error_code: str) -> dict:
    messages = [dict(message) for message in payload["messages"]]
    if error_code == "word_count_out_of_range":
        source_prompt = "\n".join(str(message.get("content", "")) for message in messages)
        length_instruction = _generation_length_instruction(source_prompt)
        messages[0]["content"] += (
            f" Strict retry: {length_instruction}. Count the finished French words before "
            "returning the answer."
        )
    else:
        messages[0]["content"] += (
            f" Strict retry after {error_code}: output clean French text only. Do not copy any "
            "source-language words or add commentary."
        )
    return {**payload, "messages": messages, "temperature": 0.05}


async def request_french_transform(
    request: TransformRequest, api_key: str
) -> tuple[str, str, ResolvedTaskMode, QualityCheck, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        if request.task_mode == "auto":
            local_task_mode = _infer_task_mode_locally(request.text)
            if local_task_mode:
                resolved_task_mode = local_task_mode
            else:
                classification_payload = _classification_payload(request)
                for classification_attempt in range(2):
                    _, classification = await _post_chat(
                        client, classification_payload, headers
                    )
                    try:
                        resolved_task_mode = _parse_task_classification(classification)
                        break
                    except HTTPException:
                        if classification_attempt == 0:
                            classification_payload = {
                                **classification_payload,
                                "messages": [
                                    *classification_payload["messages"],
                                    {
                                        "role": "user",
                                        "content": (
                                            "Return one lowercase word only: generate, translate, "
                                            "express, or polish."
                                        ),
                                    },
                                ],
                            }
                            continue
                        raise
        else:
            resolved_task_mode = request.task_mode

        payload = _chat_payload(request, resolved_task_mode)
        result = ""
        model = request.model
        for attempt in range(2):
            body, raw_text = await _post_chat(client, payload, headers)
            model = str(body.get("model") or request.model)
            try:
                result = _validate_model_result(raw_text, request, resolved_task_mode)
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, dict) else {}
                error_code = str(detail.get("code") or "invalid_output_contract")
                if attempt == 0:
                    payload = _contract_retry_payload(payload, error_code)
                    continue
                break
            break

        quality_check: QualityCheck = "passed"
        proofread_model = PERPLEXITY_PROOFREAD_MODEL
        proofread_payload = _proofread_payload(
            request, resolved_task_mode, result
        )
        for proofread_attempt in range(2):
            proofread_body, raw_proofread = await _post_chat(
                client, proofread_payload, headers
            )
            try:
                result = _validate_model_result(
                    raw_proofread, request, resolved_task_mode
                )
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, dict) else {}
                error_code = str(detail.get("code") or "invalid_proofread_output")
                if proofread_attempt == 0:
                    proofread_payload = _contract_retry_payload(
                        proofread_payload, error_code
                    )
                    continue
                if result:
                    break
                raise
            proofread_model = str(
                proofread_body.get("model") or PERPLEXITY_PROOFREAD_MODEL
            )
            quality_check = "proofread"
            break

        return result, model, resolved_task_mode, quality_check, proofread_model

    raise RuntimeError("Unreachable transform retry state")


def _timestamp() -> str:
    now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{now}_{uuid.uuid4().hex[:6]}"


def _safe_timestamp(value: str | None) -> str:
    if value and re.fullmatch(r"[0-9A-Za-z_-]{1,48}", value):
        return value
    return _timestamp()


def _validate_voice(voice: str) -> str:
    if voice not in SUPPORTED_VOICES:
        raise HTTPException(status_code=422, detail="不支持所选语音。")
    return voice


async def create_speech_files(
    text: str, voice: str, timestamp: str | None = None
) -> tuple[str, str]:
    content = _normalized_text(text)
    selected_voice = _validate_voice(voice)
    job_timestamp = _safe_timestamp(timestamp)
    safe_voice = selected_voice.replace("/", "_").replace("\\", "_")
    base_filename = f"TTS_{safe_voice}_{job_timestamp}"
    audio_filename = f"{base_filename}.mp3"
    srt_filename = f"{base_filename}.srt"
    audio_path = OUTPUT_DIR / audio_filename
    srt_path = OUTPUT_DIR / srt_filename

    if not audio_path.exists() or not srt_path.exists():
        communicate = edge_tts.Communicate(content, selected_voice)
        submaker = edge_tts.SubMaker()
        with audio_path.open("wb") as audio_file:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_file.write(chunk["data"])
                elif chunk["type"] == "SentenceBoundary":
                    submaker.feed(chunk)
        srt_path.write_text(submaker.get_srt(), encoding="utf-8")

    return audio_filename, srt_filename


def _output_file(filename: str, download: bool = False) -> FileResponse:
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
        headers={"Access-Control-Expose-Headers": "Content-Disposition"},
    )


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "model": PERPLEXITY_MODEL,
        "proofread_model": PERPLEXITY_PROOFREAD_MODEL,
        "output_directory_ready": OUTPUT_DIR.is_dir(),
    }


@app.get("/api/models")
async def available_models():
    return {
        "default": PERPLEXITY_MODEL,
        "proofreader": {
            "id": PERPLEXITY_PROOFREAD_MODEL,
            "label": MODEL_LABELS.get(
                PERPLEXITY_PROOFREAD_MODEL, PERPLEXITY_PROOFREAD_MODEL
            ),
        },
        "models": [
            {"id": model_id, **details}
            for model_id, details in TRANSFORM_MODELS.items()
        ],
    }


@app.post("/api/connection/test")
async def test_connection(
    request: ConnectionTestRequest,
    authorization: str | None = Header(default=None),
):
    api_key = _authorization_token(authorization)
    sample_request = TransformRequest(
        text="\u6211\u6b63\u5728\u5b66\u4e60\u6cd5\u8bed\u3002",
        style="spoken",
        level="A1-A2",
        locale="fr-FR",
        model=request.model,
        task_mode="translate",
    )
    text, model, _, quality_check, proofread_model = await request_french_transform(
        sample_request, api_key
    )
    return {
        "connected": True,
        "requested_model": request.model,
        "model": model,
        "label": TRANSFORM_MODELS[request.model]["label"],
        "proofread_model": proofread_model,
        "proofread_label": MODEL_LABELS.get(proofread_model, proofread_model),
        "sample": text,
        "quality_check": quality_check,
    }


@app.post("/api/transform")
async def transform_to_french(
    request: TransformRequest,
    authorization: str | None = Header(default=None),
):
    api_key = _authorization_token(authorization)
    text, model, task_mode, quality_check, proofread_model = (
        await request_french_transform(request, api_key)
    )
    return {
        "text": text,
        "model": model,
        "task_mode": task_mode,
        "task_label": TASK_MODE_LABELS[task_mode],
        "proofread_model": proofread_model,
        "proofread_label": MODEL_LABELS.get(proofread_model, proofread_model),
        "quality_check": quality_check,
    }


@app.post("/api/speech")
async def generate_speech(request: SpeechRequest):
    audio_filename, srt_filename = await create_speech_files(
        request.text, request.voice
    )
    return {
        "audio_url": f"/files/{audio_filename}",
        "srt_url": f"/files/{srt_filename}",
        "audio_filename": audio_filename,
        "srt_filename": srt_filename,
        "voice": request.voice,
    }


@app.get("/files/{filename}")
async def get_output_file(filename: str, download: bool = Query(default=False)):
    return _output_file(filename, download=download)


@app.get("/tts")
async def generate_tts(
    text: str,
    voice: str = "en-US-AvaNeural",
    t: str | None = None,
    format: Literal["mp3", "srt"] = "mp3",
):
    audio_filename, srt_filename = await create_speech_files(text, voice, t)
    filename = srt_filename if format == "srt" else audio_filename
    return _output_file(filename, download=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
