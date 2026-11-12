# polish-1.3.1

Version: 1.3.1. Tool: Codex CLI. Model: gpt-6.1-sol.
Implementation commit: 8c93b505dcbad2aeba320bdb08e636deefcc2987.

Removed AccentBar, its insertion code, and the Enter/Shift+Enter hint from the shared Recall/Dictation Exercise. Repository searches found no other copies. Textareas and submission behavior remain; aria-describedby now references only a visible empty-answer error. No unused imports remain.

Updated the package version and only the two root lockfile version fields. Release history starts with APP_VERSION and preserves the previous bullets under explicit 1.3.0. The only app-source 1.3.0 literal is that historical entry.

Validation:
- `cd web && npm test`: 405 passed, 18 files; previously 401. Added keyboard and error-association tests for both exercise kinds.
- `npm run build`: passed (bundle-size warning).
- Chromium: actual Shift+Enter inserts a newline; Enter checks and displays the result in Recall and Dictation.
- `bash /home/mgacai/polish-1.3.1-out/audit.sh`: raw button/select/input/textarea/details/summary = 0/0/0/0/0/0; 38 app TSX files, 34 importing UI, 1333 className uses, 190 CSS lines. Corrected the external audit script's stale polish-1.3.1.1 path to this worktree.
- `git diff --check`: passed. No Python application changes.

Screenshots: `/home/mgacai/polish-1.3.1-out/screenshots/`
- p131-before-recall-empty-1280.png
- p131-before-recall-empty-390.png
- p131-before-recall-typing-1280.png
- p131-before-recall-typing-390.png
- p131-after-recall-empty-1280.png
- p131-after-recall-empty-390.png
- p131-after-recall-typing-1280.png
- p131-after-recall-typing-390.png
- p131-after-dictation-empty-390.png

Before captures preceded app edits. Reviewed all shots: removed controls and hint are absent, the answer textarea remains, and no large gap remains between it and the actions. Version 1.3.1 is visible. Screenshot automation was adapted in `/tmp/ui-audit-pw/shots-polish-1.3.1.mjs`; the original was unchanged.

Preview used only 127.0.0.1:8029 with strictPort after confirming it was free; stopped after verification. Preview harness and PNGs are not committed. Production resources were untouched. Branch: design/polish-1.3.1; implementation commit above, with this report recorded in a following documentation commit.
