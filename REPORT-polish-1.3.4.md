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


## TASK 5 — Elision lookup and Chinese sentence context

Tool: Codex CLI. Model: gpt-6.1-sol. Follow-up on `design/polish-1.3.4`; version remains 1.3.4 and tasks 1–4 are preserved.

The existing offline_dictionary lookup now resolves l’, d’, j’, n’, m’, t’, s’, c’, qu’, jusqu’, lorsqu’, and puisqu’ (straight and curly apostrophes) through the remainder, using the same French/English indexes, ranking, inflection handling, related-word fallback and phrase components. Exact expressions such as d’accord remain intact. Selection version is 6. The word card keeps the clicked headword and displays an elision breakdown; noun gender from the index identifies le/la when available, and dictionary entry headings show masculine/feminine noun labels. No dictionary database was modified.

The card now requests word_context even when the analysis already supplies an English gloss, renders meaning_zh plus why_zh as its main sentence explanation, and keeps English as a secondary line. The prompt asks why_zh for the meaning here and grammatical role in 1–2 conservative short Chinese sentences. Existing field limits remain unchanged. word_context.VERSION is 4, invalidating older cache keys; current-version nonempty bare-gloss rows without a usable Chinese note also regenerate on lookup. Empty negative-cache entries remain cached. A failed context request retains a clearly labelled fallback and Retry.

Regression coverage includes l’oubli, l’homme, j’ai and n’ai with both apostrophes, both indexes and isolated single-index lookup, all requested prefixes, API found state, related/components fallback, exact expressions, clicked headword, Chinese role display despite a stored English gloss, prompt requirements, and mocked cache regeneration followed by cache reuse. Unit tests use temporary databases/fixtures and mocked AI only.

Verification:

- `cd web && npm test`: **453 passed**, 20 files.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: **647 passed**.
- `cd web && npm run build`: passed (existing bundle-size advisory only).
- `bash /home/mgacai/polish-1.3.4-out/audit.sh`: raw button/select/input/textarea/details/summary counts all **0**.
- `git diff --check`: passed.

Screenshots, all visually inspected, with browser assertions for elision breakdown, Chinese meaning/subject role, absence of a dictionary miss, and no horizontal overflow:

- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-oubli-light-1280.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-oubli-dark-1280.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-oubli-light-390.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-oubli-dark-390.png`

Screenshots use the actual offline_dictionary implementation against `/home/mgacai/polish-1.2-out/dict-build/english-french-v1.sqlite`, opened read-only/immutable. No configured French index was available for screenshots; both languages are covered by fixture tests. The context response is a fixture containing why_zh, rendered by the real UI; no live paid AI was called. Reused `/tmp/pwa-1.3.2-tools/node_modules/playwright` and `/home/mgacai/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`.

Confirmed 8030 free before starting; preview bound only to 127.0.0.1:8030, stopped afterward and port verified free. Temporary preview source/config were removed from the checkout. No screenshots, node_modules, database copies or preview files are committed. No production files, containers, credentials, deployment, main branch, merge or PR operations were used. Push target is only `origin design/polish-1.3.4`.


## TASK 6 — Whole elided tokens and shared lemma identity

Tool: Codex CLI. Model: gpt-6.1-sol. Branch: `design/polish-1.3.4`; version stays 1.3.4. Tasks 1–5 remain committed and preserved.

Root cause: `tokenizeFrench` already recognized internal apostrophes, but `FrText.build` retained analysis word boundaries. An analysis that flagged only `homme` left `l'` outside its tappable span. `alignElidedSegments` now aligns boundaries against the complete sentence and merges an immediately adjacent recognized prefix and remainder, preserving the remainder's analysis index and combined mark/added flags. Straight/curly apostrophes work identically. Build-up steps, analysis word chips and split word-by-word components use the same full surface. Review marks cover the complete token. Native selection starting inside the remainder visibly snaps to the full elided token. Card titles retain `l'homme`; Task 5's `l' = le + homme` breakdown remains visible, including nested dictionary rendering.

Frontend `stripElidedPrefix` and backend `strip_elided_prefix` strip one prefix from the same Task 5 set (l, d, j, n, m, t, s, c, qu, jusqu, lorsqu, puisqu), for single-word identity. NFC, whitespace normalization, case folding and apostrophe equivalence remain intact; whole phrases, accents and distinct inflections remain distinct. Backend dictionary elision resolution reuses its helper while preserving Task 5 exact-expression handling. Counts, debounce, deck star, Importance and saved-card keys share the remainder key, so `l'homme` and `homme` share `homme`. SRS retains the surface target for sentence blanks while preventing a second alias card.

The recorded `elision-keys-1.3.4` migration merges count aliases by summing counts, retaining earliest first/latest last lookup timestamps, and preserving favorite membership. Legacy deck aliases merge across word-card modes; a practiced schedule takes precedence, and any active saved alias keeps the survivor active. Notes/translations remain, review records follow the survivor, and original count/favorite/card/review rows (including schedules and metadata) are retained in the additive `srs_elision_merge_backup` recovery table. Importance is recalculated after merging. Migration testing used SQLite backup of a temporary fixture source into a temporary users-backup.db, verified the source stayed unchanged, and verified a second migration run is idempotent. No live users.db was read or changed.

The phrase overlap path normalizes apostrophes and verifies that the expression occurs in the actual sentence. “In this sentence” adds a short Chinese fixed-expression note, e.g. `固定表达 droits de l’homme：人权。` from fixture phrase context. Absent expressions are not shown.

Verification:

- `cd web && npm test`: **477 passed**, 20 files. Includes both apostrophes for l'homme, l'oubli, j'ai, n'ai, qu'il; split analysis regression; native selection; analysis/component chips; review marks; shared keys/star; surface headword and present/absent fixed-expression context. Task 5 elision tests remain passing.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: **650 passed**. Includes all prefixes, shared counts/save/Importance, and reversible/idempotent migration on a fixture backup.
- `cd web && npm run build`: passed (existing bundle-size and static-script advisories).
- `bash /home/mgacai/polish-1.3.4-out/audit.sh`: raw button/select/input/textarea/details/summary counts all **0**.
- `git diff --check`: passed.

New screenshots only, all visually inspected; fixture-only preview used actual taps on analysis-split sentence tokens. Browser assertions verify the full selected unit, surface headword, elision breakdown, fixed-expression Chinese note and no horizontal overflow:

- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-lhomme-light-1280.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-lhomme-dark-1280.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-lhomme-light-390.png`
- `/home/mgacai/polish-1.3.4-out/screenshots/polish-1.3.4-word-lhomme-dark-390.png`

Dictionary and sentence/phrase context are explicit screenshot fixtures; no live AI or database was used. Reused `/tmp/pwa-1.3.2-tools/node_modules/playwright` and `/home/mgacai/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`. Confirmed 8030 free before preview, bound only to 127.0.0.1:8030, stopped afterward and verified free. Temporary preview source/config removed. No screenshot PNGs, node_modules, database copies or preview files are committed. No production, Docker, environment, models, credentials, deployment, main branch, PR or merge changes. Push target: only `origin design/polish-1.3.4`.
