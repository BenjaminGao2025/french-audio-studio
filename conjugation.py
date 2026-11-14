"""Verb conjugation tables for the word card, from a read-only index built by scripts/build_conjugation.py.
Simple tenses come from the index; compound tenses are the auxiliary plus the past participle.
Never raises and never calls a model: a missing or broken index only hides the table.
"""
from __future__ import annotations

import copy
import functools
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

from offline_dictionary import canonical_pos, index_path, normalize

SCHEMA_VERSION = 1
ENV = "CONJUGATION_PATH"

# Display order. Written-only tenses come last and are marked as such.
TENSES = [
    ("present", "Présent"), ("passe_compose", "Passé composé"), ("imperfect", "Imparfait"),
    ("plus_que_parfait", "Plus-que-parfait"), ("future", "Futur simple"), ("conditional", "Conditionnel présent"),
    ("subj_present", "Subjonctif présent"), ("imperative", "Impératif"), ("simple_past", "Passé simple"),
    ("subj_imperfect", "Subjonctif imparfait"),
]
WRITTEN = {"simple_past", "subj_imperfect"}
# Which reading of an ambiguous form to open on: laisse is first a present, then a subjunctive.
FOCUS_ORDER = ["present", "imperfect", "future", "conditional", "subj_present", "imperative",
               "simple_past", "subj_imperfect"]
COMPOUND = {"passe_compose": "present", "plus_que_parfait": "imperfect"}
PRONOUN = {1: "je", 2: "tu", 3: "il", 4: "nous", 5: "vous", 6: "ils"}
VOWELS = tuple("aàâäeéèêëiîïoôöuùûüyœæ")
# h aspiré: je hais, not j'hais.
ASPIRATED = {"haïr", "hacher", "haleter", "hanter", "harceler", "hasarder", "hâter", "hausser", "héler",
             "hennir", "hérisser", "heurter", "hisser", "honnir", "hurler", "huer", "hiérarchiser"}


# j'ai, n'a, qu'il → the verb; avez-vous, a-t-il, dis-moi → the verb before the inverted pronoun.
CLITIC = re.compile(r"^(?:j|n|m|t|s|l|c|qu)'")
INVERTED = re.compile(r"(?:-t)?-(?:je|tu|il|elle|on|nous|vous|ils|elles|moi|toi|le|la|les|lui|leur|y|en)$")


# The sentence analysis labels words in plain English ("action word form", "naming word"); older
# results and the dictionary use "verb", "AUX", "noun". Only a clearly non-verb label hides the table.
NOT_VERB = ("naming word", "describing word", "pointer word", "linking word", "noun", "adj", "adv", "pron",
            "det", "article", "prep", "conj", "intj")


def _verb_hint(pos):
    p = canonical_pos(pos)
    if "action word" in p or ("verb" in p and "adverb" not in p):
        return True
    return not any(k in p for k in NOT_VERB)


def _elides(word, lemma):
    return word.startswith(VOWELS) or (word.startswith("h") and lemma not in ASPIRATED)


def _pronoun(person, tense, word, lemma):
    if tense == "imperative":
        return ""
    base = PRONOUN[person]
    if person == 1 and _elides(word, lemma):
        base = "j'"
    if tense.startswith("subj"):
        return "qu'" + base if base.startswith("il") else "que " + base
    return base


def _join(pronoun, form):
    return pronoun + form if pronoun.endswith("'") else f"{pronoun} {form}".strip()


def conjugation(word: str, pos: str = "", lemma: str = ""):
    """The conjugation of a clicked verb form, or None when it is not a known verb form."""
    word = INVERTED.sub("", CLITIC.sub("", normalize(word)))
    if not word or len(word) > 40 or " " in word or (pos and not _verb_hint(pos)):
        return None
    p = index_path(ENV)
    if not p:
        return None
    try:
        st = p.stat()
        return copy.deepcopy(_conjugate(str(p), st.st_ino, st.st_mtime_ns, st.st_size, word, normalize(lemma or "")))
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError):
        return None


@functools.lru_cache(maxsize=1024)
def _conjugate(path, inode, mtime, size, word, lemma_hint):
    with closing(sqlite3.connect(Path(path).as_uri() + "?mode=ro&immutable=1", uri=True)) as conn:
        conn.execute("PRAGMA query_only=ON")
        if int(dict(conn.execute("SELECT key,value FROM metadata"))["schema_version"]) != SCHEMA_VERSION:
            raise ValueError("Unsupported conjugation index schema")
        hits = conn.execute("SELECT f.lemma,f.tense,f.person,v.frequency FROM forms f JOIN verbs v USING(lemma) "
                            "WHERE f.form=? LIMIT 64", (word,)).fetchall()
        if not hits:
            # allée / allés / allées are agreed past participles; the index holds only allé.
            stems = [word[:-2]] if word.endswith("es") else [word[:-1]] if word.endswith(("e", "s")) else []
            hits = [h for stem in stems for h in conn.execute(
                "SELECT f.lemma,f.tense,f.person,v.frequency FROM forms f JOIN verbs v USING(lemma) "
                "WHERE f.form=? AND f.tense='pp' LIMIT 16", (stem,))]
        if not hits:
            return None
        freq = {lemma: f for lemma, _, _, f in hits}
        lemma = lemma_hint if lemma_hint in freq else max(freq, key=lambda x: (freq[x], x == word))
        aux = conn.execute("SELECT aux FROM verbs WHERE lemma=?", (lemma,)).fetchone()[0]

        def table(verb):
            cells = {}
            for t, n, f, i in conn.execute(
                    "SELECT tense,person,form,ipa FROM forms WHERE lemma=? ORDER BY rank", (verb,)):
                cells.setdefault((t, n), []).append((f, i))
            return cells

        own = table(lemma)
        helpers = {v: table(v) for v in ({"avoir", "être"} if aux == "both" else {aux})}
    matches = [(t, n) for lem, t, n, _ in hits if lem == lemma]
    pp = own.get(("pp", 0), [("", "")])[0][0]
    primary = "avoir" if aux == "both" else aux
    tenses = []
    for key, label in TENSES:
        cells = []
        for person in range(1, 7):
            if key in COMPOUND:
                helper = helpers[primary].get((COMPOUND[key], person), [None])[0]
                if not helper or not pp:
                    continue
                agree = pp if primary == "avoir" else pp + ("(e)" if person <= 3 else "(e)s")
                said = pp if primary == "avoir" or person <= 3 or pp.endswith(("s", "x")) else pp + "s"
                pron = _pronoun(person, key, helper[0], primary)
                cells.append(dict(person=person, pronoun=pron, form=f"{helper[0]} {agree}",
                                  say=_join(pron, f"{helper[0]} {said}"), ipa="", current=False))
                continue
            found = own.get((key, person))
            if not found:
                continue
            # paie / paye: both spellings, the clicked one read aloud.
            spoken = next((f for f, _ in found if f == word), found[0][0])
            pron = _pronoun(person, key, found[0][0], lemma)
            cells.append(dict(person=person, pronoun=pron, form=" / ".join(f for f, _ in found),
                              say=_join(pron, spoken), ipa=found[0][1], current=(key, person) in matches))
        if cells:
            tenses.append(dict(key=key, label=label, written=key in WRITTEN, cells=cells))
    if not tenses:
        return None
    present = {t for t, _ in matches}
    focus = next((t for t in FOCUS_ORDER if t in present), "")
    role = {"pp": "past participle", "ppr": "present participle", "infinitive": "infinitive"}
    result = dict(lemma=lemma, aux=aux, focus=focus, role=next((role[t] for t in role if t in present), ""),
                  participles=dict(present=own.get(("ppr", 0), [("", "")])[0][0], past=pp), tenses=tenses,
                  source_url=f"https://en.wiktionary.org/wiki/{quote(lemma)}#French")
    if aux == "both":
        helper = helpers["être"].get(("present", 1), [None])[0]
        if helper and pp:
            result["also"] = f"{_join(_pronoun(1, 'present', helper[0], 'être'), helper[0])} {pp}(e)"
    return result
