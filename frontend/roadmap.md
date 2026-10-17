# Roadmap — 1000H French

## Round-three fixes

- [x] Block ids, ordered Finish/Skip navigation, Cards and wrap-up lifecycle
- [x] Raw west-positive timezone offset
- [x] Actual listening playback and sequential relistens
- [x] Seven required regression test suites and StrictMode-safe writing timer
- [x] Production adapter, profile names, minimal state, retell/shadow data, episode heartbeat, journal/reading completion, root and README cleanups
- [x] Validate tests, lint and live preview; hosting harness validates builds

- Verified this round: 8 test suites, lint without errors/warnings, hosting harness build OK; browser journal input → two recordings → Saved → Cards → Today done, Skip → Cards → Today skipped, minimal on/off, listening failure and real test-audio success.
- Real hosted audio/endpoints remain unverified; preview uses mock data. Static-build command was not manually run; hosting harness validates the normal build.

## Done

- A1 fonts: Fontsource bundles (Instrument Sans, Newsreader, JetBrains Mono); Google Fonts links removed
- A1 telemetry: Lovable error reporting removed; no external requests
- A2 basepath: router uses BASE_URL; `build:static` script (vite.static.config.ts, Start SPA + prerender /)
- A3 hygiene: prettier + eslint clean, 47 unused shadcn components deleted
- B1 typed API layer: src/api/{client,types,real,mock,index,hooks}.ts; Bearer token, 401→/login, tz_offset = getTimezoneOffset() unchanged (west-positive)
- B2 state: TanStack Query hooks; Skeleton/EmptyState/ErrorState/DataView
- B3 shared widgets: AudioButton, Recorder (webm/mp4 fallback), BlockTimer (60s heartbeat), SkipReasonSelect, RubricPanel
- B4 Today: API-driven plan, time-based greeting, minimal-day (20-min) toggle, todos, fallback/material indicators
- B5 blocks: journal (5 steps, MediaRecorder, archive link), listening (blind-play gate), writing (timer + auto-submit + rubric), reading (multi-open answers, add-to-cards), speaking (T2 prep→record), wrapup (4 questions)
- B6 cards: keyboard 1–4/space, API interval labels, cloze answers
- B7 hours ledger: 7 backend lanes, Active/Manual/Input columns, manual log/delete, family-day toggle
- B8 decisions: Week 8 report vs Week 16 empty state, decision form, export link
- B9 items bank: summary cards + filtered table
- B10 episodes / shadow / retell / me pages (responsive, /m phone-frame routes deleted)
- C login + settings (locale, theme, palette, phase, account, logout) + tutor page
- D i18n: zh-CN default dictionary, useT(), Settings toggle
- E theme: ink-blue default + sage preset + dark mode, Settings toggles
- Verified: tsgo, eslint, vitest, `build`, `build:static` all pass; 18 pages smoke-tested in browser, 0 console errors

## Open (blocked on the FastAPI repo — Part 2, not this project)

- Verify real-adapter endpoint shapes against the live backend (production now defaults to the real API); blocked on access to the separate FastAPI repo.
- CSP validation of the static build inside the host FastAPI app (strict script-src 'self' — may require the pure-Vite conversion the review recommends instead of Start SPA mode)
- Full zh/en dictionary coverage of page body copy is deferred outside this narrow round-three scope.
