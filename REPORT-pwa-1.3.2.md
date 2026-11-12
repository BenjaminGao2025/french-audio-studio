# PWA 1.3.2 verification report

- Date: 2026-11-11 (America/Vancouver).
- Operator/host: mgacai / mini7840.
- Tool: Codex CLI. Model: `gpt-6.1-sol`.
- Branch: `design/pwa-1.3.2`, based on `473ec09`.
- Implementation commit: `5d3ac9059adb5f6985851dd2c9a99bd6a9afd796`.
- This report is recorded in a subsequent documentation commit.
- Schema changes: none.

## Changes

Completed the existing PWA setup for the React SPA; retained `/manifest.webmanifest`, `/sw.js`, and `/static/pwa-register.js`.

The SPA head now includes the missing `apple-mobile-web-app-status-bar-style=default` and registers the existing HTTPS-only service worker using a deferred external script. `default` keeps the normal dark status text suitable for the light paper theme, without requesting translucent content behind the status bar. The head retains both app-capable tags, the app title, `viewport-fit=cover`, one manifest link, and the Apple touch icon. SPA and public landing/privacy/institution pages use the same paper theme color.

Header height now grows from 56px by the top safe inset instead of consuming its fixed height with padding. Player padding and sticky action footers add the bottom inset to their normal spacing. Word-card drawers and sheets protect relevant top/bottom edges and horizontal insets. Shell/sidebar gutters and both mastery and Sonner toasts also account for safe areas. Existing CSS safe-area variables remain the common mechanism; no new visual chrome or instructional UI was added.

Version is 1.3.2 in `web/package.json` and only the two root package-lock version fields. The first release entry uses APP_VERSION; previous release bullets remain explicitly under 1.3.1. Desktop screenshot shows v1.3.2 in the sidebar footer.

## Manifest and icons

Served at `/manifest.webmanifest` as `application/manifest+json`, with `Cache-Control: no-cache`.

| Field | Value |
| --- | --- |
| name | 1000H French |
| short_name | 1000H |
| id / start_url | /app/study |
| scope | /app/ |
| display | standalone |
| orientation | any |
| lang | en (matches the SPA's English UI) |
| theme_color / background_color | #f7f4ee |

Icons are regenerated directly from `static/brand-symbol.svg`, using its olive #2f4634 background and white book mark. PNGs are opaque square assets; Safari/the OS applies the outer icon shape. The maskable mark is scaled to 80% around the centre with additional olive padding. Pixel inspection confirms all white pixels fit within the central 80% safe circle (maximum radius 157.9px, below 204.8px for 512px). Icon links now use `?v=brand-2`.

- `static/pwa/apple-touch-icon.png`: 180 × 180.
- `static/pwa/icon-192.png`: 192 × 192, purpose any.
- `static/pwa/icon-512.png`: 512 × 512, purpose any.
- `static/pwa/icon-maskable-512.png`: 512 × 512, purpose maskable.

## Worker, server, cookies

Registration remains HTTPS-only, `/sw.js` with worker scope `/`. The manifest's separate application scope is `/app/`. Worker responses remain JavaScript with `no-cache` and `Service-Worker-Allowed: /`. CSP retains `worker-src 'self'` and `manifest-src 'self'`.

Kept the existing caching rules: only same-origin GET `/static/*?v=<ASSET_VERSION>` resources use the versioned static cache. Public `/home`, `/privacy`, and `/for-institutions` navigation retains its existing network-first offline fallback. `skipWaiting`, `clients.claim`, and old-cache deletion remain. No offline learning was added. Hashed `/app/assets/*` caching was deliberately skipped; these remain network-only in the worker, with FastAPI's existing immutable HTTP asset caching.

SPA HTML `/app`, `/app/study`, and `/app/index.html` stays network-only in the worker. Fixed `/app/index.html` to share the server's shell `no-store` response rather than its generic file response. Deep links and `/app/assets` serving remain covered by tests. API, TTS/audio, files, auth, episodes, and users.db requests bypass worker caching; the actual fetch handler is executed in a Node VM test to verify this.

Cookie code was left unchanged. A new isolated test confirms `fas_session`, `Path=/`, HttpOnly, SameSite=Lax, and Secure for HTTPS forwarded by a loopback proxy. These attributes support same-origin standalone requests to `/app` and `/api`. Physical Safari session transfer/sign-in behaviour was not device-tested.

## Verification

- `cd web && npm test`: **405 passed**, 18 test files. Final run: 67.93s.
- `cd web && npm run build`: **passed**, including TypeScript checking. Vite leaves the external registration script in the head as intended and prints its non-module-script warning; it also reports the existing large application chunk. Test output includes React act/jsdom media warnings; no test failures.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_pwa tests.test_single_audio`: **11 passed**.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_app_shell`: **16 passed**. Combined Python run: **27 passed**.
- PWA tests cover manifest fields/colors/MIME/cache headers, PNG dimensions and serving, public and source/built SPA iOS tags, no-store shell responses, dynamic-route worker bypass, lifecycle/purge, HTTPS registration, cookie attributes, and CSP.
- `bash /home/mgacai/pwa-1.3.2-out/audit.sh`: raw button **0**, select **0**, input **0**, textarea **0**, details **0**, summary **0**; 38 app TSX files, 34 importing UI, 1334 className uses.
- Chromium `Page.getAppManifest`: **zero errors**; verified name, start_url, scope, display, and all three manifest icons returning **200**.
- The Vite UI preview uses fixture data and Playwright serves the exact repository manifest/icon bytes through request interception because this harness has no FastAPI public routes. Real FastAPI MIME/status/cache behaviour is independently checked with TestClient; built SPA HTML is also tested through the shell route with APP_DIR patched to `web/dist`.
- Simulated 390 × 844 iPhone safe areas: top **47px**, bottom **34px**. Measured header height **103px**, top padding **47px**; drawer top **168.8px**, bottom **844px**, bottom padding **34px**; player bottom padding **42px**; Sonner bottom offset **50px**. Screenshots were visually inspected, including the icons.
- Lighthouse is not installed and was not run. The HTTP-only preview intentionally does not register the HTTPS-only worker. Native iPhone/Mac Safari installability still requires a physical Safari check after deployment.
- `git diff --check`: passed.

Preview bound only to `127.0.0.1:8030`, confirmed free before start and free after shutdown. Temporary preview entry/config copies were removed after capture. No production/container/deployment operations or protected-data changes were performed.

## Screenshots and logs

All screenshots are outside git in `/home/mgacai/pwa-1.3.2-out/screenshots/`:

- `pwa-after-study-1280.png`
- `pwa-after-study-390.png`
- `pwa-after-iphone-safe-390.png` (word drawer, simulated safe areas)
- `pwa-after-iphone-player-390.png` (additional player/toast safe-area check)
- `pwa-icon-180.png`
- `pwa-icon-192.png`
- `pwa-icon-512.png`
- `pwa-icon-maskable-512.png`

Logs/scripts: `/home/mgacai/pwa-1.3.2-out/{npm-test.log,build.log,browser-check.log,browser-check.cjs,browser-states.json,icon-check.log}`. Report copy: `/home/mgacai/pwa-1.3.2-out/REPORT.md`.

## Safari installation

After deploying the candidate over HTTPS, open `/app/study` in Safari.

- iPhone: Share → Add to Home Screen → enable Open as Web App if offered → Add. Launch from the new icon. [Apple iPhone guide](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26).
- Mac Safari (macOS Sonoma or later): File → Add to Dock, or Share → Add to Dock → Add. Launch from the Dock. [Apple Mac guide](https://support.apple.com/en-ca/104996).

Check sign-in, Study navigation, word drawer, player, and notch/home-indicator clearance in the installed app. Installation/device checks were not performed against production during this run.


## TASK A — Case-insensitive review character diff (follow-up)

- Tool: Codex CLI. Model: gpt-6.1-sol. Version remains 1.3.2; existing PWA commits are preserved.
- Character alignment and equality normalize NFC and then fold French letter case, matching the existing grading rule. Accents remain strict. Original typed and expected case remains visible.
- Case-only differences render both lines green without error marks, placeholders, strike-through or expected-character highlighting. Identical answers retain the compact green check. The shared TypeAnswerDiff covers Review Result and Type it again.
- Tests cover Adossé/adossé, ADOSSÉ/adossé, missing accents, NFC equivalence and a mixed case/accent phrase. The Review frontend test checks Correct plus both display lines, and practice highlighting only the accent mismatch.
- Verification: cd web && npm test — 409/409 tests, 18/18 files. Final targeted rerun — 55/55 tests. npm run build passes (existing bundle-size / non-module PWA script warnings only).

Screenshots (fixture preview on 127.0.0.1:8030):
- /home/mgacai/pwa-1.3.2-out/screenshots/pwa-after-review-case-1280.png
- /home/mgacai/pwa-1.3.2-out/screenshots/pwa-after-review-case-390.png

## TASK B — Nested word-card star, sentence meaning and alignment (follow-up)

- Tool: Codex CLI. Model: gpt-6.1-sol.
- B1: Verified the existing single WordDeckStar uses the drilled headword, keyed by shown word, and cloze membership through lookupKey. No separate parent star was added. The new nuisibles → nuisible frontend regression saves the parent, drills into its dictionary lemma, verifies the child's empty star, saves/removes the child using the current sentence, and confirms the parent remains saved after Back.
- B2 root cause: WordPanel previously sent the displayed lemma with occurrence 0 on every nested drill. The backend requires a whole-word surface match and rejects nuisible in “Ces insectes sont nuisibles.” with word_not_in_sentence (422); nuisibles has the valid span (18, 27). Reproduced offline with word_context.word_spans and covered by a backend regression, without production requests or live data.
- Fix: Nested dictionary lemmas retain their source inflection and selected occurrence for sentence context, while display, lookup and deck actions target the child lemma. Other drilled words keep their own context target. Dictionary state is cleared when another lookup begins.
- Fallback: If context fails or returns no usable English meaning, an available English dictionary gloss appears under “In this sentence”, explicitly labelled “Dictionary meaning”. Retry remains available for failed context. The frontend test forces failure, checks the harmful gloss instead of the hard error, retries successfully and checks the source-form payload. Existing meaning validation rejects errors; error strings are never used as definitions or saved metadata.
- B3: Removed the Review Word/phrase button's default horizontal padding and the word modules' extra horizontal inset. Modules retain horizontal dividers. Browser measurement at 390 px confirms label, headword, In this sentence heading and gloss all start at x=40. Breadcrumb shares the headword container's edge.
- Verification: 409/409 frontend tests; final targeted 55/55; PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context — 25/25 tests, isolated temporary databases. Build passes. bash /home/mgacai/pwa-1.3.2-out/audit.sh — raw button/select/input/textarea/details/summary counts all 0.
- Browser checks passed using the local fake backend and deliberately unavailable context fixture. Screenshot shows the child's empty star and dictionary fallback. No production services or prohibited ports were used. Preview 8030 was confirmed free before launch and stopped afterward; temporary harness files were removed.
- /workspace does not exist on this host and its parent / is not writable as mgacai, so the extra screenshot copy there was unavailable.

Screenshots:
- /home/mgacai/pwa-1.3.2-out/screenshots/pwa-after-drill-star-390.png
- /home/mgacai/pwa-1.3.2-out/screenshots/pwa-after-drill-insentence-390.png
- /home/mgacai/pwa-1.3.2-out/screenshots/pwa-after-drill-align-390.png

Verification logs are in /home/mgacai/pwa-1.3.2-out/: npm-test-followup.log, targeted-followup.log, python-test-followup.log, build-followup.log, audit-followup.log and followup-browser.log.
