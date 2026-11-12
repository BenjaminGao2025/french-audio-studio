# Polish 1.3.4

Tool: Codex CLI. Model: gpt-6.1-sol.
Branch: design/polish-1.3.4.

## Unified star and Importance

The word-deck star and read-only dots now share cloze/Fill-in membership through `wordIsSaved`. Unsaved words show an empty star and zero filled dots, even with historical lookups. Saved words start at Importance 3. `IMPORTANCE_FROM_LOOKUPS` in Python and TypeScript sets 3 counted lookups → 4 and 5 counted lookups → 5. The five-second suppression window and visible lookup counts remain.

Manual save derives max(default saved importance, lookup tier). Unstar removes matching cloze cards across sentence contexts and keeps lookup counts. It leaves zero dots until another qualifying counted lookup or manual save. Suppressed reopen requests cannot auto-save. Pending star actions keep the committed membership visible so dots and star agree, including failure cases.

Counted qualifying lookups save a missing cloze card through `add_note`, using the opened sentence context when supplied, and synchronize matching stored word-card importance. The frontend refreshes its library after qualifying lookup responses. Top-level and nested word cards, Review dots/sorting/filters, and Design examples use the new scale. Historical word favorites remain separate from deck membership.

`/api/srs/importance` remains compatible: word-card values are recomputed from lookup tiers; sentence/grammar card priorities retain their existing manual behavior. The word-card UI has no second importance control.

## Migration

An additive `srs_migrations` marker runs the 1.3.4 recomputation once on existing word cards. The `srs_cards.importance` column remains. No cards are inserted from historical lookup rows, and no user content or existing columns are removed.

Temp database tests cover migration, preserved card IDs/content/scheduling, historical counts without auto-insertion, repeated initialization, save tiers, unstar, suppression, later auto-save, and manual endpoint behavior.

Also tested against a SQLite online backup opened from the live database in read-only mode into `/home/mgacai/polish-1.3.4-out/migration-users.db`. Migration preserved all 947 cards and verified 657 word-card importance values. Hashes of every existing table's contents excluding `srs_cards.importance` were unchanged; integrity checks and repeated initialization passed. The backup and sidecars were deleted. See `migration.log` and `check-migration.py` in the output directory.

## Answer feedback and release metadata

Removed GradeToast from App and deleted its component, toast state, listeners, timer, and unused random praise picker. Correct Recall/Dictation results keep inline feedback. Sound/chimes, optional spoken audio, and other application toasts remain.

Version is 1.3.4 in `web/package.json` and the two root version fields in its lockfile. RELEASES starts with APP_VERSION and preserves the former bullets under an explicit 1.3.3 entry. PWA registration now uses `pwa-register.js?v=1.3.4`.

## Verification

- `cd web && npm test`: 446 tests passed across 19 files.
- `cd web && npm run build`: passed; expected classic script and chunk-size warnings only. Built `dist/index.html` contains `pwa-register.js?v=1.3.4`.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: 638 tests passed; fixtures/temp databases only.
- Adapted 1.3.3 audit script: raw button/select/input/textarea/details/summary counts all zero.
- `git diff --check`: passed.

Logs are under `/home/mgacai/polish-1.3.4-out/`, including `npm-test-final.log`, `python-test.log`, `build.log`, `audit.log`, `migration.log`, and `screenshots-final.log`.

## Screenshots and cleanup

20 full-page PNGs are in `/home/mgacai/polish-1.3.4-out/screenshots/`:

- `polish-1.3.4-word-unsaved-{light,dark}-{1280,390}.png`
- `polish-1.3.4-word-saved-{light,dark}-{1280,390}.png`
- `polish-1.3.4-word-lookups3-{light,dark}-{1280,390}.png`
- `polish-1.3.4-word-lookups5-{light,dark}-{1280,390}.png`
- `polish-1.3.4-recall-correct-{light,dark}-{1280,390}.png`

Reused the existing fixture preview, specified Playwright installation, and Chromium binary. Browser assertions covered no horizontal overflow, empty star ⇔ zero dots, saved tiers 3/4/5, preserved lookup counts after unstar, and no grade-toast or bottom-left praise. The fixture clock advanced between counted lookups to respect suppression. Visually inspected all 20 captures through desktop/mobile contact sheets. Optional copy to `/workspace/polish-1.3.4/screenshots/` was unavailable (permission denied).

Confirmed port 8030 free before starting; preview bound only to 127.0.0.1:8030 and was stopped afterward. Confirmed the port free. Removed temporary preview source/config and database backups. No PNGs or node_modules are committed. No Docker commands, deployment, production configuration changes, main push, merge, or PR.


## TASK 3 — Case- and POS-aware dictionary lookup

Tool: Codex CLI. Model: gpt-6.1-sol. Follow-up on `design/polish-1.3.4`; application version stays 1.3.4 and tasks 1–2 remain intact.

Root cause: the API and dictionary lookup lowercased the surface token before selection, the browser cache shared uppercase/lowercase requests, and English-first concatenation could promote `MA prep` over `ma det`. English form-of entries could also be excluded when a competing direct abbreviation was present.

The read-only lookup now retains surface case independently of the normalized index key. Both indexes rank matching lemma case and sentence POS before frequency and corpus preference. Exact surface entries suppress competing other-case variants; an uppercase `MA` query still selects its abbreviation. POS aliases include determiner/det/ADJ:pos. Inflected lowercase verb lemmas remain eligible for sentence-POS ranking. The merged primary lemma/POS/IPA follows the selected corpus, preserving surface-form IPA behavior. The API accepts POS, analysis word cards and saved metadata lookups pass it, and the frontend dictionary cache keys include surface case and POS. The word card respects a French primary entry when it outranks English results. No dictionary SQLite data or grading behavior changed; dictionary selection uses no AI.

Four new Python regression tests cover EN and FR ma/MA/Ma, isolated indexes, API determiner POS, cross-corpus POS priority, and inflected verb/adjective selection. A new frontend test verifies case/POS cache isolation.

Screenshots (all visually inspected, with no horizontal overflow):

- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-ma-{light,dark}-{1280,390}.png`

These use temporary dictionary fixtures through the actual lookup implementation and show `ma det`, “feminine singular of mon (my)”, in “J’ai laissé ma carte.”; no MA/meilleur avant/BB appears.

## TASK 4 — Fill-in cues and short-cloze fallback

Tool: Codex CLI. Model: gpt-6.1-sol.

Root cause traced through the save and render paths: note translation fields are mapped correctly when present, but lookup-triggered auto-save accepted only English and could persist an empty translation. It dropped available Chinese sentence cues. Explicit word saving used the display English field without consulting the original analysis translation. Review then rendered only Chinese OR English, and retained Fill-in even when translations were absent or a sentence provided virtually no context.

Lookup auto-save now carries and stores both available sentence translations. Lookup and manual word saving prefer the original analysis English translation when available. Review shows both available language cues before answering and includes both target meanings and POS when supplied. Missing translations never leave a legacy cloze as a bare blank: it presents as Recall/recognize with the target visible and self-rated after reveal.

Named constants shared in meaning between Python and TypeScript are `CLOZE_MIN_SENTENCE_WORDS = 3` and `CLOZE_MAX_BLANK_FRACTION = 0.5`. New saves with fewer than three words, a target covering more than half the words, or an absent target become recognize cards. Function-word expansion is checked after expansion. Existing cloze cards receive the same shortness check at presentation, preserving their stored IDs, scheduling and content. Saved-word membership includes recognize fallbacks so the existing star/lookup importance behavior remains consistent. No schema changes or destructive migration were needed.

New tests cover bilingual auto-save preservation, short/mostly-blank generation fallback, either/both language cues in mapping, untranslated legacy fallback, visible bilingual meanings/POS, and rendering short legacy cards as Recall without a blank/input. Existing expectations were updated for POS-aware calls and saved recognize membership.

Screenshots (all visually inspected, with no horizontal overflow):

- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-review-fillin-{light,dark}-{1280,390}.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-review-short-fallback-{light,dark}-{1280,390}.png`

The Fill-in shows both “我落下了我的卡。” and “I left my card.” with meaning/POS. The untranslated two-word “Nous partons.” fixture shows Recall with “partons”, rather than “Nous _____.”.

Follow-up verification:

- `cd web && npm test`: **452 passed**, 20 files (6 new tests).
- `cd web && npm run build`: passed; existing classic PWA-script/chunk-size warnings only.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: **644 passed** (6 new tests), fixtures/temp databases only.
- `bash /home/mgacai/polish-1.3.4-out/audit.sh`: raw button/select/input/textarea/details/summary all **0**.
- `git diff --check`: passed.
- Logs: `followup-npm-verified.log`, `followup-python-final.log`, `followup-build-final.log`, `followup-audit.log`, `followup-screenshots.log` under `/home/mgacai/polish-1.3.4-out/`.

Reused the fixture preview pattern, specified Playwright installation and Chromium binary. Captured 12 new screenshots, without recapturing tasks 1–2. Optional `/workspace/polish-1.3.4/screenshots/` copy was unavailable/unwritable. Confirmed 127.0.0.1:8030 free before starting; bound only there, stopped our preview, and verified the port free by binding afterward. Temporary preview source/config were removed from the checkout; reusable copies remain in the output directory. No screenshot PNGs, databases, node_modules or preview files are committed. No production files, containers, credentials, deployment, main branch, merge or PR operations were used. Only `origin design/polish-1.3.4` is the push target.
