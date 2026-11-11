# Mobile gutters, player bar, review explainer (1.1.0)

Branch `design/redesign-v2`. Version stays 1.1.0. Nothing was merged. Nothing was pushed to `main`. No pull request.

Tool: `grok 1.0.77 (50ca579fa996) [stable]`. Model: grok-4.7.

## Commits

- Parent: `be09a56` (docs: record the final cleanup commit SHA).
- Design commit: `4d4f56c6d7036ce093bdf6145edcfbadbef2155d`
- https://github.com/BenjaminGao2025/french-audio-studio/commit/4d4f56c6d7036ce093bdf6145edcfbadbef2155d

## Audit

Script: `bash /tmp/rd-audit.sh`. Non-test `.tsx` outside `components/ui`, excluding `preview-main.tsx`.

```
app_tsx_files=34
files_importing_ui=30
raw_<button>=0
raw_<select>=0
raw_<input>=0
raw_<textarea>=0
raw_<details>=0
raw_<summary>=0
className_uses=1338
css: 190 ./styles.css
export function in web/src/components/ui/index.tsx: 9
```

Raw controls stay 0.

## Per item

1. Gutters. The main column inside `SidebarInset` is `px-4` below the `md` breakpoint and `md:px-0`, so desktop max-width centering is unchanged. Ghost back buttons no longer use a negative left margin on small screens (`md:-ml-3` only), so they stay inside that gutter. At 390 the page padding is 16px. The header keeps `px-3` (sidebar trigger at 12px). All 26 pages at 390 have no horizontal scroll on `#main`. History and Saved may scroll inside their own table container.
2. Sentence player. The bar is an inline-size container (`@container`). Under 520px: previous, play, next, n/N, and More (time, speed, repeat, play all, add to review). From 520px: previous, n of N, next, play, progress, nowrap time, and More. From 960px: speed, repeat, play all, and add to review sit inline and More hides. Measured: 390 bar is 358px and does not overflow; 1440 without the word card is 1152px and shows the full row; 1440 with the word card open is 768px, time is one 20px line (`0:00 / 0:04`), and the More menu lists speed, Repeat, Play all sentences, and Add to review. No overlaps.
3. Review home. The “How new cards are introduced” collapsible is gone. Learning, Due, New, cards per session, daily new-card limit, new cards introduced today, and library size stay as plain stats. Smoke tests assert those numbers and no longer read the explainer.

## Tests

- `cd web && npm test`: 17 files, 361 passed.
- `cd web && npm run build`: passed (`tsc --noEmit` and Vite).
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt`: 25 passed. `auth_db` utcnow deprecation warnings are pre-existing. One test logs “Word context reply not usable: 'Sorry, no JSON'” and still passes.

## Screenshots

52 files, `after5-<page>-<1440|390>.png`, in both `screenshots/` and `/home/mgacai/redesign-v5-out/screenshots/`. Preview was `127.0.0.1:8027` only, and it was stopped after the shots. `before-*`, `after-*`, `after3-*`, and `after4-*` were not overwritten. PNGs, `web/src/preview-main.tsx`, and `web/vite.audit.config.ts` are not committed.

Pages: study-home, workspace-listen, workspace-words, workspace-recall, word-card, review-home, review-session, review-session-revealed, saved-list, practice, progress, episodes, settings, settings-feedback, login, login-gate, recall-reveal, practice-listen, practice-speak, practice-write, practice-studio, practice-feedback, grammar-map, own-words, photo-import, history.

Checked by eye: workspace-listen 390 and 1440, word-card 1440 (card open, player one row) and 390, review-home 1440 and 390, study-home 390, saved-list 390, practice 390, plus the back-button pages (practice-listen, history, photo-import, recall-reveal) at 390.

## Leftovers

None for this pass.
