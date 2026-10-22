// End-of-phase alerts for the focus timer: a soft chime and a system notification.
//
// The chime is scheduled on the Web Audio clock at start time, not played from a timer callback:
// browsers throttle timers in background tabs, but scheduled audio plays on time, so the chime
// lands exactly when the phase ends even while the learner is in another tab (e.g. a practice site).
// Only the tab where the learner pressed a button has an unlocked AudioContext, so only that tab
// chimes; the others just follow the shared state.

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let scheduled: { at: number; nodes: OscillatorNode[] } | null = null;

/** Call from a click handler: browsers only allow audio after a user gesture. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function hasAudio(): boolean {
  return ctx !== null;
}

function tone(c: Ctx, freq: number, start: number, length: number, peak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
  return osc;
}

/** Schedule the chime for an absolute time (ms). Replaces any chime scheduled before. */
export function scheduleChime(atMs: number, kind: "focus" | "break") {
  if (!ctx) return;
  if (scheduled?.at === atMs) return;
  cancelChime();
  const delay = Math.max(0, (atMs - Date.now()) / 1000);
  const t0 = ctx.currentTime + delay;
  // Focus done: a rising three-note bell, twice. Break over: a single falling pair.
  const notes = kind === "focus" ? [659.25, 830.61, 987.77, 659.25, 830.61, 987.77] : [880, 659.25];
  const gap = kind === "focus" ? 0.18 : 0.28;
  const nodes = notes.map((f, i) =>
    tone(ctx!, f, t0 + i * gap + (kind === "focus" && i >= 3 ? 0.5 : 0), 1.2, 0.18),
  );
  scheduled = { at: atMs, nodes };
}

/** Cancel a chime that has not started yet; one already ringing is left to finish. */
export function cancelChime() {
  if (!scheduled) return;
  if (Date.now() >= scheduled.at) {
    scheduled = null;
    return;
  }
  for (const n of scheduled.nodes) {
    try {
      n.stop();
      n.disconnect();
    } catch {
      // already stopped
    }
  }
  scheduled = null;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Ask once, from a click handler. Resolves to the resulting permission. */
export async function requestNotifications(): Promise<NotificationPermission | "unsupported"> {
  const p = notificationPermission();
  if (p !== "default") return p;
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
}

/** System notification, only while this page is not in front (otherwise the panel opens). */
export function notify(title: string, body: string) {
  if (notificationPermission() !== "granted" || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag: "1000h-focus", silent: hasAudio() });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}
