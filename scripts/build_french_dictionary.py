"""Stream official Kaikki French-edition raw gzip + Lexique383.tsv into a compact SQLite index.
No downloads/startup hooks. Inputs and output must be outside the repository. See DICTIONARY.md.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import hashlib
import json
import resource
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offline_dictionary import SCHEMA_VERSION, fingerprint, normalize, text

MAX_LINE = 8 * 1024 * 1024


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        while b := f.read(1024 * 1024):
            h.update(b)
    return h.hexdigest()


def records(path, metrics):
    with gzip.open(path, "rb") as f:
        while line := f.readline(MAX_LINE + 1):
            metrics["lines"] += 1
            if len(line) > MAX_LINE:
                while line and not line.endswith(b"\n"):
                    line = f.readline(MAX_LINE + 1)
                metrics["oversized"] += 1
                continue
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                metrics["malformed"] += 1
                continue
            if value.get("lang_code") == "fr":
                yield value


def build(raw, lexique, output):
    started = time.monotonic()
    staging = output.with_name(output.name + ".staging")
    if staging.exists() or staging.is_symlink() or output.is_symlink():
        raise ValueError("Refuse existing staging file or symlink")
    metrics = dict(lines=0, malformed=0, oversized=0, entries=0, lexique=0)
    source = dict(
        kaikki=dict(
            url="https://kaikki.org/frwiktionary/raw-wiktextract-data.jsonl.gz",
            page="https://kaikki.org/frwiktionary/rawdata.html",
            sha256=sha(raw),
            bytes=raw.stat().st_size,
            authors="Wiktionnaire contributors; extraction by Tatu Ylonen / Kaikki",
        ),
        lexique=dict(
            url="https://lexique.org/databases/Lexique383/Lexique383.tsv",
            sha256=sha(lexique),
            bytes=lexique.stat().st_size,
            authors="Boris New, Christophe Pallier, Ronald Peereman, Sophie Dufour, Christian Lachaud and contributors",
        ),
        license="CC BY-SA 4.0",
        license_url="https://creativecommons.org/licenses/by-sa/4.0/",
        changes="French-only filter; selected bounded senses; normalized search keys; combined Lexique metadata. Chinese translations are adaptations under CC BY-SA 4.0.",
        built_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    )
    dataset = fingerprint([SCHEMA_VERSION, source["kaikki"]["sha256"], source["lexique"]["sha256"]])
    conn = sqlite3.connect(staging)
    try:
        conn.executescript(
            "PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA journal_mode=DELETE;"
            "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);"
            "CREATE TABLE entries(id INTEGER PRIMARY KEY,word TEXT,lemma TEXT,pos TEXT,pos_title TEXT,gender TEXT,ipa TEXT,senses TEXT,form_of TEXT);"
            "CREATE TABLE lexique(word TEXT,lemma TEXT,pos TEXT,gender TEXT,number TEXT,frequency REAL,info TEXT);"
        )
        for d in records(raw, metrics):
            word = text(d.get("word"), 200)
            if not word:
                continue
            senses, refs, genders = [], [], []
            for s in (d.get("senses") or [])[:64]:
                if not isinstance(s, dict):
                    continue
                glosses = [text(g) for g in (s.get("glosses") or [])[:4] if isinstance(g, str)]
                gloss = " / ".join(g for g in glosses if g)[:600]
                if gloss and gloss not in senses:
                    senses.append(gloss)
                refs.extend(text(x.get("word"), 200) for x in (s.get("form_of") or [])[:4] if isinstance(x, dict))
                genders.extend(t for t in s.get("tags", []) if t in ("feminine", "masculine"))
            ipa = next(
                (text(s.get("ipa"), 120) for s in (d.get("sounds") or [])[:32] if isinstance(s, dict) and s.get("ipa")),
                "",
            )
            conn.execute(
                "INSERT INTO entries VALUES(NULL,?,?,?,?,?,?,?,?)",
                (
                    normalize(word),
                    word,
                    text(d.get("pos"), 40),
                    text(d.get("pos_title"), 80),
                    "/".join(sorted(set(genders))),
                    ipa,
                    json.dumps(senses[:6], ensure_ascii=False),
                    json.dumps(list(dict.fromkeys(refs))[:8]),
                ),
            )
            metrics["entries"] += 1
            if metrics["entries"] % 2000 == 0:
                conn.commit()
        csv.field_size_limit(65536)
        with lexique.open(encoding="utf-8-sig", newline="") as f:
            for d in csv.DictReader(f, delimiter="\t"):
                try:
                    freq = max(float(d.get("freqfilms2") or 0), float(d.get("freqlivres") or 0))
                except ValueError:
                    freq = 0
                conn.execute(
                    "INSERT INTO lexique VALUES(?,?,?,?,?,?,?)",
                    (
                        normalize(text(d.get("ortho"), 200)),
                        text(d.get("lemme"), 200),
                        text(d.get("cgram"), 40),
                        text(d.get("genre"), 20),
                        text(d.get("nombre"), 20),
                        freq,
                        text(d.get("infover"), 400),
                    ),
                )
                metrics["lexique"] += 1
                if metrics["lexique"] % 2000 == 0:
                    conn.commit()
        conn.executescript("CREATE INDEX entries_word ON entries(word); CREATE INDEX lexique_word ON lexique(word);")
        conn.executemany(
            "INSERT INTO metadata VALUES(?,?)",
            [
                ("schema_version", str(SCHEMA_VERSION)),
                ("dataset", dataset),
                ("sources", json.dumps(source, ensure_ascii=False)),
            ],
        )
        conn.commit()
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("integrity_check failed")
    finally:
        conn.close()
    metrics.update(
        elapsed_seconds=time.monotonic() - started,
        peak_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        index_bytes=staging.stat().st_size,
        index_sha256=sha(staging),
        dataset=dataset,
        sources=source,
    )
    staging.chmod(0o444)
    staging.replace(output)
    output.with_suffix(".manifest.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n")
    return metrics


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--raw", type=Path, required=True)
    p.add_argument("--lexique", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    repo = Path(__file__).resolve().parents[1]
    for path in (a.raw, a.lexique, a.output):
        if path.is_symlink() or repo in path.resolve().parents:
            p.error("Data must be outside the repository, without symlinks")
    if a.output.exists():
        p.error("Choose a new output filename; promotion only replaces this builder staging file")
    print(json.dumps(build(a.raw, a.lexique, a.output), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
