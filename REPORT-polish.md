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
