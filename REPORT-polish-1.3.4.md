# Polish 1.3.4

Tool: Codex CLI. Model: gpt-6.1-sol.
Branch: design/polish-1.3.4.

## Unified star and Importance

The word-deck star and read-only dots now share cloze/Fill-in membership through `wordIsSaved`. Unsaved words show an empty star and zero filled dots, even with historical lookups. Saved words start at Importance 3. `IMPORTANCE_FROM_LOOKUPS` in Python and TypeScript sets 3 counted lookups → 4 and 5 counted lookups → 5. The five-second suppression window and visible lookup counts remain.

Manual save derives max(default saved importance, lookup tier). Unstar removes matching cloze cards across sentence contexts and keeps lookup counts. It leaves zero dots until another qualifying counted lookup or manual save. Suppressed reopen requests cannot auto-save. Pending star actions keep the committed membership visible so dots and star agree, including failure cases.

Counted qualifying lookups save a missing cloze card through `add_note`, using the opened sentence context when supplied, and synchronize matching stored word-card importance. The frontend refreshes its library after qualifying lookup responses. Top-level and nested word cards, Review dots/sorting/filters, and Design examples use the new scale. Historical word favorites remain separate from deck membership.

`/api/srs/importance` remains compatible: word-card values are recomputed from lookup tiers; sentence/grammar card priorities retain their existing manual behavior. The word-card UI has no second importance control.

## Migration

An additive `srs_migrations` marker runs the 1.3.4 recomputation once on existing word cards. The `srs_cards.importance` column remains. No cards are inserted from historical lookup rows, and no user content or existing columns are removed.

Temp database tests cover migration, preserved card IDs/content/scheduling, historical counts without auto-insertion, repeated initialization, save tiers, unstar, suppression, later auto-save, and manual endpoint behavior.

Also tested against a SQLite online backup opened from the live database in read-only mode into `/home/mgacai/polish-1.3.4-out/migration-users.db`. Migration preserved all 947 cards and verified 657 word-card importance values. Hashes of every existing table's contents excluding `srs_cards.importance` were unchanged; integrity checks and repeated initialization passed. The backup and sidecars were deleted. See `migration.log` and `check-migration.py` in the output directory.

## Answer feedback and release metadata

Removed GradeToast from App and deleted its component, toast state, listeners, timer, and unused random praise picker. Correct Recall/Dictation results keep inline feedback. Sound/chimes, optional spoken audio, and other application toasts remain.

Version is 1.3.4 in `web/package.json` and the two root version fields in its lockfile. RELEASES starts with APP_VERSION and preserves the former bullets under an explicit 1.3.3 entry. PWA registration now uses `pwa-register.js?v=1.3.4`.

## Verification

- `cd web && npm test`: 446 tests passed across 19 files.
- `cd web && npm run build`: passed; expected classic script and chunk-size warnings only. Built `dist/index.html` contains `pwa-register.js?v=1.3.4`.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: 638 tests passed; fixtures/temp databases only.
- Adapted 1.3.3 audit script: raw button/select/input/textarea/details/summary counts all zero.
- `git diff --check`: passed.

Logs are under `/home/mgacai/polish-1.3.4-out/`, including `npm-test-final.log`, `python-test.log`, `build.log`, `audit.log`, `migration.log`, and `screenshots-final.log`.

## Screenshots and cleanup

20 full-page PNGs are in `/home/mgacai/polish-1.3.4-out/screenshots/`:

- `polish-1.3.4-word-unsaved-{light,dark}-{1280,390}.png`
- `polish-1.3.4-word-saved-{light,dark}-{1280,390}.png`
- `polish-1.3.4-word-lookups3-{light,dark}-{1280,390}.png`
- `polish-1.3.4-word-lookups5-{light,dark}-{1280,390}.png`
- `polish-1.3.4-recall-correct-{light,dark}-{1280,390}.png`

Reused the existing fixture preview, specified Playwright installation, and Chromium binary. Browser assertions covered no horizontal overflow, empty star ⇔ zero dots, saved tiers 3/4/5, preserved lookup counts after unstar, and no grade-toast or bottom-left praise. The fixture clock advanced between counted lookups to respect suppression. Visually inspected all 20 captures through desktop/mobile contact sheets. Optional copy to `/workspace/polish-1.3.4/screenshots/` was unavailable (permission denied).

Confirmed port 8030 free before starting; preview bound only to 127.0.0.1:8030 and was stopped afterward. Confirmed the port free. Removed temporary preview source/config and database backups. No PNGs or node_modules are committed. No Docker commands, deployment, production configuration changes, main push, merge, or PR.
