# polish-1.3 / version 1.3.0

Date: 2026-11-11. Branch: `design/polish-1.3`, baseline `fa82137`.
Tool: Codex CLI. Model: `gpt-6.1-sol`.

## Changes by task

1. **IPA playback:** shared stock Button-based `Phonetic` control uses existing `sayFrench` and `formatFriendlyPhonetic`, preserving square brackets. Headword, English/French dictionary entries (including recursive related/component results), Review word evaluation, Study tools and listening vocabulary all use it. Controls have a pronunciation aria-label, pointer/hover affordance, and stop propagation. Tests cover all three phonetic controls in a word card without a nested lookup or extra lookup count.
2. **Default-open modules:** sentence meaning and Dictionary have keys tied to sentence and displayed word. New word, nested drill, Back, and reopening reset them to expanded. French definitions stay collapsed. Word origin / Ask AI / Notes stay collapsed in the full card. Review evaluation embeds the same WordPanel with compact notes count and omits origin/AI/editor. The automatic evaluation embed does not increment lookup count or steal focus; explicit nested lookups still count.
3. **One deck star:** shared WordDeckStar is used in word cards and Fill-in library rows. It optimistically changes its appearance, blocks duplicate submits, and rolls back with an assertive announcement on failure. Saving updates the shared library and sentence saved-card cache; deletion updates both. Tests cover save/delete failures, historical bookmarks, metadata, cross-sentence membership, and preserving Listen/Speak, other words and recognition cards.
4. **Minor UI:** local important Tailwind focus classes enforce `ring-1` / `ring-ring` on Review answer and repetition inputs; shared Input is untouched. Study home uses six columns: first three cards span two columns each, Recall and Dictation span three each. Mobile remains a single column. Desktop word popovers anchor to the full French sentence box and open below it with a 16px offset, collision handling, viewport bounds and scrolling. Mobile retains the Drawer. The Listen card's artificial 80px playback minimum is replaced by compact padding; French text size is unchanged.
5. **整合补查:** findings and verification below. No old-stack cherry-picks or dictionary rebuilds.
6. **Character diff:** original local TypeScript minimum-edit alignment of NFC Unicode characters; no Anki code, identifiers, comments, structure or dependency copied. Case and accents remain significant. Equal text appears once in green with a check. Otherwise typed and correct lines align in monospace, with red wrong/extra characters, struck extra letters, grey missing placeholders, a small down arrow, and muted/underlined corrections. Correct answer remains an audio button. Review and wrong retyping share this component; redundant “Different word: you wrote …” / “Accent: you wrote …” lines are absent there. Exercise retains its existing word-level marking; the requested minimum scope is covered without changing Exercise behavior.
7. **Unlimited Type it again:** no attempt cap, readOnly or count-based disabling. Correct attempts keep the existing soft sound, increment the counter, clear and refocus the input. Wrong attempts use the character diff. Enter stops propagation and checks practice without rating the card; Again/Hard/Good/Easy remain available. Tests continue through four successes and another wrong attempt.

Version is 1.3.0 in package.json and root lock metadata. The new changelog entry is first; the prior entry remains explicitly 1.2.0. Remaining 1.2.0 strings are historical release information or actual dependency versions, not the displayed app version.

## Bookmark / Save mapping

Before: the word-card Bookmark wrote `/api/srs/favorites`; actual 生词本 cards were separate `srs_cards` created by `/api/srs/notes`.

Now: filled Star means a cloze card with `lookupKey(word)` exists anywhere in the loaded user library, including another sentence or an archived card. Empty Star saves only that exact word's cloze target using the current sentence and translations, with the shared `clozeTarget` metadata snapshot (meaning, context, IPA, lemma, POS and dictionary gloss). Filled Star deletes only matching cloze card IDs across contexts through `/api/srs/cards/{id}`. It never deletes Listen/Speak cards, recognition/grammar cards or other words. The separate bookmark filter was removed as redundant; library Fill-in stars show actual membership. Listen/Speak saving via Add to review remains available.

Historical favorites are **not migrated**. A bookmark without a cloze card shows an empty star until saved. Favorites table and server API remain intact; the word-card/library UI no longer uses them, and loading the library no longer requests them. Unused legacy client helpers remain for compatibility. No second favorites announcement is used. Importance remains the labelled, read-only lookup-based rating, separate from the single save star, including for unsaved words.

A real integration gap was fixed: existing server save behavior expanded function-word targets or converted absent targets to recognition cards. The optional `SrsTarget.exact_target` boolean defaults to false for compatibility; shared SPA cloze saves send true. This preserves the exact starred word, including dictionary drill words absent from the original sentence. Such a word is practised as a word-target Recall prompt when no blank can be formed; it no longer accidentally tests the full sentence. Existing API callers retain their previous expansion/conversion behavior. New backend tests cover exact function words, absent nested words and safe single-card deletion.

## 整合补查 findings

- `feat/card-english-only`: inspected `f4fdcb9` and `7cb442c` summaries. They modify the old static popover. English-first dictionary, contextual English and always-visible Importance are present in the React card. Importance now also has a zero-count fallback while the count request is pending. No cherry-pick.
- `feat/personal-deck` / `3594cab`: inspected the 569-line old-stack feature in static/homework.js, static/study.js, journal.py and related files. Left on the old stack; porting to StudyPersonal needs a separate product decision. No port.
- `feature/offline-french-dictionary` / `5d788d8`: inspected the explicitly not-release-ready WIP summary. Superseded by the production French/English indexes already on this host. Not integrated.

Read-only Python lookup used `offline_dictionary.lookup` with:

- `FRENCH_DICTIONARY_PATH=/home/mgacai/tts-dictionary-data/french-v1.sqlite`
- `ENGLISH_DICTIONARY_PATH=/home/mgacai/tts-dictionary-data/english-french-v1.sqlite`

| Sample | Result | Observed primary English / lemma |
| --- | --- | --- |
| recorrection | related: correction | correction (all senses) |
| laver | exact | to wash; lemma laver |
| machine à laver | exact | washing machine |
| canadienne | exact | Canadian; English lemma canadien; French entries also include canadienne |
| failli | exact | bankrupt; insolvent; English lemma failli, French entries include faillir |
| vont | exact | to go; primary lemma aller, additional English entries include vader |
| lues | exact | past participle of lire; English lemma lu, French lemma lire |
| machine à laver inconnuezzz | components | machine / à / laver hits; inconnuezzz explicitly missing |
| inconnuezzz | miss | no fabricated senses |

Entries are ordered English before French. Related and component fallbacks work; no fallback code or dictionaries changed. The failli adjective-first ambiguity is pre-existing corpus content, not a fallback miss; the contextual meaning module is needed for the “almost” use. Dictionary origin/senses were not invented with AI.

Lookup trace: WordPanel calls the persisted API on an explicit open, and once in the nested-drill handler. An instance ref now suppresses React StrictMode's duplicate initial effect request. Nested drill does not also run the root-open count effect. The automatic compact Review evaluation does not count. API responses update the popup counter and shared library lookup state. The separate local `store.recordLookup` / `countLookup` prototype path is not called by production word-card opens.

The server remains the authoritative five-second debounce. New regression test for `en` checks times 0, 1, 4, 5, 9, 10 seconds: counts 1, 1, 1, 2, 2, 3. Suppressed requests do not move the counted timestamp; `lookup_counts` reads the persisted result after every call. The historical “en always 1” problem is not reproduced. Existing normalization, per-user isolation and importance-tier tests pass. Frontend StrictMode test confirms exactly one initial POST plus one nested POST; smoke assertion now distinguishes the library GET from incrementing POSTs.

## Verification

- `cd web && npm test`: **391 passed**, 18 files (historical frontend baseline 377).
- `cd web && npm run build`: **passed**, including TypeScript. Existing >500kB bundle advisory remains.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt tests.test_offline_dictionary tests.test_word_notes tests.test_word_lookups tests.test_srs`: **97 passed**. The unchanged suite initially ran 95 here; two regression cases were added. Tests use the existing testenv/temp fixtures, not live users.db.
- `bash /home/mgacai/polish-1.3-out/audit.sh`: raw button **0**, select **0**, input **0**, textarea **0**, details **0**, summary **0**; 38 application TSX files, 34 importing UI.
- `git diff --check`: passed.
- Playwright: source French sentence and desktop popover do not overlap at 768 and 1280; card stays inside viewport; Escape and outside click close it. At 390 the Drawer remains in use. After three correct retypes the input is editable and focused; a further attempt works. Screenshots were visually inspected for star states, English dictionary content, open modules, grid balance, compact Listen card and thin focus ring.

Test/build/audit logs are at `/tmp/p13-tests.log`, `/tmp/p13-build.log`, `/tmp/p13-backend.log`, `/tmp/p13-audit.log`; screenshot run log is `/tmp/p13-shots.log`. Non-failing pre-existing React act warnings and Python datetime deprecation warnings appear in test output.

## Screenshots

Before reference: existing polish-1.2 screenshots under `/home/mgacai/polish-1.2-out/screenshots/`; no fresh before shots were taken before edits.

Preview was restricted to `127.0.0.1:8028`, confirmed free before startup. The adapted script is `/tmp/ui-audit-pw/shots-polish-13.mjs`; the original shots-polish.mjs was untouched. The copied untracked harness uses the fake backend, with selected dictionary responses read from the existing host indexes for representative screenshots. No screenshot route hits a production service. Adapted harness copies are saved outside Git as `/home/mgacai/polish-1.3-out/preview-main-after.tsx` and `/home/mgacai/polish-1.3-out/vite.audit-after.config.ts`.

Screenshot directory: `/home/mgacai/polish-1.3-out/screenshots/`.

- `/home/mgacai/polish-1.3-out/screenshots/p13-after-listen-card-390.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-diff-wrong-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-diff-wrong-390.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-eval-expanded-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-eval-expanded-390.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-study-home-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-study-home-390.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-typeagain-focus-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-typeagain-unlocked-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-card-ipa-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-card-ipa-390.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-card-star-empty-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-card-star-empty-390.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-card-star-filled-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-card-star-filled-390.png`

## Deployment, backup and rollback

Schema/data migration needed: **none**. No historical favorites conversion, table deletion, dictionary rebuild/download or live database access was performed. The backend change is an optional request field and save behavior only. Deploy the frontend and matching backend together so exact starred targets are honored.

At deployment, retain the existing standard database backup and previous application release using the normal service procedure. No backup of production was attempted in this run. Rollback is application-code rollback to the prior release; no schema rollback or automatic database restore is needed. New exact-target cards remain valid rows and favorites remain intact. Unstarring intentionally deletes only selected cloze rows; reverting code does not recover user-deleted cards. Recover data from a verified backup only if recovery is specifically required.

Production containers, compose/Docker files, image tags, tunnels, live users.db, credentials, models and outputs were not modified. No Docker build/run or deployment took place. Only the branch specified by the user is pushed. The preview is stopped at completion; temporary harness files are excluded from Git.

## Open issues

No release-blocking issue found in this scope. Existing failli dictionary ordering can foreground an adjective gloss instead of the verb; contextual English remains separate and correct for the sentence. A corpus/ranking improvement would be separate work. Personal-deck old-stack features remain deferred as requested. Build bundle-size advice and existing test warnings remain.

## Commits

Implementation: `779e64a75e1a1b471b620d824cb63633719f44f5` — design: v1.3.0 deck stars, IPA playback, review diff and unlimited retyping.

The separate report commit is the commit containing this file; retrieve with `git log -1 --format=%H -- REPORT-polish-1.3.md`. Both commit IDs are also included in the final handoff. Commit messages record Tool: Codex CLI and Model: gpt-6.1-sol.


## TASK 8 — Remove Review grammar notes (follow-up)

Removed the entire “Grammar notes (N)” accordion from the shared revealed Review column, including word, listen and speak cards. Backend grammar data, schema, APIs, saveNote extras, card metadata, Study’s Grammar tab and “See grammar in this sentence” remain untouched. The frontend regression checks absence of the section while the card’s grammar snapshot is still present.

Screenshots (fixture retains grammar that previously produced the accordion):
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-no-grammar-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-no-grammar-390.png`

## TASK 9 — Review answer autofocus

Unrevealed typing cards focus `#rev-input` on mount and whenever index/card changes, including repeated learning cards. Navigation’s deferred heading focus now gives the Review answer input priority; advancing also focuses the next input instead of the card container. Revealing does not refocus the hidden field. Touch/mobile uses the same focus behaviour: no coarse-pointer exclusion, since no layout break was demonstrated. Responsive browser checks passed; no physical-device keyboard claim is made. Type it again retains its existing refocus.

Input, textarea, select, contenteditable, dialog and menu guards protect session shortcuts. The answer’s local Enter handler checks once and stops propagation (preventing duplicate checking/audio); composition is respected. Tests cover initial focus, navigation focus, next-card focus, 1/5 while typing, Type it again’s shortcut guard and Enter checking.

Screenshot: `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-input-focus-1280.png` (automatically focused, stock focus ring; no manual focus for this shot).

## TASK 10 — Correct-answer pronunciation and spoken default

Every correct Type it again attempt keeps the soft success chime and invokes `sayFrench(target, 1, "fr-CA-JeanNeural")`, including attempts beyond 3/3. Correct main typed Checks invoke the same one-shot path exactly once; incorrect Checks do not pronounce the answer. Listen/Speak have no fabricated typed-answer audio. The existing one-shot player cancels its previous clip and pauses main playback through sayFrench. The helper now accepts an optional voice override: existing word/sentence callers retain their prior voice selection, while these reinforcement calls explicitly use Jean.

`DEFAULT_FEEDBACK.spoken` is false (pending Ben’s confirmation). Missing spoken fields also take that default. The Excellent clip, preference control and persistence remain available. Saved `spoken: true` remains true; no localStorage preferences were wiped. A main typed Check that plays pronunciation suppresses spoken praise even when enabled, retaining the chime so the two TTS voices do not start together. Other feedback continues to honour the saved spoken preference. Tests assert the target text and Jean override on a correct Check and all four correct retypes, and verify unset versus saved-true preferences. No extra audio screenshot required.

## TASK 11 — Hidden desktop 5, soft archive and Undo

Unmodified desktop key 5 invokes the same persisted soft-archive endpoint used by the existing Mark mastered mechanism: `POST /api/srs/cards/{card_id}/archive` with `{ "archived": true }`, backed by `srs.set_archived`. No mastered flag, deletion, database schema change or migration was added. The menu and shortcut share this action. The card advances after the archive succeeds without confirmation; the last card completes the session. A failed archive keeps the current card and announces the failure. Repeated keys and modifiers are ignored; 5 is excluded on coarse pointers and never shown as a button chip.

The stock Sonner toast reads “Marked as mastered” with an Undo action, lasts six seconds, and does not block the next card. Undo posts `{ "archived": false }` and returns the card to the current position when that session is still mounted, preserving subsequent work and session totals. Otherwise it still unarchives and announces restoration. Rollback: POST the same archive endpoint with `{ "archived": false }`, or Restore in Mastered. Tests cover archive+advance, last Listen/Speak completion, typing guards and Undo restoration.

Screenshot: `/home/mgacai/polish-1.3-out/screenshots/p13-after-review-mastered-toast-1280.png` (real archive shortcut against fakeBackend, next card and stock Undo toast visible).

## TASK 12 — Structured Simplified Chinese word origin

The etymology prompt now requires Simplified Chinese explanations, glosses and language labels, preserves citation forms such as à, fin, ad, finem and finis, states uncertainty and distinguishes mnemonic associations. Responses add `lang: "zh"`, `schema_version: 2`, `construction: [{form, gloss_zh}]`, `source: [{lang, form, from_form}]`, `sense_history_zh` and `memory_zh`; the plain `text` fallback remains for old clients and Chinese plain model replies. Typed Pydantic response parsing bounds fields before caching. English-only, empty and error replies are rejected rather than cached.

The existing etymology text column stores structured JSON; no database schema changes. The `zh:v2:{lemma}` cache namespace regenerates legacy English/old origins on the next section expansion, without deleting legacy cache entries. The old request language field is still accepted, but explanations now always use Chinese. No eager etymology request on word-card open: the module stays collapsed and mounts its loader only when expanded. While generating, it shows the existing Spinner. Failure shows “暂无法获取词源，请重试。” plus Retry; failed requests are evicted from the client promise cache, and no failure string is stored as an origin.

The stock layout uses small muted labels 构成 / 来源 / 词义演变 / 记忆提示, omits empty blocks and distinguishes source forms with serif text/language attributes. Construction parts use stock link Buttons wired to the same nested dictionary drill as dictionary chips. fakeBackend returns a structured Chinese example. Frontend tests cover lazy loading, Retry, Chinese blocks, preserved source forms and clicking fin into its nested card. Eight isolated backend tests cover persistent Chinese caching, legacy-English regeneration, JSON/source preservation, invalid English rejection, authorization, validation and retry after failure.

Screenshots (afin fixture, expanded origin, clickable à and fin):
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-origin-zh-1280.png`
- `/home/mgacai/polish-1.3-out/screenshots/p13-after-word-origin-zh-390.png`

### Follow-up verification and boundaries

Tool: Codex CLI. Model: gpt-6.1-sol. Version remains 1.3.0; Tasks 1–7 were preserved. Branch stayed `design/polish-1.3`; origin was fetched and was not ahead, so no pull was needed. Only `git push origin design/polish-1.3` is used; no PR, main operation, force push or deployment.

- `cd web && npm test`: 396 tests pass across 18 files.
- `PYTHONPATH=tests python3 -m unittest test_etymology -q`: 8 tests pass using testenv’s isolated temporary data and mocked model calls; existing datetime deprecation warnings only.
- `cd web && npm run build`: passes; existing large-chunk advisory only.
- `bash /home/mgacai/polish-1.3-out/audit.sh`: raw button/select/input/textarea/details/summary counts all 0.
- `git diff --check`: clean.

Playwright/Chrome screenshot script: `/tmp/ui-audit-pw/shots-polish-13-followup.mjs`. Browser assertions verified automatic focus and that 5 in the answer input does not master. Screenshots were visually inspected. Preview used only `127.0.0.1:8028`, confirmed free before startup, with fakeBackend and no live LLM or production services. Preview is stopped after verification. Harness copies and screenshots remain outside the commit; no PNG, node_modules, preview-main.tsx or vite.audit.config.ts is staged.

Production containers, compose.yml, Dockerfile, docker, cloudflared, outputs/, live users.db, .env, models and credentials were not touched. No other processes were killed. Reports are appended, and only the requested design branch is committed/pushed.


## TASK 13 — Word-card hierarchy and fewer nested borders

Tool: Codex CLI. Model: `gpt-6.1-sol`. Follow-up only; version stays `1.3.0`.

`WordPopup.tsx` now groups the modules in one stock bordered, rounded container with horizontal dividers. Each section retains its stock Collapsible and accessible heading/name. In this sentence and Dictionary still default open and reset on each new word, nested drill, Back, and reopening; Word origin, Ask AI and Notes remain collapsed. The shared Review evaluation WordPanel receives the same layout. Compact Notes uses the same label typography.

Module triggers and Chinese origin labels use `text-xs font-medium tracking-wide text-muted-foreground`. Meaning, dictionary glosses and origin bodies use normal readable foreground body text. Browser measurements confirm 12px/500 muted section labels versus 14px/400 foreground meaning and gloss. French definition links also use normal weight. French definitions sit in a lightly muted inner block without another border. Stock spacing uses gap-2/gap-3 and px-3/pb-3; the source sentence's French serif size, IPA playback, deck star and clickable construction forms are preserved.

Before/after screenshots were captured and visually inspected at desktop 1280 and mobile 390; the desktop after shot includes expanded French definitions, and the mobile drawer shows the default expanded meaning and Dictionary alongside the collapsed modules. Additional captures show Chinese structured origin labels and Review's shared embed. All paths are under `/home/mgacai/polish-1.3-out/screenshots/`:

- `p13-before-hierarchy-1280.png`
- `p13-before-hierarchy-390.png`
- `p13-after-hierarchy-1280.png`
- `p13-after-hierarchy-390.png`
- `p13-after-hierarchy-origin-1280.png`
- `p13-after-hierarchy-review-1280.png`

## TASK 14 — Remove a selected photo import

Tool: Codex CLI. Model: `gpt-6.1-sol`.

`StudyInput.tsx` adds a stock ghost Button with an X icon and visible accessible name “Remove” beside the photo filename. The filename occupies its own row on small screens so both controls remain legible. The selected-photo preview group is focusable; Backspace and Delete invoke the same removal path only when the group itself is focused, without handling keys from descendant inputs or controls.

Removal aborts any current OCR controller, revokes the created object URL with `URL.revokeObjectURL`, clears both the module-level file and component preview, resets OCR lines/phase/partial state and local error/progress state, clears the file input, announces “Photo removed.” through the existing live region, and focuses the empty choose-photo control. It stays on the photo import screen. Existing abort guards prevent late image preparation or OCR responses from restoring removed content. Choose another photo and the privacy fact line are retained.

Five added frontend cases cover Remove, focused-preview Backspace, focused-preview Delete, removal during image preparation, and removal during an upload. They verify preview removal, the empty choose control, cleared persistent file state on remount, OCR reset, the announcement, object-URL revocation, aborted upload signals and ignored late results.

Selected and removed screenshots were captured and visually inspected, with filename, Remove and privacy fact visible. Paths under `/home/mgacai/polish-1.3-out/screenshots/`:

- `p13-after-photo-selected-1280.png`
- `p13-after-photo-selected-390.png`
- `p13-after-photo-removed-1280.png`
- `p13-after-photo-removed-390.png`

Verification for Tasks 13–14: `cd web && npm test` passes **401 tests across 18 files** (including the five added cases); `npm run build` passes. The build retains its large-chunk advisory. The full suite emits existing React act warnings. `bash /home/mgacai/polish-1.3-out/audit.sh` reports raw button/select/input/textarea/details/summary counts **all 0**. `git diff --check` passes. Preview was bound only to `127.0.0.1:8028`, confirmed free before startup, and stopped after capture. Preview harness files and PNGs are excluded from the commit. No production resources or version metadata were changed.
