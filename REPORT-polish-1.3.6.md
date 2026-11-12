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
