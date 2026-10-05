from __future__ import annotations

import asyncio
import datetime
import hashlib
import io
import json
import logging
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

import edge_tts
import httpx

logger = logging.getLogger("tts_service")
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

import auth_db
import episodes
import game
import srs


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(BASE_DIR / "outputs"))).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Two OpenAI-compatible upstreams: the Perplexity web2api (perplexity-web-api) and the AGY (Antigravity) adapter
PERPLEXITY_BASE_URL = os.getenv(
    "PERPLEXITY_BASE_URL", "http://127.0.0.1:8002/v1"
).rstrip("/")
AGY_BASE_URL = os.getenv("AGY_BASE_URL", "http://127.0.0.1:8645/v1").rstrip("/")
PERPLEXITY_MODEL = os.getenv("PERPLEXITY_MODEL", "gpt-6.1-sol-thinking")
PERPLEXITY_PROOFREAD_MODEL = os.getenv("PERPLEXITY_PROOFREAD_MODEL", "gemini-3.8-flash")
# Quick helper tasks (e.g. fixing dictation) always use a fast model
FAST_MODEL = os.getenv("FAST_MODEL", "gemini-3.8-flash")
PERPLEXITY_TIMEOUT_SECONDS = float(os.getenv("PERPLEXITY_TIMEOUT_SECONDS", "120"))
MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "15000"))
TTS_SNIPPET_MAX_CHARS = 600
ASR_MODEL_DIR = Path(
    os.getenv("ASR_MODEL_DIR", str(BASE_DIR / "models" / "faster-whisper-large-v3-turbo"))
)
ASR_CPU_THREADS = int(os.getenv("ASR_CPU_THREADS", "8"))
ASR_MAX_BYTES = 15 * 1024 * 1024

TRANSFORM_MODELS = {
    "gpt-6.1-sol-thinking": {
        "label": "GPT-6.1 Sol Thinking",
        "description": "Perplexity; strongest reasoning, slower.",
        "recommended": True,
    },
    "gpt-6.1-sol": {
        "label": "GPT-6.1 Sol",
        "description": "Perplexity; strong and faster than Thinking.",
        "recommended": False,
    },
    "claude-sonnet-5.5-thinking": {
        "label": "Claude Sonnet 5.5 Thinking",
        "description": "Perplexity; careful explanations.",
        "recommended": False,
    },
    "claude-sonnet-5.5": {
        "label": "Claude Sonnet 5.5",
        "description": "Perplexity.",
        "recommended": False,
    },
    "grok-4.7": {
        "label": "Grok 4.7",
        "description": "Perplexity.",
        "recommended": False,
    },
    "gemini-3.8-flash": {
        "label": "Gemini 3.8 Flash (AGY)",
        "description": "7840 AGY; fastest.",
        "recommended": False,
    },
}
MODEL_LABELS = {model_id: details["label"] for model_id, details in TRANSFORM_MODELS.items()}
if PERPLEXITY_MODEL not in TRANSFORM_MODELS:
    raise RuntimeError(f"Unsupported PERPLEXITY_MODEL: {PERPLEXITY_MODEL}")


AGY_UPSTREAM_MODELS = {"gemini-3.8-flash": "gemini-3.8-flash-low"}


def _map_upstream_model(model_name: str) -> str:
    return AGY_UPSTREAM_MODELS.get(model_name, model_name)


def _upstream_base_url(upstream_model: str) -> str:
    return AGY_BASE_URL if upstream_model in AGY_UPSTREAM_MODELS.values() else PERPLEXITY_BASE_URL

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
# What Perplexity answers when the web session is no longer logged in
UPSTREAM_LOGIN_RE = re.compile(r"^\s*sign (?:up|in) and repeat your request", re.IGNORECASE)
# Perplexity adds source markers like "[1]" to answers, even between JSON tokens
CITATION_MARKER_RE = re.compile(r" ?\[\d{1,2}\](?:\[\d{1,2}\])*")
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

TransformModel = Literal[
    "gpt-6.1-sol-thinking", "gpt-6.1-sol", "claude-sonnet-5.5-thinking",
    "claude-sonnet-5.5", "grok-4.7", "gemini-3.8-flash",
]
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


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    model: TransformModel = PERPLEXITY_MODEL


app = FastAPI(title="French Audio Studio", version="2.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _normalized_text(value: str) -> str:
    text = value.strip()
    if not text:
        raise HTTPException(status_code=422, detail="请输入需要处理的文本。")
    return text


SERVER_WEB2API_KEY = os.getenv("WEB2API_API_KEY", "")


def _authorization_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "missing_api_key",
                "message": "请先登录账号（新注册享 60 天免费）或在设置中填写 API Key。",
            },
        )
    parts = authorization.split(" ", 1)
    token = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else authorization.strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "missing_api_key",
                "message": "请先登录账号（新注册享 60 天免费）或在设置中填写 API Key。",
            },
        )

    # Check if this token is an internal user session token
    user_payload = auth_db.verify_token(token)
    if user_payload:
        user_info = auth_db.get_user_status(user_payload["sub"])
        if not user_info or not user_info.get("is_valid"):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "trial_expired",
                    "message": "您的 60 天免费试用期已结束。您可以填写自定义 API Key 继续使用，或联系站长续期。",
                },
            )
        if not SERVER_WEB2API_KEY:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "server_key_missing",
                    "message": "服务器尚未配置上游 API Key（WEB2API_API_KEY），请在设置中填写自己的 API Key。",
                },
            )
        return SERVER_WEB2API_KEY

    return token


def _bearer_value(authorization: str | None) -> str:
    if not authorization:
        return ""
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return authorization.strip()


def _require_user_id(authorization: str | None) -> int:
    payload = auth_db.verify_token(_bearer_value(authorization))
    if not payload:
        raise HTTPException(
            status_code=401,
            detail={"code": "login_required", "message": "请先登录账号。"},
        )
    return int(payload["sub"])


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
        "model": _map_upstream_model(PERPLEXITY_PROOFREAD_MODEL),
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
        "model": _map_upstream_model(request.model),
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
                f"{_upstream_base_url(str(payload.get('model')))}/chat/completions",
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
        raw_text = CITATION_MARKER_RE.sub("", str(body["choices"][0]["message"]["content"]))
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "invalid_upstream_response",
                "message": "Perplexity 返回了无法识别的内容。",
            },
        ) from exc
    if UPSTREAM_LOGIN_RE.search(raw_text[:200]):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "perplexity_login_expired",
                "message": "Perplexity 的登录已失效，请先在 7840 更新登录，或在连接设置里换用 Gemini。",
            },
        )
    if not raw_text.strip():
        raise HTTPException(
            status_code=502,
            detail={"code": "empty_upstream_response", "message": "模型没有返回内容，请再试一次。"},
        )
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


TRIVIAL_SINGLE_WORDS = {
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
    "ce", "c'", "c’", "ça", "de", "d'", "d’", "à", "au", "aux",
    "dans", "en", "par", "pour", "avec", "sans", "sous",
    "un", "une", "des", "du", "le", "la", "les", "l'", "l’",
    "et", "ou", "mais", "donc", "or", "ni", "car",
    "ne", "pas", "y", "se", "s'", "s’", "me", "te",
}


def _is_unwanted_token(token_text: str) -> bool:
    clean = token_text.strip()
    if not clean:
        return True
    # 1. Punctuation: e.g. '.', ',', '!', '?', ';', ':', '«', '»', '...', '-', '(', ')'
    if not re.search(r"[a-zA-ZÀ-ÿ]", clean):
        return True
    # 2. Pure digits or numbers: e.g. '40', '10', '3.5'
    if re.fullmatch(r"[\d\s.,]+", clean):
        return True
    # 3. Collocations / multi-word expressions (contain spaces) are ALWAYS KEPT!
    if " " in clean:
        return False
    # 4. Filter single elementary words based on user's ~200 baseline
    if clean.lower() in TRIVIAL_SINGLE_WORDS:
        return True
    return False


def _filter_sentence_tokens(tokens: list[dict]) -> list[dict]:
    filtered = [tok for tok in tokens if not _is_unwanted_token(tok.get("token", ""))]
    if filtered:
        return filtered
    # Fallback if every single token was filtered out: keep content words with letters
    fallback = [
        tok for tok in tokens
        if re.search(r"[a-zA-ZÀ-ÿ]", tok.get("token", "")) and not re.fullmatch(r"[\d\s.,]+", tok.get("token", ""))
    ]
    return fallback or tokens


def format_friendly_phonetic(raw: str) -> str:
    if not raw:
        return ""
    s = str(raw).strip()
    s = re.sub(r"^[/[\\(\s]+", "", s)
    s = re.sub(r"[/\]\\)\s]+$", "", s).strip()
    s = re.sub(r"[.·•\-]", "", s)
    s = re.sub(r"[ʁʀ]", "r", s)
    s = re.sub(r"ɡ", "g", s)
    if not s:
        return ""
    return f"[{s}]"


def _analyze_payload(request: AnalyzeRequest) -> dict:
    prompt = (
        "You are explaining a French sentence to an A1–A2 learner. Their native language is Chinese and their English is basic.\n\n"
        "Language rules:\n"
        "- The English must be easier than the French being taught. The reader is learning French, not English.\n"
        "- Short sentences: at most 12 words each. One idea per sentence.\n"
        "- Use everyday words only. Do not use words like: elided, auxiliary, particle, indefinite, omit, agree with (grammar sense), construction.\n"
        "- No brackets or long explanations inside brackets.\n"
        "- Show, don't describe. Every explanation must include a real example from the sentence. Do not describe a rule without showing it.\n"
        "- Pattern to follow: one short rule sentence + one example.\n"
        "- Before you output, reread each explanation. If a learner with basic English would need to read it twice, rewrite it shorter.\n\n"
        "Missing words:\n"
        '- Forms, signs, certificates and titles often leave out words like "this" and "is".\n'
        "- When a sentence leaves out words, show the short version and the full sentence one after the other.\n"
        "- Put the missing words in [brackets] in the full sentence, in both French and English.\n"
        '- Then add one short sentence, for example: "Forms often leave out \'this\' and \'is\'. Like a label."\n'
        "- Include this in grammar_points when a phrase leaves out words.\n\n"
        "Good and bad explanation examples:\n"
        "BAD (too abstract, too long):\n"
        "\"On forms and certificates, French often drops 'C'est une...' (It is a...) and 'est' (is) to keep the text short, writing 'Attestation valable' instead of 'Cette attestation est valable'.\"\n\n"
        "GOOD:\n"
        "Short version: Attestation valable\n"
        "Full sentence: [Cette] attestation [est] valable.\n"
        "English: [This] certificate [is] valid.\n"
        "Forms often leave out \"this\" and \"is\". Like a label.\n\n"
        "BAD:\n"
        "\"negative particle (elided to n' before a vowel; pairs with 'aucune' for negation)\"\n\n"
        "GOOD:\n"
        "ne becomes n' before a vowel: ne + est → n'est.\n"
        "Here it works with aucune to mean \"no\".\n\n"
        "Accuracy rules:\n"
        "- The word table must cover every word in the sentence, in order, including small words like par, les, de, à.\n"
        "- Fixed expressions stay together as ONE entry when their meaning is not the sum of the words "
        "(à partir de, il y a, grâce à, au lieu de, par rapport à, à cause de, en fonction de). "
        "Put the dictionary form in lemma and the whole expression's meaning in meaning / meaning_zh. "
        "Example: 'À partir des' → fr: 'À partir des', lemma: 'à partir de', meaning: 'starting from', meaning_zh: '从……起', "
        "why: 'des = de + les.'\n"
        "- Numbers, dates, ordinals and abbreviations are words too: 1er, 2026, 15h30, TCF. "
        "In meaning say how to read them aloud, e.g. '1er' → meaning: 'first (say: premier)', '2026' → meaning: 'say: deux mille vingt-six'. "
        "The ipa is for the spoken form.\n"
        '- Never list a word that is not in the sentence. Example: if the sentence uses ne … aucune, do not list "ne … pas".\n'
        "- Every French sentence in the build-up must be correct French.\n\n"
        "Chinese meaning:\n"
        "- Every word also gets meaning_zh: its short Chinese meaning in THIS sentence (2–8 characters), e.g. 没有任何, 豁免, 被允许的.\n\n"
        "English bridge:\n"
        "- If a French word looks like an English word with the same meaning, show it (autorisée → authorized).\n"
        '- If it looks like an English word but means something different, warn clearly: "False friend! actuellement = currently, not actually."\n'
        "- If there is no English look-alike, leave it empty. Do not force one.\n\n"
        "Word-by-word alignment:\n"
        "- Top row French, bottom row English, word by word, keeping the French order.\n"
        "- Then one short sentence on where French and English order differ. If they are the same, say so.\n"
        "- For very short phrases of 4 words or fewer where word order is identical to English, you may leave \"alignment\": [] and \"order_note\": \"\".\n\n"
        "Build-up (layers):\n"
        "- CRITICAL RULE FOR SHORT SENTENCES: If the sentence or phrase has 5 words or fewer (e.g. 'Délivrance des résultats', 'Bonjour tout le monde', 'Merci beaucoup', short titles/headings), DO NOT create a build-up! Return empty array: \"build_up\": []. Do NOT artificially split short phrases.\n"
        "- For longer sentences (more than 5 words), build it like a tree: trunk first, then branches.\n"
        "  1. Step 1 is the bare trunk: the FIRST main clause reduced to its core (subject + verb + object; for an imperative, verb + object), "
        "even if it feels very short, with nothing of a relative clause in it (e.g. 'Choisissez celle.', not 'Choisissez celle qui correspond.'). "
        "Never start from a later clause, a clause after et/mais, or a subordinate clause.\n"
        "  2. Each next step adds ONE branch, in the sentence's own order: what hangs on the trunk first (a relative clause qui/que/dont, an object, a complement), "
        "then a coordinated main clause (et/mais/ou + verb), then place/time phrases.\n"
        "  3. Keep the original word order in every step, and end with the exact original sentence (3–5 steps).\n"
        "  Example: 'Choisissez celle qui correspond à l'image et cochez une case sur la feuille de réponses.' → "
        "1 'Choisissez celle.' (trunk) → 2 'Choisissez celle qui correspond à l'image.' (relative clause describing celle) → "
        "3 '… et cochez une case.' (second main verb, joined by et) → 4 the full sentence (place: sur la feuille de réponses). "
        "Wrong: starting with 'Cochez une case.'\n"
        '- Each step has: French, English, and "new": what was added and its role, in simple English, without a "New:" prefix '
        '(e.g. "Trunk: choose the one." / "Branch: qui correspond à l\'image describes celle.").\n\n'
        "Grammar points:\n"
        "- 1–3 points, the most useful ones for this sentence.\n"
        "- Each has: a short title, a simple explanation, and a memory hook (word history, a comparison with English or Chinese, or a simple picture).\n\n"
        "Pronunciation tips:\n"
        "- Only the tricky parts: silent letters (e.g. silent -ent in verbs), liaison between words, tricky vowels or nasals.\n"
        "- Format each tip starting with the clean French word or liaison phrase being taught, followed by a colon: 'French word: simple explanation'. Example: \"'informations': the starting 'in-' is the nasal vowel [ɛ̃] (like 'vin' or 'matin'), not English 'in'\".\n"
        "- Do NOT write phrases like \"'in-' in 'informations':\" before the colon; always put the clean French word before the colon.\n"
        "- Always enclose the French words or phonetic representations in single quotes, e.g. \"'leurs diplômes': The 's' in 'leurs' is silent before consonant 'diplômes'\".\n\n"
        "Output JSON format strictly matching this schema:\n"
        "{\n"
        '  "sentences": [\n'
        "    {\n"
        '      "schemaVersion": 2,\n'
        '      "sentence": "Aucune dispense n\'est autorisée par les autorités canadiennes.",\n'
        '      "translation_en": "No exemption is authorized by the Canadian authorities.",\n'
        '      "translation_zh": "加拿大当局不允许任何豁免。",\n'
        '      "alignment": [\n'
        '        {"fr": "Aucune", "en": "No"},\n'
        '        {"fr": "dispense", "en": "exemption"},\n'
        '        {"fr": "n\'est", "en": "is"},\n'
        '        {"fr": "autorisée", "en": "authorized"},\n'
        '        {"fr": "par", "en": "by"},\n'
        '        {"fr": "les autorités", "en": "the authorities"},\n'
        '        {"fr": "canadiennes", "en": "Canadian"}\n'
        "      ],\n"
        '      "order_note": "Almost the same order as English. Only difference: French puts canadiennes after the noun. English says Canadian authorities.",\n'
        '      "build_up": [\n'
        '        {"fr": "Les autorités autorisent.", "en": "The authorities authorize.", "new": "Basic sentence: who + does what."},\n'
        '        {"fr": "Les autorités canadiennes autorisent.", "en": "The Canadian authorities authorize.", "new": "canadiennes = Canadian. In French it goes after the noun."},\n'
        '        {"fr": "Les autorités canadiennes n\'autorisent pas la dispense.", "en": "The Canadian authorities do not authorize the exemption.", "new": "ne … pas = not. It wraps around the verb."},\n'
        '        {"fr": "Les autorités canadiennes n\'autorisent aucune dispense.", "en": "The Canadian authorities authorize no exemption.", "new": "pas changes to aucune = no / not any."},\n'
        '        {"fr": "Aucune dispense n\'est autorisée par les autorités canadiennes.", "en": "No exemption is authorized by the Canadian authorities.", "new": "Passive, just like English: is authorized by = est autorisée par."}\n'
        "      ],\n"
        '      "words": [\n'
        '        {"fr": "aucune", "ipa": "okyn", "lemma": "aucun", "type": "describing word", "meaning": "no, not any", "meaning_zh": "没有任何", "why": "Ends in -e because dispense is a feminine word. Used with ne, but without pas.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "dispense", "ipa": "dispɑ̃s", "lemma": "dispense", "type": "naming word", "meaning": "exemption", "meaning_zh": "豁免", "why": "Feminine noun.", "english_link": "dispensation", "false_friend": false},\n'
        '        {"fr": "n\'est", "ipa": "nɛ", "lemma": "être", "type": "action word form", "meaning": "is (negative)", "meaning_zh": "不是", "why": "ne becomes n\' before a vowel. Combined with aucune.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "autorisée", "ipa": "otɔʁize", "lemma": "autoriser", "type": "action word form", "meaning": "authorized", "meaning_zh": "被允许的", "why": "Ends in -e because dispense is a feminine word.", "english_link": "authorized", "false_friend": false},\n'
        '        {"fr": "par", "ipa": "paʁ", "lemma": "par", "type": "small linking word", "meaning": "by", "meaning_zh": "由；被", "why": "Shows who does the action.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "les", "ipa": "le", "lemma": "le", "type": "small pointer word", "meaning": "the (plural)", "meaning_zh": "这些（复数）", "why": "Points to more than one authority.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "autorités", "ipa": "otɔʁite", "lemma": "autorité", "type": "naming word", "meaning": "authorities", "meaning_zh": "当局", "why": "Ends in -s because it is plural.", "english_link": "authorities", "false_friend": false},\n'
        '        {"fr": "canadiennes", "ipa": "kanadjɛn", "lemma": "canadien", "type": "describing word", "meaning": "Canadian (plural)", "meaning_zh": "加拿大的", "why": "Ends in -nes because autorités is feminine plural.", "english_link": "Canadian", "false_friend": false}\n'
        "      ],\n"
        '      "grammar_points": [\n'
        '        {"title": "aucune … ne = no / not any (no pas!)", "explanation": "aucune already means no. Adding pas would say no twice.", "hook": "Aucun problème! = No problem! Same aucun."},\n'
        '        {"title": "Passive: est autorisée par = is authorized by", "explanation": "est autorisée par works like English is authorized by.", "hook": "Same word order as English."},\n'
        '        {"title": "Describing words go after the noun", "explanation": "French names the thing first, then says what kind: les autorités canadiennes.", "hook": "Exceptions are short common words: beau, jeune, bon, grand, petit…"}\n'
        "      ],\n"
        '      "pronunciation_tips": [\n'
        '        "\'les autorités\': link the \'s\' to make a /z/ sound → \'lé-zo-to-ri-té\'",\n'
        '        "\'autorisée\': \'s\' between two vowels sounds like /z/",\n'
        '        "\'canadiennes\': the ending \'-nes\' sounds like /n/"\n'
        '      ]\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "NOTE: The words array must cover every single word in the sentence in sequential order, including small words (articles, prepositions, etc.)."
    )
    return {
        "model": _map_upstream_model(request.model),
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Explain this French text for an A1–A2 learner in valid JSON strictly following the schema:\n\n{request.text}"},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.1,
    }


def _parse_analysis_json(raw_text: str, fallback_text: str) -> dict:
    cleaned = raw_text.strip()

    # Strip thinking blocks from reasoning models (<think>...</think>)
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned).strip()

    # If wrapped in markdown code fence
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    candidate = fence_match.group(1).strip() if fence_match else cleaned

    parsed_data = None
    try:
        parsed_data = json.loads(candidate)
    except Exception:
        first_brace = candidate.find("{")
        last_brace = candidate.rfind("}")
        first_bracket = candidate.find("[")
        last_bracket = candidate.rfind("]")

        is_object = (first_brace != -1 and last_brace > first_brace)
        is_array = (first_bracket != -1 and last_bracket > first_bracket)

        if is_object and (not is_array or first_brace < first_bracket):
            json_substr = candidate[first_brace : last_brace + 1]
        elif is_array:
            json_substr = candidate[first_bracket : last_bracket + 1]
        else:
            json_substr = candidate

        # Remove trailing commas before } or ]
        cleaned_json = re.sub(r",\s*([\]}])", r"\1", json_substr)
        try:
            parsed_data = json.loads(cleaned_json)
        except Exception as exc:
            logger.warning("Failed to parse JSON from upstream LLM: %s. Snippet: %r", exc, raw_text[:300])

    sentences_raw = None
    if isinstance(parsed_data, list):
        sentences_raw = parsed_data
    elif isinstance(parsed_data, dict):
        if "sentences" in parsed_data and isinstance(parsed_data["sentences"], list):
            sentences_raw = parsed_data["sentences"]
        elif "sentence" in parsed_data or "original" in parsed_data or "alignment" in parsed_data or "words" in parsed_data:
            sentences_raw = [parsed_data]

    if sentences_raw:
        valid_sentences = []
        for s in sentences_raw:
            if not isinstance(s, dict):
                continue
            is_v2 = (
                s.get("schemaVersion") == 2
                or "words" in s
                or "build_up" in s
                or "alignment" in s
            )
            sentence_text = str(s.get("sentence") or s.get("original") or "").strip()
            if not sentence_text:
                continue

            if is_v2:
                raw_words = s.get("words", [])
                clean_words = []
                for w in raw_words:
                    if isinstance(w, dict):
                        fr = str(w.get("fr") or w.get("token") or "").strip()
                        if fr:
                            clean_words.append({
                                "fr": fr,
                                "ipa": format_friendly_phonetic(str(w.get("ipa") or w.get("phonetic") or "")),
                                "lemma": str(w.get("lemma") or fr),
                                "type": str(w.get("type") or w.get("pos") or ""),
                                "meaning": str(w.get("meaning") or w.get("explanation_en") or ""),
                                "meaning_zh": str(w.get("meaning_zh") or w.get("explanation_cn") or ""),
                                "why": str(w.get("why") or ""),
                                "english_link": str(w.get("english_link") or ""),
                                "false_friend": bool(w.get("false_friend", False)),
                            })

                raw_alignment = s.get("alignment", [])
                clean_alignment = []
                for a in raw_alignment:
                    if isinstance(a, dict):
                        fr = str(a.get("fr", "")).strip()
                        en = str(a.get("en", "")).strip()
                        if fr or en:
                            clean_alignment.append({"fr": fr, "en": en})

                raw_buildup = s.get("build_up", [])
                clean_buildup = []
                for b in raw_buildup:
                    if isinstance(b, dict):
                        fr = str(b.get("fr", "")).strip()
                        en = str(b.get("en", "")).strip()
                        new_note = re.sub(r"^(new\s*:\s*)+", "", str(b.get("new", "")).strip(), flags=re.IGNORECASE)
                        if fr:
                            clean_buildup.append({"fr": fr, "en": en, "new": new_note})

                raw_grammar = s.get("grammar_points", [])
                clean_grammar = []
                for g in raw_grammar:
                    if isinstance(g, dict):
                        title = str(g.get("title", "")).strip()
                        exp = str(g.get("explanation", "")).strip()
                        hook = str(g.get("hook", "")).strip()
                        if title or exp:
                            clean_grammar.append({"title": title, "explanation": exp, "hook": hook})

                raw_tips = s.get("pronunciation_tips", [])
                clean_tips = [str(tip).strip() for tip in raw_tips if str(tip).strip()]

                trans_en = str(s.get("translation_en") or "")
                trans_zh = str(s.get("translation_zh") or s.get("translation_cn") or "")

                # Tokens fallback for popover & legacy export
                legacy_tokens = [
                    {
                        "token": w["fr"],
                        "lemma": w["lemma"],
                        "pos": w["type"],
                        "phonetic": w["ipa"],
                        "explanation_en": f"{w['meaning']}. {w['why']}".strip(". "),
                        "explanation_cn": w["meaning_zh"],
                    }
                    for w in clean_words
                ]

                valid_sentences.append({
                    "schemaVersion": 2,
                    "sentence": sentence_text,
                    "original": sentence_text,
                    "translation_en": trans_en,
                    "translation_zh": trans_zh,
                    "translation_cn": trans_zh,
                    "alignment": clean_alignment,
                    "order_note": str(s.get("order_note", "")),
                    "build_up": clean_buildup,
                    "words": clean_words,
                    "tokens": legacy_tokens,
                    "grammar_points": clean_grammar,
                    "pronunciation_tips": clean_tips,
                })
            else:
                # Legacy V1
                raw_tokens = s.get("tokens", [])
                clean_tokens = []
                for tok in raw_tokens:
                    if isinstance(tok, dict) and "token" in tok:
                        t_str = str(tok.get("token", "")).strip()
                        if t_str:
                            clean_tokens.append({
                                "token": t_str,
                                "lemma": str(tok.get("lemma", t_str)),
                                "pos": str(tok.get("pos", "")),
                                "phonetic": format_friendly_phonetic(str(tok.get("phonetic", ""))),
                                "explanation_en": str(tok.get("explanation_en", "")),
                                "explanation_cn": str(tok.get("explanation_cn", "")),
                            })
                filtered_tokens = _filter_sentence_tokens(clean_tokens)
                valid_sentences.append({
                    "schemaVersion": 1,
                    "original": sentence_text,
                    "sentence": sentence_text,
                    "translation_en": str(s.get("translation_en", "")),
                    "translation_cn": str(s.get("translation_cn", "")),
                    "translation_zh": str(s.get("translation_cn", "")),
                    "tokens": filtered_tokens,
                })
        if valid_sentences:
            return {"sentences": valid_sentences}

    # Fallback heuristic segmenter (only if upstream LLM completely failed)
    raw_sentences = [
        sent.strip()
        for sent in re.split(r"(?<=[.!?。！？])\s+", fallback_text)
        if sent.strip()
    ]
    if not raw_sentences:
        raw_sentences = [fallback_text.strip()]

    fallback_sentences = []
    for sent in raw_sentences:
        raw_words = re.findall(r"[\w'’\-]+", sent)
        fallback_words = [
            {
                "fr": word,
                "ipa": "",
                "lemma": word.lower(),
                "type": "word",
                "meaning": "Vocabulary item in sentence context",
                "why": "Word from original sentence.",
                "english_link": "",
                "false_friend": False,
            }
            for word in raw_words
        ]
        fallback_sentences.append({
            "schemaVersion": 2,
            "sentence": sent,
            "original": sent,
            "translation_en": "",
            "translation_zh": "",
            "translation_cn": "",
            "alignment": [{"fr": w["fr"], "en": ""} for w in fallback_words],
            "order_note": "",
            "build_up": [{"fr": sent, "en": "", "new": "Original sentence"}],
            "words": fallback_words,
            "tokens": [
                {
                    "token": w["fr"],
                    "lemma": w["lemma"],
                    "pos": w["type"],
                    "phonetic": "",
                    "explanation_en": w["meaning"],
                    "explanation_cn": "",
                }
                for w in fallback_words
            ],
            "grammar_points": [],
            "pronunciation_tips": [],
        })
    return {"sentences": fallback_sentences}


async def request_french_analysis(request: AnalyzeRequest, api_key: str) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = _analyze_payload(request)
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        _, raw_text = await _post_chat(client, payload, headers)
        return _parse_analysis_json(raw_text, request.text)


def _timestamp() -> str:
    now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{now}_{uuid.uuid4().hex[:6]}"


def _safe_timestamp(
    value: str | None, text: str | None = None, voice: str | None = None
) -> str:
    if value and re.fullmatch(r"[0-9A-Za-z_-]{1,48}", value):
        return value
    if text and voice and len(text) <= TTS_SNIPPET_MAX_CHARS:
        h = hashlib.sha256(f"{voice}:{text.strip()}".encode("utf-8")).hexdigest()[:16]
        return f"snip_{h}"
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
    job_timestamp = _safe_timestamp(timestamp, text=content, voice=selected_voice)
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
        communicate = edge_tts.Communicate(content, selected_voice)
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


def _output_file(
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
            **({"Cache-Control": f"public, max-age={cache_seconds}"} if cache_seconds else {}),
        },
    )


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path in {"/", "/study"}:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def _asset_version() -> str:
    digest = hashlib.sha256()
    for path in sorted(STATIC_DIR.iterdir()):
        if path.suffix in {".js", ".css"}:
            digest.update(path.name.encode("utf-8"))
            digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()


def _html_page(name: str) -> HTMLResponse:
    html = (STATIC_DIR / name).read_text(encoding="utf-8")
    return HTMLResponse(
        html.replace("__ASSET_VERSION__", ASSET_VERSION),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/api/version")
async def asset_version():
    # Open pages compare this with the version they were loaded with
    return {"version": ASSET_VERSION}


@app.get("/")
async def root():
    return _html_page("index.html")


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
async def generate_speech(
    request: SpeechRequest,
    authorization: str | None = Header(default=None),
):
    _require_user_id(authorization)
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


@app.get("/study")
async def study():
    return _html_page("study.html")


@app.post("/api/analyze")
async def analyze_french(
    request: AnalyzeRequest,
    authorization: str | None = Header(default=None),
):
    api_key = _authorization_token(authorization)
    result = await request_french_analysis(request, api_key)
    return result


class FeynmanGrammarPoint(BaseModel):
    title: str = Field(default="", max_length=300)
    explanation: str = Field(default="", max_length=1000)


class FeynmanRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=1000)
    grammar_points: list[FeynmanGrammarPoint] = Field(default_factory=list, max_length=5)
    explanation: str = Field(min_length=1, max_length=2000)
    variation: str = Field(default="", max_length=500)
    model: TransformModel = PERPLEXITY_MODEL


FEYNMAN_VERDICTS = {"solid", "partial", "missing"}

TUTOR_ENGLISH_STYLE = (
    "Write in simple English (A2 level). The learner is also practicing English.\n"
    "- Short sentences, at most 15 words each. Everyday words only.\n"
    "- No grammar jargon unless you explain it with an example.\n"
    "- If an English word is hard, add the Chinese in brackets once, e.g. contraction (缩合).\n"
    "- Quote French words exactly.\n"
)




def _feynman_payload(request: FeynmanRequest) -> dict:
    prompt = (
        "You are a patient French tutor. The learner is A1–A2, native language Chinese.\n"
        "They just studied one French sentence and are using the Feynman technique: "
        "explaining it in their own words, without looking at the notes.\n"
        "Your job is NOT to re-teach everything. Your job is to find the gaps in THEIR explanation.\n\n"
        "Steps:\n"
        "1. got_right: what they explained correctly. Be specific, quote their idea. No generic praise.\n"
        "2. gaps: important meaning or grammar of the sentence that they missed or got wrong. "
        "Compare with the reference points. At most 3, most important first. "
        "If something they said is wrong, say what is wrong and the correct idea.\n"
        "3. variation: if they wrote their own new French sentence, check it. "
        "ok=true if it is correct and natural French. Otherwise give the corrected sentence and one short reason. "
        "If they wrote nothing, variation is null.\n"
        "4. follow_up: ONE short question that makes them recall the most important gap by themselves "
        "(answerable in one line). Do not give the answer in the question.\n"
        "5. verdict: solid (main meaning and key grammar are right), partial, or missing (mostly wrong or empty).\n\n"
        "The learner may write in Chinese, English or both. Your feedback is always in simple English.\n"
        + TUTOR_ENGLISH_STYLE +
        "Each item is one or two short sentences.\n"
        "Output valid JSON only:\n"
        '{"verdict": "partial", "got_right": ["..."], "gaps": ["..."], '
        '"variation": {"ok": false, "corrected": "...", "note": "..."}, "follow_up": "..."}'
    )
    reference = "\n".join(
        f"- {g.title}: {g.explanation}".strip() for g in request.grammar_points if g.title or g.explanation
    )
    user = (
        f"French sentence: {request.sentence}\n"
        f"Chinese translation: {request.translation_zh or '(none)'}\n"
        f"Reference points:\n{reference or '(none)'}\n\n"
        f"Learner's explanation:\n{request.explanation}\n\n"
        f"Learner's own new sentence: {request.variation or '(none)'}"
    )
    return {
        "model": _map_upstream_model(request.model),
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.2,
    }


def _parse_feynman_json(raw_text: str) -> dict:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    candidate = fence.group(1).strip() if fence else cleaned
    start, end = candidate.find("{"), candidate.rfind("}")
    try:
        data = json.loads(candidate[start : end + 1] if start != -1 and end > start else candidate)
    except Exception:
        data = None
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=502,
            detail={"code": "feynman_bad_output", "message": "AI 反馈格式异常，请再试一次。"},
        )

    def str_list(value: Any) -> list[str]:
        items = value if isinstance(value, list) else []
        return [str(item).strip() for item in items if str(item).strip()][:5]

    variation = data.get("variation")
    clean_variation = None
    if isinstance(variation, dict):
        clean_variation = {
            "ok": bool(variation.get("ok")),
            "corrected": str(variation.get("corrected") or "").strip(),
            "note": str(variation.get("note") or "").strip(),
        }
    verdict = str(data.get("verdict") or "").strip().lower()
    return {
        "verdict": verdict if verdict in FEYNMAN_VERDICTS else "partial",
        "got_right": str_list(data.get("got_right")),
        "gaps": str_list(data.get("gaps")),
        "variation": clean_variation,
        "follow_up": str(data.get("follow_up") or "").strip(),
    }


@app.post("/api/feynman")
async def feynman_check(
    request: FeynmanRequest,
    authorization: str | None = Header(default=None),
):
    api_key = _authorization_token(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        for attempt in range(2):
            _, raw_text = await _post_chat(client, _feynman_payload(request), headers)
            try:
                result = _parse_feynman_json(raw_text)
                break
            except HTTPException:
                logger.warning("Feynman output not parseable (attempt %d): %r", attempt + 1, raw_text[:300])
                if attempt == 1:
                    raise
    if not request.variation.strip():
        result["variation"] = None
    return result


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


def _transcribe_sync(audio: bytes, sentence: str, context: str = "") -> dict:
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
        prompt = f"{context} 我在用中文讲解这句法语：{sentence}".strip() if sentence else None
        segments, info = _asr_model.transcribe(
            io.BytesIO(audio),
            language="zh",
            beam_size=5,
            vad_filter=True,
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        text = _clean_asr_segments([
            (seg.text, seg.no_speech_prob, seg.avg_logprob, seg.compression_ratio) for seg in segments
        ])
    return {"text": text, "duration": round(info.duration, 1)}


@app.post("/api/transcribe")
async def transcribe_audio(
    request: Request,
    sentence: str = Query(default="", max_length=1000),
    context: str = Query(default="", max_length=2000),
    authorization: str | None = Header(default=None),
):
    _require_user_id(authorization)
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=422, detail={"message": "没有收到录音。"})
    if len(audio) > ASR_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"message": "录音太长了，请分段说。"})
    try:
        return await run_in_threadpool(_transcribe_sync, audio, sentence.strip(), context.strip())
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Transcription failed: %s", exc)
        raise HTTPException(status_code=422, detail={"message": "录音无法识别，请再录一次。"}) from exc


class TranscriptFixRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    context: str = Field(default="", max_length=4000)
    text: str = Field(min_length=1, max_length=5000)
    model: TransformModel = PERPLEXITY_MODEL


def _transcript_fix_payload(request: TranscriptFixRequest) -> dict:
    system = (
        "You fix speech-to-text errors. The text is a learner explaining a French sentence, "
        "mostly in Chinese with some French or English words mixed in. The recognizer often mishears the French parts.\n"
        f"The French sentence being discussed: {request.sentence}\n"
        f"Other text from the same passage (the learner may mention it too): {request.context or '(none)'}\n"
        "Rules:\n"
        "- Only fix words that are clearly mis-heard: gibberish or wrong-language words that SOUND like a word or phrase "
        "from the sentence or passage (e.g. 'a part or die' -> 'à partir de', 'd'preuves' -> 'd'épreuves'), "
        "and obvious English mis-hearings (e.g. 'mine starting from' -> 'means starting from').\n"
        "- Also fix Chinese homophone errors when the context makes the intended word obvious (e.g. 原因 vs 元音, 不在 vs 不再).\n"
        "- Never fix the learner's ideas, grammar claims or wrong explanations. "
        "If they said a real French word, keep it, even if it is wrong.\n"
        "- Delete recognizer hallucinations that are not part of the explanation, such as video subtitle credits "
        "('字幕由…提供', '请订阅', '谢谢观看') or a few random words stuck at the very end.\n"
        "- Keep everything else exactly. Use Chinese punctuation for Chinese text.\n"
        "Return only the corrected text."
    )
    return {
        "model": _map_upstream_model(request.model),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": request.text},
        ],
        "stream": False,
        "temperature": 0,
    }


@app.post("/api/transcribe/fix")
async def fix_transcript(
    request: TranscriptFixRequest,
    authorization: str | None = Header(default=None),
):
    api_key = _authorization_token(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        _, raw_text = await _post_chat(
            client, _transcript_fix_payload(request.model_copy(update={"model": FAST_MODEL})), headers
        )
    fixed = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip().strip("`").strip()
    # A correction must stay close to the original; otherwise keep what was heard.
    if not fixed or len(fixed) > len(request.text) * 1.6 + 40:
        fixed = request.text
    return {"text": fixed}


class AskTurn(BaseModel):
    role: Literal["learner", "tutor"]
    content: str = Field(min_length=1, max_length=2000)


class AskRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=1000)
    grammar_points: list[FeynmanGrammarPoint] = Field(default_factory=list, max_length=5)
    history: list[AskTurn] = Field(default_factory=list, max_length=20)
    question: str = Field(min_length=1, max_length=1000)
    model: TransformModel = PERPLEXITY_MODEL


def _ask_payload(request: AskRequest) -> dict:
    reference = "\n".join(
        f"- {g.title}: {g.explanation}".strip() for g in request.grammar_points if g.title or g.explanation
    )
    system = (
        "You are a patient French tutor. The learner is A1–A2 in French, native language Chinese.\n"
        f"They are studying this sentence: {request.sentence}\n"
        f"Chinese translation: {request.translation_zh or '(none)'}\n"
        f"Notes they have seen:\n{reference or '(none)'}\n\n"
        "Answer their question about French. They may ask in Chinese or English.\n"
        "- Answer the exact question first, in one or two sentences.\n"
        "- Then show it with 1–3 short French examples, each with its English meaning. "
        "Use words from their sentence when you can.\n"
        "- If their message answers a question you asked earlier, say clearly if it is right, "
        "and fix it if not.\n"
        "- At most 90 words. Plain text only: no markdown, no headings, no tables. "
        "You may use short lines like 'de + la = de la'.\n"
        + TUTOR_ENGLISH_STYLE
    )
    messages = [{"role": "system", "content": system}]
    for turn in request.history[-12:]:
        messages.append({
            "role": "user" if turn.role == "learner" else "assistant",
            "content": turn.content,
        })
    messages.append({"role": "user", "content": request.question})
    return {
        "model": _map_upstream_model(request.model),
        "messages": messages,
        "stream": False,
        "temperature": 0.3,
    }


@app.post("/api/ask")
async def ask_tutor(
    request: AskRequest,
    authorization: str | None = Header(default=None),
):
    api_key = _authorization_token(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        _, raw_text = await _post_chat(client, _ask_payload(request), headers)
    answer = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    answer = re.sub(r"^#+\s*", "", answer, flags=re.MULTILINE).replace("**", "")
    if not answer:
        raise HTTPException(
            status_code=502,
            detail={"code": "ask_empty", "message": "AI 没有给出回答，请再问一次。"},
        )
    return {"answer": answer[:3000]}


LOOKUP_CACHE: dict[str, dict] = {}


async def request_word_lookup(word: str, api_key: str, model: str = FAST_MODEL) -> dict:
    clean_word = word.strip()
    cache_key = clean_word.lower()
    if cache_key in LOOKUP_CACHE:
        return LOOKUP_CACHE[cache_key]

    prompt = (
        "You are an expert French pedagogical lexicographer for learners.\n"
        "Provide accurate linguistic details for the given French word in valid JSON format ONLY.\n"
        "Schema:\n"
        "{\n"
        '  "token": "...",\n'
        '  "lemma": "dictionary canonical base form (infinitive for verbs, masc sing for nouns/adjectives)",\n'
        '  "pos": "part of speech (e.g. v., n.m., n.f., adj., adv., prep., conj.)",\n'
        '  "phonetic": "IPA phonetic transcription (e.g. /bɔ̃.ʒuʁ/)",\n'
        '  "explanation_cn": "concise, accurate Chinese definition and grammatical nuance",\n'
        '  "explanation_en": "concise, accurate English definition"\n'
        "}\n"
        "If the token is a number, ordinal, date part or abbreviation (1er, 2026, 15h30, TCF), "
        "explanation_cn must say how to read it aloud in French words, e.g. '读作 premier（第一）'."
    )

    payload = {
        "model": _map_upstream_model(model),
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Define this French word: {clean_word}"},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.0,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        _, raw_text = await _post_chat(client, payload, headers)

    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    candidate = fence_match.group(1).strip() if fence_match else cleaned

    try:
        data = json.loads(candidate)
    except Exception:
        first_brace = candidate.find("{")
        last_brace = candidate.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            try:
                data = json.loads(candidate[first_brace : last_brace + 1])
            except Exception:
                data = {}
        else:
            data = {}

    result = {
        "token": str(data.get("token", clean_word)),
        "lemma": str(data.get("lemma", clean_word)),
        "pos": str(data.get("pos", "")),
        "phonetic": format_friendly_phonetic(str(data.get("phonetic", ""))),
        "explanation_cn": str(data.get("explanation_cn", "语境词汇")),
        "explanation_en": str(data.get("explanation_en", "")),
    }

    LOOKUP_CACHE[cache_key] = result
    return result


@app.get("/api/lookup")
async def lookup_word(
    word: str,
    model: str = FAST_MODEL,
    authorization: str | None = Header(default=None),
):
    clean = word.strip()
    if not clean:
        raise HTTPException(status_code=400, detail={"message": "请提供待查询单词"})
    api_key = _authorization_token(authorization)
    result = await request_word_lookup(clean, api_key, model=model)
    return result


@app.get("/tts")
async def generate_tts(
    text: str,
    voice: str = "fr-FR-DeniseNeural",
    format: Literal["mp3", "srt"] = "mp3",
    download: bool = False,
):
    if len(text) > TTS_SNIPPET_MAX_CHARS:
        raise HTTPException(status_code=422, detail="文本过长，请使用音频工作台生成。")
    # Snippets are cached by (voice, text) hash, so the same URL always returns the same audio.
    audio_filename, srt_filename = await create_speech_files(text, voice)
    filename = srt_filename if format == "srt" else audio_filename
    return _output_file(filename, download=download, cache_seconds=30 * 86400)


class AuthRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
async def register_account(req: AuthRequest):
    if not auth_db.ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail={"message": "本站暂不开放注册。"})
    try:
        res = auth_db.register_user(req.email, req.password)
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})


@app.post("/api/auth/login")
async def login_account(req: AuthRequest):
    try:
        res = auth_db.login_user(req.email, req.password)
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})


@app.get("/api/auth/me")
async def get_current_user(authorization: str | None = Header(default=None)):
    status = auth_db.get_user_status(_require_user_id(authorization))
    if not status:
        raise HTTPException(status_code=404, detail={"message": "账号不存在"})
    return status


class SaveHistoryRequest(BaseModel):
    id: str
    type: str = "tts"
    text: str
    payload: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/history")
async def list_history(
    type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    records = auth_db.get_history_records(user_id=user_id, record_type=type, limit=limit)
    return {"records": records, "count": len(records)}


@app.post("/api/history")
async def save_history(
    req: SaveHistoryRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    res = auth_db.save_history_record(
        record_id=req.id,
        record_type=req.type,
        text=req.text,
        payload=req.payload,
        user_id=user_id,
    )
    return res


@app.delete("/api/history/{record_id}")
async def delete_history(
    record_id: str,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    ok = auth_db.delete_history_record(record_id, user_id=user_id)
    return {"success": ok}


@app.delete("/api/history")
async def clear_all_history(
    type: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    count = auth_db.clear_history_records(user_id=user_id, record_type=type)
    return {"deleted": count}



# ---------------------------------------------------------------------------
# Spaced repetition (sentence notes + FSRS cards), per logged-in user
# ---------------------------------------------------------------------------
class SrsTarget(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    mode: Literal["cloze", "recognize", "grammar"] = "cloze"
    importance: int = Field(default=3, ge=1, le=5)
    meta: dict[str, Any] = Field(default_factory=dict)


class SrsNoteRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=2000)
    translation_en: str = Field(default="", max_length=2000)
    extra: dict[str, Any] = Field(default_factory=dict)
    modes: list[Literal["listen", "speak"]] = Field(default_factory=list)
    targets: list[SrsTarget] = Field(default_factory=list, max_length=20)


class SrsLookupRequest(BaseModel):
    sentences: list[str] = Field(default_factory=list, max_length=1000)


class SrsReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=4)
    duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    score: int | None = Field(default=None, ge=0, le=100)
    answer: str | None = Field(default=None, max_length=5000)  # srs stores the first 500 chars
    tz_offset: int = Field(default=0, ge=-840, le=840)


class SrsImportRequest(BaseModel):
    cards: list[dict[str, Any]] = Field(default_factory=list, max_length=5000)


@app.get("/review")
async def review_page():
    return _html_page("review.html")


@app.get("/api/srs/queue")
def srs_queue(
    tz_offset: int = Query(default=0, ge=-840, le=840),
    new_limit: int = Query(default=srs.DEFAULT_NEW_LIMIT, ge=0, le=100),
    min_importance: int = Query(default=1, ge=1, le=5),
    authorization: str | None = Header(default=None),
):
    return srs.build_queue(
        _require_user_id(authorization), tz_offset, new_limit, min_importance=min_importance
    )


class SrsImportanceRequest(BaseModel):
    card_ids: list[str] = Field(min_length=1, max_length=50)
    importance: int = Field(ge=1, le=5)


@app.post("/api/srs/importance")
def srs_set_importance(req: SrsImportanceRequest, authorization: str | None = Header(default=None)):
    return {"updated": srs.set_importance(_require_user_id(authorization), req.card_ids, req.importance)}


@app.get("/api/srs/words")
def srs_saved_words(authorization: str | None = Header(default=None)):
    return {"words": srs.saved_words(_require_user_id(authorization))}


@app.post("/api/srs/notes")
def srs_add_note(
    req: SrsNoteRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        return srs.add_note(
            user_id,
            req.sentence,
            translation_zh=req.translation_zh,
            translation_en=req.translation_en,
            extra=req.extra,
            modes=req.modes,
            targets=[t.model_dump() for t in req.targets],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)})


@app.post("/api/srs/notes/lookup")
def srs_lookup_notes(
    req: SrsLookupRequest,
    authorization: str | None = Header(default=None),
):
    return {"notes": srs.lookup_notes(_require_user_id(authorization), req.sentences)}


@app.delete("/api/srs/notes/{note_id}")
def srs_delete_note(note_id: str, authorization: str | None = Header(default=None)):
    return {"success": srs.delete_note(_require_user_id(authorization), note_id)}


@app.get("/api/srs/cards")
def srs_list_cards(
    q: str = Query(default="", max_length=100),
    authorization: str | None = Header(default=None),
):
    return {"cards": srs.list_cards(_require_user_id(authorization), q)}


@app.delete("/api/srs/cards/{card_id}")
def srs_delete_card(card_id: str, authorization: str | None = Header(default=None)):
    return {"success": srs.delete_card(_require_user_id(authorization), card_id)}


@app.post("/api/srs/cards/{card_id}/review")
def srs_review_card(
    card_id: str,
    req: SrsReviewRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        card = srs.review_card(
            user_id, card_id, req.rating, req.duration_ms, req.score, req.answer
        )
    except KeyError:
        raise HTTPException(status_code=404, detail={"message": "卡片不存在。"})
    # Kill feed for the review page: XP, combo, first blood and the new totals
    card["game"] = game.review_feedback(user_id, req.tz_offset)
    return card


# ---------------------------------------------------------------------------
# Game: study time, XP and hero level (see game.py)
# ---------------------------------------------------------------------------
GameLane = Literal["course", "listening", "reading", "speaking", "writing", "review", "car"]


class GameHeartbeat(BaseModel):
    lane: GameLane
    seconds: int = Field(ge=0, le=600)
    tz_offset: int = Field(default=0, ge=-840, le=840)


class GameLog(BaseModel):
    lane: GameLane
    minutes: int = Field(ge=1, le=300)
    note: str = Field(default="", max_length=200)
    tz_offset: int = Field(default=0, ge=-840, le=840)


class GameDayRequest(BaseModel):
    tz_offset: int = Field(default=0, ge=-840, le=840)
    on: bool = True


@app.get("/api/game/state")
def game_state(
    tz_offset: int = Query(default=0, ge=-840, le=840),
    authorization: str | None = Header(default=None),
):
    return game.state(_require_user_id(authorization), tz_offset)


@app.post("/api/game/heartbeat")
def game_heartbeat(req: GameHeartbeat, authorization: str | None = Header(default=None)):
    stored = game.record_time(_require_user_id(authorization), req.lane, req.seconds, req.tz_offset)
    return {"stored_seconds": stored}


@app.post("/api/game/log")
def game_log(req: GameLog, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    game.log_time(user_id, req.lane, req.minutes, req.note, req.tz_offset)
    return game.state(user_id, req.tz_offset)


@app.delete("/api/game/log/{log_id}")
def game_delete_log(
    log_id: int,
    tz_offset: int = Query(default=0, ge=-840, le=840),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    if not game.delete_log(user_id, log_id):
        raise HTTPException(status_code=404, detail={"message": "记录不存在。"})
    return game.state(user_id, tz_offset)


@app.post("/api/game/family-day")
def game_family_day(req: GameDayRequest, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    game.set_family_day(user_id, req.on, req.tz_offset)
    return game.state(user_id, req.tz_offset)


@app.get("/api/game/callout/{name}.mp3")
async def game_callout(name: str):
    """The announcer's voice for one fixed callout (no free text, so no TTS proxy)."""
    text = game.CALLOUT_PHRASES.get(name)
    if not text:
        raise HTTPException(status_code=404, detail={"message": "没有这条播报。"})
    path = OUTPUT_DIR / "callouts" / f"{name}.mp3"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.part")
        try:
            await edge_tts.Communicate(text, **game.CALLOUT_VOICE).save(str(tmp))
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=604800"})


@app.post("/api/game/wave-cleared")
def game_wave_cleared(req: GameDayRequest, authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    xp = game.wave_cleared(user_id, req.tz_offset)
    return {"xp": xp, "state": game.state(user_id, req.tz_offset)}


class GrammarPointIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    explanation: str = Field(default="", max_length=1000)
    hook: str = Field(default="", max_length=500)


class GrammarCardRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=2000)
    translation_en: str = Field(default="", max_length=2000)
    grammar: GrammarPointIn
    model: TransformModel = PERPLEXITY_MODEL


def _grammar_exercise_payload(request: GrammarCardRequest) -> dict:
    point = request.grammar
    system = (
        "You write ONE fill-in-the-blank exercise so an A1–A2 French learner (native Chinese, basic English) "
        "practises ONE grammar point by using it, not by re-reading it.\n"
        f"Grammar point: {point.title}. {point.explanation}\n"
        f"It was taught with this sentence: {request.sentence}\n"
        "Rules:\n"
        "- Write a NEW short French sentence (6–12 words) about everyday life, with A1–A2 words. "
        "It must use the same grammar point but must not copy the original sentence.\n"
        "- Blank only the 1–3 words that show the grammar point: write them as ____ in prompt_fr.\n"
        "- answer: exactly the words that go in the blank.\n"
        "- hint: a clue that does not give the answer away, e.g. 'avoir → ?', 'de + les', "
        "or for word order the words in English order, e.g. 'différents / objectifs'.\n"
        "- full_fr: the whole correct sentence. full_en: a simple English translation.\n"
        "Output valid JSON only: "
        '{"prompt_fr": "...", "answer": "...", "hint": "...", "full_fr": "...", "full_en": "..."}'
    )
    return {
        "model": _map_upstream_model(request.model),
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": "Write the exercise."}],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.4,
    }


def _parse_grammar_exercise(raw_text: str) -> dict | None:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start : end + 1])
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    item = {key: str(data.get(key) or "").strip() for key in ("prompt_fr", "answer", "hint", "full_fr", "full_en")}
    blank = re.search(r"_{2,}", item["prompt_fr"])
    if not blank or not item["answer"] or not item["full_fr"]:
        return None
    item["prompt_fr"] = re.sub(r"_{2,}", "____", item["prompt_fr"], count=1)
    # The sentence with the blank filled must be the full sentence (ignoring case/spacing)
    filled = item["prompt_fr"].replace("____", item["answer"])
    squash = lambda text: re.sub(r"\s+", " ", text).strip().lower()
    if squash(filled) != squash(item["full_fr"]):
        return None
    return item


@app.post("/api/srs/grammar")
async def srs_add_grammar_card(
    request: GrammarCardRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    api_key = _authorization_token(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    exercise = None
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        for attempt in range(2):
            _, raw_text = await _post_chat(client, _grammar_exercise_payload(request), headers)
            exercise = _parse_grammar_exercise(raw_text)
            if exercise:
                break
            logger.warning("Grammar exercise not usable (attempt %d): %r", attempt + 1, raw_text[:300])
    if not exercise:
        raise HTTPException(
            status_code=422,
            detail={"code": "grammar_exercise_failed", "message": "AI 没能生成合适的练习，请再点一次。"},
        )
    point = request.grammar
    meta = {"rule": point.explanation, "hook": point.hook, **exercise}
    return await run_in_threadpool(
        srs.add_note,
        user_id,
        request.sentence,
        request.translation_zh,
        request.translation_en,
        None,
        (),
        [{"text": point.title, "mode": "grammar", "meta": meta}],
    )


async def backfill_english(user_id: int, api_key: str, model: str = FAST_MODEL) -> dict:
    """Fill in simple-English translations/meanings that older cards lack (English UI mode)."""
    missing = await run_in_threadpool(srs.missing_english, user_id)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    translations: dict[str, str] = {}
    meanings: dict[str, str] = {}
    jobs = [
        ("notes", missing["notes"], translations,
         "Translate each French text into short, natural, simple English (A2 level). "
         "It may be a sentence, a heading or a single word. Use the Chinese only as a hint."),
        ("cards", missing["cards"], meanings,
         "For each item, give the short English meaning (1–6 words) of the French word or phrase "
         "as it is used in the sentence. Use the Chinese only as a hint."),
    ]
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        for _, items, target, instruction in jobs:
            for start in range(0, len(items), 20):
                batch = items[start : start + 20]
                payload = {
                    "model": _map_upstream_model(model),
                    "messages": [
                        {"role": "system", "content": instruction
                            + ' Output valid JSON only: {"items": [{"id": "...", "en": "..."}]}, one entry per input id.'},
                        {"role": "user", "content": json.dumps(batch, ensure_ascii=False)},
                    ],
                    "response_format": {"type": "json_object"},
                    "stream": False,
                    "temperature": 0.2,
                }
                _, raw_text = await _post_chat(client, payload, headers)
                cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
                start_brace, end_brace = cleaned.find("{"), cleaned.rfind("}")
                try:
                    data = json.loads(cleaned[start_brace : end_brace + 1])
                except Exception:
                    logger.warning("English backfill output not parseable: %r", raw_text[:300])
                    continue
                valid_ids = {item["id"] for item in batch}
                for entry in data.get("items", []) if isinstance(data, dict) else []:
                    if isinstance(entry, dict) and entry.get("id") in valid_ids and str(entry.get("en") or "").strip():
                        target[entry["id"]] = str(entry["en"])[:500]
    updated = await run_in_threadpool(srs.set_english, user_id, translations, meanings)
    return {
        "missing_notes": len(missing["notes"]),
        "missing_cards": len(missing["cards"]),
        "updated": updated,
    }


@app.post("/api/srs/backfill-english")
async def srs_backfill_english(authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    return await backfill_english(user_id, _authorization_token(authorization))

# ---------------------------------------------------------------------------
# "Listen while driving" episodes (MP3 + LRC/SRT from the learner's material)
# ---------------------------------------------------------------------------
_episode_lock = asyncio.Lock()           # render one episode at a time
_background_tasks: set[asyncio.Task] = set()
STORY_SPEAKERS = {"A", "B", "N"}


def _story_payload(vocabulary: list[str], examples: list[str], kind: str, model: str) -> dict:
    who = (
        "a dialogue between two people, speakers A and B"
        if kind == "dialogue"
        else "a short story told by a narrator, speaker N"
    )
    system = (
        "You write French listening practice for an A1–A2 learner (native Chinese, basic English) "
        "who is moving to Canada and preparing the TCF Canada test.\n"
        f"Write {who}, 10–14 lines.\n"
        "Rules:\n"
        f"- Reuse as many of these known words as is natural: {', '.join(vocabulary) or '(none)'}.\n"
        "- Everyday situations: a test centre, an office, school, work, shopping, a new city, a phone call.\n"
        "- Short sentences, at most 12 words. Mostly present tense. At most 3 words the learner may not know.\n"
        "- Do not copy these sentences the learner already studied: "
        f"{' | '.join(examples) or '(none)'}.\n"
        "- Each line has an English translation in very simple English (A2, everyday words).\n"
        'Output valid JSON only: {"title_en": "...", "lines": [{"speaker": "A", "fr": "...", "en": "..."}]}'
    )
    return {
        "model": _map_upstream_model(model),
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": "Write it."}],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.7,
    }


def _parse_story(raw_text: str) -> dict | None:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start : end + 1])
    except Exception:
        return None
    lines = []
    for line in data.get("lines") or [] if isinstance(data, dict) else []:
        if not isinstance(line, dict):
            continue
        fr = re.sub(r"\s+", " ", str(line.get("fr") or "")).strip()
        speaker = str(line.get("speaker") or "N").strip().upper()[:1]
        if fr and len(fr) <= 300:
            lines.append({
                "speaker": speaker if speaker in STORY_SPEAKERS else "N",
                "fr": fr,
                "en": re.sub(r"\s+", " ", str(line.get("en") or "")).strip()[:300],
            })
    if len(lines) < 4:
        return None
    return {"title_en": str(data.get("title_en") or "").strip()[:80], "lines": lines[:16]}


async def _write_stories(api_key: str, vocabulary: list[str], examples: list[str], model: str) -> list[dict]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    stories = []
    async with httpx.AsyncClient(timeout=PERPLEXITY_TIMEOUT_SECONDS) as client:
        for kind in ("dialogue", "story"):
            for attempt in range(2):
                try:
                    _, raw_text = await _post_chat(client, _story_payload(vocabulary, examples, kind, model), headers)
                except HTTPException as exc:
                    logger.warning("Story generation failed: %s", exc.detail)
                    break
                story = _parse_story(raw_text)
                if story:
                    stories.append(story)
                    break
                logger.warning("Story output not usable (attempt %d): %r", attempt + 1, raw_text[:200])
    return stories


async def _generate_episode(user_id: int, episode_id: str, api_key: str | None, model: str) -> None:
    try:
        async with _episode_lock:
            material = await run_in_threadpool(episodes.learning_material, user_id)
            if not material:
                raise ValueError("No studied sentences with an English translation yet.")
            review, buildups = await run_in_threadpool(episodes.pick_material, user_id, material)
            stories = []
            if api_key:
                stories = await _write_stories(
                    api_key, episodes.story_vocabulary(review), [m["sentence"] for m in review[:8]], model
                )
            number = await run_in_threadpool(episodes.episode_number, user_id)
            title = episodes.clean_title(
                f"Episode {number}" + (f" · {stories[0]['title_en']}" if stories and stories[0]["title_en"] else "")
            )
            segments = episodes.build_script(number, review, buildups, stories)
            duration = await episodes.render(segments, episodes.episodes_dir() / episode_id, title)
            await run_in_threadpool(
                episodes.update_episode, episode_id,
                status="ready", title=title, duration=duration,
                sentences_json=json.dumps(list(dict.fromkeys(m["key"] for m in review + buildups))),
            )
    except Exception as exc:
        logger.exception("Episode %s failed", episode_id)
        await run_in_threadpool(episodes.update_episode, episode_id, status="failed", error=str(exc)[:300])


@app.get("/listen")
async def listen_page():
    return _html_page("listen.html")


@app.get("/api/episodes")
def list_episodes_api(authorization: str | None = Header(default=None)):
    return {"episodes": episodes.list_episodes(_require_user_id(authorization))}


@app.post("/api/episodes")
async def create_episode_api(
    model: TransformModel = Query(default=PERPLEXITY_MODEL),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    try:
        api_key = _authorization_token(authorization)
    except HTTPException:
        api_key = None  # no upstream key: build the episode without new stories
    episode = await run_in_threadpool(episodes.create_episode, user_id)
    task = asyncio.create_task(_generate_episode(user_id, episode["id"], api_key, model))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return episode


@app.delete("/api/episodes/{episode_id}")
def delete_episode_api(episode_id: str, authorization: str | None = Header(default=None)):
    return {"success": episodes.delete_episode(_require_user_id(authorization), episode_id)}


@app.get("/episodes/{episode_id}.{ext}")
async def episode_file(episode_id: str, ext: str, download: bool = Query(default=False)):
    # The 128-bit random id is the capability (players and downloads cannot send auth headers)
    if not re.fullmatch(r"[0-9a-f]{32}", episode_id) or ext not in {"mp3", "srt", "lrc"}:
        raise HTTPException(status_code=404, detail="文件不存在。")
    path = episodes.episodes_dir() / f"{episode_id}.{ext}"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在。")
    media_type = {"mp3": "audio/mpeg", "srt": "application/x-subrip", "lrc": "text/plain; charset=utf-8"}[ext]
    return FileResponse(
        path,
        media_type=media_type,
        filename=f"french-listening-{episode_id[:8]}.{ext}" if download else None,
        headers={"Cache-Control": "private, max-age=86400"},
    )

@app.post("/api/srs/import")
def srs_import_legacy(
    req: SrsImportRequest,
    authorization: str | None = Header(default=None),
):
    return srs.import_legacy_cards(_require_user_id(authorization), req.cards)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

