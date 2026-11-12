"""Read-only French and English-gloss corpus lookup. Dataset licensing is independent of application code."""

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
SELECTION_VERSION = 6


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


def index_path(env="FRENCH_DICTIONARY_PATH"):
    value = os.getenv(env, "")
    if not value:
        return None
    p = Path(value)
    # Operator configuration only, never request input. Refuse symlinks in every component.
    if not p.is_absolute() or any(x.is_symlink() for x in (p, *p.parents)) or not p.is_file():
        return None
    return p


def _read(p, word, surface, pos):
    try:
        st = p.stat()
        return copy.deepcopy(_lookup(str(p), st.st_ino, st.st_mtime_ns, st.st_size, word, surface, pos))
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as exc:
        raise DictionaryUnavailable("Dictionary index is unavailable") from exc


def related_candidates(word):
    """Conservative, bounded spelling rules; these are related words, never definitions."""
    candidates = []
    for prefix in ("re-", "ré-", "dé-", "in-", "im-", "re", "ré", "dé", "in", "im"):
        if word.startswith(prefix) and len(word) - len(prefix) >= 4:
            candidates.append(word[len(prefix):])
    for suffix, replacement in (("s", ""), ("aux", "al"), ("ées", "er"), ("és", "er"),
                                ("ée", "er"), ("é", "er"), ("ement", ""), ("ments", "")):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            candidates.append(word[:-len(suffix)] + replacement)
    return list(dict.fromkeys(candidates))


# Grammatical expansions only; lexical definitions still come from the existing indexes.
ELISIONS = {
    "l": ("le / la", "definite article or object pronoun, elided before a vowel or silent h"),
    "d": ("de", "preposition, elided before a vowel or silent h"),
    "j": ("je", "subject pronoun, elided before a vowel or silent h"),
    "n": ("ne", "negation particle, elided before a vowel or silent h"),
    "m": ("me", "object/reflexive pronoun, elided before a vowel or silent h"),
    "t": ("te", "object/reflexive pronoun, elided before a vowel or silent h"),
    "s": ("se", "reflexive pronoun, elided before a vowel or silent h"),
    "c": ("ce", "demonstrative pronoun, elided before a vowel"),
    "qu": ("que", "conjunction or relative/interrogative pronoun, elided before a vowel"),
    "jusqu": ("jusque", "preposition, elided before a vowel"),
    "lorsqu": ("lorsque", "conjunction, elided before a vowel"),
    "puisqu": ("puisque", "conjunction, elided before a vowel"),
}


STOPWORDS = set("le la les un une des de du à au aux et ou en pour par sur ce ces se ne pas l d".split())


def canonical_pos(pos):
    value = POS.get(pos, pos).strip().lower()
    return {"determiner": "det", "déterminant": "det", "déterminant possessif": "det",
            "adjective": "adj", "verb": "verb", "noun": "noun"}.get(value, value)


def entry_rank(entry, surface, pos):
    # Case selection precedes POS; an uppercase abbreviation is a fallback for lowercase input.
    lemma = unicodedata.normalize("NFC", entry["lemma"]).replace("’", "'")
    case_matches = (lemma == surface or (lemma.islower() and surface.islower())
                    or (lemma.isupper() and surface.isupper()) or (lemma.istitle() and surface.istitle()))
    return (not case_matches, bool(pos) and canonical_pos(entry["pos"]) != canonical_pos(pos))


def lookup(word: str, pos: str = ""):
    """Rank surface case and sentence POS before corpus preference; never select with AI."""
    surface = " ".join(unicodedata.normalize("NFC", word).replace("’", "'").replace("ʼ", "'").split())
    word = normalize(word)
    if not word or len(word) > 200:
        return None
    paths = {lang: index_path(env) for lang, env in
             (("en", "ENGLISH_DICTIONARY_PATH"), ("fr", "FRENCH_DICTIONARY_PATH"))}
    if not any(paths.values()):
        raise DictionaryUnavailable("Dictionary index is not configured")

    def exact(token):
        results = {lang: _read(path, token, surface if token == word else token, pos) if path else None for lang, path in paths.items()}
        if not any(results.values()):
            return None
        # A lemma supplied by either corpus can provide the other corpus's senses.
        for lang, result in list(results.items()):
            if result:
                other = "fr" if lang == "en" else "en"
                if paths[other] and not results[other]:
                    results[other] = _read(paths[other], normalize(result["lemma"]), surface, pos)
        result = copy.deepcopy(results["en"] or results["fr"])
        result["token"] = token
        for lang in ("en", "fr"):
            result["entries_" + lang] = [dict(e, language=lang) for e in
                                               (results[lang] or {}).get("entries", [])]
        result["entries"] = sorted(result["entries_en"] + result["entries_fr"],
                                   key=lambda e: entry_rank(e, surface if token == word else token, pos))
        if any(e["lemma"].replace("’", "'") == surface for e in result["entries"]):
            for lang in ("en", "fr"):
                result["entries_" + lang] = [e for e in result["entries_" + lang]
                    if normalize(e["lemma"]) != word or e["lemma"].replace("’", "'") == surface]
            result["entries"] = [e for e in result["entries"]
                if normalize(e["lemma"]) != word or e["lemma"].replace("’", "'") == surface]
        first = result["entries"][0]
        result["phonetic"] = results[first["language"]]["phonetic"]
        for field in ("lemma", "pos", "gender"):
            result[field] = first[field]
        result["attribution"] = " ".join(r["attribution"] for r in results.values() if r)
        result["datasets"] = {lang: r["dataset"] for lang, r in results.items() if r}
        result["match_type"] = "exact"
        return result

    def resolve(token):
        result = exact(token)
        if result:
            return result
        prefix, apostrophe, remainder = token.partition("'")
        if apostrophe and prefix in ELISIONS and remainder and " " not in remainder:
            result = exact(remainder)
            if not result:
                for candidate in related_candidates(remainder):
                    result = exact(candidate)
                    if result:
                        result.update(match_type="related", related=result["lemma"], phonetic="")
                        break
            if result:
                expansion, note = ELISIONS[prefix]
                # With a noun, the index supplies the gender of the definite article.
                if prefix == "l" and result["pos"] == "noun":
                    gender = result.get("gender", "")
                    if gender in ("m", "masculine", "f", "feminine"):
                        masculine = gender in ("m", "masculine")
                        expansion = "le" if masculine else "la"
                        note = ("masculine" if masculine else "feminine") + " definite article, elided before a vowel or silent h"
                result.update(token=token, elision=dict(prefix=token[:len(prefix) + 1],
                              expansion=expansion, note=note, remainder=remainder))
                return result
        for candidate in related_candidates(token):
            result = exact(candidate)
            if result:
                result.update(token=token, match_type="related", related=result["lemma"], phonetic="")
                return result
        return None

    result = resolve(word)
    if result or " " not in word:
        if result and result.get("elision"):
            result["token"] = surface
            result["elision"]["prefix"] = surface[:len(result["elision"]["prefix"])]
        return result
    parts = []
    for token in dict.fromkeys(re.findall(r"[^\W_]+(?:['-][^\W_]+)*", word, re.UNICODE)[:32]):
        part = resolve(token)
        if part:
            parts.append(part)
        elif token not in STOPWORDS:
            parts.append(dict(token=token, lemma=token, pos="", phonetic="", explanation_cn="",
                              explanation_en="", entries=[], entries_en=[], entries_fr=[], dictionary_state="not_found"))
    if not any(p["entries"] for p in parts):
        return None
    result = copy.deepcopy(next(p for p in parts if p["entries"]))
    result.update(token=word, lemma=word, phonetic="", match_type="components", components=parts,
                  entries=[], entries_en=[], entries_fr=[])
    result.pop("related", None)
    return result


@functools.lru_cache(maxsize=2048)
def _lookup(path, inode, mtime, size, word, surface, pos):
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
            if len({e["lemma"] for e in direct}) > 1 or not json.loads(entry["form_of"]) or any(
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
        candidates.sort(key=lambda x: (*entry_rank(x[0], surface, pos), -float(x[1].get("frequency", 0)), bool(json.loads(x[0]["form_of"])), x[0]["id"]))
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
        language = meta.get("gloss_language", "fr")
        if language == "en":
            for entry in entries:
                entry["source_url"] = "https://en.wiktionary.org/wiki/" + quote(entry["lemma"], safe="") + "#French"
                entry["history_url"] = "https://en.wiktionary.org/w/index.php?title=" + quote(entry["lemma"], safe="") + "&action=history"
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
            source_language=language,
            source_name="English Wiktionary" if language == "en" else "Wiktionnaire",
            attribution=("English Wiktionary contributors; extracted by Tatu Ylonen / Kaikki." if language == "en" else
                         "Wiktionnaire contributors; extracted by Tatu Ylonen / Kaikki. Lexique 3.83 by Boris New, Christophe Pallier and contributors."),
            changes="French-only selection, bounded source senses and normalized search; French monolingual entries use Lexique metadata. Definitions are not AI-generated or translated.",
            entries=entries,
            dataset=meta["dataset"],
            license_url=LICENSE_URL,
            selection_version=SELECTION_VERSION,
        )
        return result
