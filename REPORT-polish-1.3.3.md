# Polish 1.3.3

Tool: Codex CLI. Exact model: gpt-6.1-sol. Operator: mgacai on host 7840.
Branch: design/polish-1.3.3, based on origin/main at 99cabb4.
Implementation commit: 6befb76a302fe9625bab1e13518d2180196c978f.

## Changes

Importance uses five small dots: filled dots use primary, empty dots use a muted token. The shared component updates word cards, the saved-cards column, and the Design gallery. The mapping remains 0–4 lookups → 3/5, 5–9 → 4/5, 10+ → 5/5. Visible lookup counts and importanceLabel remain intact. Lucide Star is now used only by WordDeckStar. The gallery names the dots and uses the primary color in its contrast sample. A word-card regression test checks an empty deck star alongside five non-star indicators and “1 lookup”.

Recall and Dictation, in whole-sentence and step modes, now show a large percentage, verdict, right/wrong counts, and a separate accent count when needed. One inline alignment shows normal correct words, muted struck wrong words followed by destructive corrections, muted missing words, struck extra words, and dotted accent corrections. Wrong-word/correction pairs stay together when wrapping. The complete correct sentence remains tappable inside a light muted inset. The result footer contains only Try again and Next, or the existing Done destination on the final item. The prose issue list and History footer link are removed. History saving, failed-save retry, server-controlled correctness, and submission behavior are retained.

The existing frontend weighted alignment was extended to supply ordered inline operations and counts; no third grader was added. The accent alignment cost is now 0.5, matching dictation.py. Its established score formula is reused: round(100 × (ok + 0.5 × accent) / (expected normalized word count + extra)). The bdec0d8 JavaScript was not copied. NFC, case and punctuation normalization, hyphen/space equivalence, and existing accent/œ rules remain. “Ma machine a lav fui” against “Ma machine à laver fuit.” yields 50%, 2 right, 2 wrong, and 1 accent correction. Existing answer/target marks remain available for other consumers.

The service-worker test checks shutil.which("node") before running the VM subprocess. Node-present environments still execute all VM assertions. Node-absent environments continue through the source assertions for cache deletion, HTTPS-only registration, and root scope. A regression test simulates absent Node and verifies no subprocess runs. No Node dependency was added to the production image.

Version is 1.3.3 in web/package.json and the two root package-lock version fields only. RELEASES begins with APP_VERSION and retains the preceding bullets under explicit 1.3.2. Schema changes: none.

## Verification

- `cd web && npm test`: 420 passed across 18 files (409 previously; 11 added).
- `cd web && npm run build`: passed. Vite reports its existing large-bundle and classic PWA-script bundling warnings.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: 634 passed.
- `PYTHONPATH=".:tests" python3 -m unittest test_pwa -v`: 10 passed, including the real Node VM test and simulated absent-Node test.
- `bash /home/mgacai/polish-1.3.3-out/audit.sh`: raw button/select/input/textarea/details/summary = 0/0/0/0/0/0; 38 app TSX files; 34 importing UI; 1335 className uses; 222 CSS lines.
- `git diff --check`: passed.
- Browser fixture assertions passed for all 12 required screenshots: empty deck star, five dots, 5 lookups, correct score, inline marks, two footer actions, no prose issue list, and no horizontal page overflow. Tests cover both exercise kinds and both scopes with correct and mixed results, including final-item footers.

Logs and the reusable fixture preview harness are saved in /home/mgacai/polish-1.3.3-out/. The preview used only 127.0.0.1:8030, confirmed free before starting, and was stopped after screenshots. The harness uses the fake backend and fictional data. No production login, live database access, production container operation, image build/tag, main push, merge, force-push, or PR was performed.

## Screenshots

All required screenshots were captured and visually inspected at 1280 and 390 pixels. Importance contains no stars; results have the score hierarchy, inline marks, light correct-answer inset, and Try again + Next only. Files are under /home/mgacai/polish-1.3.3-out/screenshots/:

- polish-after-importance-phrase-1280.png
- polish-after-importance-phrase-390.png
- polish-after-importance-word-1280.png
- polish-after-importance-word-390.png
- polish-after-recall-whole-1280.png
- polish-after-recall-whole-390.png
- polish-after-recall-steps-1280.png
- polish-after-recall-steps-390.png
- polish-after-recall-correct-1280.png
- polish-after-recall-correct-390.png
- polish-after-dictation-1280.png
- polish-after-dictation-390.png

The additional copy to /workspace/polish-1.3.3/screenshots/ was unavailable: /workspace does not exist and attempting to create it returned Permission denied. Screenshots, node_modules, preview-main.tsx and vite.audit.config.ts are excluded from commits.

The report is also copied to /home/mgacai/polish-1.3.3-out/REPORT.md. Delivery uses only `git push -u origin design/polish-1.3.3` to retarget this branch's upstream.


## TASK 4 — Recall word-chip activation

Follow-up implementation: af99adc71bce69aa18545e95eadac11880b09928. Tool: Codex CLI; model: gpt-6.1-sol. Version remains 1.3.3; the earlier Importance, result hierarchy and CI Node-skip changes are retained.

Root cause: FrText discarded every click with detail > 1 and gated clicks with a non-collapsed native selection on the remembered lastWasClick flag. A rapid/repeated click after dismissal could therefore highlight/select a chip without emitting onPick; a stale native phrase selection could also swallow an accessibility/programmatic click without a new pointer sequence. The analysis phrase-overlap logic only supplies card content and does not block opening. Both Exercise and Study already create fresh pick objects; no parent text-equality guard needed removal.

Reproduced against the original committed FrText on the fixture-only 127.0.0.1:8030 Playwright harness: open laver, dismiss, send a browser click with clickCount=2 → zero open cards. The identical check with the fix → one open laver card. The new regression test fails against the original component (no picks) and passes with the fix. Evidence: baseline-browser.log, baseline-test.log, fixed-browser.log and reproduce-baseline.cjs under /home/mgacai/polish-1.3.3-out/.

The shared component now suppresses only the immediate click belonging to a deliberate mouse drag. A new pointer gesture or the end-of-event-loop cleanup clears suppression; click counts and old selections cannot suppress a fresh word activation. Explicit word taps clear the old native range and always emit a new pick. Keyboard activation and selection position deduplication remain. The Recall desktop host now passes the clicked element as the popover anchor, keeping the correct-answer line visible above the card.

Browser checks cover native drag-selection of Ma machine, close then laver, repeated laver close/reopen, neighbouring machine/à/fuit clicks, and a multi-click activation. Existing selection/keyboard tests and the Study/Review suites pass. Browser engine: Chromium on Linux; desktop Mac Safari was not available in this environment.

Screenshots: /home/mgacai/polish-1.3.3-out/screenshots/polish-after-recall-laver-card-1280.png and polish-after-recall-laver-card-390.png. The laver card is open and has no grammar entry point.

## TASK 5 — Correct result focuses Next

The shared Recall/Dictation Result focuses its Next control, including the final-item Done destination, after a correct grade. Document capture listeners track whether Enter is still held. Focus waits until keyup and a subsequent animation frame, so the submitting event cannot activate the new control. Repeated Enter keydowns are ignored both in the textarea check path and on Next. A fresh Enter on Next advances once; normal pointer and Space activation remain. Incorrect results retain result-container focus and do not auto-advance. The focus listener stops after the initial transfer so later keyboard work in a word card cannot steal focus back.

ExerciseReveal tests cover Recall and Dictation in whole and step scopes, final Done controls, a held textarea submission, repeat suppression, fresh Enter once, Check-button Enter release, ordinary Next navigation and incorrect results. Browser assertions hold Enter through the asynchronous grade, verify Next is not yet focused, release Enter, verify Next focus, then press a fresh Enter to advance.

Screenshots: /home/mgacai/polish-1.3.3-out/screenshots/polish-after-recall-correct-next-1280.png and polish-after-recall-correct-next-390.png, showing the focus ring.

## TASK 6 — Remove word-card grammar entry point

Removed the ghost grammar action and onGrammar prop from the shared WordPanel API and its Study/Exercise callers. This covers desktop popovers, mobile drawers, Review and other shared hosts. StudyWordCard no longer expects or clicks the removed label; it asserts the card has no grammar entry point. Sentence-level Study grammar and all backend grammar data, analysis and endpoints are unchanged. All newly captured word-card shots show the removal; no replacement copy was added.

## TASK 7 — Old navy-slate dark palette and theme preference

Mapped /home/mgacai/projects/tts-old-src/static/tokens.css dark tokens onto shadcn: background #141a23, card/popover/sidebar #1b2430, secondary #202b38, muted #273444, foreground #d5deea, muted text #a5b4c7, border #354357, primary/ring #91b5e6, accent text #a3bfd3, danger #eca1a9 and success #8dcca5. Chart tokens use the same palette. The light warm-paper/olive palette remains. The .dark block sets color-scheme: dark.

The account dropdown uses stock DropdownMenuRadioGroup/DropdownMenuRadioItem with Light, Dark, System. Default is System; localStorage key theme persists the explicit choice. The helper reads stored values, applies the html .dark class, and attaches/cleans up a live prefers-color-scheme change listener. The no-flash bootstrap is the small blocking external /static/theme-boot.js in web/index.html's head. It reads storage and system preference before paint, uses no inline script or eval, and is compatible with script-src 'self'. web/index.html is the sole SPA HTML entry. PWA theme-color metas have light/dark media queries (#f7f4ee / #141a23). Apple status-bar-style remains default for both schemes: the opaque native status bar avoids a translucent overlay; no unsupported per-scheme Apple meta was introduced. The PWA manifest retains its light installation fallback.

Audited application color literals and utilities: word cards, drawers, Study player, Review, result corrections, charts and toast surfaces inherit tokens. TypeAnswerDiff now uses a theme-aware success token instead of green-700; legacy error references use destructive, the OCR warning uses primary, and the account initials have contrasting primary-foreground. Design gallery literal swatches remain reference samples; stock UI component styling is retained.

Theme tests execute the actual external boot script for light/dark/system/invalid/missing stored choices with both OS schemes, and check storage reading/writing, html class application, live System updates and listener cleanup. PWA tests verify both theme-color metas and the blocking script in source and built SPA shells.

Follow-up verification:

- cd web && npm test: 435 passed across 19 files (15 added). Log: followup-tests-verified.log.
- cd web && npm run build: passed; existing classic PWA-script and large-bundle warnings remain. Log: followup-build-final.log.
- PYTHONPATH=".:tests" python3 -m unittest test_pwa -v: 10 passed using testenv/temp DBs. Log: followup-pwa-final.log.
- bash /home/mgacai/polish-1.3.3-out/audit.sh: raw button/select/input/textarea/details/summary counts all 0; 38 app TSX files, 34 importing UI, 1334 className uses, 232 CSS lines. Log: followup-audit.log.
- git diff --check: passed.
- Playwright fixture assertions passed at 1280 and 390, with no horizontal page overflow. Dark screenshots were visually inspected: navy-slate page, lighter cards, readable text and light-blue accents. Menu captures wait for the opening animation to finish.

All 18 follow-up screenshots are under /home/mgacai/polish-1.3.3-out/screenshots/:

- polish-after-recall-laver-card-1280.png
- polish-after-recall-laver-card-390.png
- polish-after-recall-correct-next-1280.png
- polish-after-recall-correct-next-390.png
- polish-after-study-light-1280.png
- polish-after-study-light-390.png
- polish-after-study-dark-1280.png
- polish-after-study-dark-390.png
- polish-after-recall-light-1280.png
- polish-after-recall-light-390.png
- polish-after-recall-dark-1280.png
- polish-after-recall-dark-390.png
- polish-after-wordcard-light-1280.png
- polish-after-wordcard-light-390.png
- polish-after-wordcard-dark-1280.png
- polish-after-wordcard-dark-390.png
- polish-after-theme-menu-light-1280.png
- polish-after-theme-menu-dark-1280.png

The optional /workspace copy remains unavailable because /workspace is absent/not writable. Browser script and logs remain in the external output directory. The fixture preview bound only 127.0.0.1:8030 after checking it was free; it is stopped and the port is confirmed free. Temporary preview source/config were removed from the checkout. No screenshot PNGs, node_modules or preview files are committed. No protected production resources or other processes were touched. Delivery is restricted to origin design/polish-1.3.3.


## TASK 8 — Uncrowd Study > Check yourself (Recall and Dictation)

- Kept the primary Understand / Listen & speak / Check yourself switch. Moved Recall / Dictation Tabs into the exercise toolbar beside the Whole sentence / Step by step ToggleGroup. The toolbar stays on one row at 390px and 1280px.
- Removed the redundant Recall / Dictation heading, separate heading/meta row, sentence-count repetition, divider, standalone reveal icons, banner chrome, and sticky action wrapper. Question, optional step, and source now form one muted metadata line.
- One stock shadcn Card holds the prominent English prompt (or Dictation listening prompt and player), collapsed hint/answer insets, textarea, and one Check / Hint / Answer action row. Hint and Answer use ghost buttons with stable labels and pressed states. Revealed inset labels keep Lightbulb / Eye inline; Try it now belongs inside the Answer inset and retains answer-known scoring.
- Recall and Dictation share this structure in whole-sentence and step-by-step modes. Results stay inside the same card with the existing large score, counts, inline corrections, correct-answer inset, Try again / Next, and correct-result Next focus with Enter-release protection. Existing word-card behavior and dark theme remain intact; version stays 1.3.3.
- Verification: `cd web && npm test` — **439 tests passed, 19 files passed**, including 25 ExerciseReveal tests. Added layout/reveal coverage for both modes and scopes, retained inline-mark and keyboard-focus coverage, and updated the exercise smoke selector. Tests use fixtures and the fake backend only. `npm run build` passed (existing bundle-size advisory); `bash /home/mgacai/polish-1.3.3-out/audit.sh` passed with all six raw-control counts **0**; `git diff --check` passed.
- Screenshots: `/home/mgacai/polish-1.3.3-out/screenshots/`:
  - `polish-before-check-{recall,dictation}-{1280,390}.png` — committed baseline, captured before redesign; recaptured from unchanged HEAD source after dismissing the fixture word-card overlay.
  - `polish-after-check-{recall,dictation}-{light,dark}-{1280,390}.png`.
  - `polish-after-check-recall-result-{light,dark}-{1280,390}.png` — correct step result with Next focused.
  - Additional `polish-after-check-{recall,dictation}-revealed-{light,dark}-{1280,390}.png` — step-by-step hint/answer insets.
  - Visually reviewed desktop/mobile light/dark captures; browser assertions confirm one action row, no horizontal overflow, inline inset icons, and focused Next. `/workspace` does not exist and its parent is not writable, so the optional copy was unavailable.
- Evidence: `task8-tests-verified.log`, `task8-build.log`, `task8-audit.log`, and `task8-screenshots.cjs` under `/home/mgacai/polish-1.3.3-out/`. The first full-suite invocation ended without a summary; the completed rerun above passed all 439 tests.
- Tool: **Codex CLI**. Model: **gpt-6.1-sol**.


## TASK 9 — Standalone Recall/Dictation sessions and PWA register version

- Reused the existing Exercise toolbar, single muted question/step/source line, stock shadcn Card, collapsed reveal insets, shared answer actions, and in-card results. RunScreen already mounts Exercise with an sr-only page title and Recall/Dictation > Session breadcrumb; retained that structure and the focused shell Exit control. No duplicate session layout or launcher redesign was needed.
- Tightened the shared toolbar so justify-between applies only when modeTabs exists; standalone scope controls align compactly at the left. Removed the unused Exercise compact prop and its Check yourself call-site argument. Scoring, history saving, tappable French words, dark theme, and correct-result Next focus with Enter-release protection remain shared.
- Extended ExerciseReveal coverage through RunScreen for both kinds/scopes: hidden title, breadcrumb, no tabs, toolbar alignment classes, one muted meta line, one Card, Check/Hint/Answer row, collapsed defaults and inline inset icons. Wrong/correct result tests now mount RunScreen; Check-button Enter-release and next-question focus tests also mount RunScreen. Existing Check yourself/modeTabs and keyboard coverage remain.
- Changed web/index.html pwa-register query to 1.3.3 without changing package.json or routers.pages.ASSET_VERSION. Both Python suites read web/package.json; source and optional built dist/index.html must match. Updated the script allowlist to include the existing theme-boot script.
- Verification: cd web && npm test — **443 tests passed, 19 files passed**. npm run build passed with existing classic PWA-script/chunk-size warnings; dist/index.html contains pwa-register.js?v=1.3.3. PYTHONPATH=".:tests" python3 -m unittest tests.test_app_shell tests.test_pwa -v — **27 tests passed**, including Node-unavailable skip coverage. Tests use fixtures/temp resources only. audit.sh reports raw button/select/input/textarea/details/summary counts all **0**. git diff --check passed.
- Captured and visually inspected **20 standalone screenshots** under /home/mgacai/polish-1.3.3-out/screenshots/:
  - standalone-recall-prompt-{light,dark}-{1280,390}.png
  - standalone-recall-revealed-{light,dark}-{1280,390}.png
  - standalone-recall-wrong-{light,dark}-{1280,390}.png
  - standalone-recall-correct-{light,dark}-{1280,390}.png
  - standalone-dictation-{light,dark}-{1280,390}.png
- Browser assertions verify /app/study/run, focused Exit header, no tabs or visible main-column headings, a compact left-aligned scope toolbar, one Card, same-row answer actions, inline inset icons, correct-result Next focus, and no horizontal overflow. Optional /workspace/polish-1.3.3/screenshots copy was unavailable (not writable).
- Evidence: task9-tests.log, task9-build.log, task9-python.log, task9-audit.log, task9-screenshots.log, task9-screenshots.cjs, and standalone-contact-{390,1280}.jpg in /home/mgacai/polish-1.3.3-out/. Preview used only 127.0.0.1:8030 after a free-port check, then stopped; port confirmed free. Temporary preview source/config removed. No screenshot PNGs or node_modules are committed; protected production resources and other processes were untouched.
- Tool: **Codex CLI**. Model: **gpt-6.1-sol**.
