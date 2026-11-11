"""Build a compact English-gloss French index from official Kaikki JSONL (or JSONL.gz).
Inputs and output must be outside the repository. No downloads or runtime hooks.
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offline_dictionary import LICENSE_URL, SCHEMA_VERSION, fingerprint, normalize, text
from scripts.build_french_dictionary import MAX_LINE, sha

SOURCE_URL = "https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl"


def build(raw, output):
    staging = output.with_name(output.name + ".staging")
    if output.exists() or output.is_symlink() or staging.exists() or staging.is_symlink():
        raise ValueError("Refuse existing output or staging file")
    source = dict(url=SOURCE_URL, page="https://kaikki.org/dictionary/French/", sha256=sha(raw),
                  authors="English Wiktionary contributors; extraction by Tatu Ylonen / Kaikki",
                  license="CC BY-SA 4.0", license_url=LICENSE_URL,
                  changes="French-only selection; bounded source senses; normalized search keys.",
                  built_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    metrics = dict(entries=0, malformed=0, oversized=0, recorrection_in_kaikki=False)
    dataset = fingerprint([SCHEMA_VERSION, source["sha256"], "en"])
    with sqlite3.connect(staging) as conn:
        conn.executescript(
            "PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;"
            "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);"
            "CREATE TABLE entries(id INTEGER PRIMARY KEY,word TEXT,lemma TEXT,pos TEXT,pos_title TEXT,gender TEXT,ipa TEXT,senses TEXT,form_of TEXT);"
            "CREATE TABLE lexique(word TEXT,lemma TEXT,pos TEXT,gender TEXT,number TEXT,frequency REAL,info TEXT);"
        )
        opener = gzip.open if raw.suffix == ".gz" else open
        with opener(raw, "rb") as stream:
            while line := stream.readline(MAX_LINE + 1):
                if len(line) > MAX_LINE:
                    while line and not line.endswith(b"\n"):
                        line = stream.readline(MAX_LINE + 1)
                    metrics["oversized"] += 1
                    continue
                try:
                    d = json.loads(line)
                    if not isinstance(d, dict):
                        raise ValueError("Not an entry")
                except (ValueError, UnicodeError):
                    metrics["malformed"] += 1
                    continue
                if d.get("lang_code") != "fr":
                    continue
                word = text(d.get("word"), 200)
                if not word:
                    continue
                if normalize(word) == "recorrection":
                    metrics["recorrection_in_kaikki"] = True
                senses, refs, genders = [], [], []
                for sense in (d.get("senses") or [])[:64]:
                    if not isinstance(sense, dict):
                        continue
                    gloss = " / ".join(filter(None, (text(g) for g in (sense.get("glosses") or [])[:4])))[:600]
                    if gloss and gloss not in senses:
                        senses.append(gloss)
                    refs.extend(text(r.get("word"), 200) for r in (sense.get("form_of") or [])[:4] if isinstance(r, dict))
                    genders.extend(t for t in sense.get("tags", []) if t in ("masculine", "feminine"))
                ipa = next((text(s.get("ipa"), 120) for s in (d.get("sounds") or [])[:32]
                            if isinstance(s, dict) and s.get("ipa")), "")
                conn.execute("INSERT INTO entries VALUES(NULL,?,?,?,?,?,?,?,?)", (
                    normalize(word), word, text(d.get("pos"), 40), text(d.get("pos"), 80),
                    "/".join(sorted(set(genders))), ipa, json.dumps(senses[:6], ensure_ascii=False),
                    json.dumps(list(dict.fromkeys(refs))[:8], ensure_ascii=False)))
                metrics["entries"] += 1
                if metrics["entries"] % 2000 == 0:
                    conn.commit()
        conn.executescript("CREATE INDEX entries_word ON entries(word); CREATE INDEX lexique_word ON lexique(word);")
        conn.executemany("INSERT INTO metadata VALUES(?,?)", [
            ("schema_version", str(SCHEMA_VERSION)), ("dataset", dataset), ("gloss_language", "en"),
            ("sources", json.dumps(source, ensure_ascii=False))])
        conn.commit()
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("integrity_check failed")
    staging.chmod(0o444)
    staging.replace(output)
    metrics.update(index_bytes=output.stat().st_size, index_sha256=sha(output), dataset=dataset, sources=source)
    output.with_suffix(".manifest.json").write_text(json.dumps(metrics, indent=2) + "\n")
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    for path in (args.raw, args.output):
        if any(p.is_symlink() for p in (path, *path.parents)) or repo in path.resolve().parents:
            parser.error("Data must be outside the repository, without symlinks")
    print(json.dumps(build(args.raw, args.output), indent=2))


if __name__ == "__main__":
    main()
