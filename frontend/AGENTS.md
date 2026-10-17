<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Project rules

- All data flows through the typed API layer in src/api/ (client, types, real, mock, hooks). Mock adapter is used only in development or with VITE_USE_MOCK=1; production uses the real adapter by default; real adapter targets a separate FastAPI backend. No Lovable Cloud / Supabase / server functions — the backend lives in another repo. Why: this app is the frontend for an existing FastAPI site.
- Shared UI lives in src/components/fr/kit.tsx (AppShell for overview pages, BlockShell for focused blocks); non-component exports (meta, btn, navTo, withBlock) live in kit-utils.ts so react-refresh stays clean. Why: keeps "one screen, one task" consistent.
- No /m phone-frame routes: pages are responsive (AppShell shows a bottom tab bar under md). Why: the app ships inside the host site, not as a side-by-side preview.
- Theme presets are CSS-variable blocks in src/styles.css: ink-blue is the default, sage is opt-in via <html data-theme="sage">; dark mode via .dark. Switched in Settings (src/theme/theme.ts). Why: must match the host site's design system.
- Fonts are bundled via Fontsource (no Google Fonts requests); no external telemetry. Why: the host site enforces a strict CSP.
- i18n via src/i18n (t/useT), zh-CN default, toggle in Settings. Why: the user is a Chinese speaker learning French.
- `build:static` (vite.static.config.ts) produces the SPA build for hosting under the FastAPI app; plain `build` is the Lovable/SSR build.

- Block lifecycle is shared through useBlockFlow; Today appends block ids and destinations are computed before mutations. Why: cache refresh must not determine the next block.
- Listening counts only successful AudioButton playback; writing submissions use a per-session ref guard outside timer state updates. Why: failed audio and StrictMode must not create false activity or duplicate submissions.
