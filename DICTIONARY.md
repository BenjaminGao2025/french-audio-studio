# Local offline French dictionary trial

No automatic imports/downloads. Disabled by default. Application code and dictionary data have
separate licenses. This change is not a release. Do not apply the compose override without approval.

## Data and attribution

Kaikki French-language edition raw data page: https://kaikki.org/frwiktionary/rawdata.html .
Extract the actual `.jsonl.gz` href from this page, resolve against the page URL, and retain the HTML.
On 2026-11-08 UTC it linked https://kaikki.org/frwiktionary/raw-wiktextract-data.jsonl.gz
(736596796 bytes, SHA256 33c7b73bc11d2533c9c0e0be6484ded76bd9ff29337065f2070b4f1b7d2e4f3c).
Dump 2026-10-01, extracted 2026-11-02. Raw data contains many languages: import filters `lang_code=fr`.
https://kaikki.org/frwiktionary/ licenses the extraction on Wiktionary's CC BY-SA / GFDL terms.
We select the CC BY-SA 4.0 track, confirmed by https://fr.wiktionary.org/wiki/Wiktionnaire:Licence .
Attribution: Wiktionnaire contributors, extraction by Tatu Ylonen / Kaikki (Wiktextract).
Each displayed entry links its Wiktionnaire page and contributor history.

Lexique **3.83**, not Lexique4: https://lexique.org/databases/Lexique383/Lexique383.tsv
(25850780 bytes, SHA256 637ba37a767a66679c48371d673ece50cbf541b49a4e40e598963d4f3fbce52b).
https://lexique.org/databases/Lexique383/README-Lexique.txt identifies CC BY-SA4 (printed `SA40.0`).
Its relative LICENSE-CC-BY-SA4.0.txt link returned 404 when retrieved. Canonical license:
https://creativecommons.org/licenses/by-sa/4.0/ and legal text
https://creativecommons.org/licenses/by-sa/4.0/legalcode.en .
Authors: Boris New, Christophe Pallier; contributors Ronald Peereman, Sophie Dufour,
Christian Lachaud and others, as listed in the retained README.

Changes/adaptations under CC BY-SA 4.0: French filtering, normalized keys, bounded selected
source senses, combined metadata, and Chinese translations. Adapted data/translated glosses
must retain attribution, change notice and the same license on redistribution. This does not
relicense application code. No examples/quotations, audio or images are imported.

## Reproduce on mini7840

Data directory: `/home/mgacai/tts-dictionary-data` (mgacai). Keep raw files, official source HTML,
README, license notices and generated manifest together. Nothing from this directory belongs in git,
a Docker build context or the image. Downloads used Python standard-library urllib streaming;
no new system packages. Use a fresh output filename:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/build_french_dictionary.py \
  --raw /home/mgacai/tts-dictionary-data/raw-wiktextract-data.jsonl.gz \
  --lexique /home/mgacai/tts-dictionary-data/Lexique383.tsv \
  --output /home/mgacai/tts-dictionary-data/french-v1.sqlite
```

The builder refuses existing output/staging files, bounds JSONL lines at 8 MiB, commits every 2000
rows, uses an 8 MiB SQLite cache and disk temporary storage, verifies integrity and atomically
promotes its staging file. The sidecar manifest records hashes, sizes, counts, elapsed time and peak
RSS. Raw files are streamed, never loaded as a corpus into RAM. Python sqlite3/gzip/csv/json are
portable to ARM; ARM execution has not been tested.

## Runtime and future release

Set operator-only `FRENCH_DICTIONARY_PATH` to an absolute, regular, nonsymlink SQLite path. The
candidate mounts the final index **read-only** at `/app/dictionary/french.sqlite`; lookup opens it
`mode=ro&immutable=1`, query-only, with a 2 MiB SQLite cache. No path is accepted from an API request.
`compose.dictionary.yml` is a future optional override; it is not applied in this task. No runtime
mounts/configuration of the running service were changed. Missing/disabled/corrupt indexes safely
fall back to the existing generated lookup path after auth, entitlement and rate limits.

Translation cache migration adds only `dictionary_translation_cache` to the normal isolated
`OUTPUT_DIR/users.db`; it is lazy, additive/idempotent. Before a future release use the established
SQLite online-backup procedure. This task's pre-migration read-only online backup is
`/tmp/tts-dictionary-backups/20261108T003741Z/users.db`; no live schema migration was run.
Translations contain public source senses only. Keys include dataset checksums, selection/version,
lemma/POS, selected sense text and translation version. No sentence or user context is stored in
this shared cache. Successful translations persist once; failures have a bounded five-minute
process cooldown and keep the French source. Unentitled users can read source and already cached
translations; only entitled callers can start/join paid misses. Offline reads spend no AI quota.

Lexique frequency ranks plausible POS independently of the sentence. Up to three entries, two
short source senses each are shown, not exhaustive definitions. Inflected forms resolve via Lexique
and/or Wiktionnaire form-of references; `infover` retains *all* listed analyses (not a unique person
or mood). Lexique phonetic codes are not IPA; IPA comes only from Wiktionnaire. Accents remain
significant; NFC and apostrophe variants normalize. Context retains the existing per-user,
per-sentence and per-occurrence cache and extracted phrase priority. Corpus lookup precedes
built-in/global generated answers. Curated decomposition is visibly supplemental.

## Rollback after an eventual approved release

Before any release, preserve the named git/Docker `pre-offline-dictionary` snapshots at aceaccc
and make a fresh online DB backup. Roll application image back to
`deploygrow-tts:pre-offline-dictionary` / code `aceaccc55ae2fe29e1e547750396fddd63ded163`, remove
only the optional dictionary override/environment at the next approved recreate, and leave the
external corpus and additive cache table alone. No destructive DB rollback is required. If a full
DB restore is separately authorized, stop writers, restore that release's online backup with the
established procedure and handle WAL/SHM consistently; do not overwrite a live SQLite database.
