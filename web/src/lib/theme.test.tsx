// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { readTheme, useTheme } from "./theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { localStorage.clear(); document.documentElement.classList.remove("dark"); vi.unstubAllGlobals(); });
it.each(["light", "dark", "system", "invalid", null])("boot applies stored %s and the OS before rendering", value => {
  const source = readFileSync("../static/theme-boot.js", "utf8");
  for (const systemDark of [false, true]) {
    const toggle = vi.fn();
    runInNewContext(source, { localStorage: { getItem: () => value }, matchMedia: () => ({ matches: systemDark }), document: { documentElement: { classList: { toggle } } } });
    expect(toggle).toHaveBeenCalledWith("dark", value === "dark" || (value !== "light" && value !== "dark" && systemDark));
  }
});
it("reads storage, persists choices and follows live System changes only in System", async () => {
  localStorage.setItem("theme", "dark");
  expect(readTheme()).toBe("dark");
  let change = () => {};
  const media = { matches: false, addEventListener: vi.fn((_type, cb) => { change = cb; }), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  let choose: (value: string) => void = () => {};
  function Harness() { const [theme, select] = useTheme(); choose = select; return <span>{theme}</span>; }
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => root.render(<Harness />));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await act(async () => choose("system"));
  expect(localStorage.getItem("theme")).toBe("system");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  media.matches = true;
  await act(async () => change());
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await act(async () => choose("light"));
  await act(async () => change());
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  await act(async () => root.unmount());
  expect(media.removeEventListener).toHaveBeenCalled();
});
