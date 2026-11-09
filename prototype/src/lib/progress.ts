/** Audio-time rules for the 1000-hour goal (simulated in this prototype). */

export interface Interval {
  start: number; // epoch ms, wall clock while actually playing
  end: number;
}

/** Counted time is wall-clock playback time, so content minutes are divided by speed. */
export function countedMinutesFor(contentMinutes: number, speed: number): number {
  return contentMinutes / speed;
}

/** Overlapping playback on one account counts once. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Split intervals at local midnight for a fixed UTC offset (minutes). */
export function splitAtMidnight(i: Interval, offsetMinutes: number): Interval[] {
  const day = 86_400_000;
  const off = offsetMinutes * 60_000;
  const out: Interval[] = [];
  let s = i.start;
  while (s < i.end) {
    const nextMidnight = Math.floor((s + off) / day) * day + day - off;
    const e = Math.min(i.end, nextMidnight);
    out.push({ start: s, end: e });
    s = e;
  }
  return out;
}

export const GOAL_HOURS = 1000;

export interface PaceSummary {
  remainingHours: number;
  dailyAverageMinutes: number;
  etaDays: number | null;
  etaDate: Date | null;
}

export function pace(lifetimeHours: number, last28Hours: number, reference: Date): PaceSummary {
  const remainingHours = Math.max(0, GOAL_HOURS - lifetimeHours);
  const dailyAverageMinutes = (last28Hours * 60) / 28;
  if (remainingHours === 0 || dailyAverageMinutes <= 0) {
    return { remainingHours, dailyAverageMinutes, etaDays: null, etaDate: null };
  }
  const etaDays = Math.round((remainingHours * 60) / dailyAverageMinutes);
  const etaDate = new Date(reference.getTime() + etaDays * 86_400_000);
  return { remainingHours, dailyAverageMinutes, etaDays, etaDate };
}
