"""Build a read-only French verb conjugation index from official Kaikki JSONL (English Wiktionary).
Simple tenses and participles come from each verb's conjugation table; compound tenses are built at
runtime from the auxiliary. Lexique supplies lemma frequency (suis -> être before suivre) and a
coverage cross-check. Inputs and output must be outside the repository. No downloads.
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from conjugation import SCHEMA_VERSION
from offline_dictionary import LICENSE_URL, fingerprint, normalize
from scripts.build_french_dictionary import MAX_LINE, sha

SOURCE_URL = "https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl"
FORM = re.compile(r"^[a-zàâäçéèêëîïôöùûüÿœæ'-]{1,40}$")
PERSON = {("first-person", "singular"): 1, ("second-person", "singular"): 2, ("third-person", "singular"): 3,
          ("first-person", "plural"): 4, ("second-person", "plural"): 5, ("third-person", "plural"): 6}


def tense_of(tags):
    t = set(tags)
    if "infinitive" in t:
        return "infinitive"
    if "participle" in t:
        return "ppr" if "present" in t else "pp" if "past" in t else None
    if "imperative" in t:
        return "imperative"
    if "subjunctive" in t:
        return "subj_imperfect" if "imperfect" in t else "subj_present" if "present" in t else None
    if "conditional" in t:
        return "conditional"
    if "indicative" in t:
        if "historic" in t:
            return "simple_past"
        for key in ("imperfect", "future", "present"):
            if key in t:
                return key
    return None


def person_of(tags):
    t = set(tags)
    for (p, n), value in PERSON.items():
        if p in t and n in t:
            return value
    return 0


def verb_rows(d):
    """(aux, {(tense, person): [(form, ipa), …]}) from the plain (non-reflexive) block of one verb record.
    A cell can hold two spellings (paie / paye); the first is the one shown first."""
    cells, aux, infinitives = {}, set(), 0
    for x in d.get("forms") or []:
        if not isinstance(x, dict) or x.get("source") != "conjugation":
            continue
        tags = [t for t in x.get("tags") or [] if isinstance(t, str)]
        form = x.get("form") if isinstance(x.get("form"), str) else ""
        if "multiword-construction" in tags:
            if "infinitive" in tags:
                aux.update(a for a in ("avoir", "être") if form == a or form.startswith(a + " "))
            continue
        if "infinitive" in tags:
            infinitives += 1
            if infinitives > 1:  # the reflexive (se …) and pronominal (s'en …) blocks follow
                break
        tense = tense_of(tags)
        form = normalize(form)
        if not tense or not FORM.match(form):
            continue  # "-" marks a missing form; a few records leak IPA into the form field
        key = (tense, person_of(tags) if tense not in ("infinitive", "pp", "ppr") else 0)
        found = cells.setdefault(key, [])
        if form not in [f for f, _ in found]:
            found.append((form, (x.get("ipa") or "").strip("/ ")[:80] if isinstance(x.get("ipa"), str) else ""))
    return ("both" if len(aux) == 2 else aux.pop() if aux else "avoir"), cells


def build(raw, lexique, output):
    staging = output.with_name(output.name + ".staging")
    if output.exists() or output.is_symlink() or staging.exists() or staging.is_symlink():
        raise ValueError("Refuse existing output or staging file")
    source = dict(url=SOURCE_URL, page="https://kaikki.org/dictionary/French/", sha256=sha(raw),
                  authors="English Wiktionary contributors; extraction by Tatu Ylonen / Kaikki",
                  license="CC BY-SA 4.0", license_url=LICENSE_URL, lexique_sha256=sha(lexique),
                  changes="French verbs only; plain conjugation block; simple tenses and participles; "
                          "auxiliary; Lexique lemma frequency.",
                  built_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    freq, lex_forms = {}, set()
    with lexique.open(encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        col = {name: i for i, name in enumerate(head)}
        for line in f:
            r = line.rstrip("\n").split("\t")
            if len(r) < len(head) or r[col["cgram"]] not in ("VER", "AUX"):
                continue
            lemma = normalize(r[col["lemme"]])
            freq[lemma] = max(freq.get(lemma, 0.0), float(r[col["freqlemfilms2"]] or 0))
            lex_forms.add((normalize(r[col["ortho"]]), lemma))
    metrics = dict(verbs=0, forms=0, malformed=0, oversized=0)
    dataset = fingerprint([SCHEMA_VERSION, source["sha256"], source["lexique_sha256"], "conjugation"])
    seen = set()
    with sqlite3.connect(staging) as conn:
        conn.executescript(
            "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);"
            "CREATE TABLE verbs(lemma TEXT PRIMARY KEY,aux TEXT,frequency REAL);"
            "CREATE TABLE forms(lemma TEXT,tense TEXT,person INTEGER,rank INTEGER,form TEXT,ipa TEXT,"
            "PRIMARY KEY(lemma,tense,person,rank)) WITHOUT ROWID;"
        )
        opener = gzip.open if raw.suffix == ".gz" else open
        with opener(raw, "rb") as stream:
            while line := stream.readline(MAX_LINE + 1):
                if len(line) > MAX_LINE:
                    while line and not line.endswith(b"\n"):
                        line = stream.readline(MAX_LINE + 1)
                    metrics["oversized"] += 1
                    continue
                if b'"verb"' not in line:
                    continue
                try:
                    d = json.loads(line)
                    if not isinstance(d, dict):
                        raise ValueError("Not an entry")
                except (ValueError, UnicodeError):
                    metrics["malformed"] += 1
                    continue
                lemma = normalize(d.get("word") if isinstance(d.get("word"), str) else "")
                if d.get("lang_code") != "fr" or d.get("pos") != "verb" or lemma in seen or not FORM.match(lemma):
                    continue
                aux, cells = verb_rows(d)
                if ("present", 3) not in cells and ("present", 1) not in cells:
                    continue  # no usable table on this record; another etymology may have one
                seen.add(lemma)
                conn.execute("INSERT INTO verbs VALUES(?,?,?)", (lemma, aux, freq.get(lemma, 0.0)))
                rows = [(lemma, t, p, rank, form, ipa) for (t, p), found in cells.items()
                        for rank, (form, ipa) in enumerate(found)]
                conn.executemany("INSERT INTO forms VALUES(?,?,?,?,?,?)", rows)
                metrics["verbs"] += 1
                metrics["forms"] += len(rows)
        conn.execute("CREATE INDEX forms_form ON forms(form)")
        covered = sum(1 for form, lemma in lex_forms if lemma in seen and conn.execute(
            "SELECT 1 FROM forms WHERE form=? AND lemma=? LIMIT 1", (form, lemma)).fetchone())
        known = sum(1 for _, lemma in lex_forms if lemma in seen)
        metrics.update(lexique_verbs_found=len(seen & set(freq)), lexique_verbs=len(freq),
                       lexique_forms_covered=covered, lexique_forms_of_found_verbs=known)
        conn.executemany("INSERT INTO metadata VALUES(?,?)", [
            ("schema_version", str(SCHEMA_VERSION)), ("dataset", dataset),
            ("sources", json.dumps(source, ensure_ascii=False))])
        conn.commit()
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("integrity_check failed")
    staging.chmod(0o444)
    staging.replace(output)
    metrics.update(index_bytes=output.stat().st_size, index_sha256=sha(output), dataset=dataset, sources=source)
    output.with_suffix(".manifest.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n")
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--lexique", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    for path in (args.raw, args.lexique, args.output):
        if any(p.is_symlink() for p in (path, *path.parents)) or repo in path.resolve().parents:
            parser.error("Data must be outside the repository, without symlinks")
    print(json.dumps(build(args.raw, args.lexique, args.output), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
