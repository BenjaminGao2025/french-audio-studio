# 1000H French web app

The new French Audio Studio front end: a React 19 + Vite + TypeScript SPA served by FastAPI under `/app/`
(`routers/app_shell.py`). It started from the approved design prototype (branch `design/figma-make-v3`).

It is the only learning UI: the old pages (`/study`, `/review`, …) redirect here (`routers/pages.py`).
Study, Review, Episodes, Progress, History, Practice and Settings use the real API (`src/api/`); Exam is a
placeholder. A route that is not connected yet still shows a "Demo data" banner.

```bash
npm ci
npm run dev        # Vite dev server on :5180, /api proxied to http://127.0.0.1:8000 (API_TARGET to change)
npm test           # rule tests, API client tests, render/answer-leak smoke tests over every registered state
npm run typecheck
npm run build      # → dist/ (the Docker build copies it to static/app; never committed)
```

Structure: `src/api` (fetch client, auth/session) · `src/lib` (grading, lookup keys, audio-time rules) ·
`src/data/fixtures.ts` (shared types and sample data for the design reference and tests) · `src/state` (store, routing) ·
`src/components` (shell, UI primitives) · `src/screens` (one file per area; `registry.ts` lists every
screen state for the smoke tests and the design reference at `/app/design`).
