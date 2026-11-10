import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { setToken } from "./api/client";
import { loadMe } from "./api/auth";
import { installFakeBackend } from "./test/fakeBackend";
import { REGISTRY } from "./screens/registry";
import { resetDemo, set } from "./state/store";
import "./styles.css";

installFakeBackend();
const inner = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === "/api/auth/me") {
    return new Response(
      JSON.stringify({
        id: 1,
        email: "alex.martin@example.com",
        plan: "demo",
        created_at: "2026-01-01T00:00:00Z",
        trial_expires_at: null,
        days_left: 0,
        is_valid: true,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return inner(input, init);
}) as typeof fetch;

setToken("ui-audit-demo-token");

type PreviewAPI = {
  apply: (id: string, key: string) => void;
  list: () => { id: string; title: string; keys: string[] }[];
};
function apply(id: string, key: string) {
  resetDemo();
  set(() => ({ auth: "in", frame: "fluid" }));
  const screen = REGISTRY.find((s) => s.id === id);
  const state = screen?.states.find((s) => s.key === key);
  if (!screen || !state) throw new Error(`Unknown preview state ${id}/${key}`);
  state.apply();
}
(window as unknown as { __preview: PreviewAPI }).__preview = {
  apply,
  list: () => REGISTRY.map((s) => ({ id: s.id, title: s.title, keys: s.states.map((st) => st.key) })),
};

function Boot() {
  useEffect(() => {
    void loadMe();
  }, []);
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
