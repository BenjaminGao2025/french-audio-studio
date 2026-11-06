"""Listen-while-driving episodes: AI-written stories rendered to MP3 + LRC/SRT in the background."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Literal

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import coach
import episodes
import game
from services import ai
from web_common import _require_user_id, rate_limit, run_in_background

logger = logging.getLogger(__name__)
router = APIRouter()


_episode_lock = asyncio.Lock()  # render one episode at a time
_episode_users: set[int] = set()  # users with an episode currently generating
STORY_SPEAKERS = {"A", "B", "N"}


STORY_KINDS = {
    "dialogue": "a dialogue between two people, speakers A and B",
    "story": "a short story told by a narrator, speaker N",
    "announcement": "a public announcement (station, test centre, office) read by speaker N, then two people (A, B) talking about it",
    "voicemail": "a voicemail message left by speaker A, then speaker B calling back",
    "interview": "a short radio interview: a host (A) asks a guest (B) about their life or work",
}
# Which kinds each level hears, in turn (B1/B2 add TCF-style listening formats)
LEVEL_STORY_KINDS = {
    "A1": ("dialogue", "story"),
    "A2": ("dialogue", "story", "voicemail"),
    "B1": ("dialogue", "announcement", "story", "voicemail", "interview"),
    "B2": ("interview", "announcement", "dialogue", "voicemail", "story"),
}
LEVEL_STORY_RULES = {
    "A1": "Short sentences, at most 10 words. Present tense. At most 2 words the learner may not know.",
    "A2": "Sentences of at most 12 words. Present, passé composé and futur proche. At most 3 words the learner may not know.",
    "B1": "Sentences of up to 16 words, with connectors (parce que, mais, alors, quand). Past and future tenses. At most 5 new words.",
    "B2": "Natural spoken French, sentences up to 22 words, opinions and reasons, the pace of a TCF Canada listening item. At most 8 new words.",
}


def _story_payload(
    vocabulary: list[str],
    examples: list[str],
    kind: str,
    model: str,
    level: str = "A1",
    request: str = "",
    focus: str = "",
) -> dict:
    who = STORY_KINDS.get(kind, STORY_KINDS["story"])
    wishes = ""
    if request:
        wishes += f"- The learner asked for today (follow it when it fits): {request}\n"
    if focus:
        wishes += f"- Topic or skill to focus on: {focus}\n"
    system = (
        f"You write French listening practice for a {level} learner (native Chinese, basic English) "
        "who is moving to Canada and preparing the TCF Canada test.\n"
        f"Write {who}, 10–14 lines.\n"
        "Rules:\n"
        f"- Reuse as many of these known words as is natural: {', '.join(vocabulary) or '(none)'}.\n"
        "- Everyday situations: a test centre, an office, school, work, shopping, a new city, a phone call.\n"
        f"- {LEVEL_STORY_RULES.get(level, LEVEL_STORY_RULES['A1'])}\n"
        f"{wishes}"
        "- Do not copy these sentences the learner already studied: "
        f"{' | '.join(examples) or '(none)'}.\n"
        "- Each line has an English translation in very simple English (A2, everyday words).\n"
        'Output valid JSON only: {"title_en": "...", "lines": [{"speaker": "A", "fr": "...", "en": "..."}]}'
    )
    return {
        "model": ai.AGY_MODEL,
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
            lines.append(
                {
                    "speaker": speaker if speaker in STORY_SPEAKERS else "N",
                    "fr": fr,
                    "en": re.sub(r"\s+", " ", str(line.get("en") or "")).strip()[:300],
                }
            )
    if len(lines) < 4:
        return None
    return {"title_en": str(data.get("title_en") or "").strip()[:80], "lines": lines[:16]}


async def _write_stories(
    api_key: str,
    vocabulary: list[str],
    examples: list[str],
    model: str,
    count: int = 2,
    level: str = "A1",
    request: str = "",
    focus: str = "",
) -> list[dict]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    stories = []
    kinds = LEVEL_STORY_KINDS.get(level, LEVEL_STORY_KINDS["A1"])
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        for index in range(count):
            kind = kinds[index % len(kinds)]
            payload = _story_payload(vocabulary, examples, kind, model, level, request, focus)
            for attempt in range(2):
                try:
                    _, raw_text = await ai.post_chat(client, payload, headers)
                except HTTPException as exc:
                    logger.warning("Story generation failed: %s", exc.detail)
                    break
                story = _parse_story(raw_text)
                if story:
                    stories.append(story)
                    break
                logger.warning("Story output not usable (attempt %d): %r", attempt + 1, raw_text[:200])
    return stories


EPISODE_REQUEST_ADJUST = {
    "speed": {"slower", "faster", "normal"},
    "english": {"less", "more", "normal"},
}


async def _read_episode_request(api_key: str, request: str) -> dict:
    """Turn the learner's words ("too fast, more numbers") into style changes + a focus."""
    if not request.strip():
        return {}
    system = (
        "A French learner describes what they want from today's listening episode. "
        "Return JSON only: "
        '{"speed": "slower" | "faster" | "normal", "english": "less" | "more" | "normal", '
        '"focus": "the topic or skill to practise, in a few English words, or empty"}.\n'
        "speed: slower if they find it too fast or want more time; faster if too slow. "
        "english: less if they want more French / less English; more if they need more help."
    )
    payload = {
        "model": ai.AGY_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": request[:500]}],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            _, raw_text = await ai.post_chat(client, payload, headers)
        start, end = raw_text.find("{"), raw_text.rfind("}")
        data = json.loads(raw_text[start : end + 1])
    except Exception as exc:  # the request still reaches the stories as written
        logger.warning("Could not read the episode request: %s", exc)
        return {}
    adjust = {key: data.get(key) for key, allowed in EPISODE_REQUEST_ADJUST.items() if data.get(key) in allowed}
    focus = re.sub(r"\s+", " ", str(data.get("focus") or "")).strip()[:120]
    if focus:
        adjust["focus"] = focus
    return adjust


async def _generate_episode(
    user_id: int,
    episode_id: str,
    api_key: str | None,
    model: str,
    settings: dict | None = None,
    replace_id: str | None = None,
) -> None:
    settings = settings or {}
    level = settings.get("level") if settings.get("level") in episodes.LEVELS else "A1"
    minutes = settings.get("minutes") if settings.get("minutes") in episodes.LENGTHS else episodes.LENGTHS[0]
    request = str(settings.get("request") or "")
    try:
        async with _episode_lock:
            material = await run_in_threadpool(episodes.learning_material, user_id)
            if not material:
                raise ValueError("No studied sentences with an English translation yet.")
            adjust = await _read_episode_request(api_key, request) if api_key and request else {}
            style = episodes.episode_style(level, adjust)
            material = episodes.material_for_level(material, level)
            plan = episodes.episode_plan(minutes, style, len(material))
            review, buildups = await run_in_threadpool(
                episodes.pick_material, user_id, material, plan["review"], plan["buildups"]
            )
            stories = []
            if api_key:
                stories = await _write_stories(
                    api_key,
                    episodes.story_vocabulary(review),
                    [m["sentence"] for m in review[:8]],
                    model,
                    count=plan["stories"],
                    level=level,
                    request=request,
                    focus=adjust.get("focus", ""),
                )
            number = await run_in_threadpool(episodes.episode_number, user_id)
            title = episodes.clean_title(
                f"Episode {number}" + (f" · {stories[0]['title_en']}" if stories and stories[0]["title_en"] else "")
            )
            segments = episodes.build_script(number, review, buildups, stories, style)
            duration = await episodes.render(segments, episodes.episodes_dir() / episode_id, title)
            await run_in_threadpool(
                episodes.update_episode,
                episode_id,
                status="ready",
                title=title,
                duration=duration,
                sentences_json=json.dumps(list(dict.fromkeys(m["key"] for m in review + buildups))),
                settings_json=json.dumps(
                    {**settings, "level": level, "minutes": minutes, "adjust": adjust}, ensure_ascii=False
                ),
            )
            # A remake replaces the episode it was made from, once the new one is ready
            if replace_id and replace_id != episode_id:
                await run_in_threadpool(episodes.delete_episode, user_id, replace_id)
    except Exception as exc:
        logger.exception("Episode %s failed", episode_id)
        await run_in_threadpool(episodes.update_episode, episode_id, status="failed", error=str(exc)[:300])


class EpisodeRequest(BaseModel):
    level: Literal["A1", "A2", "B1", "B2"] | None = None  # None: recommended from study hours
    minutes: Literal[20, 30, 45, 60] = 20
    request: str = Field(default="", max_length=500)
    replace_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")


@router.get("/api/episodes")
def list_episodes_api(authorization: str | None = Header(default=None)):
    user_id = _require_user_id(authorization)
    hours = game.state(user_id, 0)["hours_total"]
    return {
        "episodes": episodes.list_episodes(user_id),
        "hours": hours,
        "recommended_level": (
            (coach.get_profile(user_id) or {}).get("profile", {}).get("levels", {}).get("listen", "A1")
        ).replace("A0", "A1"),
        "levels": list(episodes.LEVELS),
        "lengths": list(episodes.LENGTHS),
    }


@router.post("/api/episodes")
async def create_episode_api(
    req: EpisodeRequest | None = None,
    model: ai.TransformModel = Query(default=ai.DEFAULT_MODEL),
    authorization: str | None = Header(default=None),
):
    user_id = _require_user_id(authorization)
    req = req or EpisodeRequest()
    if user_id in _episode_users or any(
        ep.get("status") == "generating" for ep in await run_in_threadpool(episodes.list_episodes, user_id)
    ):
        raise HTTPException(
            status_code=429,
            detail={"code": "episode_busy", "message": "已有一期节目正在生成，请等它完成后再生成新的。"},
        )
    try:
        api_key = ai.upstream_key(authorization)
    except HTTPException as exc:
        if exc.status_code == 429:
            raise
        api_key = None  # no upstream key: build the episode without new stories
    rate_limit(user_id, "episode")
    if req.replace_id:
        try:
            episodes.get_episode(user_id, req.replace_id)
        except KeyError:
            raise HTTPException(status_code=404, detail={"message": "要替换的节目不存在。"})
    level = req.level or (
        (coach.get_profile(user_id) or {}).get("profile", {}).get("levels", {}).get("listen", "A1")
    ).replace("A0", "A1")
    settings = {"level": level, "minutes": req.minutes, "request": req.request.strip()}
    episode = await run_in_threadpool(episodes.create_episode, user_id, settings)
    _episode_users.add(user_id)
    task = run_in_background(_generate_episode(user_id, episode["id"], api_key, model, settings, req.replace_id))
    task.add_done_callback(lambda _t, uid=user_id: _episode_users.discard(uid))
    return episode


@router.delete("/api/episodes/{episode_id}")
def delete_episode_api(episode_id: str, authorization: str | None = Header(default=None)):
    return {"success": episodes.delete_episode(_require_user_id(authorization), episode_id)}


@router.get("/episodes/{episode_id}.{ext}")
async def episode_file(request: Request, episode_id: str, ext: str, download: bool = Query(default=False)):
    # <audio src> and download links send the same-origin HttpOnly session cookie.
    user_id = _require_user_id(request.headers.get("authorization"), request)
    if not re.fullmatch(r"[0-9a-f]{32}", episode_id) or ext not in {"mp3", "srt", "lrc"}:
        raise HTTPException(status_code=404, detail="文件不存在。")
    try:
        await run_in_threadpool(episodes.get_episode, user_id, episode_id)
    except KeyError:
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
