// Learner-friendly phonetics, the same everywhere in the app: /ɔʁ.di.na.tœʁ/ -> [ɔrdinatœr]
export function formatFriendlyPhonetic(raw: string): string {
  if (!raw) return "";
  let str = String(raw).trim();
  str = str.replace(/^[/[\\(\s]+/, "").replace(/[/\]\\)\s]+$/, "").trim();
  str = str.replace(/[.·•\-]/g, "");
  str = str.replace(/[ʁʀ]/g, "r");
  str = str.replace(/ɡ/g, "g");
  if (!str) return "";
  return `[${str}]`;
}
