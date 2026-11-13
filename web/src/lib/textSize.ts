/* Device-local text size: scales the root font, so every rem-based size (text, spacing, widths) grows together, like an IDE zoom. */
export const TEXT_SIZE_KEY = "frenchStudio.textSize";
export const TEXT_SIZES = [100, 115, 130, 145] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

const listeners = new Set<() => void>();

export function readTextSize(): TextSize {
  try {
    const n = Number(localStorage.getItem(TEXT_SIZE_KEY));
    return (TEXT_SIZES as readonly number[]).includes(n) ? (n as TextSize) : 100;
  } catch {
    return 100;
  }
}

export function applyTextSize(size: TextSize = readTextSize()) {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = size === 100 ? "" : `${size}%`;
}

export function saveTextSize(size: TextSize) {
  try { localStorage.setItem(TEXT_SIZE_KEY, String(size)); } catch { /* private mode: still applies for this visit */ }
  applyTextSize(size);
  listeners.forEach((fn) => fn());
}

export function subscribeTextSize(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
