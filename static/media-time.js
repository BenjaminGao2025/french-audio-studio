/* ==========================================================================
   French Audio Studio - listening time (any <audio> / Audio() that is actually playing)
   Counts the seconds of audio really played, so a locked iPhone or a background tab still earns
   its time. Each beat (every tick while something plays, and on play / pause / ended / seeking /
   visibility changes) reads how far every playing element's position moved since the last beat:
   the position is the truth even when the page's own timers were frozen, and a jump larger than
   MAX_JUMP is a seek or a bad reading, not listening. The page's own "active" time is counted by
   the same beat, and one second is only ever counted once: the beat credits the larger of the
   two sources for the interval, never their sum.

   FrenchMediaTime.create({
     laneFor(el)      lane for the playing element (el = null: the page's own lane)
     isActive()       the page is being used right now (visible, not idle); default false
     onSeconds(lane, seconds)   called with every credit
     tickMs           beat interval while an element plays (default 5000)
     alwaysTick       keep beating even when nothing plays (pages that count their own active time)
   }) -> { beat(), playing(), destroy() }
   ========================================================================== */

(function (root) {
    'use strict';

    const MAX_JUMP = 4 * 3600;

    function create(options) {
        const doc = options.document || root.document;
        const win = options.window || root;
        const now = options.now || Date.now;
        const tickMs = options.tickMs || 5000;
        const isActive = options.isActive || (() => false);
        const playing = new Map();      // playing element -> position at the last beat
        const known = new WeakSet();    // elements whose own events are wired
        let lastBeat = now();
        let wasActive = false;
        let timer = 0;
        let destroyed = false;

        const position = el => Number(el.currentTime) || 0;

        // Seconds this element's position moved since it was last read (0 for a seek or a bad reading)
        function advance(el, wallSeconds) {
            const was = playing.get(el);
            const at = position(el);
            playing.set(el, at);
            if (was === undefined || at <= was) return 0;
            const moved = at - was;
            const rate = Math.max(Number(el.playbackRate) || 1, 1);
            // A frozen page wakes up with a long wall-clock gap: the position says how much was played.
            // A short gap cannot hold more than it lasted (that would be a seek).
            return moved <= MAX_JUMP && moved <= wallSeconds * rate + 2 ? moved : 0;
        }

        function beat() {
            if (destroyed) return;
            const t = now();
            const wall = Math.max(0, (t - lastBeat) / 1000);
            lastBeat = t;
            let media = 0;
            let mediaEl = null;
            for (const el of Array.from(playing.keys())) {
                const moved = advance(el, wall);
                if (moved > media) { media = moved; mediaEl = el; }
                if (el.paused || el.ended) playing.delete(el);
            }
            // The page's own active time covers at most the interval since the last beat (+ one tick of slack)
            const active = wasActive ? Math.min(wall, (2 * tickMs) / 1000) : 0;
            wasActive = Boolean(isActive());
            const credit = Math.max(active, media);
            if (credit >= 0.5) options.onSeconds(options.laneFor(media > active ? mediaEl : null), credit);
            schedule();
        }

        // The tick runs while something plays or the page counts active time
        function schedule() {
            const needed = options.alwaysTick || playing.size > 0 || wasActive || isActive();
            if (needed && !timer) timer = win.setInterval(beat, tickMs);
            else if (!needed && timer) { win.clearInterval(timer); timer = 0; }
        }

        function start(el) {
            if (!el || destroyed) return;
            beat();
            if (!playing.has(el)) playing.set(el, position(el));
            wire(el);
            schedule();
        }

        function stop(el) {
            beat();  // the final stretch of this element is read before it leaves
            playing.delete(el);
            schedule();
        }

        function reposition(el) {
            if (playing.has(el)) playing.set(el, position(el));
        }

        function wire(el) {
            if (known.has(el) || typeof el.addEventListener !== 'function') return;
            known.add(el);
            ['pause', 'ended', 'emptied', 'abort'].forEach(name => el.addEventListener(name, () => stop(el)));
            ['seeking', 'seeked'].forEach(name => el.addEventListener(name, () => reposition(el)));
            ['playing', 'play'].forEach(name => el.addEventListener(name, () => { if (!el.paused) start(el); }));
        }

        // Media in the page, and detached Audio() objects: their events never reach the document, so
        // play() itself is wrapped to learn about them.
        const MediaElement = win.HTMLMediaElement;
        const originalPlay = MediaElement && MediaElement.prototype.play;
        let wrapper = null;
        if (originalPlay && !options.noPatch) {
            MediaElement.prototype.play = wrapper = function () {
                const result = originalPlay.apply(this, arguments);
                if (!destroyed) { wire(this); start(this); }
                return result;
            };
        }
        const onDocPlay = e => { if (e.target && e.target.tagName && /^(AUDIO|VIDEO)$/.test(e.target.tagName) && !e.target.paused) start(e.target); };
        doc.addEventListener('play', onDocPlay, true);
        const onVisibility = () => beat();
        doc.addEventListener('visibilitychange', onVisibility);
        win.addEventListener('pagehide', onVisibility);
        win.addEventListener('pageshow', onVisibility);

        function destroy() {
            if (destroyed) return;
            beat();
            destroyed = true;
            if (timer) win.clearInterval(timer);
            // Only restore when nobody wrapped play() after us
            if (wrapper && MediaElement.prototype.play === wrapper) MediaElement.prototype.play = originalPlay;
            doc.removeEventListener('play', onDocPlay, true);
            doc.removeEventListener('visibilitychange', onVisibility);
            win.removeEventListener('pagehide', onVisibility);
            win.removeEventListener('pageshow', onVisibility);
            playing.clear();
        }

        schedule();
        return { beat, destroy, playing: () => playing.size };
    }

    const api = { create, MAX_JUMP };
    root.FrenchMediaTime = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
