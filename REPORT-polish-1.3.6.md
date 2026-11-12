# polish-1.3.6

Tool: Codex CLI. Model: `gpt-6.1-sol`. Branch: `design/polish-1.3.6`.
Implementation commit: 1ca30a0321385a3923e1b735976e9495f207aec3.

Started at `cb00daa`, preserving `ee0f019` and `cb00daa`. No reset, merge from main, production changes, Docker operations, database migration, or deployment. The nested `ont` → `avoir` tests remain intact and pass; `word_context.VERSION` remains 6. The `testenv` import and following blank line in `tests/test_elision_keys.py` are unchanged.

## Bugs

**A:** FrText selection playback and a trailing Steps row click could start two separate audio elements. Pausing the store player also failed to cancel its pending authentication/load continuation. The audio layer now gives playback a single owner: starting or resuming a handle cancels the previous owner, including pending one-shot or store playback. A pause before loading prevents autoplay. Steps remembers a completed pick/drag, including when opening the phrase card clears the browser selection before the click arrives. The pointer-up handler preserves the selection marker set by FrText's document capture listener. Word taps, Play step, Repeat and Play all steps remain available.

Verification: `src/state/audio.test.ts` uses mocked Audio elements and counts active playback. Store → sayFrench and sayFrench → store each leave exactly one element playing. Superseded pending playTexts/playUrl handles have zero play calls. Pause before loading has zero play calls until resume, then exactly one. The whole-step Range/pointerup/trailing-row-click regression in `StudyWordCard.test.tsx` asserts exactly one sayFrench call and zero startPlayback calls.

**B:** A long selection skipped contextual lookup but still rendered an expression selected by loose word-set overlap. Previous lookup state could also survive a changed pick. Removed that supplemental overlapping-expression path. Short selections request word-context for the exact surface and chosen explanation language, retaining tappable French marks and lemma-specific nested requests. Long selections show only the existing short hint under In this sentence. Cards remount on changed picks; context results are keyed by sentence, surface, occurrence, language and nested status, so old results are not displayed for a new lookup. English/Chinese fake-backend regressions cover an exact short phrase followed by a long selection containing droits, with no human-rights gloss or previous explanation.

## Tasks 1–5

1. New Check yourself sessions default to Step by step. It is first and selected in the stock outlined scope ToggleGroup. Existing session modes remain unchanged. Whole-sentence test/gallery fixtures now set their scope explicitly.
2. Listen & speak tabs are Steps, Sounds, Say it. First group entry opens Steps; remembered tabs and the existing store default remain supported. Screenshot automation enters from Understand and asserts Steps is selected.
3. Repeat this step, Say this step and Review all use stock shadcn outline/sm buttons. Removed inline list padding and negative play-button offset. Play and action rows span the step grid, aligning with Test me / Play all steps and the list edges. All three action buttons fit together at 390px in the fixture.
4. Words is a wrapping interlinear block with serif French over smaller muted English, merged elisions such as l'homme, and the existing order note below. The long content-word grid and Function words collapsible are gone. Tokens still open the word card. Existing alignment is preferred; segment/word data supplies a fallback.
5. Shared StepReview appears on every Steps row and in Check yourself step mode before and after grading. It loads membership with the existing notes lookup and useSavedCards/cardKey("listen"). Add uses POST /api/srs/notes with step French, step English, translation_zh: "", modes: ["listen"], targets: []. Remove uses DELETE /api/srs/cards/{card_id}. Lookup metadata retains the listen-card ID even before the library loads. A sentence-key lock prevents simultaneous duplicate saves; identical step sentences share pressed state. Tests cover add, no duplicate card, shared toggles, remove, persisted-card lookup, and Check yourself question/result. No migration or new endpoint.

Version is 1.3.6 in web/package.json and exactly the two root package-lock version fields. Releases has a new APP_VERSION entry and preserves the former bullets under explicit 1.3.5. The hardcoded PWA registration query string is updated.

## Validation

- `cd web && npm test`: 508 tests passed.
- `cd web && npm run build`: passed; only existing classic-script/chunk-size warnings.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: 667 tests passed.
- Ruff 0.17.4: `ruff check tests/test_elision_keys.py` passed.
- Copied and retargeted 1.3.5 audit: raw button/select/input/textarea/details/summary = 0/0/0/0/0/0.
- `git diff --check`: passed.

Logs and retargeted audit script: `/home/mgacai/polish-1.3.6-out/`. Tests used in-memory fake services and fixture/temp databases.

## Screenshots

All nine light-mode shots were opened and visually inspected. Directory: `/home/mgacai/polish-1.3.6-out/screenshots/`.

- `polish-1.3.6-steps-default-light-390.png`
- `polish-1.3.6-steps-default-light-desktop.png`
- `polish-1.3.6-steps-buttons-light-390.png`
- `polish-1.3.6-check-step-default-light-390.png`
- `polish-1.3.6-check-step-default-light-desktop.png`
- `polish-1.3.6-words-interlinear-light-390.png`
- `polish-1.3.6-words-interlinear-light-desktop.png`
- `polish-1.3.6-phrase-context-light-390.png`
- `polish-1.3.6-phrase-too-long-light-390.png`

Desktop width is 1280px. Preview used fixture-only fetch on 127.0.0.1:8030; the port was checked free before starting and after stopping our preview process. Preview source/config were copied to the output directory and removed from the checkout. No screenshots or dependencies are committed. `/workspace` is absent, so the optional screenshot mirror was unavailable.

Report copy: `/home/mgacai/polish-1.3.6-out/REPORT.md`.

## Follow-up: Bug C, Task D, Task E

Tool: Codex CLI, model `gpt-6.1-sol`, user `mgacai`, host `mini7840`. Continued from `e7dc4ee` on `design/polish-1.3.6`; all earlier implementation, docs, avoir and ruff commits remain intact.

### C — grading normalization and visible corrections

Reproduced the requested pairs before changing comparison code. At this HEAD, frontend and Python already accept NFC/NFD in both directions for représentants/résolu, straight/curly apostrophes in both directions, and Ben's exact answer without the target's final period. All are correct, 100%, with no wrong or accent marks. The reported original 86% result could not be reproduced from those exact strings; it would be inaccurate to attribute it to an NFC or trailing-period defect in this checkout.

A confirmed comparison hole was frontend omission of U+2032 (prime) from APOS, although the backend already folds it. A new regression failed before the fix and passes after adding the same folding. Existing frontend and backend NFC normalization remain in place; no backend comparison change was necessary. Accent strictness remains intact.

The confirmed presentation problem was reliance on semantic `del` styling with muted foreground. Given forms now explicitly use `line-through decoration-2 text-foreground`; accent-only deletions retain dotted decoration and their correct accented counterpart. Missing words use a contrasting underlined expected form. Different words show the struck given form and contrasting expected form side by side; extras show a struck given form. Counts and marks still derive from the same alignment.

Tests: frontend `rules.test.ts` and Exercise result render cover NFD both ways, curly both ways, Ben's exact pair, prime apostrophe, genuine substitution, accent-only, missing and extra tokens. Render tests compare visible mark counts to alignment counts and assert explicit strike classes and expected forms. Python `test_ben_normalization_regressions` covers all normalized pairs at 100% with only ok operations. The fixture screenshot shows fini struck through next to résolu; Chromium computed `text-decoration-line: line-through` and foreground `rgb(42, 38, 34)`.

Commit: `6a9fd3d`.

### D — toggle panels and Try again

Root cause: open-state early returns made Hint and Answer one-way controls; hint visibility doubled as its scoring flag. The answer's faint ghost action also hid only the answer.

Hint now has an independent sticky hinted scoring flag. Answer retains the existing sticky revealed flag and uses coverAnswer for panel visibility. Toolbar buttons toggle, report accurate boolean aria-pressed states, and each panel has a stock shadcn ghost icon close button (Hide hint / Hide answer). The pre-check Answer action is an outline Try again with RotateCcw: it hides both panels, clears the textarea and focuses it while preserving hint-used and answer-known scoring. Result-view Try again still resets the completed attempt's flags.

Tests: ExerciseReveal covers toolbar toggle and panel close in Recall and Dictation, Whole sentence and Step by step; a later Check retains both scoring flags and renders Answer known. The pre-check Try again regression checks cleared/focused input, hidden panels, and preserved scoring. Completed-result Try again is checked for fresh flags. No Try it now remains in the UI.

Commits: `8c0050d`, `9c60520` (scope the added field to QuestionUI, preserving the existing ReviewUI hinted field).

### E — word-card Ask AI voice input

Root cause: Ask AI had text entry and Send only. Added a compact stock shadcn icon mic next to the input and Send, with Record question / Stop recording labels and a pressed recording state. A busy spinner marks permission/transcription work. Unsupported MediaRecorder/getUserMedia hides the control. Permission, recording and transcription errors are dismissible; the input stays usable. Capture tracks are released when stopped or unmounted, in-flight transcription is aborted on unmount, and recording has the existing three-minute limit.

The compact recorder reuses audio focus, the existing transcribeTake API and a shared StudyRecorder MIME chooser: webm/opus, mp4, webm, ogg. It POSTs to the existing /api/transcribe with language=zh and the current French sentence as context. No new service, vendor, key, backend STT change or fix pass was added. Transcription appends with a separating space using the current input value, preserving edits made while processing. It never auto-sends.

Tests: seven fake-backend AskVoice tests cover supported presence, three unsupported fallbacks, start/stop POST and sentence/language context, mp4 selection/payload, appending a second recording after editing, manual Send only, permission denial/dismissal/retry, transcription failure/retry, and track cleanup on unmount. No live ASR model or production transcription endpoint was called.

Commit: `d134a34`.

Voice limitations: physical iPhone Safari/PWA and physical Mac Chrome microphone capture were not tested. iOS requires a user tap and microphone permission, may select mp4 only, and recording can be interrupted by app/background changes. Mac Chrome also requires microphone permission. Browser support and local STT recognition of mixed Chinese/English/French determine results; reviewed text is editable before sending. Unit tests use an mp4-only fake recorder and fake backend; screenshots use desktop Chromium at a 390px viewport.

### Final verification for C/D/E

- `cd web && npm test`: **534 passed**, 24 test files (previous 508). Existing React act warnings remain non-fatal. The avoir nested-lemma tests remain unchanged and pass in StudyWordCard.
- `cd web && npm run build`: passed; existing classic PWA script/chunk-size warnings only.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: **668 passed** (previous 667), fixture/temp DBs only.
- Raw-element audit: **button=0, select=0, input=0, textarea=0, details=0, summary=0**; 40 app TSX files, 37 importing UI components, 1337 className uses, CSS remains 232 lines.
- `git diff --check`: clean.
- `uvx ruff==0.17.4 check tests/test_elision_keys.py`: all checks passed. The ruff blank line remains unchanged.
- Logs: `npm-test-cde.log`, `python-test-cde.log`, `build-cde.log`, `audit-cde.log` in the output directory.

Four 390px light-mode screenshots captured and visually inspected under `/home/mgacai/polish-1.3.6-out/screenshots/`:

- `polish-1.3.6-ask-ai-mic-light-390.png`
- `polish-1.3.6-check-hint-open-light-390.png`
- `polish-1.3.6-check-answer-try-again-light-390.png`
- `polish-1.3.6-check-grade-mark-light-390.png`

The hint screenshot was recaptured after inspection to show the panel and close control fully. The mic is visible beside Ask AI's input; Answer has an outline Try again and close control. Preview used the same fixture entry and fake backend, only on 127.0.0.1:8030, confirmed free before launch. Preview stopped and 8030 confirmed free afterward. Temporary preview source/config removed from the checkout; screenshots remain outside Git. /workspace does not exist, so the optional mirror was unavailable. No main push, force push, PR, deploy, Docker operation or production change.

## Follow-up: Bug F — comma tokenization

Tool: **CodeBuddy Code, model `HY4 (hy4std)`**, user `mgacai`, host `7840`. Codex was out of quota. Continued from `bcc012b` on `design/polish-1.3.6`; all A–E implementation, docs, avoir and ruff commits remain intact. No main merge/push, PR, force-push, deploy, Docker, migration or production change.

### F — a comma with no following space glued two words and drifted the alignment

**Root cause (confirmed):** `web/src/lib/grading.ts` `tokenize()` split the sentence on whitespace only, then stripped punctuation from each whitespace chunk with `.replace(/[^\p{L}\p{N}']/gu, "")`. `"nationale,ont"` therefore collapsed into ONE key `nationaleont`; the existing Levenshtein/DP `align()` then shifted the surrounding tokens, so both `ont` and `en` were marked wrong. The Python `dictation.py` `tokenize()` already split on every non-word character, so it never had the comma bug, but it deliberately split elisions (`l'` + `homme`) via `_split_elision`, diverging from the frontend one-unit rule.

**Fix:**
- `grading.ts` now NFC-normalizes and folds typographic apostrophes to ASCII, then splits each word on a `SEPARATOR` run of anything that is not a letter, digit or apostrophe. `"nationale,ont"`, `"nationale, ont"` and `"nationale , ont"` all yield the same two keys `nationale`, `ont`; punctuation produces no token at all, so it can never be right or wrong. Apostrophes stay inside an elision (`l'homme`, `j'ai`, `d'exposer`, `aujourd'hui` = one token). The existing DP alignment is unchanged: once tokens split correctly, one glued or accented token no longer shifts its neighbours. NFC, accent-strictness, prime/curly-apostrophe folding and the trailing-period behaviour from Bug C are intact.
- `dictation.py` now keeps elisions as ONE token too (removed `_split_elision`, `_split_merged`, `ELISION_PREFIXES`; `grade()` aligns `tokenize(answer)` directly). `tests/fixtures/dictation_cases.json` was regenerated from the new tokenizer and checked by hand. Consequence, now consistent on both graders: writing an elision as two words (`"l homme"`, `"qu' il"`) is a word-level error, while a merged elision with a dropped apostrophe (`"lhomme"`, `"jai"`) remains an accent-level slip. Accent-strictness and the Bug C NFD / curly-apostrophe / trailing-period cases are unchanged.

**Tests:**
- Frontend `rules.test.ts` (+5): glued-comma tokenization and spacing equivalence, punctuation never a token, Ben's exact regression (`ont`/`en` ok, only the `Assemblée` accent marked, counts not drifted), the NFD / trailing-period / curly / elision cases fully correct, and elisions as single tokens. `ExerciseReveal.test.tsx` (+1 render): a genuinely wrong word still shows a line-through strike plus its correct form, `N right · M wrong` matches the alignment marks, and `ont`/`en` stay ok.
- Python `test_dictation.py` (+5 `BugFCommaTokenizationTests`): glued comma, punctuation never a word, Ben's regression, resolu NFD + trailing period, and one-token elisions with curly apostrophes. Elision-related assertions and `dictation_cases.json` were updated carefully; `test_ben_normalization_regressions` (Bug C) is unchanged and still passes.

### Final verification for F

- `cd web && npm test`: **540 passed** (previous 534), 24 test files.
- `cd web && npm run build`: passed; existing classic PWA script / chunk-size warnings only.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: **673 passed** (previous 668), fixture/temp DBs only.
- Raw-element audit: **button=0, select=0, input=0, textarea=0, details=0, summary=0**; 40 app TSX files, 37 importing UI components, 1337 className uses, CSS 232 lines.
- `git diff --check`: clean.
- `uvx ruff==0.17.4 check tests/test_elision_keys.py`: all checks passed (also clean on `dictation.py` and `test_dictation.py`).
- Avoir nested-lemma tests (Python `test_word_context` 31, frontend `StudyWordCard` 40) and Bug C regressions pass unchanged.

Commit: `fix: split punctuation in grading tokens so commas do not glue words (1.3.6)`. A brief 1.3.6 release-note bullet was added to `web/src/data/releases.ts`. No screenshot was captured (optional); preview port 8030 was not started, and `preview-main.tsx` / `vite.audit.config.ts` were not added to the checkout. /workspace is absent, so the optional mirror was unavailable.
