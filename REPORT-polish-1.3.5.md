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


## TASK 4 — Ask AI answers the learner's actual question first

Tool: Codex CLI. Exact model id: gpt-6.1-sol.

Root cause: WordPopup prefixed the raw question with About “word”, making the open French word the assumed topic. The server required sentence-first French grounding, omitted the English translation and open-word context, and unconditionally appended English-only style instructions.

Changes: WordPopup now sends the raw question with structured word, translation_en and language context through the existing /api/ask endpoint. Sentence-level Ask sends the translation and Explanation language without requiring a word. AskRequest accepts these optional fields (language defaults to en for older clients). The system prompt supplies the translation and open word as context and requires answering the actual question first, including defining English translation phrases before any helpful French connection. Clear Chinese/English questions determine the response language; mixed or ambiguous questions use the en/zh setting. English answers use short, plain B1 English; Chinese answers use Chinese. Follow-up continuity, example limits, the 90-word cap, plain text, history mapping and truncation remain intact. Tasks 1–3 and version 1.3.5 are preserved.

Verification:
- cd web && npm test: 494 passed across 22 files.
- cd web && npm run build: passed; existing classic PWA script and chunk-size warnings only.
- PYTHONPATH=".:tests" python3 -m unittest discover -s tests: 665 passed, including all 12 Ask prompt tests; fixtures/temp databases only.
- Original 1.3.4 audit ran; because its path is fixed to the old worktree, also ran a copy targeting this 1.3.5 checkout. Current-worktree raw button/select/input/textarea/details/summary: 0 / 0 / 0 / 0 / 0 / 0.
- git diff --check: passed.
- Frontend tests cover the unchanged madame question, the exact mixed-language set-forth question with both settings, and sentence Ask translation/language/history without a word.
- Prompt tests cover direct English-gloss answers, raw user messages, structured context, language precedence/fallback, conditional style, backward compatibility and invalid-language validation.

Screenshot: /home/mgacai/polish-1.3.5-out/screenshots/polish-1.3.5-ask-set-forth-light-390.png
Light mode, 390px wide, d'exposer card open with Ask AI expanded and the exact question “啥意思？ to set forth 呢？”. The visibly labeled fixture answer defines “to set forth” first as formally state or present, then connects it to d'exposer. No live model call was made; this verifies the preview UI and fixture response, while automated tests verify the request and prompt. The screenshot was visually reviewed. /workspace was not writable for the optional copy.

Preview bound only to 127.0.0.1:8030 after confirming it was free. Stopped the task-owned preview process, confirmed no listener and a successful reusable bind on 8030, and removed temporary preview-main.tsx / vite.audit.config.ts from the checkout. Preview sources are retained only in the output directory. No screenshots, preview files, databases or node_modules are committed.

Task 4 logs: task4-npm-test.log, task4-build.log, task4-python-test.log, task4-python-targeted.log, task4-audit.log, task4-original-audit.log, task4-screenshot.log in /home/mgacai/polish-1.3.5-out/.
Push target: origin design/polish-1.3.5 only. No main push, merge, PR, force-push, deployment, Docker or production changes.
