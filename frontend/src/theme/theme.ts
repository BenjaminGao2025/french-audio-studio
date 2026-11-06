// Theme (light/dark/system) handling. Palette presets (ink-blue / sage) live in styles.css
// and are switched via <html data-theme="...">.

export type Theme = "light" | "dark" | "system";

const KEY = "1000h.theme";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (window.localStorage.getItem(KEY) as Theme) || "system";
}

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(theme: Theme) {
  window.localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/** Call once at app start (client only). */
export function initTheme() {
  if (typeof window === "undefined") return;
  applyTheme(getTheme());
  const palette = window.localStorage.getItem("1000h.palette");
  if (palette) document.documentElement.dataset["theme"] = palette;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyTheme(getTheme()));
}
