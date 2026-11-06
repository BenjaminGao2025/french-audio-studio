"""Tutor routes: Feynman checks, speech-to-text, Ask (and save an answer as a card), lookup, etymology."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import analysis
import auth_db
import srs
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
        _, raw_text = await ai.post_chat(
            client, _transcript_fix_payload(request), headers
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
    model: ai.TransformModel = ai.DEFAULT_MODEL


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
        "- Ground your answer in their sentence first: point to the actual clue in that sentence, "
        "not a generic rule.\n"
        "- For a follow-up question, continue from your previous answer: refer back briefly, "
        "e.g. 'As above, ...', and connect to earlier turns. "
        "Never repeat an example already given in the conversation.\n"
        "- Give examples only when they really help: 0–2 short French examples, "
        "each with its English meaning.\n"
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
        point = json.loads(cleaned[cleaned.find("{"): cleaned.rfind("}") + 1])
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


LOOKUP_CACHE: dict[str, dict] = {}


async def request_word_lookup(word: str, api_key: str, model: str = ai.DEFAULT_MODEL) -> dict:
    clean_word = word.strip()
    cache_key = clean_word.lower()
    if cache_key in LOOKUP_CACHE:
        return LOOKUP_CACHE[cache_key]

    prompt = (
        "You are an expert French pedagogical lexicographer for learners.\n"
        "Provide accurate linguistic details for the given French word or short phrase in valid JSON format ONLY.\n"
        "For a phrase, explain it as a whole (its meaning as a unit), not word by word.\n"
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
        "model": ai.AGY_MODEL,
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
        _, raw_text = await ai.post_chat(client, payload, headers)

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
        "phonetic": analysis.format_friendly_phonetic(str(data.get("phonetic", ""))),
        "explanation_cn": str(data.get("explanation_cn", "语境词汇")),
        "explanation_en": str(data.get("explanation_en", "")),
    }

    LOOKUP_CACHE[cache_key] = result
    return result


@router.get("/api/lookup")
async def lookup_word(
    word: str,
    model: str = ai.DEFAULT_MODEL,
    authorization: str | None = Header(default=None),
):
    clean = word.strip()
    if not clean:
        raise HTTPException(status_code=400, detail={"message": "请提供待查询单词"})
    if clean.lower() in LOOKUP_CACHE:  # cached: still login-only, but free
        _require_user_id(authorization)
        return LOOKUP_CACHE[clean.lower()]
    api_key = ai.upstream_key(authorization)
    result = await request_word_lookup(clean, api_key, model=model)
    return result


class EtymologyRequest(BaseModel):
    word: str = Field(min_length=1, max_length=200)
    lemma: str | None = Field(default=None, max_length=200)


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
    key = (lemma or word).lower()
    cached = auth_db.get_etymology(key)
    if cached is not None:
        return {"text": cached, "cached": True}

    api_key = ai.upstream_key(authorization)
    payload = {
        "model": ai.AGY_MODEL,
        "messages": [
            {"role": "system", "content": (
                "你是严谨的法语词源老师。用简体中文纯文本解释所给原形词的词根/构词、"
                "词源（如拉丁语来源，已知才写）和恰好一条简短记忆钩子。"
                "不确定时明确说不确定，不编造词源；区分真实词源和记忆联想。"
                "只解释原形词，便于同词族复用。总计约120个汉字以内，最多4短行，不用Markdown。"
            )},
            {"role": "user", "content": f"法语原形词：{key}"},
        ],
        "stream": False,
        "temperature": 0.0,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
    text = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
    if not text:
        raise HTTPException(
            status_code=502,
            detail={"code": "etymology_failed", "message": "暂无法获取词源，请重试。"},
        )
    auth_db.set_etymology(key, word, lemma, text)
    return {"text": text, "cached": False}


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
    squash = lambda text: re.sub(r"\s+", " ", text).strip().lower()
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
