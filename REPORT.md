# Review card UI

Branch `fix/review-card-ui` (from `origin/main` at `2e3e9ca`). Not merged.

Model: Grok 4.7. grok CLI 1.0.46 (`2765805b9442`), confirmed with `grok --version`.

## Root causes

- The React SPA never ported `formatFriendlyPhonetic`. Word popup, study words, and review meta printed dictionary or analysis IPA with slashes and syllable dots (`/pʁɔ.pɔ.ze/`).
- The word click opened a full-width sheet: a duplicate “Meaning of …” title, an example-sentence block, a collapsed dictionary, and a context meaning that could echo the word or translate the whole sentence.
- Study and Review each used their own font sizes, button heights, and a narrow centered column.
- “Due today” was rendered again inside the sentence workspace, including Recall.
- A revealed Recall, Dictation, or graded correct answer was plain text, so a word click did not open the card.
- Graded answers had no shared, non-blocking cue. Result boxes repeated how the attempt was recorded.

Stored IPA and saved definitions were not rewritten. Phonetics and Han-script meanings are normalized only when shown.

## Changes

- `web/src/lib/phonetic.ts` is the old helper. Every visible IPA goes through it once. New analysis and `/api/word-context` prompts ask for learner-friendly IPA and a short English gloss of this word in this sentence. `word_context.VERSION` is 3. Error-like model text is rejected and not stored. The client shows Retry.
- Word card (`WordPopup.tsx`) is the same component in a desktop popover and a narrow sheet. No example sentence, no duplicate title. Dictionary senses are visible. Favorite and Importance are labeled. Sentence grammar is a link.
- Study home, the eight study tabs, the review session, and the saved list use the existing tokens (`page--wide`, one button row, one type scale). See `DESIGN_RATIONALE.md`.
- Due today stays on Study home as one line (`Due today · N cards · N to revisit`) plus Review today’s cards.
- Revealed French in Recall, Dictation, and the review correct-answer line uses `FrText`, so a word or a phrase opens the same card.
- “Try it now” hides that French, clears the textarea, and focuses it. The attempt remains answer-known.
- Hint shown / Answer shown are pressed chips, not disabled grey text.
- Practice feedback (Web Audio chime, praise chip, streak 3/5/10, cached TTS “Excellent !” at 5) does not block Next. Settings live in Practice feedback and in `localStorage` (`frenchStudio.feedback`). Reduced motion forces animation off.

## Tests

- Frontend: `cd web && npm test` — 17 files, 361 tests, passed (re-run after the last UI edit).
- Typecheck and production build: `cd web && npm run build` — `tsc --noEmit` clean, Vite build succeeded (`dist/` is gitignored). Chunk-size warning is pre-existing.
- Backend: `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt` — 25 tests, OK. One expected log line: `Word context reply not usable: 'Sorry, no JSON'`. `auth_db.py` `utcnow` deprecation warnings are pre-existing.

## Screenshots

Production `https://tts.gaoyuze.com` was not used (login redirect). Before shots are the local UI at the start of the branch. After shots are the local mock on `127.0.0.1:8020` (fake backend, no production user data). The preview harness was deleted and is not in the commit.

- `screenshots/review-card-ui/before-study-home.png`
- `screenshots/review-card-ui/before-study-workspace.png`
- `screenshots/review-card-ui/before-study-words.png`
- `screenshots/review-card-ui/before-word-panel.png`
- `screenshots/review-card-ui/before-review-session.png`
- `screenshots/review-card-ui/before-saved-list.png`
- `screenshots/review-card-ui/after-study-home.png`
- `screenshots/review-card-ui/after-study-workspace.png`
- `screenshots/review-card-ui/after-study-words.png`
- `screenshots/review-card-ui/after-word-panel.png`
- `screenshots/review-card-ui/after-review-session.png`
- `screenshots/review-card-ui/after-saved-list.png`
- `screenshots/review-card-ui/after-recall-answer.png` (extra: revealed Recall, Try it now, pressed chips)

## Not verified

- Real model quality for in-sentence meanings and new phrase IPA. The prompts and the reject-error-text path were unit-tested. No live LLM call was made.
- Production accounts, production card data, and OCR.
- Spoken “Excellent !” against the live TTS service. The client calls the existing `/tts` URL, caches the clip, and falls back to the chime. The headless screenshot run did not play audio.
- The word-panel screenshot uses the fake dictionary, which labels `failli` as a noun and returns the gloss “almost did”. Bracket IPA `[faji]` is the real formatter.

## Merge and rollback

Do not merge until Ben approves the screenshots. A person, or the parent agent, merges `fix/review-card-ui` into `main`. This session does not merge and does not push `main`.

Rollback: revert the merge commit on `main`. Do not force-push. Production auto-deploys from `main`.

## Commit

`755c71cfbfd8d18eca30d361ba71f712b6530be7` on `fix/review-card-ui`.

`git log -1 --oneline` after that commit is `fix(study): restore friendly IPA and a calmer study/review UI`. This report’s SHA line is the only follow-up.
