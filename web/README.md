# 1000H French web app

The new French Audio Studio front end: a React 19 + Vite + TypeScript SPA served by FastAPI under `/app/`
(`routers/app_shell.py`). It started from the approved design prototype (branch `design/figma-make-v3`).

Status: sign-in, sign-out and the shell use the real API (`src/api/`). Every other screen still shows the
prototype's in-memory sample data and the shell says so ("Demo data — not connected yet"); later phases
connect them one area at a time.

```bash
npm ci
npm run dev        # Vite dev server on :5180, /api proxied to http://127.0.0.1:8000 (API_TARGET to change)
npm test           # rule tests, API client tests, render/answer-leak smoke tests over every registered state
npm run typecheck
npm run build      # → dist/ (the Docker build copies it to static/app; never committed)
```

Structure: `src/api` (fetch client, auth/session) · `src/lib` (grading, lookup keys, audio-time rules) ·
`src/data/fixtures.ts` (sample data, to be removed as screens connect) · `src/state` (store, routing) ·
`src/components` (shell, UI primitives) · `src/screens` (one file per area; `registry.ts` lists every
screen state for the smoke tests and the design reference at `/app/design`).
