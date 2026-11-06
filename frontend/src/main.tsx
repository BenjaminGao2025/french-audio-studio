// Client entry (plain Vite SPA). The only <script> in index.html points here, so the host
// CSP never needs 'unsafe-inline'. Theme and lang are set before the first render.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";
import { api, getToken } from "./api";
import { getLocale } from "./i18n";
import { getRouter } from "./router";
import { initTheme } from "./theme/theme";

const router = getRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

initTheme();
document.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";

// Audio elements cannot send the bearer token: exchange it for the HttpOnly session cookie
// (same as static/i18n.js on the legacy pages). Errors are ignored.
if (getToken()) void api.auth.session().catch(() => {});

// A redeploy replaces hashed chunks; reload once (at most every 10 s) to pick up the new shell.
const RELOAD_KEY = "1000h.chunkReloadAt";
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
  if (Date.now() - last < 10_000) return;
  window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
