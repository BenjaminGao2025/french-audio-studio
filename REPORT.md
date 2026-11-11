# 1.1.0 redesign report

Branch `design/redesign-v2`. Nothing was merged. Nothing was pushed to `main`.

## Navigation

The left sidebar and the separate header are gone. On a wide screen the app is a reading bar: brand on the left, Study / Review / Practice / Progress / Settings in the bar, version and account on the right. The page is a centered paper sheet on a deeper warm ground (`#e4dcc8`). On a phone the same five destinations stay in a bottom tab bar with a safe-area inset, and the top bar is only the brand plus the account. Review session (`review/session`) and a Recall or Dictation run (`study/run`) hide that navigation and keep a slim Exit bar.

- Study, Review, Practice, Progress, Settings stay the five destinations. URLs are unchanged.
- Focused modes: `review/session`, `study/run`.
- Due today still appears only on the Study home (`StudyReviewNotice`).

## Per page

- Study home (`study/new`, and Study with no analysis): a Start composer (French text, own ideas, photo import), a Continue card when a previous analysis exists, Due today as Cards / To revisit, then quieter links for own words, the grammar map, and practise without new text.
- Study workspace: the French sentence is the large serif line. Pager, playback, and Add to review sit in a toolbar under it. The eight tools stay reachable as three groups: Understand (Words, Grammar, Explain it), Listen & speak (Sounds, Steps, Say it), Check yourself (Recall, Dictation). `study.tab` values are unchanged.
- Word card: unchanged contract. Desktop dock sits beside the sentence. A narrow width still uses the sheet. First line is the word, speaker, and bracket IPA when the lookup has IPA.
- Review home: today’s session is a count, then Learning / Due / New, with one Start review action. Saved and Mastered stay on their routes.
- Review session: focused. One keyboard-hint line on the front, another after the reveal. After reveal the French is large, then Again / Hard / Good / Easy with intervals and keys.
- Saved: one filter row on a wide screen, one count, French wraps in the table. A narrow width stays a card list. Search, filters, favorites, and practise-from-selection remain.
- Practice: the landing is a two-column studio of the existing destinations (one column on a phone). Listen, Speak, Write, Studio, and Feedback keep their task flows inside the new sheet.
- Episodes: the list title is serif, and level, length, and status are separate chips.
- Progress: the hero is the 1,000-hour total and the recent activity, then the existing charts and lists. History uses the same sheet and drops the old helper sentence under the title.
- Settings: sections are separated. Practice feedback stays a vertical list. Volume still shows its number.
- Signed-out gate: a short paper card and a Sign in button. No benefit paragraphs. The real login screen uses the same warm ground and paper card. The invite-code sentence stays.
- Other routes (personal words, grammar map, photo, recall and dictation launchers, design reference, moved, 404) render in the new shell. Their inner forms were not rebuilt.

## What stayed on purpose

Friendly bracket IPA (`formatFriendlyPhonetic`), clickable French words including revealed answers, feedback sounds and streaks, Settings practice-feedback toggles, keyboard hints on review grades, `:focus-visible` without a thick ring on the route heading, `prefers-reduced-motion`, the compact word card (no example sentence, no full-sentence translation), and the Saved search and filters. No backend, SRS, audio-pipeline, auth, or API payload changes. No new routes.

## Tests

- `cd web && npm test`: 17 files, 361 passed.
- `cd web && npm run build`: `tsc --noEmit` and Vite build succeeded.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt`: 25 tests, OK.

Two assertions were updated because the copy changed: the Study continue card now says “Continue”, and Due today is “Cards” / “To revisit” instead of “9 cards” and “5 to revisit” in one string. The Speak prompt “Say this in French out loud” was kept.

## Git

- Branch: `design/redesign-v2` (from `85db765`, v1.0.6).
- Tree: https://github.com/BenjaminGao2025/french-audio-studio/tree/design/redesign-v2
- Design commit: `8b19fbb2da3449c8a53010b4d09e3d31950a392a`
- https://github.com/BenjaminGao2025/french-audio-studio/commit/8b19fbb2da3449c8a53010b4d09e3d31950a392a

## Screenshots

Same filenames in both directories. PNGs are untracked.

- `/home/mgacai/projects/notion-mcp-terminal/TTS-wt/redesign-v2/screenshots/`
- `/home/mgacai/redesign-v2-out/screenshots/`

32 before and 32 after. Widths 1440 and 390.

- study-home
- workspace-listen
- workspace-words
- workspace-recall
- word-card
- review-home
- review-session
- review-session-revealed
- saved-list
- practice
- progress
- episodes
- settings
- settings-feedback
- login
- recall-reveal

Pattern: `before-<page>-<w>.png` and `after-<page>-<w>.png`.

## Tool

`grok --version` printed `grok 1.0.77 (50ca579fa996) [stable]`. Model for this session: grok-4.7 / Grok 4.7.

## Not verified

A physical iPhone notch and safe area, real LLM answers, production `users.db`, spoken audio playback, and a real device keyboard. Screenshots are headless Chrome at 1440×1100 and 390×844 against the demo registry on `127.0.0.1:8027`. The preview server is stopped after this report.

Listen, Speak, Write, Audio Studio, and Practice feedback steps were not given a separate layout pass. They sit in the new sheet with their previous task UI. Grammar map, personal words, photo import, and History tables likewise keep their previous inner layout.

## Merge and rollback

Do not merge from this session. A person merges `design/redesign-v2` into `main` only after Ben approves the before/after screenshots. Rollback is `git revert` of that merge commit on `main`. Do not force-push.
