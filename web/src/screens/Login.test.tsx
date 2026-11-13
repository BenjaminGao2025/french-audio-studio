// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LoginScreen } from "./Login";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const render = (url: string) => {
  history.replaceState(null, "", url);
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  root = createRoot(el);
  act(() => root!.render(<LoginScreen onSignedIn={() => {}} />));
  return el;
};
const inviteField = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("label")).find((l) => l.textContent?.includes("Invite code"))?.control as HTMLInputElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("invite links (old /?invite= links redirect to /app/login?invite=)", () => {
  it("open sign-up with the code filled in", () => {
    const el = render("/app/login?invite=ABC123");
    expect(el.querySelector("h1")?.textContent).toBe("Create an account");
    expect(inviteField(el)?.value).toBe("ABC123");
  });

  it("cap the code at 64 characters", () => {
    const el = render(`/app/login?invite=${"x".repeat(80)}`);
    expect(inviteField(el)?.value).toBe("x".repeat(64));
  });

  it("without a code, sign-in is shown", () => {
    const el = render("/app/login?next=study");
    expect(el.querySelector("h1")?.textContent).toBe("Sign in");
    expect(inviteField(el)).toBeUndefined();
  });
});

describe("Continue with Google", () => {
  it("stays hidden when the server has no Google client ID", async () => {
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ google_client_id: null }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const el = render("/app/login");
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(el.querySelector("[data-google-signin]")).toBeNull();
      expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
    } finally {
      globalThis.fetch = fetchBefore;
    }
  });

  it("loads Google's button when the server names a client ID", async () => {
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ google_client_id: "abc.apps.googleusercontent.com" }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const el = render("/app/login");
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(el.querySelector("[data-google-signin]")).not.toBeNull();
      expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull();
    } finally {
      globalThis.fetch = fetchBefore;
    }
  });
});
