// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../data/releases";
import { liveVersion, useUpdatePrompt, versionInPage } from "./updateCheck";

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = (v: string) => `<head><script src="/static/pwa-register.js?v=${v}" defer></script></head>`;
const serve = (body: string, ok = true) => vi.fn(async () => ({ ok, text: async () => body }) as Response);

function Probe({ fetchImpl }: { fetchImpl: typeof fetch }) {
  useUpdatePrompt(true, fetchImpl);
  return null;
}

async function mount(fetchImpl: typeof fetch) {
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(<Probe fetchImpl={fetchImpl} />));
  return root;
}

afterEach(() => toast.mockClear());

const focus = () => act(async () => {
  window.dispatchEvent(new Event("focus"));
  await new Promise((r) => setTimeout(r, 0));
});

describe("update check", () => {
  it("reads the release from the page", () => {
    expect(versionInPage(page("1.3.18"))).toBe("1.3.18");
    expect(versionInPage("<html></html>")).toBeNull();
  });

  it("treats a failed request as unknown", async () => {
    expect(await liveVersion(serve("", false))).toBeNull();
    expect(await liveVersion(vi.fn(async () => { throw new TypeError("offline"); }))).toBeNull();
  });

  it("offers a reload once when a newer release is live", async () => {
    const fetchImpl = serve(page("9.9.9"));
    const root = await mount(fetchImpl);
    await focus();
    await focus();
    expect(fetchImpl).toHaveBeenCalledWith("/app/index.html", expect.objectContaining({ cache: "no-store" }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe("Version 9.9.9 is ready");
    expect(toast.mock.calls[0][1]).toMatchObject({ action: { label: "Reload" } });
    root.unmount();
  });

  it("stays quiet when the live release is this one", async () => {
    const fetchImpl = serve(page(APP_VERSION));
    const root = await mount(fetchImpl);
    await focus();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    root.unmount();
  });
});
