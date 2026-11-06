"""The studio transform: turn a request into French (generate / translate / express / polish), then check
the result is French only and proofread it when needed."""

from __future__ import annotations

import re
from typing import Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field

from services import ai
from web_common import MAX_TEXT_CHARS, _normalized_text

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

NON_FRENCH_SCRIPT_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")
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
TASK_CLASSIFICATION_RE = re.compile(r"\b(generate|translate|express|polish)\b", re.IGNORECASE)
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
FRENCH_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:[’'-][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)*")
TaskMode = Literal["auto", "generate", "translate", "express", "polish"]
ResolvedTaskMode = Literal["generate", "translate", "express", "polish"]
QualityCheck = Literal["passed", "proofread"]


class TransformRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    style: Literal["spoken", "neutral", "formal", "polished"] = "spoken"
    level: Literal["A1-A2", "B1-B2", "C1-C2"] = "B1-B2"
    locale: Literal["fr-FR", "fr-CA"] = "fr-FR"
    model: ai.TransformModel = ai.DEFAULT_MODEL
    task_mode: TaskMode = "auto"


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
                "message": "模型未返回可验证的处理方式，请重试或手动选择一种处理方式。",
            },
        )
    if len(matches) != 1:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "invalid_task_classification",
                "message": "模型返回了无法识别的处理方式，请重试或手动选择一种处理方式。",
            },
        )
    return matches.pop()


def _infer_task_mode_locally(value: str) -> ResolvedTaskMode | None:
    text = _normalized_text(value)
    if CHINESE_GENERATE_RE.search(text) or LATIN_GENERATE_RE.search(text):
        return "generate"

    rough_markers = ROUGH_SPEECH_RE.findall(text)
    starts_as_rough_speech = bool(re.match(r"^\s*(?:嗯|呃|额|那个|就是|um+\b|uh+\b)", text, re.IGNORECASE))
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
    return f"length target {target} French words; final count must stay between {minimum} and {maximum} words"


def _classification_payload(request: TransformRequest) -> dict:
    return {
        "model": ai.AGY_MODEL,
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
        "model": ai.AGY_MODEL,
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
                "content": (f"Original user input:\n{_normalized_text(request.text)}\n\nDraft to review:\n{candidate}"),
            },
        ],
        "stream": False,
        "temperature": 0.05,
    }


def _build_messages(request: TransformRequest, task_mode: ResolvedTaskMode) -> list[dict[str, str]]:
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
        "model": ai.AGY_MODEL,
        "messages": _build_messages(request, task_mode),
        "stream": False,
        "temperature": temperatures[task_mode],
    }


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
                "message": "模型没有返回法语文本。",
            },
        )
    if _contains_non_french_script(result):
        raise HTTPException(
            status_code=502,
            detail={
                "code": "non_french_upstream_response",
                "message": f"{ai.MODEL_LABELS[ai.DEFAULT_MODEL]} 返回了双语或非法语内容，纯法语检查未通过。",
            },
        )
    if UPSTREAM_META_RE.search(result):
        raise HTTPException(
            status_code=502,
            detail={
                "code": "upstream_meta_response",
                "message": "模型返回了内部说明而不是法语正文，已拒绝该结果。",
            },
        )
    requested_range = _requested_word_range(request.text) if task_mode == "generate" else None
    if requested_range:
        word_count = _french_word_count(result)
        minimum, maximum = requested_range
        if not minimum <= word_count <= maximum:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "word_count_out_of_range",
                    "message": (f"生成结果为 {word_count} 词，没有满足 {minimum}–{maximum} 词的要求。"),
                },
            )
    return result


def _contract_retry_payload(payload: dict, error_code: str) -> dict:
    messages = [dict(message) for message in payload["messages"]]
    if error_code == "word_count_out_of_range":
        source_prompt = "\n".join(str(message.get("content", "")) for message in messages)
        length_instruction = _generation_length_instruction(source_prompt)
        messages[0]["content"] += (
            f" Strict retry: {length_instruction}. Count the finished French words before returning the answer."
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
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        if request.task_mode == "auto":
            local_task_mode = _infer_task_mode_locally(request.text)
            if local_task_mode:
                resolved_task_mode = local_task_mode
            else:
                classification_payload = _classification_payload(request)
                for classification_attempt in range(2):
                    _, classification = await ai.post_chat(client, classification_payload, headers)
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
                                            "Return one lowercase word only: generate, translate, express, or polish."
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
            body, raw_text = await ai.post_chat(client, payload, headers)
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
        proofread_model = ai.DEFAULT_MODEL
        proofread_payload = _proofread_payload(request, resolved_task_mode, result)
        for proofread_attempt in range(2):
            proofread_body, raw_proofread = await ai.post_chat(client, proofread_payload, headers)
            try:
                result = _validate_model_result(raw_proofread, request, resolved_task_mode)
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, dict) else {}
                error_code = str(detail.get("code") or "invalid_proofread_output")
                if proofread_attempt == 0:
                    proofread_payload = _contract_retry_payload(proofread_payload, error_code)
                    continue
                if result:
                    break
                raise
            proofread_model = str(proofread_body.get("model") or ai.DEFAULT_MODEL)
            quality_check = "proofread"
            break

        return result, model, resolved_task_mode, quality_check, proofread_model

    raise RuntimeError("Unreachable transform retry state")
