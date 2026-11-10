// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { version } from "../../package.json";
import { VersionInfo } from "./VersionInfo";
import { WidthContext } from "./ui";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("version and update history", () => {
  it.each([390, 1200])("opens and closes the update history at width %i", async (width) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<WidthContext.Provider value={width}><VersionInfo /></WidthContext.Provider>));
      const trigger = host.querySelector<HTMLButtonElement>("button")!;
      expect(trigger.textContent).toBe(`v${version}`);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      trigger.focus();
      await act(async () => trigger.click());
      const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog).toBeTruthy();
      expect(dialog.classList.contains("sheet")).toBe(width < 640);
      expect(dialog.textContent).toContain("What’s new");
      expect(dialog.textContent).toContain(`v${version}`);
      expect(dialog.textContent).toContain("Removed the French character shortcut buttons");
      expect(dialog.textContent).toContain("v1.0.0");
      await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
