"""
French Audio Studio - "Listen while driving" episodes.

An episode is one MP3 (plus LRC/SRT subtitles) built from the learner's own
material, so a beginner can actually follow it hands-free:
  1. review    - studied sentences: French, English, slow French, a pause to
                 repeat aloud, French again
  2. build-up  - a long sentence grown step by step
  3. stories   - short dialogues/stories an LLM writes with known words
                 (first with English, then French only)
  4. French only - the review sentences again without translation
French lines alternate France and Canada voices; English is simple.
"""

from __future__ import annotations

import asyncio
import datetime
import hashlib
import io
import json
import re
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import av
import edge_tts
import numpy as np

import auth_db
import srs

SAMPLE_RATE = 24000
FR_VOICES = ("fr-FR-DeniseNeural", "fr-CA-JeanNeural", "fr-FR-HenriNeural", "fr-CA-SylvieNeural")
STORY_VOICES = {"A": "fr-FR-DeniseNeural", "B": "fr-CA-JeanNeural", "N": "fr-CA-SylvieNeural"}
EN_VOICE = "en-US-AvaNeural"
SLOW_RATE = "-30%"
REVIEW_COUNT = 14
BUILDUP_COUNT = 2
SHADOW_MAX_WORDS = 14
STALE_AFTER = datetime.timedelta(minutes=30)
TTS_CONCURRENCY = 4


@dataclass
class Segment:
    text: str
    voice: str
    rate: str = "+0%"
    pause_after: float = 0.8
    subtitle: str = ""      # shown in LRC/SRT; defaults to text
    shadow: bool = False    # pause long enough to repeat the line aloud


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
def _db() -> sqlite3.Connection:
    auth_db.init_db()
    conn = sqlite3.connect(auth_db._get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS episodes (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            duration REAL NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '',
            sentences_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        )
        """
    )
    return conn


def episodes_dir() -> Path:
    path = auth_db._get_db_path().parent / "episodes"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def create_episode(user_id: int) -> dict[str, Any]:
    episode_id = uuid.uuid4().hex
    with _db() as conn:
        conn.execute(
            "INSERT INTO episodes (id, user_id, status, created_at) VALUES (?, ?, 'generating', ?)",
            (episode_id, user_id, _now().isoformat()),
        )
    return get_episode(user_id, episode_id)


def update_episode(episode_id: str, **fields: Any) -> None:
    allowed = {"title", "status", "duration", "error", "sentences_json"}
    sets = {key: value for key, value in fields.items() if key in allowed}
    if not sets:
        return
    with _db() as conn:
        conn.execute(
            f"UPDATE episodes SET {', '.join(f'{key} = ?' for key in sets)} WHERE id = ?",
            (*sets.values(), episode_id),
        )


def _row_payload(row: sqlite3.Row) -> dict[str, Any]:
    status = row["status"]
    if status == "generating" and _now() - datetime.datetime.fromisoformat(row["created_at"]) > STALE_AFTER:
        status = "failed"  # the job died (e.g. service restart)
    return {
        "id": row["id"],
        "title": row["title"],
        "status": status,
        "duration": row["duration"],
        "error": row["error"],
        "created_at": row["created_at"],
    }


def get_episode(user_id: int, episode_id: str) -> dict[str, Any]:
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM episodes WHERE id = ? AND user_id = ?", (episode_id, user_id)
        ).fetchone()
    if not row:
        raise KeyError(episode_id)
    return _row_payload(row)


def list_episodes(user_id: int) -> list[dict[str, Any]]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM episodes WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [_row_payload(row) for row in rows]


def delete_episode(user_id: int, episode_id: str) -> bool:
    with _db() as conn:
        deleted = conn.execute(
            "DELETE FROM episodes WHERE id = ? AND user_id = ?", (episode_id, user_id)
        ).rowcount
    if deleted:
        for ext in ("mp3", "srt", "lrc"):
            (episodes_dir() / f"{episode_id}.{ext}").unlink(missing_ok=True)
    return bool(deleted)


def _sentence_usage(user_id: int) -> dict[str, int]:
    usage: dict[str, int] = {}
    with _db() as conn:
        for (raw,) in conn.execute(
            "SELECT sentences_json FROM episodes WHERE user_id = ? AND status = 'ready'", (user_id,)
        ):
            for key in json.loads(raw or "[]"):
                usage[key] = usage.get(key, 0) + 1
    return usage


# ---------------------------------------------------------------------------
# Material: what the learner has studied
# ---------------------------------------------------------------------------
def learning_material(user_id: int) -> list[dict[str, Any]]:
    """Merge saved review notes and analysed sentences into one list keyed by sentence."""
    items: dict[str, dict[str, Any]] = {}

    def entry(sentence: str) -> dict[str, Any]:
        key = srs.sentence_key(sentence)
        return items.setdefault(key, {
            "key": key, "sentence": sentence.strip(), "en": "", "build_up": [], "words": [], "in_deck": False,
        })

    with sqlite3.connect(auth_db._get_db_path()) as conn:
        history = conn.execute(
            "SELECT payload_json FROM history_records WHERE user_id = ? AND record_type = 'study' "
            "ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    for (raw,) in history:
        for s in json.loads(raw or "{}").get("sentences", []):
            sentence = str(s.get("sentence") or s.get("original") or "").strip()
            if not sentence:
                continue
            item = entry(sentence)
            item["en"] = item["en"] or str(s.get("translation_en") or "").strip()
            if not item["build_up"]:
                item["build_up"] = [
                    {"fr": str(b.get("fr") or "").strip(), "en": str(b.get("en") or "").strip()}
                    for b in s.get("build_up") or [] if b.get("fr")
                ]
            for w in s.get("words") or []:
                word = str(w.get("fr") or w.get("token") or "").strip()
                if len(word) > 3 and word not in item["words"]:
                    item["words"].append(word)

    srs.init_db()
    with sqlite3.connect(auth_db._get_db_path()) as conn:
        notes = conn.execute(
            "SELECT id, sentence, translation_en FROM srs_notes WHERE user_id = ?", (user_id,)
        ).fetchall()
        targets = conn.execute(
            "SELECT note_id, target FROM srs_cards WHERE user_id = ? AND target != ''", (user_id,)
        ).fetchall()
    note_targets: dict[str, list[str]] = {}
    for note_id, target in targets:
        note_targets.setdefault(note_id, []).append(target)
    for note_id, sentence, translation_en in notes:
        item = entry(sentence)
        item["in_deck"] = True
        item["en"] = item["en"] or (translation_en or "").strip()
        for target in note_targets.get(note_id, []):
            if target not in item["words"]:
                item["words"].insert(0, target)

    # Only material with an English translation can be played with its meaning
    return [item for item in items.values() if item["en"]]


def pick_material(user_id: int, material: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    """Least-played first; saved-to-review and real sentences (4+ words) before headings."""
    usage = _sentence_usage(user_id)
    ranked = sorted(
        material,
        key=lambda m: (usage.get(m["key"], 0), not m["in_deck"], len(m["sentence"].split()) < 4),
    )
    review = ranked[:REVIEW_COUNT]
    buildups = sorted(
        (m for m in material if len(m["build_up"]) >= 3),
        key=lambda m: usage.get(m["key"], 0),
    )[:BUILDUP_COUNT]
    return review, buildups


def story_vocabulary(review: list[dict[str, Any]], limit: int = 30) -> list[str]:
    words: list[str] = []
    for item in review:
        for word in item["words"]:
            if word.lower() not in (w.lower() for w in words):
                words.append(word)
    return words[:limit]


# ---------------------------------------------------------------------------
# Script: the ordered list of things to say
# ---------------------------------------------------------------------------
def build_script(
    number: int,
    review: list[dict[str, Any]],
    buildups: list[dict[str, Any]],
    stories: list[dict[str, Any]],
) -> list[Segment]:
    s: list[Segment] = []

    def fr(text: str, en: str, voice: str, **kw: Any) -> Segment:
        return Segment(text, voice, subtitle=f"{text}\n{en}" if en else text, **kw)

    def say_en(text: str, pause: float = 1.0) -> None:
        s.append(Segment(text, EN_VOICE, pause_after=pause))

    say_en(f"French listening, episode {number}. Listen, and repeat out loud when there is a pause.", 1.5)

    if review:
        say_en("Part one. Sentences you studied.", 1.2)
        for index, item in enumerate(review):
            voice = FR_VOICES[index % len(FR_VOICES)]
            s.append(fr(item["sentence"], item["en"], voice, pause_after=0.9))
            s.append(Segment(item["en"], EN_VOICE, pause_after=0.8))
            # Repeating aloud only works for short sentences; long ones are practised in part two
            repeatable = len(item["sentence"].split()) <= SHADOW_MAX_WORDS
            s.append(fr(item["sentence"], item["en"], voice, rate=SLOW_RATE, shadow=repeatable, pause_after=1.5))
            s.append(fr(item["sentence"], item["en"], voice, pause_after=2.0))

    if buildups:
        say_en("Part two. We build long sentences, step by step.", 1.2)
        for index, item in enumerate(buildups):
            voice = FR_VOICES[(index + 1) % len(FR_VOICES)]
            for step in item["build_up"]:
                s.append(fr(step["fr"], step["en"], voice, pause_after=0.8))
                if step["en"]:
                    s.append(Segment(step["en"], EN_VOICE, pause_after=0.8))
                s.append(fr(step["fr"], step["en"], voice, shadow=True))
            s[-1].pause_after = 2.0

    for index, story in enumerate(stories):
        lines = story.get("lines") or []
        if not lines:
            continue
        label = "Part three" if index == 0 else "Next"
        say_en(f"{label}. A short story: {story.get('title_en') or 'a new story'}. First with English.", 1.2)
        for line in lines:
            voice = STORY_VOICES.get(line.get("speaker"), STORY_VOICES["N"])
            s.append(fr(line["fr"], line.get("en", ""), voice, pause_after=0.7))
            if line.get("en"):
                s.append(Segment(line["en"], EN_VOICE, pause_after=1.1))
        say_en("Now listen again, in French only.", 1.2)
        for line in lines:
            voice = STORY_VOICES.get(line.get("speaker"), STORY_VOICES["N"])
            s.append(fr(line["fr"], line.get("en", ""), voice, pause_after=0.6))
        s[-1].pause_after = 2.0

    if review:
        say_en("Last part. French only. Just listen.", 1.2)
        for index, item in enumerate(review):
            s.append(fr(item["sentence"], item["en"], FR_VOICES[(index + 2) % len(FR_VOICES)], pause_after=1.4))

    say_en("Well done. See you next time.", 1.0)
    return s


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------
def _decode_to_pcm(data: bytes) -> np.ndarray:
    container = av.open(io.BytesIO(data))
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    chunks = [
        frame.to_ndarray().reshape(-1)
        for decoded in container.decode(audio=0)
        for frame in resampler.resample(decoded)
    ]
    return np.concatenate(chunks) if chunks else np.zeros(0, np.int16)


async def synthesize(text: str, voice: str, rate: str = "+0%") -> np.ndarray:
    """Speech as 24 kHz mono int16, cached on disk by (voice, rate, text)."""
    cache_dir = episodes_dir() / "cache"
    cache_dir.mkdir(exist_ok=True)
    digest = hashlib.sha256(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()[:24]
    path = cache_dir / f"{digest}.mp3"
    if not path.exists():
        audio = bytearray()
        async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
            if chunk["type"] == "audio":
                audio += chunk["data"]
        tmp = path.with_suffix(f".{uuid.uuid4().hex[:6]}.part")
        tmp.write_bytes(bytes(audio))
        tmp.replace(path)
    return _decode_to_pcm(path.read_bytes())


def _timestamp_srt(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def _timestamp_lrc(seconds: float) -> str:
    centis = int(round(seconds * 100))
    return f"[{centis // 6000:02}:{centis // 100 % 60:02}.{centis % 100:02}]"


def subtitles(cues: list[tuple[float, float, str]], title: str) -> tuple[str, str]:
    srt = "\n".join(
        f"{index}\n{_timestamp_srt(start)} --> {_timestamp_srt(end)}\n{text}\n"
        for index, (start, end, text) in enumerate(cues, 1)
    )
    lrc_lines = [f"[ti:{title}]"] + [
        f"{_timestamp_lrc(start)}{text.replace(chr(10), ' / ')}" for start, _, text in cues
    ]
    return srt, "\n".join(lrc_lines) + "\n"


async def render(
    segments: list[Segment],
    out_base: Path,
    title: str,
    synth: Callable[[str, str, str], Awaitable[np.ndarray]] | None = None,
) -> float:
    """Synthesize every segment, join them with pauses, write MP3 + SRT + LRC. Returns seconds."""
    synth = synth or synthesize
    semaphore = asyncio.Semaphore(TTS_CONCURRENCY)
    unique = {(seg.text, seg.voice, seg.rate) for seg in segments}

    async def one(key: tuple[str, str, str]) -> tuple[tuple[str, str, str], np.ndarray]:
        async with semaphore:
            return key, await synth(*key)

    audio = dict(await asyncio.gather(*(one(key) for key in unique)))
    # Joining ~20 minutes of audio and MP3 encoding is CPU work: keep it off the event loop
    return await asyncio.to_thread(_assemble, segments, audio, out_base, title)


def _assemble(
    segments: list[Segment],
    audio: dict[tuple[str, str, str], np.ndarray],
    out_base: Path,
    title: str,
) -> float:
    pieces: list[np.ndarray] = []
    cues: list[tuple[float, float, str]] = []
    position = 0
    for seg in segments:
        pcm = audio[(seg.text, seg.voice, seg.rate)]
        start = position / SAMPLE_RATE
        pieces.append(pcm)
        position += len(pcm)
        cues.append((start, position / SAMPLE_RATE, seg.subtitle or seg.text))
        pause = (len(pcm) / SAMPLE_RATE) * 1.1 + 1.0 if seg.shadow else seg.pause_after
        silence = np.zeros(int(pause * SAMPLE_RATE), np.int16)
        pieces.append(silence)
        position += len(silence)
    pcm = np.concatenate(pieces) if pieces else np.zeros(SAMPLE_RATE, np.int16)

    out = io.BytesIO()
    container = av.open(out, "w", format="mp3")
    stream = container.add_stream("libmp3lame", rate=SAMPLE_RATE)
    stream.layout = "mono"
    stream.bit_rate = 64000
    frame = av.AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
    frame.rate = SAMPLE_RATE
    for packet in stream.encode(frame):
        container.mux(packet)
    for packet in stream.encode(None):
        container.mux(packet)
    container.close()

    srt, lrc = subtitles(cues, title)
    for ext, data in (("mp3", out.getvalue()), ("srt", srt.encode("utf-8")), ("lrc", lrc.encode("utf-8"))):
        tmp = out_base.with_suffix(f".{ext}.part")
        tmp.write_bytes(data)
        tmp.replace(out_base.with_suffix(f".{ext}"))
    return round(len(pcm) / SAMPLE_RATE, 1)


def episode_number(user_id: int) -> int:
    with _db() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM episodes WHERE user_id = ? AND status = 'ready'", (user_id,)
        ).fetchone()[0] + 1


def clean_title(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:120]
