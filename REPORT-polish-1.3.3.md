# Polish 1.3.3

Tool: Codex CLI. Exact model: gpt-6.1-sol. Operator: mgacai on host 7840.
Branch: design/polish-1.3.3, based on origin/main at 99cabb4.
Implementation commit: 6befb76a302fe9625bab1e13518d2180196c978f.

## Changes

Importance uses five small dots: filled dots use primary, empty dots use a muted token. The shared component updates word cards, the saved-cards column, and the Design gallery. The mapping remains 0–4 lookups → 3/5, 5–9 → 4/5, 10+ → 5/5. Visible lookup counts and importanceLabel remain intact. Lucide Star is now used only by WordDeckStar. The gallery names the dots and uses the primary color in its contrast sample. A word-card regression test checks an empty deck star alongside five non-star indicators and “1 lookup”.

Recall and Dictation, in whole-sentence and step modes, now show a large percentage, verdict, right/wrong counts, and a separate accent count when needed. One inline alignment shows normal correct words, muted struck wrong words followed by destructive corrections, muted missing words, struck extra words, and dotted accent corrections. Wrong-word/correction pairs stay together when wrapping. The complete correct sentence remains tappable inside a light muted inset. The result footer contains only Try again and Next, or the existing Done destination on the final item. The prose issue list and History footer link are removed. History saving, failed-save retry, server-controlled correctness, and submission behavior are retained.

The existing frontend weighted alignment was extended to supply ordered inline operations and counts; no third grader was added. The accent alignment cost is now 0.5, matching dictation.py. Its established score formula is reused: round(100 × (ok + 0.5 × accent) / (expected normalized word count + extra)). The bdec0d8 JavaScript was not copied. NFC, case and punctuation normalization, hyphen/space equivalence, and existing accent/œ rules remain. “Ma machine a lav fui” against “Ma machine à laver fuit.” yields 50%, 2 right, 2 wrong, and 1 accent correction. Existing answer/target marks remain available for other consumers.

The service-worker test checks shutil.which("node") before running the VM subprocess. Node-present environments still execute all VM assertions. Node-absent environments continue through the source assertions for cache deletion, HTTPS-only registration, and root scope. A regression test simulates absent Node and verifies no subprocess runs. No Node dependency was added to the production image.

Version is 1.3.3 in web/package.json and the two root package-lock version fields only. RELEASES begins with APP_VERSION and retains the preceding bullets under explicit 1.3.2. Schema changes: none.

## Verification

- `cd web && npm test`: 420 passed across 18 files (409 previously; 11 added).
- `cd web && npm run build`: passed. Vite reports its existing large-bundle and classic PWA-script bundling warnings.
- `PYTHONPATH=".:tests" python3 -m unittest discover -s tests`: 634 passed.
- `PYTHONPATH=".:tests" python3 -m unittest test_pwa -v`: 10 passed, including the real Node VM test and simulated absent-Node test.
- `bash /home/mgacai/polish-1.3.3-out/audit.sh`: raw button/select/input/textarea/details/summary = 0/0/0/0/0/0; 38 app TSX files; 34 importing UI; 1335 className uses; 222 CSS lines.
- `git diff --check`: passed.
- Browser fixture assertions passed for all 12 required screenshots: empty deck star, five dots, 5 lookups, correct score, inline marks, two footer actions, no prose issue list, and no horizontal page overflow. Tests cover both exercise kinds and both scopes with correct and mixed results, including final-item footers.

Logs and the reusable fixture preview harness are saved in /home/mgacai/polish-1.3.3-out/. The preview used only 127.0.0.1:8030, confirmed free before starting, and was stopped after screenshots. The harness uses the fake backend and fictional data. No production login, live database access, production container operation, image build/tag, main push, merge, force-push, or PR was performed.

## Screenshots

All required screenshots were captured and visually inspected at 1280 and 390 pixels. Importance contains no stars; results have the score hierarchy, inline marks, light correct-answer inset, and Try again + Next only. Files are under /home/mgacai/polish-1.3.3-out/screenshots/:

- polish-after-importance-phrase-1280.png
- polish-after-importance-phrase-390.png
- polish-after-importance-word-1280.png
- polish-after-importance-word-390.png
- polish-after-recall-whole-1280.png
- polish-after-recall-whole-390.png
- polish-after-recall-steps-1280.png
- polish-after-recall-steps-390.png
- polish-after-recall-correct-1280.png
- polish-after-recall-correct-390.png
- polish-after-dictation-1280.png
- polish-after-dictation-390.png

The additional copy to /workspace/polish-1.3.3/screenshots/ was unavailable: /workspace does not exist and attempting to create it returned Permission denied. Screenshots, node_modules, preview-main.tsx and vite.audit.config.ts are excluded from commits.

The report is also copied to /home/mgacai/polish-1.3.3-out/REPORT.md. Delivery uses only `git push -u origin design/polish-1.3.3` to retarget this branch's upstream.
