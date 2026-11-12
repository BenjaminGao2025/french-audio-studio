import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export function readTheme(): Theme {
  try {
    const value = localStorage.getItem("theme");
    if (value === "light" || value === "dark") return value;
  } catch { /* Storage may be disabled. System still works. */ }
  return "system";
}
export function applyTheme(theme: Theme, systemDark: boolean) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark));
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(theme, media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const choose = (value: string) => {
    if (value !== "light" && value !== "dark" && value !== "system") return;
    try { localStorage.setItem("theme", value); } catch { /* Apply for this visit. */ }
    applyTheme(value, matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(value);
  };
  return [theme, choose] as const;
}
