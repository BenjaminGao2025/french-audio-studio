# polish-1.3.5 — Version 1.3.5

Tool: Codex CLI. Exact model id: gpt-6.1-sol.
Branch: design/polish-1.3.5, based on origin/main at 4d18c4c.
Implementation commit: f30864c9778c85957e832e406613b91379c134f0.
This report is recorded in a subsequent documentation commit; both hashes are supplied in the completion message.

## Changes

- Restored five-point Lucide Star icons on Importance: filled stars use fill-current / foreground, empty stars use muted strokes. Preserved data-filled, the accessible importanceLabel, lookup count wording, importanceFor, thresholds and save/unsave behavior. The header star remains the save control; the meter is not interactive. Updated the Design gallery and tests.
- Added Explanation language in Settings and the avatar menu, with Simple English (en, default) and 中文 (zh). The shared useExplanationLanguage hook persists to localStorage under explanationLanguage; missing/invalid stored values fall back to en. Mounted consumers update immediately, including an open word card. No preference API or server table was added.
- /api/word-context accepts validated en/zh, default en. Both the frontend promise cache and server hashed key include language; in-flight deduplication continues using the resulting key. word_context.VERSION is now 5. Old cache rows remain untouched; the new version/key namespace recomputes context without migrating data.
- English prompts require meaning_en and why_en in short, plain B1 English with the contextual grammar note. Chinese prompts retain meaning_zh / why_zh. why_en permits 240 visible characters; why_zh retains its 200-character bound. English presentation does not depend on Chinese fields. Phrase-overlap notes use the chosen language; phrase-context generation and the English Dictionary section are unchanged.
- Usage notes explicitly mark French with ⟦surface⟧. The model is instructed to mark every French word/phrase and never English/Chinese. Phrases and elisions such as ⟦Les représentants⟧, ⟦l'homme⟧ and ⟦l’homme⟧ remain single controls. Python preserves valid marks and clips by visible characters, treating marked spans atomically. Malformed/nested marks lose their delimiters and become plain text. The client never guesses French tokens in unmarked prose; it renders exact marked surfaces as underlined serif lang=fr shadcn link buttons and calls the existing drill/stack with breadcrumb and Back navigation. Dictionary elision breakdown and the existing lemma/sentence-context path are preserved.
- Bumped web/package.json and only the two root version fields in web/package-lock.json. Updated the hardcoded PWA registration query. Added the newest RELEASES entry via APP_VERSION and retained the previous bullets under explicit 1.3.4.

## Verification

- cd web && npm test: 492 tests passed (22 files).
- cd web && npm run build: passed; existing classic PWA script and chunk-size warnings only.
- PYTHONPATH=".:tests" python3 -m unittest discover -s tests: 660 tests passed.
- Copied the 1.3.4 audit script and changed its worktree path to 1.3.5 before running it. Raw button/select/input/textarea/details/summary: 0 / 0 / 0 / 0 / 0 / 0. The original script points at the previous worktree.
- git diff --check: passed.
- Tests cover defaults, invalid storage, persisted remounts, live language changes, distinct request/cache languages, API default English and a Chinese-cache miss for English, both prompts, why_en cleaning/error handling/clipping, marked French rendering in both languages, exact multiword/elision surfaces, nested lookup/back, unmarked prose and malformed marks, and filled/empty Importance stars.
- Python tests use testenv fixtures/temp DBs. Screenshots use the fake backend, not a production login, model request or live users.db. No dictionary SQLite or schema changes. No Docker, production services or production changes.

Logs are in /home/mgacai/polish-1.3.5-out/: npm-test-final.log, build-final.log, python-test-final.log, audit.log, screenshots.log.

## Screenshots

Saved and visually reviewed at 390px wide, light mode, under /home/mgacai/polish-1.3.5-out/screenshots/:

- polish-1.3.5-word-ont-en-light-390.png
- polish-1.3.5-word-ont-zh-light-390.png
- polish-1.3.5-word-ont-en-nested-light-390.png
- polish-1.3.5-importance-stars-light-390.png
- polish-1.3.5-settings-explanation-language-light-390.png

The fixture sentence is “Les représentants ont résolu le problème.” English shows the avoir / present tense / 3rd person plural / passé composé note. French explanation spans are visibly underlined; neighboring English/Chinese text stays plain. The nested avoir card shows Back to ont. Importance shows four filled stars, one empty star and 3 lookups. Settings shows Simple English. /workspace was unavailable for the optional copy.

Preview bound only to 127.0.0.1:8030 after confirming it was free. The preview was stopped and 8030 confirmed free afterward. Temporary preview-main.tsx and vite.audit.config.ts were copied to the output folder for reproducibility and removed from the checkout. No screenshots or preview sources/config are committed.

Push target: git push -u origin design/polish-1.3.5 only; no main push, merge, PR, force-push or deployment.
