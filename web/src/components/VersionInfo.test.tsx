// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { version } from "../../package.json";
import { VersionInfo } from "./VersionInfo";
import { WidthContext } from "./ui";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("version and update history", () => {
  it.each([390, 1200])("opens and closes the update history at width %i", async (width) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<WidthContext.Provider value={width}><VersionInfo /></WidthContext.Provider>));
      const trigger = host.querySelector<HTMLButtonElement>("button")!;
      expect(host.querySelector("#about-h")?.textContent).toBe("About");
      expect(host.querySelector("dt")?.textContent).toBe("Version");
      expect(host.querySelector("dd")?.textContent).toBe(version);
      expect(trigger.textContent).toBe("What’s new");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      trigger.focus();
      await act(async () => trigger.click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog).toBeTruthy();
      expect(dialog.classList.contains("sheet")).toBe(width < 640);
      expect(dialog.classList.contains("dialog")).toBe(width >= 640);
      expect(dialog.textContent).toContain("What’s new");
      expect(dialog.textContent).toContain(`v${version}`);
      expect(dialog.textContent).toContain("Removed the French character shortcut buttons");
      expect(dialog.textContent).toContain("v1.0.0");
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
