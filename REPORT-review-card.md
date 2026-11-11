# Review session as a stock shadcn Card (1.1.0)

Branch `design/review-card-card`, from `origin/main` `5a40914`. Version stays 1.1.0. Nothing was merged. Nothing was pushed to `main`. No pull request.

Tool: `grok 1.0.77 (50ca579fa996) [stable]`. Model: grok-4.7.

## What changed

The review session (`/app/review` session) is one stock Card, `max-w-xl`, centered. The shell gutter is unchanged (`px-4` below `md`, `md:px-0`), so the card does not add a second inset.

- Header: ghost Exit, title “Review”, one Progress bar, and `n / N` in tabular numerals. The duplicate “Card n of N / completed” row is gone. The version string is hidden on this focused page only. The account control stays.
- Card header: at most two badges (New, Due, or Learning, plus the mode). A ghost icon button (`aria-label` “Card actions”) opens Mark mastered, Slow 0.75×, and Pause and return to Due today.
- Card body: French stays in Source Serif 4 and words stay clickable. Play is an icon button (`aria-label` “Play”). Listen still hides the sentence until reveal. After reveal, a Separator, then the translation and bracket IPA.
- Footer: unrevealed cards use one full-width Show answer (typed cards keep Check, then Show answer). Revealed cards use four equal grade buttons. The suggested grade is the default variant (Good when nothing else is suggested, matching Enter). Keys `1`–`4` and `Enter` render only from the `md` breakpoint, with the stock Kbd component.
- `web/src/components/ui/kbd.tsx` is the stock shadcn Kbd (radix, Tailwind v4). Progress, dropdown menu, separator, card, badge, and button were already in the tree.
- Review home and the recall reveal page were checked at 390 and 1440. They already use the same Card, Badge, and Button patterns and were left as they are. Due today stays on Study home only.

The 390 header progress bar is `w-20` (measured 80px) so the count and avatar stay on one row. Grade buttons at 390 measured 72×56, all four the same. The revealed separator measured 1px tall. No second layout pass.

## Commits

- Parent: `5a40914` (Merge design/redesign-v2: stock shadcn redesign 1.1.0).
- Design commit: `518e31fd4d3583d55602cccd374ed5ed0d8cb3fb`
- https://github.com/BenjaminGao2025/french-audio-studio/commit/518e31fd4d3583d55602cccd374ed5ed0d8cb3fb

## Tests

- `cd web && npm test`: 17 files, 362 passed (361 on main, plus one session-card test). Run finished after the last source edit.
- `cd web && npm run build`: passed (`tsc --noEmit` and Vite 7.3.7). The bundle chunk-size warning is the existing single JS chunk.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt`: 25 passed. `auth_db` utcnow deprecation warnings are pre-existing. One test logs “Word context reply not usable: 'Sorry, no JSON'” and still passes.

## Audit

Script: `bash /home/mgacai/review-card-v2-out/audit.sh`. Non-test `.tsx` outside `components/ui`, excluding `preview-main.tsx`.

```
app_tsx_files=34
files_importing_ui=30
raw_<button>=0
raw_<select>=0
raw_<input>=0
raw_<textarea>=0
raw_<details>=0
raw_<summary>=0
className_uses=1328
css: 190 ./styles.css
```

Raw controls stay 0.

## Screenshots

17 files in `/home/mgacai/review-card-v2-out/screenshots/`. Preview was `127.0.0.1:8027` only, and it was stopped after the shots. PNGs, `web/src/preview-main.tsx`, and `web/vite.audit.config.ts` are not committed.

Before and after, at 1440 and 390: `review-session`, `review-session-revealed`, `recall-reveal`, `review-home`. Names: `rc-before-<page>-<w>.png` and `rc-after-<page>-<w>.png`. Extra menu shot: `rc-after-review-session-menu-390.png` (Mark mastered, Slow 0.75×, Pause and return to Due today).

Checked by eye: review-session and review-session-revealed at 390 and 1440, the open menu at 390, review-home at 390, and recall-reveal at 390. No horizontal overflow, no edge collision, equal grade buttons, no instructional sentence on the card.
