# 1000H French — clickable design prototype

A standalone, front-end-only prototype built from the Figma Make prompt on branch `design/figma-make-v2`.
It does not run, import or change the FastAPI app, `frontend/`, or any deployment config.

- All data is fictional and held in memory. No backend, AI, account, database, audio, camera or microphone is used.
- Simulated media, sync, offline, background playback and device support are labelled as such.
- **Demo states** (header) jumps to every screen ID and state; **Reset demo** restores fictional data only.
- **Design reference** (`#/design`, also in the account menu) holds tokens, contrast checks, component roles,
  accessibility specs, adopted defaults and the navigable coverage inventory.

```bash
npm ci
npm run dev        # Vite dev server
npm test           # rule tests + render/answer-leak smoke tests over every registered state
npm run build      # typecheck + production build
```

Structure: `src/lib` (grading, lookup keys/throttle, audio-time rules) · `src/data/fixtures.ts` ·
`src/state` (in-memory store, simulation helpers) · `src/components` (shell, UI primitives) ·
`src/screens` (one file per area, `registry.ts` for the Demo states navigator).
