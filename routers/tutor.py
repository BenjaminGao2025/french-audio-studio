"""Tutor routes: Feynman checks, speech-to-text, Ask (and save an answer as a card), lookup, etymology."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import auth_db
import offline_dictionary
import phrase_context
import srs
import word_context
from services import ai, asr
from web_common import _require_user_id, rate_limit

logger = logging.getLogger(__name__)
router = APIRouter()


class FeynmanGrammarPoint(BaseModel):
    title: str = Field(default="", max_length=300)
    explanation: str = Field(default="", max_length=1000)


class FeynmanRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=1000)
    grammar_points: list[FeynmanGrammarPoint] = Field(default_factory=list, max_length=5)
    explanation: str = Field(min_length=1, max_length=2000)
    variation: str = Field(default="", max_length=500)
    model: ai.TransformModel = ai.DEFAULT_MODEL


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
        + TUTOR_ENGLISH_STYLE
        + "Each item is one or two short sentences.\n"
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
        "model": ai.AGY_MODEL,
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


@router.post("/api/feynman")
async def feynman_check(
    request: FeynmanRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        for attempt in range(2):
            _, raw_text = await ai.post_chat(client, _feynman_payload(request), headers)
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


@router.post("/api/transcribe")
async def transcribe_audio(
    request: Request,
    sentence: str = Query(default="", max_length=1000),
    context: str = Query(default="", max_length=2000),
    language: str = Query(default="zh", pattern=r"^(zh|fr)$"),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    declared = int(request.headers.get("content-length") or 0)
    if declared > asr.ASR_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"message": "录音太长了，请分段说。"})
    rate_limit(user_id, "transcribe")
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=422, detail={"message": "没有收到录音。"})
    if len(audio) > asr.ASR_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"message": "录音太长了，请分段说。"})
    if not asr.looks_like_audio(audio):
        raise HTTPException(status_code=415, detail={"message": "录音格式不支持，请用浏览器重新录一次。"})
    return await asr.transcribe(audio, sentence, context, language)


class TranscriptFixRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    context: str = Field(default="", max_length=4000)
    text: str = Field(min_length=1, max_length=5000)
    model: ai.TransformModel = ai.DEFAULT_MODEL


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
        "model": ai.AGY_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": request.text},
        ],
        "stream": False,
        "temperature": 0,
    }


@router.post("/api/transcribe/fix")
async def fix_transcript(
    request: TranscriptFixRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        _, raw_text = await ai.post_chat(client, _transcript_fix_payload(request), headers)
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
    translation_en: str = Field(default="", max_length=1000)
    word: str = Field(default="", max_length=1000)
    language: Literal["en", "zh"] = "en"
    grammar_points: list[FeynmanGrammarPoint] = Field(default_factory=list, max_length=5)
    history: list[AskTurn] = Field(default_factory=list, max_length=20)
    question: str = Field(min_length=1, max_length=1000)
    model: ai.TransformModel = ai.DEFAULT_MODEL


def _ask_payload(request: AskRequest) -> dict:
    reference = "\n".join(
        f"- {g.title}: {g.explanation}".strip() for g in request.grammar_points if g.title or g.explanation
    )
    system = (
        "You are a patient French tutor. The learner is A1–A2 in French, native language Chinese.\n"
        f"They are studying this sentence: {request.sentence}\n"
        f"Chinese translation: {request.translation_zh or '(none)'}\n"
        f"English translation: {request.translation_en or '(none)'}\n"
        f"The word card is open on: {request.word or '(none)'} (context only, not the assumed subject).\n"
        f"Notes they have seen:\n{reference or '(none)'}\n\n"
        "Answer the user's actual question first and directly. The open French word is context, "
        "not necessarily what they are asking about.\n"
        "- If they ask about an English word or phrase in the translation, define that English first. "
        "For example, 'to set forth' means to formally state or present. "
        "Only then link it to the French word or sentence if it helps.\n"
        "- Ground your answer in their French sentence only if it helps answer their actual question: "
        "point to the actual clue in that sentence, not a generic rule. Grounding is secondary.\n"
        "- Follow the language of the question: clearly Chinese questions get Chinese answers; "
        "clearly English questions get English answers.\n"
        f"- For mixed or ambiguous question language, use {'Chinese (zh)' if request.language == 'zh' else 'English (en)'}, "
        "the learner's Explanation language setting.\n"
        "- Only for English answers: use simple English, roughly B1, with short, plain sentences "
        "and everyday words. Explain any needed grammar terms simply. Quote French words exactly.\n"
        "- For Chinese answers, write in Chinese; quote English or French terms when needed.\n"
        "- For a follow-up question, continue from your previous answer: refer back briefly, "
        "e.g. 'As above, ...', and connect to earlier turns. "
        "Never repeat an example already given in the conversation.\n"
        "- Give examples only when they really help: 0–2 short French examples, "
        "each with its English meaning.\n"
        "- If their message answers a question you asked earlier, say clearly if it is right, "
        "and fix it if not.\n"
        "- At most 90 words. Plain text only: no markdown, no headings, no tables. "
        "You may use short lines like 'de + la = de la'.\n"
    )
    messages = [{"role": "system", "content": system}]
    for turn in request.history[-12:]:
        messages.append(
            {
                "role": "user" if turn.role == "learner" else "assistant",
                "content": turn.content,
            }
        )
    messages.append({"role": "user", "content": request.question})
    return {
        "model": ai.AGY_MODEL,
        "messages": messages,
        "stream": False,
        "temperature": 0.3,
    }


@router.post("/api/ask")
async def ask_tutor(
    request: AskRequest,
    authorization: str | None = Header(default=None),
):
    api_key = ai.upstream_key(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        _, raw_text = await ai.post_chat(client, _ask_payload(request), headers)
    answer = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    answer = re.sub(r"^#+\s*", "", answer, flags=re.MULTILINE).replace("**", "")
    if not answer:
        raise HTTPException(
            status_code=502,
            detail={"code": "ask_empty", "message": "AI 没有给出回答，请再问一次。"},
        )
    return {"answer": answer[:3000]}


class AskCardRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=2000)
    translation_en: str = Field(default="", max_length=2000)
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=3000)
    model: ai.TransformModel = ai.DEFAULT_MODEL


def _ask_point_payload(request: AskCardRequest) -> dict:
    system = (
        "A French learner (A1–A2, native Chinese) asked a tutor a question about a sentence. "
        "Turn the answer into ONE grammar point they can practise.\n"
        f"Sentence: {request.sentence}\nQuestion: {request.question}\nTutor's answer: {request.answer}\n"
        "- title: the rule in a few words, e.g. 'Object pronoun before the verb (les)'.\n"
        "- explanation: one short sentence in simple English.\n"
        "- hook: a tiny memory hook from the sentence, e.g. 'nous les acceptons = we them accept'.\n"
        'Output valid JSON only: {"title": "...", "explanation": "...", "hook": "..."}'
    )
    return {
        "model": ai.AGY_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": "Write the grammar point."}],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.2,
    }


@router.post("/api/ask/card")
async def ask_to_card(request: AskCardRequest, authorization: str | None = Header(default=None)):
    """A tutor answer becomes a grammar card: the rule, then a new fill-in sentence that uses it."""
    _require_user_id(authorization)
    headers = {"Authorization": f"Bearer {ai.upstream_key(authorization)}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        _, raw_text = await ai.post_chat(client, _ask_point_payload(request), headers)
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text)
    try:
        point = json.loads(cleaned[cleaned.find("{") : cleaned.rfind("}") + 1])
        grammar = GrammarPointIn(
            title=str(point.get("title") or "").strip()[:300],
            explanation=str(point.get("explanation") or "").strip()[:1000],
            hook=str(point.get("hook") or "").strip()[:500],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail={"code": "ask_card_failed", "message": "AI 没能整理出要点，请再点一次。"}
        ) from exc
    return await srs_add_grammar_card(
        GrammarCardRequest(
            sentence=request.sentence,
            translation_zh=request.translation_zh,
            translation_en=request.translation_en,
            grammar=grammar,
            model=request.model,
        ),
        authorization,
    )


LOOKUP_MAX_CHARS = 200


async def request_word_lookup(word: str, api_key: str = "", model: str = ai.DEFAULT_MODEL, pos: str = "") -> dict:
    """Read genuine source definitions. Kept callable by the snapshot backfill script; no AI calls."""
    try:
        result = await run_in_threadpool(offline_dictionary.lookup, word, pos)
    except offline_dictionary.DictionaryUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": "dictionary_unavailable", "message": "The dictionary is temporarily unavailable. Please try again."}) from exc
    if result is not None:
        return result
    return {
        "token": word, "lemma": word, "pos": "", "phonetic": "",
        "explanation_cn": "", "explanation_en": "", "entries": [], "entries_en": [], "entries_fr": [],
        "dictionary_source": "wiktionnaire", "dictionary_state": "not_found",
        "source_language": "fr", "source_name": "Wiktionnaire",
    }


@router.get("/api/lookup")
async def lookup_word(
    word: str = Query(min_length=1, max_length=LOOKUP_MAX_CHARS),
    pos: str = Query(default="", max_length=80),
    model: str = ai.DEFAULT_MODEL,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    clean = offline_dictionary.normalize(word)
    if not clean or any(ord(c) < 32 for c in word):
        raise HTTPException(status_code=400, detail={"message": "Enter a word to look up."})
    rate_limit(user_id, "dictionary")
    result = await request_word_lookup(word.strip(), pos=pos)
    # The word card's forms table (tout / tous / toute / toutes) rides along with the lookup.
    forms = await run_in_threadpool(offline_dictionary.word_forms, word.strip(), pos)
    return {**result, "forms": forms} if forms else result


class EtymologyRequest(BaseModel):
    word: str = Field(min_length=1, max_length=200)
    lemma: str | None = Field(default=None, max_length=200)
    language: Literal["zh", "en"] = "zh"


class OriginPart(BaseModel):
    form: str = Field(max_length=200)
    gloss_zh: str = Field(default="", max_length=300)


class OriginSource(BaseModel):
    lang: str = Field(max_length=100)
    form: str = Field(max_length=200)
    from_form: str = Field(default="", max_length=200)


class OriginDetail(BaseModel):
    construction: list[OriginPart] = Field(default_factory=list, max_length=12)
    source: list[OriginSource] = Field(default_factory=list, max_length=12)
    sense_history_zh: str = Field(default="", max_length=2000)
    memory_zh: str = Field(default="", max_length=1000)


def _origin_response(raw: str) -> dict:
    """Validate before caching; source-language citation forms remain untouched."""
    clean = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean)
    if clean.startswith("{"):
        detail = OriginDetail.model_validate_json(clean)
        explanations = [p.gloss_zh for p in detail.construction] + [p.lang for p in detail.source] + [detail.sense_history_zh, detail.memory_zh]
        if any(re.search(r"暂无法|请重试|请求失败|发生错误", x) for x in explanations) or not any(explanations) or any(x and not re.search(r"[\u4e00-\u9fff]", x) for x in explanations):
            raise ValueError("Origin explanations must be Chinese")
        text = "\n".join(filter(None, [
            "构成：" + " + ".join(p.form + (f"（{p.gloss_zh}）" if p.gloss_zh else "") for p in detail.construction) if detail.construction else "",
            "来源：" + "；".join(f"{p.lang} {p.form}" + (f" ← {p.from_form}" if p.from_form else "") for p in detail.source) if detail.source else "",
            f"词义演变：{detail.sense_history_zh}" if detail.sense_history_zh else "",
            f"记忆提示：{detail.memory_zh}" if detail.memory_zh else "",
        ]))
        return {**detail.model_dump(), "text": text, "lang": "zh", "schema_version": 2}
    if not re.search(r"[\u4e00-\u9fff]", clean) or re.search(r"无法|请重试|出错|请求失败", clean):
        raise ValueError("Empty, English or failed origin")
    return {"text": clean, "lang": "zh", "schema_version": 2}


@router.post("/api/etymology")
async def etymology_word(
    request: EtymologyRequest,
    authorization: str | None = Header(default=None),
):
    _require_user_id(authorization)
    word = request.word.strip()
    lemma = (request.lemma or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail={"message": "请提供待查询单词"})
    headword = (lemma or word).lower()
    # Versioned namespace lazily regenerates all legacy English/plain origins on open.
    # The language field remains accepted for old clients; explanations now always use Chinese.
    key = f"zh:v2:{headword}"
    cached = auth_db.get_etymology(key)
    if cached is not None:
        try:
            return {**_origin_response(cached), "cached": True}
        except (ValueError, TypeError):
            pass

    api_key = ai.upstream_key(authorization)
    payload = {
        "model": ai.AGY_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是严谨的法语词源老师。所有解释、释义及语言名称必须用简体中文，"
                    "不要使用 compound、prefix、from Latin 等英文标签。法语、拉丁语、希腊语等引用形式保持原文，"
                    "如 à、fin、ad、finem、finis，不要音译或翻译形式。只解释原形词，"
                    "不确定时明确说明，不编造词源；记忆联想必须与真实词源区分。"
                    '仅返回 JSON：{"construction":[{"form":"à","gloss_zh":"到"}],'
                    '"source":[{"lang":"拉丁语","form":"ad","from_form":""}],'
                    '"sense_history_zh":"简短的词义演变","memory_zh":"一条简短记忆联想"}。'
                    "各字段按实际单词填写；未知或不适用的字段用空数组或空字符串。总解释不超过250汉字。"
                ),
            },
            {"role": "user", "content": f"French base word: {headword}"},
        ],
        "stream": False,
        "temperature": 0.0,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    try:
        result = _origin_response(raw_text)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=502,
            detail={"code": "etymology_failed", "message": "暂无法获取词源，请重试。"},
        )
    # Store structured JSON in the existing text column; no database migration.
    stored = json.dumps(result, ensure_ascii=False) if "construction" in result else result["text"]
    auth_db.set_etymology(key, word, lemma, stored)
    return {**result, "cached": False}


class PhraseContextRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=phrase_context.SENTENCE_MAX_CHARS)
    translation_zh: str = Field(default="", max_length=phrase_context.TRANSLATION_MAX_CHARS)


# One model call per user and sentence at a time: duplicate taps wait for the same answer
_phrase_in_flight: dict[tuple[int, str], asyncio.Task] = {}


async def _compute_phrases(user_id: int, key: str, sentence: str, translation_zh: str, api_key: str) -> list:
    payload = phrase_context.ai_payload(ai.AGY_MODEL, sentence, translation_zh)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    phrases = phrase_context.parse_ai_phrases(raw_text, sentence)
    if phrases is None:
        logger.warning("Phrase context reply not usable: %r", raw_text[:300])
        raise HTTPException(
            status_code=502,
            detail={"code": "phrase_context_bad_output", "message": "暂无法分析固定搭配，请稍后再试。"},
        )
    try:
        await run_in_threadpool(phrase_context.save_cached, user_id, key, sentence, phrases)
    except Exception:
        logger.exception("Could not cache phrase context")
    return phrases


@router.post("/api/phrase-context")
async def phrase_context_for(
    request: PhraseContextRequest,
    authorization: str | None = Header(default=None),
):
    """Fixed expressions of a sentence analysed before the analysis returned them (cached per user)."""
    user_id = _require_user_id(authorization)
    sentence = phrase_context.clean_sentence(request.sentence)
    if not sentence:
        raise HTTPException(status_code=422, detail={"message": "请提供句子"})
    key = phrase_context.cache_key(sentence)
    cached = await run_in_threadpool(phrase_context.get_cached, user_id, key)
    if cached is not None:
        return {"phrases": cached, "cached": True}
    task = _phrase_in_flight.get((user_id, key))
    shared = task is not None
    if task is None:
        rate_limit(user_id, "phrase_ai")
        api_key = ai.upstream_key(authorization)  # checks the account and spends the shared "ai" bucket
        task = asyncio.ensure_future(_compute_phrases(user_id, key, sentence, request.translation_zh, api_key))
        _phrase_in_flight[(user_id, key)] = task
        task.add_done_callback(lambda _: _phrase_in_flight.pop((user_id, key), None))
    # shield: a client that goes away mid-call does not cancel the answer the others wait for
    phrases = await asyncio.shield(task)
    return {"phrases": phrases, "cached": False, "shared": shared}


class WordContextHints(BaseModel):
    """What the page's analysis already says about the word here (optional notes for the model)."""

    meaning_zh: str = Field(default="", max_length=200)
    meaning_en: str = Field(default="", max_length=300)
    note_en: str = Field(default="", max_length=600)
    lemma: str = Field(default="", max_length=100)
    pos: str = Field(default="", max_length=60)


class WordContextRequest(BaseModel):
    language: Literal["en", "zh"] = "en"
    sentence: str = Field(min_length=1, max_length=word_context.SENTENCE_MAX_CHARS)
    word: str = Field(min_length=1, max_length=word_context.WORD_MAX_CHARS)
    occurrence: int = Field(default=0, ge=0, le=word_context.MAX_OCCURRENCE)
    translation_zh: str = Field(default="", max_length=word_context.TRANSLATION_MAX_CHARS)
    hints: WordContextHints = Field(default_factory=WordContextHints)


# One model call per user, sentence and word at a time: duplicate opens wait for the same answer
_word_context_in_flight: dict[tuple[int, str], asyncio.Task] = {}


def _word_context_response(result: dict, **extra: Any) -> dict:
    return {"context": result, "state": "empty" if word_context.is_empty(result) else "ready", **extra}


async def _compute_word_context(
    user_id: int,
    key: str,
    sentence: str,
    word: str,
    occurrence: int,
    span: tuple[int, int],
    request: WordContextRequest,
    api_key: str,
) -> dict:
    payload = word_context.ai_payload(
        ai.AGY_MODEL, sentence, span, request.translation_zh, request.hints.model_dump(),
        language=request.language, cited_word=word if not word_context.word_spans(word, sentence) else "",
    )
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    result = word_context.reject_error_text(word_context.parse_ai_context(raw_text))
    if result is None:
        logger.warning("Word context reply not usable: %r", raw_text[:300])
        raise HTTPException(
            status_code=502,
            detail={"code": "word_context_bad_output", "message": "暂无法分析这个词在本句中的用法，请稍后再试。"},
        )
    try:
        await run_in_threadpool(word_context.save_cached, user_id, key, sentence, word, occurrence, result)
    except Exception:
        logger.exception("Could not cache word context")
    return result


@router.post("/api/word-context")
async def word_context_for(
    request: WordContextRequest,
    authorization: str | None = Header(default=None),
):
    """How one word works in one sentence: its meaning here and why this form (cached per user)."""
    user_id = _require_user_id(authorization)
    sentence = word_context.clean_sentence(request.sentence)
    word = word_context.clean_word(request.word)
    if not sentence or not word:
        raise HTTPException(status_code=422, detail={"code": "word_context_invalid", "message": "请提供句子和单词"})
    spans = word_context.word_spans(word, sentence)
    span = spans[request.occurrence] if request.occurrence < len(spans) else None
    if not spans and request.occurrence == 0:
        span = await run_in_threadpool(word_context.related_lemma_span, word, sentence)
    if span is None:
        raise HTTPException(status_code=422, detail={"code": "word_not_in_sentence", "message": "这个词不在这句话里。"})
    key = word_context.cache_key(sentence, word, request.occurrence, request.language)
    cached = await run_in_threadpool(word_context.get_cached, user_id, key)
    if cached is not None:
        return _word_context_response(cached, cached=True)
    task = _word_context_in_flight.get((user_id, key))
    shared = task is not None
    if task is None:
        rate_limit(user_id, "word_context_ai")
        api_key = ai.upstream_key(authorization)  # checks the account and spends the shared "ai" bucket
        task = asyncio.ensure_future(
            _compute_word_context(
                user_id, key, sentence, word, request.occurrence, span, request, api_key
            )
        )
        _word_context_in_flight[(user_id, key)] = task
        task.add_done_callback(lambda _: _word_context_in_flight.pop((user_id, key), None))
    # shield: a client that goes away mid-call does not cancel the answer the others wait for
    result = await asyncio.shield(task)
    return _word_context_response(result, cached=False, shared=shared)


class GrammarPointIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    explanation: str = Field(default="", max_length=1000)
    hook: str = Field(default="", max_length=500)


class GrammarCardRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=1000)
    translation_zh: str = Field(default="", max_length=2000)
    translation_en: str = Field(default="", max_length=2000)
    grammar: GrammarPointIn
    model: ai.TransformModel = ai.DEFAULT_MODEL


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
        "model": ai.AGY_MODEL,
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

    def squash(text):
        return re.sub(r"\s+", " ", text).strip().lower()

    if squash(filled) != squash(item["full_fr"]):
        return None
    return item


@router.post("/api/srs/grammar")
async def srs_add_grammar_card(
    request: GrammarCardRequest,
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    api_key = ai.upstream_key(authorization)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    exercise = None
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        for attempt in range(2):
            _, raw_text = await ai.post_chat(client, _grammar_exercise_payload(request), headers)
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
