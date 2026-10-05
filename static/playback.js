/* ==========================================================================
   French Audio Studio - repeat playback, shared by every page
   One setting: Repeat on/off. Any element with class "btn-repeat-toggle"
   switches it (all copies stay in sync). Pages ask FrenchPlayback.repeat()
   when they play French and report a running loop with setActive(), which
   shows a floating Stop button (Esc works too). Episode players on /listen
   loop while Repeat is on.
   ========================================================================== */

(function (root) {
    'use strict';

    const I18N = root.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const KEY = 'frenchStudio.repeat';
    const T = EN
        ? { repeat: 'Repeat', stop: 'Stop', on: 'Repeat is on: audio keeps playing until you stop it', off: 'Repeat is off: audio plays once' }
        : { repeat: '循环', stop: '停止', on: '循环已开：会一直播放，直到你停止', off: '循环已关：只播放一次' };

    let stopFn = null;
    let stopPill = null;

    function repeat() {
        try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
    }

    function sync() {
        const on = repeat();
        document.querySelectorAll('.btn-repeat-toggle').forEach(btn => {
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-pressed', String(on));
            btn.title = on ? T.on : T.off;
        });
        document.querySelectorAll('audio.episode-audio').forEach(a => { a.loop = on; });
    }

    function setRepeat(on) {
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
        sync();
    }

    // Markup for a Repeat switch; any number of them can be on a page
    function toggleHtml(extraClass = '') {
        const on = repeat();
        return `<button type="button" class="btn btn-secondary btn-repeat-toggle ${on ? 'is-on' : ''} ${extraClass}" aria-pressed="${on}" title="${on ? T.on : T.off}">
            <i data-lucide="repeat" aria-hidden="true"></i><span>${T.repeat}</span></button>`;
    }

    // A page started (or ended) continuous playback; stop() ends it
    function setActive(on, stop) {
        stopFn = on ? stop : null;
        if (!stopPill && on) {
            stopPill = document.createElement('button');
            stopPill.type = 'button';
            stopPill.className = 'playback-stop-pill';
            stopPill.innerHTML = `<i data-lucide="square" aria-hidden="true"></i><span>${T.stop}</span>`;
            stopPill.addEventListener('click', stopNow);
            document.body.appendChild(stopPill);
            if (root.lucide && typeof root.lucide.createIcons === 'function') root.lucide.createIcons();
        }
        if (stopPill) stopPill.hidden = !on;
    }

    function stopNow() {
        const fn = stopFn;
        setActive(false);
        if (fn) fn();
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-repeat-toggle');
        if (!btn) return;
        e.preventDefault();
        setRepeat(!repeat());
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && stopFn) stopNow();
    });
    document.addEventListener('play', (e) => {
        if (e.target instanceof HTMLMediaElement && e.target.classList.contains('episode-audio')) e.target.loop = repeat();
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
    else sync();

    root.FrenchPlayback = { repeat, setRepeat, toggleHtml, sync, setActive, stop: stopNow };
})(window);
