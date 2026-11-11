# Final cleanup pass (1.1.0)

Branch `design/redesign-v2`. Version stays 1.1.0. Nothing was merged. Nothing was pushed to `main`. No pull request.

Tool: `grok 1.0.77 (50ca579fa996) [stable]`. Model: grok-4.7.

## Commits

- Parent: `d657216` (docs: record the stock shadcn commit SHA).
- Design commit: `063c826b07881d60acc91a85e1f99b2c79a96f63`
- https://github.com/BenjaminGao2025/french-audio-studio/commit/063c826b07881d60acc91a85e1f99b2c79a96f63

`@tanstack/react-table` was already `^9.3.1` in `web/package.json` and the lockfile. This pass did not change those files.

## Audit

Script: `bash /tmp/rd-audit.sh`. Non-test `.tsx` outside `components/ui`, excluding `preview-main.tsx`.

Before this pass (after the stock shadcn commit):

```
app_tsx_files=34
files_importing_ui=30
raw_<button>=0
raw_<select>=0
raw_<input>=0
raw_<textarea>=0
raw_<details>=0
raw_<summary>=0
className_uses=1154
css: 190 ./styles.css
export function in web/src/components/ui/index.tsx: 18
```

After:

```
app_tsx_files=34
files_importing_ui=30
raw_<button>=0
raw_<select>=0
raw_<input>=0
raw_<textarea>=0
raw_<details>=0
raw_<summary>=0
className_uses=1340
css: 190 ./styles.css
export function in web/src/components/ui/index.tsx: 9
```

Raw controls stay 0. The hidden photo file input is still split across lines, so the audit regex does not count it. `<audio>` and clickable French word spans stay native. `className` rose because call sites now carry the stock utility classes that the wrappers used to own. CSS line count did not change.

## Per item

1. Copy. Empty states are a short title and at most one action. Removed the listen sermon, the saved-list “come back in Review” line, “First introduction…”, the family-day lecture, the devices essay, and the same kind of page descriptions on Practice, History, Episodes, and Study. Labels, counts, real errors, disabled reasons, keyboard hints, and the quota sentences stay. The exam badge still says “questions not yet verified” because the smoke test asserts that line.
2. Sentence More. The empty Collapsible bar is an outline Button labelled “More”, with the MoreHorizontal icon. The menu lists Analyses in History, New text, and Edit source / Hide source. It is closed by default and does not stretch full width.
3. Saved. The table is `useLegacyTable` + `flexRender` + the shadcn Table (TanStack Table v9 exposes the v8 API on `@tanstack/react-table/legacy`). One filter row, one count, favorites, and practice-from-selection. The Checkbox column appears only while selecting. French wraps. Importance and the other short columns are `whitespace-nowrap`. History already used the same table pattern; its wrap rule now keys off the column id.
4. Player. At 390 the bar is one row: previous, play, next, n/N, and a “More playback controls” menu (time, speed, repeat, play all, add to review). At 1440 the full row stays on one line.
5. Progress streak is a stock Card above Level. Practice destinations are the cards themselves. History “Open” buttons stay.
6. Wrappers. Deleted Button `kind`, Banner, Pill, DemoNote, FieldText, Segmented, the custom Tabs wrapper, Disclosure, and ChoiceSelect. Call sites import stock components from their own files. `index.tsx` keeps DisabledReason, Spinner, Skeleton, PageHead, Dialog, WordDock, Popover, Importance, Stat, and re-exports. Count: 18 export functions before, 9 after.
7. Phonetic. `web/src/test/fakeBackend.ts` returns raw IPA for the preview words (`failli` → `/fa.ji/` → `[faji]`, `tombé` / `tomber` → `/tɔ̃.be/` → `[tɔ̃be]`). `madame` stays empty so the word-card test still reads the sentence IPA. The mock lives in a committed file.
8. `REDESIGN.md` now describes the sidebar, the More menu, the 390 player, the data table, the copy rules, and the remaining helpers. This file is the report for the pass.

## Tests

- `cd web && npm test`: 17 files, 361 passed.
- `cd web && npm run build`: passed (`tsc --noEmit` and Vite).
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt`: 25 passed. `auth_db` utcnow deprecation warnings are pre-existing.

## Screenshots

52 files, `after4-<page>-<1440|390>.png`, in both `screenshots/` and `/home/mgacai/redesign-v4-out/screenshots/`. Preview was `127.0.0.1:8027` only. `before-*`, `after-*`, and `after3-*` were not overwritten. PNGs, `web/src/preview-main.tsx`, and `web/vite.audit.config.ts` are not committed.

Pages: study-home, workspace-listen, workspace-words, workspace-recall, word-card, review-home, review-session, review-session-revealed, saved-list, practice, progress, episodes, settings, settings-feedback, login, login-gate, recall-reveal, practice-listen, practice-speak, practice-write, practice-studio, practice-feedback, grammar-map, own-words, photo-import, history.

Checked by eye: sentence 1440 and 390 (More is a small closed button; the 390 player is one row), saved list (Importance on one line), word card (`[faji]`), review session, progress (streak card), practice (whole-card actions), study home.

## Leftovers

- The review quota Collapsible (“How new cards are introduced”) stays. Smoke tests read those sentences from the DOM.
- `progress/devices` is a title-only page. The button still opens it. The counting essay is gone.
- “Listening on the go” remains a lane name in `web/src/api/time.ts`.
- The design-reference screen still contains the token and accessibility notes. It is the catalog, not an empty state.
- Real errors, disabled reasons, and grade key hints stay.
