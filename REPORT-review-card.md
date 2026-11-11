# Site-wide stock shadcn pages, and the word card as a Sheet (1.1.0)

Branch `design/review-card-card`, from `origin/main` `5a40914`. Version stays 1.1.0. Nothing was merged. Nothing was pushed to `main`. No pull request.

Tool: `grok 1.0.77 (50ca579fa996) [stable]`. Model: grok-4.7.

Phase 1 (review session card only) remains `518e31fd4d3583d55602cccd374ed5ed0d8cb3fb`, recorded in `05c75d86e980b3a92ad428815adf155154617b53`. This note covers the site-wide pass on top of that.

## Commits

- Parent: `5a40914` (Merge design/redesign-v2: stock shadcn redesign 1.1.0).
- Phase 1 design: `518e31fd4d3583d55602cccd374ed5ed0d8cb3fb`
- Page headers and cards: `1e0ef95a1ee3b261dc5bfadda1a99583230d5835`
- Word card Sheet/Drawer: `0a540d86f0941186f36e6486151600cc233f804f`
- https://github.com/BenjaminGao2025/french-audio-studio/commit/1e0ef95a1ee3b261dc5bfadda1a99583230d5835
- https://github.com/BenjaminGao2025/french-audio-studio/commit/0a540d86f0941186f36e6486151600cc233f804f

## Shared rules

- Page title is `h1` `text-2xl font-semibold tracking-tight` (`data-page-title`). A description is one muted line, and only where the page already needed it.
- “Back to …” text links are stock breadcrumbs. A crumb with an action stays a link.
- Content sits in Cards, entry cards (title, one line, ChevronRight), tables, or a badge stepper.
- Spacing stays `gap-4` / `gap-6` and `p-4 md:p-6`. French reading text stays Source Serif 4.
- No gradients, glows, or decorative chrome. No new instructional copy.
- Behaviors kept: grading and intervals, keys 1–4 and Enter, Space/R, mark mastered, play and slow 0.75×, clickable French words, gentle feedback sounds and the Settings toggles, reveal flow, exit and pause back to the review home, Due today only on Study home, Saved as one filter row plus one count and a wide table, focus-visible, reduced motion.
- Bracket IPA still comes from `formatFriendlyPhonetic`. The word card still has no example sentence and no full-sentence translation. The dictionary stays visible.

## Per page

- Study home: title “Study”. Due today stays here only. “Practise my own words” and “My grammar map” are entry cards. Photo import uses a Study breadcrumb.
- Sentence workspace (Listen, Words, Recall): the sentence is one card, `max-w-3xl`. Opening a word no longer splits the column.
- Word card: desktop (`md` and up) is a right Sheet. Below that it is a bottom Drawer. Header is the serif word, a speaker button, bracket IPA, and a star Favorite (`aria-pressed`). Base form is a muted line only when it differs. Then “In this sentence”, the first two dictionary senses with “Show N more”, one attribution line, and a footer of importance plus lookup count.
- Review home: today’s session is one card. Under it, entry cards for Saved cards and Practise my own words.
- Review session, including Fill-in and revealed states: the phase-1 card is unchanged and used for every mode. Listen still hides the French sentence until reveal. Fill-in keeps the blank, Check, and Show answer. A picked word opens the same overlay, so the card column does not shrink.
- Saved: left as the one-row filter, one count, and the wide table. Narrow widths keep the existing card list.
- Practice hub: each destination is an entry card. Sub-pages (Listen, Speak, Write, Studio, feedback, Episodes, exam placeholder) use a Practice breadcrumb instead of a floating back link.
- Own words: Study breadcrumb, a numbered badge stepper, the prepare box, and the archive as a card with Refresh in the header.
- Grammar map: Study breadcrumb. Pattern groups stay in bordered cards.
- Photo import: Study breadcrumb. The drop zone is unchanged.
- Progress: History stays the header action. Devices uses a breadcrumb. The level meter is the stock Progress bar. Streak, estimate, and level stay cards.
- History: Progress breadcrumb. The analyses, time, and recall lists stay tables.
- Settings, including feedback: Review, Playback, Practice feedback, Account, devices, and background listening are stacked cards. Sound, volume, spoken praise, and animation stay.
- Login: the existing card; the title uses the same `text-2xl` scale.
- Login gate: page title plus one card, “Sign in to open this page.”, and the Sign in button.
- Recall reveal: unchanged card from phase 1. Its word pick uses the overlay.

## Tests

- `cd web && npm test`: 17 files, 364 passed. Run finished after the last source edit. The smoke test now expects a bottom drawer below `md` and a right sheet from `md` up, and still requires the sentence to stay in the page.
- `cd web && npm run build`: passed (`tsc --noEmit` and Vite 7.3.7). The chunk-size warning is the existing single JS chunk.
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
className_uses=1315
css: 190 ./styles.css
```

Raw controls stay 0.

## Screenshots

Directory: `/home/mgacai/review-card-v2-out/screenshots/`. Preview was `127.0.0.1:8027` only, and it was stopped after the shots. PNGs, `web/src/preview-main.tsx`, and `web/vite.audit.config.ts` are not committed.

Before shots are the original main tree `5a40914` (detached worktree `/tmp/rc-main`, removed after the shots). After shots are this branch. 56 before and 57 after. The extra after file is `rc-after-review-session-menu-390.png` from phase 1.

Names, each at 1440 and 390: `study-home`, `workspace-listen`, `workspace-words`, `workspace-recall`, `word-card`, `review-home`, `review-session`, `review-session-revealed`, `review-fillin`, `review-fillin-revealed`, `saved-list`, `practice`, `practice-listen`, `practice-speak`, `practice-write`, `practice-studio`, `practice-feedback`, `episodes`, `grammar-map`, `own-words`, `photo-import`, `progress`, `history`, `settings`, `settings-feedback`, `login`, `login-gate`, `recall-reveal`. Files: `rc-before-<page>-<w>.png` and `rc-after-<page>-<w>.png`.

Fill-in demo states `fillin` and `fillin-revealed` were added to the preview registry so those shots open a cloze card. They are not a new route.

Word card after, measured: at 1440 the sentence is x=296 w=768 and the sheet is x=1056 w=384. At 390 the sentence is x=40 w=310 and the drawer is x=0 w=390. Every after shot logged `EDGE-OK` (document overflow 0, main overflow 0).

Checked by eye after the last pass: word card, review session and revealed, fill-in and fill-in revealed, review home, own words, study home, practice, saved, settings and settings feedback, login gate, at 1440 and 390 where those files exist. One fix after that look: archive Refresh sits in the card action, step labels stay on one line, and the login gate is a card. Those shots were taken again.

## Fix round

Reviewer notes on the after shots.

- Word card Sheet: the visible heading is the word, with the speaker and bracket IPA. Favorite and Close sit in that same row with a gap. “Meaning of …” is an sr-only dialog title on both the Sheet and the Drawer. The panel uses stock `p-4` / `gap-4`. The sheet does not draw its own overlay, and `modal` is off, so the sentence stays full width and readable. Esc and Close still dismiss the card. Other sheets and drawers are unchanged.
- Own words: Refresh is an outline `size="sm"` button in `CardAction`, lined up with the title. The empty archive no longer draws a border. Below `sm` the stepper is one row of numbers plus the current step name, and it scrolls inside the page if it needs to.

Re-checked `rc-after-word-card-1440.png`, `rc-after-word-card-390.png`, `rc-after-own-words-1440.png`, and `rc-after-own-words-390.png`. At 1440 the sentence is x=296 w=768 and the sheet is x=1056 w=384, with no scrim. At 390 the sentence is x=40 w=310 and the drawer is x=0 w=390. Edge checks stayed at 0. Audit `className_uses` is 1315. Raw controls stay 0. Web tests 364 passed, build passed, Python 25 passed.

### Page top spacing and stat cards

- Page content top padding is on the shell content wrapper only: `pt-4 md:pt-6`. Under the `h-14` bar the page title sits at y=72 on 390 (16px gap) and y=80 on 1440 (24px gap). The same gap is on Review, Study, Progress, Settings, Practice, and the review session card. The session wrapper keeps bottom padding only, so the top gap is not doubled.
- Review home “Today’s session” is one stock card. The header is the title, the session count at `text-3xl` with “cards” on the same baseline, and Change as a ghost `size="sm"` action. One `Stat` grid holds Learning, Due, New, the daily limit, new cards today, and the library on its own row. Progress reads `0 / 40` at the end of the row. Start review is in the footer and is full width below `sm`.
- Study “Due today” uses the same card: title, Cards and To revisit, and “Review today’s cards” in the footer.
- Progress Goal, Done, and the four time stats use the same `Stat` pattern. The four time stats are 3 columns below `sm` and 4 from `sm` up.
- Re-checked review home, study home, progress, settings, and practice at 1440 and 390. The word-card pass in the same set stayed at sentence x=296 w=768 and sheet x=1056 w=384 at 1440, and sentence x=40 w=310 and drawer x=0 w=390 at 390. Every after shot logged EDGE-OK. Audit `className_uses` is 1292. Raw controls stay 0. Web tests 364 passed, build passed, Python 25 passed.
