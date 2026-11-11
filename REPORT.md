# shadcn visual pass — 1.0.6

Branch `design/shadcn`. Not merged. Ben reviews the screenshots before anyone merges.

The previous `REPORT.md` (review-card UI) remains at `244aa21`. This file replaces it on this branch.

## Theme

Warm paper, olive ink, bronze focus. This is not the shadcn neutral/zinc kit and not the old cool gray plus `#1d4ed8`.

The product is light. `color-scheme: light`. A `.dark` block was left by `shadcn init` and is unused. Dark mode was not designed.

| Token | Value | Role |
| --- | --- | --- |
| `--background` / `--canvas` | `#f3efe6` | Page paper |
| `body` background | `#e7e1d4` | Desk around the page |
| `--card` / `--surface` | `#fbf8f2` | Panels, word card, review stage |
| `--foreground` / `--text` | `#2a2622` | Body |
| `--muted-foreground` / `--text-2` | `#5c5348` | Secondary text, empty stars |
| `--primary` | `#2f4634` | The one primary action, selected tab underline |
| `--primary-foreground` | `#f7f4ee` | Label on olive |
| `--primary-weak` | `#e5efe6` | Selected nav, pressed secondary controls |
| `--ring` | `#8a5a2b` | Keyboard focus, bronze, not the action color |
| `--link` | `#3d5c56` | Links, separate from primary |
| `--success` / `--warning` / `--error` / `--info` | `#1d6b45` / `#8a5a12` / `#8f3b32` / `#5c4630` | Distinct hues. Info sits on `#f1e6d4`. Neutral notices use `#e3dacb`. |
| `--border` / `--divider` | `#ddd4c4` / `#e3dacb` | Warm lines |
| `--radius` | `0.625rem` | shadcn radius; controls use 10px |

`theme-color` is `#f3efe6`. Unused `--sidebar-*` tokens from init are still in `:root`. The shell does not use the shadcn Sidebar block, so they do not paint.

The bookmark mark in `static/brand-symbol.svg` and the PWA icons is the same shape, filled `#2f4634` instead of `#1d4ed8`. The wordmark H stays `var(--primary)`.

## Fonts

| Face | Where | License |
| --- | --- | --- |
| Inter Variable | UI: chrome, buttons, settings, tables | SIL OFL 1.1. Copyright 2016 The Inter Project Authors. |
| Source Serif 4 Variable | French only: hero sentence, review prompt, saved French, step lines, word-card headword | SIL OFL 1.1. Copyright line in the package: Google Inc. |

Imported at the top of `web/src/styles.css` from `@fontsource-variable/inter` and `@fontsource-variable/source-serif-4`. No Google Fonts request at runtime. The production build emits the woff2 files. CSS families are `"Inter Variable"` and `"Source Serif 4 Variable"`.

## Components by surface

shadcn init: `radix-vega`, CSS variables, lucide, Tailwind v4. Primitives live in `web/src/components/ui/*`. Call sites still use the wrappers in `ui/index.tsx` (Button, Tabs, Dialog, WordDock, FieldText).

| Surface | What it uses |
| --- | --- |
| Shell | Existing desktop sidebar and mobile bottom nav, restyled. Safe-area padding. Wordmark `translate="no"`. Footer helper removed. Primary nav lets modified clicks through. Icon-only buttons get a Tooltip. |
| Study home | Page head, segmented control, textarea, shadcn Button. Due line is one row of labeled facts. |
| Workspace (8 tabs) | shadcn Tabs, underline, horizontal scroll. Serif sentence. Player is a quiet toolbar. |
| Word card | Desktop `WordDock` column. Narrow app width uses the app Dialog as a bottom sheet, portaled to `#app-root`, shell `inert`, padded above the bottom nav. |
| Review | Same Tabs. Stage card on the front. Custom rating buttons with interval text and four washes. |
| Saved | Native table with wrapping French at desktop width. Card list when `useNarrow()` is true (app container under 640px). |
| Settings feedback | shadcn Switch and Slider, one row per control, visible volume number plus `aria-valuetext`. |
| Recall / Dictation reveal | One warning banner, “Try it now”, Hint/Answer as pressed buttons (olive wash, not a second primary chip). |
| Toasts | Existing live region. Sonner is installed and not wired, so announce behavior stays. |

Sheet, Drawer, Card, Badge, Input, Textarea, ScrollArea, DropdownMenu, Separator, and Label are installed. The word card and dialogs stay on the app Dialog so the focus trap and tests keep working.

## Audit HIGH items

Numbers are the checklist in `/home/mgacai/ui-audit-out/AUDIT.md`.

1. **Fixed.** Paper, olive, and a serif French line replace system-ui on `#f7f8fa` with one blue. Verified on the study, workspace, review, saved, and settings screenshots.
2. **Fixed.** Buttons are `w-fit` unless marked block. “Listen to the sentence” and “Make a practice card” are intrinsic width. Verified on the Sounds screenshot.
3. **Fixed** on surfaces that can show French. The workspace sentence is larger than “Study”. The player is a second row. A listen card does not show the French before reveal (that would leak the answer). After reveal the sentence is the large serif line.
4. **Fixed.** Study and Review share the underline Tabs. Narrow layout scrolls the tab list instead of a 2×4 keypad. Breakpoints are container queries on `.app`. The three group names are not a second tab row; one list was the cleaner option.
5. **Fixed.** Desktop dock sits beside the sentence. The player and the tab row stay visible. The phone sheet covers the page, sits above the bottom nav, and grays the shell. Meaning is first. Favorite and Importance are labeled. IPA stays in square brackets. Verified at 1440 and 390.
6. **Fixed.** Desktop French wraps, including “Nous avons pris un café près de la gare.” Dates read “31 Dec 2025”, not “31 Dec 2…”. At 390 the list is cards (French, meaning, due, actions), not a table that shows “No…”.
7. **Fixed.** The front is a stage card with one keyboard line. After reveal, Again / Hard / Good / Easy show 1 min / 6 h / 1 d / 4 d when the mock intervals object is empty, with four different washes. Real intervals still win when the server sends them. The area under a short card is still empty page; the card itself is not an empty canvas.
8. **Partial.** The audited lines are structured: study meta, the due line, the saved count, review meta, the exercise header, and device “Last active” / “Signed in”. Progress, Practice, Episodes, the player status, and some review quota sentences still use “ · ”.
9. **Fixed.** Practice feedback is a vertical list. Switch rows are the full hit target. Volume shows a number (70 in the screenshot) and `aria-valuetext`. Verified at 1440 and 390.
10. **Fixed.** One amber “Answer shown” banner, plus “Try it now”. The Answer control looks pressed (pale olive, olive border), not disabled and not a second primary chip. Verified at 1440 and 390.
11. **Fixed.** Tappable words use a `#6a6156` underline. Empty stars use `--text-2` (`#5c5348`), about 7:1 on `#fbf8f2`, not `#94a3b8`. The task brief also asked that a route change not leave a thick ring on the `h1`. Programmatic focus on `[data-page-title]`, the sentence heading, review and exercise headings, and `.wp-headword` has no ring. `:focus-visible` on real controls is 2px bronze.
12. **Fixed in CSS, not on a device.** `--safe-top` and `--safe-bottom` come from `env(safe-area-inset-*)`. The bottom nav uses that padding. No physical notched phone was available. The fake iPhone frame still forces 44px / 26px.
13. **Fixed** on the desktop study home: textarea first, one due line (49 cards, 9 to revisit), Analyse explains why it is disabled, and “Practise my own words” and “My grammar map” are both secondary buttons. At 390 the due line is the next block under the composer, so the first screen shows the textarea, Analyse, and the reason. A short scroll reaches the due line.

The sidebar line “Everything you do is saved to your account. Exam practice is planned.” is gone. Version stays.

## Medium and low

Fixed, locally: 15 (modified clicks on the primary nav only), 16 (names, `autocomplete="off"`, example placeholders on the study draft, saved search, explain fields, review and practice answers, daily-new and session-size), 21, 22, 23, 25 (grammar notes Retry re-reads notes already on the sentence), 27 (`…` instead of `•••`), 29 (the two “We kept / We couldn’t” strings), 32, 33, 36 (sentence case kept; Title Case ignored), 37, 38 (the 25 MB error and the speed strings that were edited; the Episodes option list was not), 40 (`scroll-margin-top` on `h1, h2`), 41, 43, 44.

Skipped on purpose: 14 (tab and saved search in the query string), 18 (`beforeunload`), 19 (device sign-out confirm), 24 (word spans stay spans so selection works), 31 (store update per keystroke), 35 (paste image and text together).

Not done, and not claimed: 17 (focus the first invalid field), 20 (`Intl` relative dates), 26 (a full pass over leftover sizes in `study-tools.css`), 28 (skeleton still animates `background-position`; reduced motion still disables it), 30 (`:focus-within` on the player), 34 (UI language stays English), 39 (skip-to-content target still has no visible ring).

## Tests

- `cd web && npm test` — 17 files, 361 tests passed. jsdom still logs `HTMLMediaElement` “Not implemented” and some `act(...)` warnings. Exit 0. Run after the 1.0.6 bump.
- `cd web && npm run build` — `tsc --noEmit` and Vite build succeeded. CSS 111.78 kB, JS 730.21 kB. Fonts are in the bundle. The chunk-size warning is the existing single bundle.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt` — 25 tests, OK. `auth_db.py` `utcnow` deprecation warnings are pre-existing. One log line, “Word context reply not usable: 'Sorry, no JSON'”, and the tests still passed. No Python behavior was changed.

## Git

- Branch: `design/shadcn` (from `244aa21`, v1.0.5).
- Commit: `7a347be9ba2db7b0d28a2e8d9d61a01c3404a07d` — `design: migrate study UI to shadcn/ui 1.0.6`.
- Tree: https://github.com/BenjaminGao2025/french-audio-studio/tree/design/shadcn
- Commit URL: https://github.com/BenjaminGao2025/french-audio-studio/commit/7a347be9ba2db7b0d28a2e8d9d61a01c3404a07d
- Not committed: `web/node_modules`, `web/src/preview-main.tsx`, `web/vite.audit.config.ts`, screenshot PNGs, secrets.
- No pull request. No merge. No force-push.

## Screenshots

Both directories, 1440 and 390, `before-*` from the 244aa21 audit and `after-*` from the mock preview at `http://127.0.0.1:8025/app/`. Production was not opened.

- `/home/mgacai/projects/notion-mcp-terminal/TTS-wt/shadcn/screenshots/`
- `/home/mgacai/shadcn-out/screenshots/`

Minimum set: `study-home`, `workspace-listen`, `workspace-words`, `workspace-recall`, `word-card`, `review-session`, `review-session-revealed`, `saved-list`, `settings-feedback`, `recall-reveal`.

The 390 saved screenshot is scrolled to the card list so the French is in frame. The 1440 saved screenshot shows the table with headers and wrapped sentences.

## Tool

`/home/mgacai/.grok/bin/grok --version` prints `grok 1.0.46 (2765805b9442) [stable]`. It does not print a model id. This session’s model is Grok 4.7.

## Merge and rollback

Do not merge from this session. A person merges after Ben approves the screenshots.

Rollback of a future merge is `git revert` of that merge commit on `main`. Never force-push.

Current production image, unchanged by this work: `deploygrow-tts:latest` id `781541cd500a`, digest `sha256:781541cd500a18220a8ede98ae7c5033097ba1be6d63d421c5efd41969f9b467`, container `tts-service`.

## Not verified

- Real model answers (word meanings, grammar notes, explain-it). The preview is a fake backend.
- Production accounts, `outputs/users.db`, or https://tts.gaoyuze.com.
- Spoken audio. The preview player is simulated.
- A physical phone with a notch. Safe-area rules are in CSS only.
- Dark mode.
