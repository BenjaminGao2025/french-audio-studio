# Polish 1.2.0

Branch `design/polish-1.2`, from `origin/main` `ce4726f`. Version is now 1.2.0. Nothing was merged. Nothing was pushed to `main`. No pull request.

Tool: `grok 1.0.77 (50ca579fa996)`. Model: grok-4.7.

## What changed

1. Version. `web/package.json` and the two root fields in `web/package-lock.json` are `1.2.0`. The old first release note is pinned to `1.1.0` (same date and change list). A new first entry uses `APP_VERSION`, date `2026-11-11`, and the four polish lines. The sidebar footer reads v1.2.0.

2. History. Study home has a History link card to `progress/history?tab=attempts`, in the same grid as the other Study cards. Progress header History is an outline button, still going to `progress/history?tab=time`. The Continue block is a stock Card (title, when, sentence count, Continue, Dismiss). No new History API.

3. Word-card padding. With a word open, the reading column keeps `md:pr-96` and adds `md:px-4`. At 1440 the card sits 16px off the sidebar and 16px before the sheet. French text stays `text-3xl` (30px). The sheet class still says `sm:max-w-md`, but the base `data-[side=right]:sm:max-w-sm` wins, so the sheet is 24rem (384px) and `pr-96` matches it. Phone word card stays a bottom drawer.

4. Listen card. Unrevealed Listen is a centered outline `size="lg"` Play button in a `min-h-20` row. Auto-play, replay, Slow 0.75×, and Show answer are unchanged. Revealed and recognize cards still use the icon Play button.

5. Practise. “Practise without new text” is gone. Recall and Dictation are EntryCards in the same Study grid, going to `study/recall` and `study/dictation`.

## Tests

- `cd web && npm test`: 17 files, 364 passed.
- `cd web && npm run build`: `tsc --noEmit` and Vite build succeeded.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt`: 25 passed.
- `bash /home/mgacai/polish-1.2-out/audit.sh`: raw button/select/input/textarea/details/summary are all 0. `app_tsx_files=34`, `files_importing_ui=30`, `className_uses=1306`, CSS 190 lines.

## Screenshots

Directory: `/home/mgacai/polish-1.2-out/screenshots/`. Preview was `127.0.0.1:8027` and was stopped after the shots. Study-home frames are tall so the link cards fit inside `#main`.

Before: `pl-before-word-card-open-1440.png`, `pl-before-review-session-390.png`, `pl-before-review-session-1440.png`, `pl-before-study-home-390.png`, `pl-before-study-home-1440.png`, `pl-before-progress-1440.png`, `pl-before-history-1440.png`, `pl-before-footer-version-1440.png` (v1.1.0).

After: the same names with `pl-after-`. Footer is v1.2.0. Study home shows History, Recall, and Dictation. Word card at 1440 has both gutters. Review session is the Listen card.

## Remaining

The sheet’s `sm:max-w-md` does not override the stock sheet’s `sm:max-w-sm`, so the panel stays 24rem. The reserved column matches that rendered width. Continue appears only when a reopenable analysis exists; the untracked preview harness seeds one so the card can be seen.

## TASK C — review-card revealed UX (2026-11-11)

Tool: Codex CLI. Model: `gpt-6.1-sol`.

Revealed typed answers now start with a separated Result section: destructive X for incorrect answers, check marks for correct answers, and the existing MarkedLine comparison. Word/phrase has its own heading, pronunciation button, clickable full phrase, phonetics, type, and saved/context meanings. Grammar notes use the stock Accordion. Listen/Speak retain their sentence and play control without a fabricated typed answer.

Wrong Checks offer optional local “Type it again” practice up to 3/3. Correct repetitions clear the input and reuse the soft success chime without changing the review streak or calling an API. Wrong repetitions show an inline diff. Enter is contained in practice; grading remains available at any count. The main answer is a single-line stock Input with a thin ring; visible grade shortcut chips are removed while keyboard handlers remain intact.

Validation: `cd web && npm test` — 17 files, 370 tests passed (six new regression cases, including Enter isolation and three repetitions). `npm run build` passed (existing chunk-size warning). `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt` — 25 passed. Audit: raw button/select/input/textarea/details/summary = 0/0/0/0/0/0; app_tsx_files=34, files_importing_ui=30, className_uses=1311, CSS=190 lines. `git diff --check` passed.

Screenshots, visually inspected, under `/home/mgacai/polish-1.2-out/screenshots/`:
- Before: `pl-before-review-fillin-wrong-{1440,390}.png` and `pl-before-review-fillin-right-{1440,390}.png`, captured before the reveal changes using the original fill-in fixture.
- After: `pl-after-review-fillin-wrong-{1440,390}.png`, `pl-after-review-fillin-right-{1440,390}.png`, `pl-after-review-fillin-typeagain-{1440,390}.png` (1/3), and `pl-after-review-fillin-{1440,390}.png` (compact unrevealed input). Untracked preview data adds “tout de suite” with phonetics, saved meaning, and grammar to exercise those sections.

Preview bound only to 127.0.0.1:8027 after confirming it was free, then stopped. Preview harness and screenshots are excluded from the commit. WordPopup, dictionary, notes, and the existing `md:pr-96` Sheet padding are unchanged.

## TASK A — English dictionary, related entries and phrase fallback (2026-11-11)

Tool: Codex CLI. Exact model ID: `gpt-6.1-sol`.

Source page: https://kaikki.org/dictionary/French/ . Official JSONL used:
https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl . English Wiktionary
contributors; extraction by Tatu Ylonen / Kaikki. The page reports extraction 2026-10-30
from the 2026-10-01 enwiktionary dump. Licence: **CC BY-SA 4.0**,
https://creativecommons.org/licenses/by-sa/4.0/ . Adaptations: French records only,
normalized search keys, bounded selected source senses, IPA and form-of references.
Definitions are not generated or translated by AI.

Downloaded raw JSONL and generated manifest are retained under
`/home/mgacai/polish-1.2-out/dict-build/`, outside git. The new database is
`/home/mgacai/polish-1.2-out/dict-build/english-french-v1.sqlite`:
**55,332,864 bytes (52.77 MiB), 404,126 entries**, zero malformed/oversized records.
SQLite integrity check passed. DB SHA-256:
`275ce00c94d78753e26f120887d8961d70c9690b1a2a06771ab86a60361a3ea8`.
Raw JSONL SHA-256: `9053b1845fb3e045fa1fbe3f749122fa43e21b49bfa741cadd50255ae6ca0126`.
**recorrection-in-kaikki: no** — checked the normalized `word` field of every French
record in the full downloaded English-Wiktionary extraction.
The existing `/home/mgacai/tts-dictionary-data/french-v1.sqlite` was read only and not overwritten.

Schema remains v1; the English builder uses the existing entries schema and an empty
Lexique table, adding `gloss_language=en` metadata. Runtime adds `ENGLISH_DICTIONARY_PATH`.
The same authenticated `GET /api/lookup` returns English then French in `entries`, tags
each entry with `language`, and also exposes `entries_en`, `entries_fr`, and `datasets`.
Both corpora are queried before heuristic fallback. Corpus lemma lookup stays available.
`match_type` distinguishes `exact`, `related` (with `related` label), and `components`
(with per-word lookup results in `components`, including explicit non-stopword misses).
The French-only deployment remains supported. True misses still have no AI fallback.

Local checks against the generated English DB and existing French DB confirmed:
`recorrection` → **Related: correction**, with English and French senses;
`objectifs différents` → component entries headed `objectifs` and `différents`, resolving
to `objectif` and `différent`, English first. Exact phrase/lemma entries precede related
whole-phrase matches, which precede per-word fallbacks. Missing stopwords are skipped.
WordPopup changes are confined to these dictionary results and a short linked
“Source: Wiktionary (CC BY-SA)” attribution; full contributors/change notice are in the
tooltip. No word-card redesign, Notes, floating card, Type-it-again or grade-button work.

Validation:
- `PYTHONPATH=.:tests python3 -m unittest tests.test_offline_dictionary tests.test_word_context tests.test_gloss_prompt`: **41 passed** (16 dictionary; existing 25 word-context/gloss tests).
- `cd web && npm test`: **17 files, 373 tests passed**. Existing jsdom media/React act warnings are non-failing.
- `cd web && npm run build`: TypeScript and Vite passed (existing chunk-size warning).
- `bash /home/mgacai/polish-1.2-out/audit.sh`: raw button/select/input/textarea/details/summary counts **0/0/0/0/0/0**; app_tsx_files=34, files_importing_ui=30, className_uses=1314, CSS=190 lines.
- Builder plain/gzip round trips, non-French/malformed filtering, source metadata, overwrite refusal, cache invalidation on atomic replacement, exact-entry precedence in either corpus, phrase precedence/partial misses, English-only/French-only operation and API no-AI behavior are covered. Popup tests cover language order, related labels, per-word entries/misses and short attribution.
- `git diff --check` passed. No application/user database migration.

### Operator deployment — documented only, not executed

After deploying this commit's application code/image through the existing backup/deploy
pipeline, copy the new DB beside the French DB, keep the existing French read-only mount
and environment, add the English read-only mount/environment, and recreate only the app
service. The following commands discover the existing Compose service and directory from
its container labels and use an external override; they do not edit `compose.yml`:

```sh
set -eu
install -m 0444 /home/mgacai/polish-1.2-out/dict-build/english-french-v1.sqlite \
  /home/mgacai/tts-dictionary-data/english-french-v1.sqlite

dictionary_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' tts-service)
dictionary_deploy_dir=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' tts-service)
test -n "$dictionary_service" && test -n "$dictionary_deploy_dir"
python3 - "$dictionary_service" <<'PY'
import json
import sys
from pathlib import Path
service = sys.argv[1]
if not service:
    raise SystemExit("Missing application service name")
override = {"services": {service: {
    "volumes": ["/home/mgacai/tts-dictionary-data/english-french-v1.sqlite:/app/dictionary/english-french.sqlite:ro"],
    "environment": {"ENGLISH_DICTIONARY_PATH": "/app/dictionary/english-french.sqlite"},
}}}
Path("/home/mgacai/tts-dictionary-data/english-dictionary.override.json").write_text(json.dumps(override, indent=2) + "\n")
PY
cd "$dictionary_deploy_dir"
docker compose -f compose.yml \
  -f /home/mgacai/tts-dictionary-data/english-dictionary.override.json \
  up -d --no-deps --force-recreate "$dictionary_service"
```

Keep the override in subsequent deploy/recreate commands. A restart alone cannot add a
mount or environment variable, hence the service recreation. This task did not run any
of these commands or touch production containers, Docker/Compose configuration, secrets,
models, user data or output directories. No dump, database, preview file or PNG is committed.
