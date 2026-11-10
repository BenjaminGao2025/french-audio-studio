"""Read-only French corpus lookup. Dataset licensing is independent of application code."""

from __future__ import annotations

import copy
import functools
import hashlib
import json
import os
import re
import sqlite3
import unicodedata
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

SCHEMA_VERSION = 1
SELECTION_VERSION = 3


class DictionaryUnavailable(Exception):
    """The configured source index cannot be read."""


LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
POS = {
    "NOM": "noun",
    "VER": "verb",
    "AUX": "verb",
    "ADJ": "adj",
    "ADV": "adv",
    "PRE": "prep",
    "PRO:per": "pron",
    "PRO:pos": "pron",
    "ADJ:pos": "det",
    "ART:def": "article",
    "ART:ind": "article",
    "CON": "conj",
    "ONO": "intj",
}


def normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).replace("’", "'").replace("ʼ", "'").lower().split())


def text(value, limit=600):
    return re.sub(r"[\x00-\x1f\x7f<>]", "", value if isinstance(value, str) else "").strip()[:limit]


def fingerprint(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def index_path():
    value = os.getenv("FRENCH_DICTIONARY_PATH", "")
    if not value:
        return None
    p = Path(value)
    # Operator configuration only, never request input. Refuse symlinks in every component.
    if not p.is_absolute() or any(x.is_symlink() for x in (p, *p.parents)) or not p.is_file():
        return None
    return p


def lookup(word: str):
    """Bounded per-process positive/negative cache, invalidated by an atomic index replacement."""
    word = normalize(word)
    p = index_path()
    if p is None:
        raise DictionaryUnavailable("Dictionary index is not configured")
    try:
        st = p.stat()
        return copy.deepcopy(_lookup(str(p), st.st_ino, st.st_mtime_ns, st.st_size, normalize(word)))
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as exc:
        raise DictionaryUnavailable("Dictionary index is unavailable") from exc


@functools.lru_cache(maxsize=2048)
def _lookup(path, inode, mtime, size, word):
    if not word or len(word) > 200:
        return None
    with closing(sqlite3.connect(Path(path).as_uri() + "?mode=ro&immutable=1", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA cache_size=-2048")
        conn.execute("PRAGMA query_only=ON")
        meta = dict(conn.execute("SELECT key,value FROM metadata"))
        if int(meta["schema_version"]) != SCHEMA_VERSION:
            raise ValueError("Unsupported dictionary index schema")
        lex = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM lexique WHERE word=? ORDER BY frequency DESC,lemma,pos LIMIT 12", (word,)
            )
        ]
        candidates = []
        for row in lex:
            for entry in conn.execute("SELECT * FROM entries WHERE word=? LIMIT 24", (normalize(row["lemma"]),)):
                if POS.get(row["pos"], row["pos"]) == entry["pos"]:
                    candidates.append((dict(entry), row))
        direct = [dict(r) for r in conn.execute("SELECT * FROM entries WHERE word=? LIMIT 24", (word,))]
        # A direct non-inflected entry remains available, even when Lexique does not contain it.
        for entry in direct:
            if not json.loads(entry["form_of"]) or any(
                POS.get(r["pos"], r["pos"]) == entry["pos"] and normalize(r["lemma"]) == word for r in lex
            ):
                candidates.append((entry, next((r for r in lex if POS.get(r["pos"], r["pos"]) == entry["pos"]), {})))
        if not candidates:
            for entry in direct:
                for lemma in json.loads(entry["form_of"]):
                    lemma = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), lemma)
                    for base in conn.execute(
                        "SELECT * FROM entries WHERE word=? AND pos=? LIMIT 6", (normalize(lemma), entry["pos"])
                    ):
                        candidates.append((dict(base), {}))
            if not candidates:
                candidates = [(e, {}) for e in direct]
        # Lexique frequency ranks POS, never sentence meaning. Preserve multiple plausible entries.
        candidates.sort(key=lambda x: (-float(x[1].get("frequency", 0)), bool(json.loads(x[0]["form_of"])), x[0]["id"]))
        entries = []
        seen = set()
        for entry, form in candidates:
            if entry["id"] in seen:
                continue
            seen.add(entry["id"])
            all_senses = json.loads(entry["senses"])
            senses = [text(s) for s in all_senses[:6] if isinstance(s, str) and text(s)]
            if not senses:
                continue
            entries.append(
                dict(
                    lemma=entry["lemma"],
                    pos=entry["pos"],
                    pos_title=entry["pos_title"],
                    gender=form.get("gender") or entry["gender"],
                    number=form.get("number", ""),
                    phonetic=entry["ipa"].strip("\\/[]"),
                    senses=senses,
                    form_info=form.get("info", "") if word != normalize(entry["lemma"]) else "",
                    frequency=form.get("frequency", 0),
                    source_url="https://fr.wiktionary.org/wiki/" + quote(entry["lemma"], safe="") + "#fr",
                    history_url="https://fr.wiktionary.org/w/index.php?title="
                    + quote(entry["lemma"], safe="")
                    + "&action=history",
                )
            )
            if len(entries) == 3:
                break
        if not entries:
            return None
        first = entries[0]
        result = dict(
            token=word,
            lemma=first["lemma"],
            pos=first["pos"],
            gender=first["gender"],
            # IPA belongs to the clicked form, not its base lemma (avons != avoir).
            phonetic=next(
                (e["ipa"].strip("\\/[]") for e in direct if e["ipa"] and e["pos"] == first["pos"]),
                first["phonetic"] if normalize(first["lemma"]) == word else "",
            ),
            explanation_cn="",
            explanation_en="",
            dictionary_source="wiktionnaire",
            dictionary_state="found",
            source_language="fr",
            source_name="Wiktionnaire",
            attribution="Wiktionnaire contributors; extracted by Tatu Ylonen / Kaikki. Lexique 3.83 by Boris New, Christophe Pallier and contributors.",
            changes="French-only selection, normalized search and Lexique metadata; definitions are not AI-generated or translated.",
            entries=entries,
            dataset=meta["dataset"],
            license_url=LICENSE_URL,
            selection_version=SELECTION_VERSION,
        )
        return result
