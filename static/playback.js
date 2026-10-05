/* ==========================================================================
   French Audio Studio - playback mode, shared by every page
   Once (default) / Repeat this one / Read everything and start over (study).
   Pages ask FrenchPlayback.mode() when they play French, and report a running
   loop with setActive() so a Stop button (and Esc) can end it. Audio players
   (<audio controls>, e.g. Listen episodes) simply loop while a repeat mode is on.
   ========================================================================== */

(function (root) {
    'use strict';

    const I18N = root.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const KEY = 'frenchStudio.playbackMode';
    const STUDY = root.location.pathname === '/study';
    const MODES = STUDY ? ['once', 'loop', 'all'] : ['once', 'loop'];
    const ICONS = { once: 'play', loop: 'repeat-1', all: 'repeat' };
    const T = EN
        ? { once: 'Play once', loop: 'Repeat', all: 'Repeat all', stop: 'Stop', title: 'How French audio plays (click to change)' }
        : { once: '播放一次', loop: '单句循环', all: '全文循环', stop: '停止', title: '法语播放方式（点击切换）' };

    let control = null;
    let stopButton = null;
    let stopFn = null;

    function mode() {
        let saved = 'once';
        try { saved = localStorage.getItem(KEY) || 'once'; } catch (_) {}
        if (saved === 'all' && !STUDY) return 'loop';  // only the study page has a whole text to go through
        return MODES.includes(saved) ? saved : 'once';
    }

    function setMode(next) {
        try { localStorage.setItem(KEY, next); } catch (_) {}
        render();
        document.querySelectorAll('audio[controls]').forEach(a => { a.loop = next !== 'once'; });
    }

    // A page started (or ended) a loop; stop() ends it
    function setActive(on, stop) {
        stopFn = on ? stop : null;
        if (stopButton) stopButton.hidden = !on;
    }

    function stop() {
        const fn = stopFn;
        setActive(false);
        if (fn) fn();
    }

    function refreshIcons() {
        if (root.lucide && typeof root.lucide.createIcons === 'function') root.lucide.createIcons();
    }

    function render() {
        if (!control) return;
        const m = mode();
        control.innerHTML = `<i data-lucide="${ICONS[m]}" aria-hidden="true"></i><span>${T[m]}</span>`;
        control.classList.toggle('is-on', m !== 'once');
        refreshIcons();
    }

    function mount() {
        const wrap = document.createElement('span');
        wrap.className = 'playback-control';
        control = document.createElement('button');
        control.type = 'button';
        control.className = 'hud-btn playback-mode';
        control.title = T.title;
        control.addEventListener('click', () => setMode(MODES[(MODES.indexOf(mode()) + 1) % MODES.length]));
        stopButton = document.createElement('button');
        stopButton.type = 'button';
        stopButton.className = 'hud-btn playback-stop';
        stopButton.hidden = true;
        stopButton.innerHTML = `<i data-lucide="square" aria-hidden="true"></i><span>${T.stop}</span>`;
        stopButton.addEventListener('click', stop);
        wrap.append(control, stopButton);
        // In the progress strip when there is one, otherwise with the header buttons
        const hudLog = document.querySelector('.game-hud .hud-log');
        if (hudLog) hudLog.before(wrap);
        else {
            const actions = document.querySelector('.topbar-actions');
            if (!actions) return;
            actions.prepend(wrap);
        }
        render();
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && stopFn) stop();
    });
    // Players with controls (Listen episodes, Audio Studio) follow the mode too
    document.addEventListener('play', (e) => {
        if (e.target instanceof HTMLMediaElement && e.target.controls) e.target.loop = mode() !== 'once';
    }, true);

    if (document.readyState === 'loading') {
        // After game.js has built the progress strip
        document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 0));
    } else {
        setTimeout(mount, 0);
    }

    root.FrenchPlayback = { mode, setMode, setActive, stop };
})(window);
