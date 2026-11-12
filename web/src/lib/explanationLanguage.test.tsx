// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { chooseExplanationLanguage, readExplanationLanguage, useExplanationLanguage } from "./explanationLanguage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => localStorage.clear());
it.each([null, "invalid", "en", "zh"])("reads %s with English as the default", value => {
  if (value !== null) localStorage.setItem("explanationLanguage", value);
  expect(readExplanationLanguage()).toBe(value === "zh" ? "zh" : "en");
});
it("updates mounted consumers together and persists across remounts", async () => {
  const host = document.createElement("div");
  let root = createRoot(host);
  function Harness() { const [language] = useExplanationLanguage(); return <span>{language === "en" ? "Simple English" : "中文"}</span>; }
  await act(async () => root.render(<><Harness /><Harness /></>));
  expect(host.textContent).toBe("Simple EnglishSimple English");
  await act(async () => chooseExplanationLanguage("zh"));
  expect(host.textContent).toBe("中文中文");
  expect(localStorage.getItem("explanationLanguage")).toBe("zh");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  expect(host.textContent).toBe("中文");
  await act(async () => chooseExplanationLanguage("invalid"));
  expect(host.textContent).toBe("中文");
  await act(async () => root.unmount());
});
