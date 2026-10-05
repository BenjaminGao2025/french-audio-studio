/* ==========================================================================
   French Audio Studio - the game layer (see game.py)
   A thin HUD under the header (hero level, XP, today / this week vs the plan,
   weekday streak), a panel to log study done outside the app, active-time
   tracking on /study and /review, and the kill feed for reviews: callouts,
   XP floats and synthesized sounds (mutable).
   ========================================================================== */

(function (root) {
    'use strict';

    const I18N = root.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const TOKEN_KEY = 'frenchStudio.userToken';
    const MUTE_KEY = 'frenchStudio.gameMuted';
    const LANES = ['course', 'listening', 'reading', 'speaking', 'writing', 'review', 'car'];
    // Pages whose time counts automatically; anything else can be logged by hand.
    // /listen counts the audio actually played (car/walk listening, worth half).
    const PAGE_LANES = { '/study': 'reading', '/review': 'review', '/listen': 'car' };
    const LANE_WEIGHTS = { car: 0.5 };
    const IDLE_MS = 120000;
    const TICK_MS = 5000;
    const FLUSH_SECONDS = 30;
    // Big callouts; other combos only get the small "Combo xN" chip
    const CALLOUTS = { 2: 'Double kill', 3: 'Triple kill', 4: 'Ultra kill', 5: 'Rampage', 7: 'Unstoppable', 10: 'Godlike', 15: 'Beyond godlike' };

    const TEXT = {
        en: {
            hudAria: 'Your progress', heroTitle: 'Open your progress',
            today: 'Today', week: (n) => (n ? `Week ${n}` : 'Before week 1'), h: 'h',
            streak: (n) => `${n}-day streak`, family: 'Family day', weekend: 'Weekend',
            logTime: 'Log time', mute: 'Turn sounds off', unmute: 'Turn sounds on',
            lanesTitle: 'This week, by part of the plan', maintenance: 'Maintenance weeks: 5 h',
            lanes: { course: 'Course', listening: 'Listening', reading: 'Reading', speaking: 'Speaking', writing: 'Writing', review: 'Review', car: 'Car / walk' },
            halfNote: 'Car and walk listening counts half: your eyes and mind are on the road.',
            quickTitle: 'Log study you did outside the app',
            presets: [
                { lane: 'speaking', minutes: 60, label: 'Teacher class · 1 h' },
                { lane: 'course', minutes: 60, label: 'Course book · 1 h' },
                { lane: 'listening', minutes: 30, label: 'Listening · 30 min' },
                { lane: 'reading', minutes: 30, label: 'Reading · 30 min' },
                { lane: 'writing', minutes: 30, label: 'Writing · 30 min' },
                { lane: 'car', minutes: 60, label: 'Car listening · 1 h' },
                { lane: 'car', minutes: 30, label: 'Walk listening · 30 min' },
            ],
            other: 'Other', minutes: 'min', add: 'Add', undo: 'Undo',
            loggedToday: 'Logged today', nothingLogged: 'Nothing logged by hand today.',
            familyLabel: 'Today is a family day', familyHint: 'No target today, and the streak stays safe.',
            totals: (h, xp) => `${h} h studied in total · ${xp} XP to the next level`,
            maxLevel: (h) => `${h} h studied in total · max level`,
            summaryTitle: 'Match summary',
            summary: (s) => `${s.kills} kills · ${s.deaths} deaths · best combo x${s.bestCombo} · +${s.xp} XP`,
            levelUp: (n) => `Level ${n}`, saveFailed: 'Could not save: ',
        },
        zh: {
            hudAria: '学习进度', heroTitle: '打开进度面板',
            today: '今天', week: (n) => (n ? `第 ${n} 周` : '第 1 周之前'), h: '小时',
            streak: (n) => `连续 ${n} 个学习日`, family: '家庭日', weekend: '周末',
            logTime: '记录时间', mute: '关闭音效', unmute: '打开音效',
            lanesTitle: '本周各模块（按计划分配）', maintenance: '保温期：每周 5 小时',
            lanes: { course: '主课', listening: '听力', reading: '阅读', speaking: '口语', writing: '写作', review: '复习', car: '开车·快走听' },
            halfNote: '开车和快走时听按一半计时：注意力主要在路上。',
            quickTitle: '记录在 App 之外的学习',
            presets: [
                { lane: 'speaking', minutes: 60, label: '老师课 · 1 小时' },
                { lane: 'course', minutes: 60, label: '主课教材 · 1 小时' },
                { lane: 'listening', minutes: 30, label: '听力 · 30 分钟' },
                { lane: 'reading', minutes: 30, label: '阅读 · 30 分钟' },
                { lane: 'writing', minutes: 30, label: '写作 · 30 分钟' },
                { lane: 'car', minutes: 60, label: '开车听 · 1 小时' },
                { lane: 'car', minutes: 30, label: '快走听 · 30 分钟' },
            ],
            other: '其他', minutes: '分钟', add: '添加', undo: '撤销',
            loggedToday: '今天手动记录的', nothingLogged: '今天还没有手动记录。',
            familyLabel: '今天是家庭日', familyHint: '今天不设目标，连续天数也不会断。',
            totals: (h, xp) => `累计学习 ${h} 小时 · 离下一级还差 ${xp} XP`,
            maxLevel: (h) => `累计学习 ${h} 小时 · 已满级`,
            summaryTitle: '本局结算',
            summary: (s) => `击杀 ${s.kills} · 阵亡 ${s.deaths} · 最高连杀 x${s.bestCombo} · +${s.xp} XP`,
            levelUp: (n) => `${n} 级`, saveFailed: '保存失败：',
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];

    const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
    const tz = () => new Date().getTimezoneOffset();
    const hours = (minutes) => (Math.round((minutes / 60) * 10) / 10).toString();
    const fmt = (n) => Math.round(n).toLocaleString(EN ? 'en-CA' : 'zh-CN');

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function refreshIcons() {
        if (root.lucide && typeof root.lucide.createIcons === 'function') root.lucide.createIcons();
    }

    async function api(method, path, body, keepalive = false) {
        const res = await fetch(path, {
            method,
            keepalive,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail?.message || `HTTP ${res.status}`);
        return data;
    }

    // ---------------------------------------------------------------------
    // Sounds: soft synthesized cues, plus the announcer's voice for big moments
    // ---------------------------------------------------------------------
    let audioCtx = null;
    const muted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; } };

    function audio() {
        if (muted()) return null;
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        audioCtx = audioCtx || new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    // A soft bell-like note: a sine with a quiet octave on top
    function bell(freq, start, duration = 0.35, volume = 0.07) {
        const ac = audio();
        if (!ac) return;
        const t0 = ac.currentTime + start;
        [[1, volume], [2, volume * 0.25]].forEach(([mult, vol]) => {
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq * mult, t0);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
            osc.connect(gain).connect(ac.destination);
            osc.start(t0);
            osc.stop(t0 + duration + 0.05);
        });
    }

    // A low thump under the big callouts
    function thump(volume = 0.22) {
        const ac = audio();
        if (!ac) return;
        const t0 = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.3);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        osc.connect(gain).connect(ac.destination);
        osc.start(t0);
        osc.stop(t0 + 0.4);
    }

    const SOUNDS = {
        // a coin pickup, two semitones higher with each kill in a combo
        kill: (combo = 1) => {
            const k = Math.pow(2, (Math.min(Math.max(combo, 1) - 1, 7) * 2) / 12);
            bell(988 * k, 0, 0.12);
            bell(1319 * k, 0.08, 0.4);
        },
        big: () => thump(),
        levelUp: () => { [523, 659, 784, 1047].forEach((f, i) => bell(f, i * 0.1, 0.5, 0.08)); bell(1568, 0.42, 0.9, 0.06); },
        wave: () => { thump(0.15); [523, 659, 784].forEach((f, i) => bell(f, 0.05 + i * 0.06, 0.8, 0.06)); },
        miss: () => bell(220, 0, 0.25, 0.035),
    };

    // The announcer: fixed lines spoken by TTS on the server and cached (game.CALLOUT_PHRASES)
    const VOICE_LINES = {
        'First blood': 'first_blood', 'Double kill': 'double_kill', 'Triple kill': 'triple_kill',
        'Ultra kill': 'ultra_kill', 'Rampage': 'rampage', 'Unstoppable': 'unstoppable', 'Godlike': 'godlike',
        'Beyond godlike': 'beyond_godlike', 'Wave cleared': 'wave_cleared', 'Level up': 'level_up',
    };
    const voiceClips = {};

    function voiceClip(key) {
        if (!voiceClips[key]) {
            voiceClips[key] = new Audio(`/api/game/callout/${key}.mp3`);
            voiceClips[key].preload = 'auto';
        }
        return voiceClips[key];
    }

    function announce(line) {
        const key = VOICE_LINES[line];
        if (!key || muted()) return;
        const clip = voiceClip(key);
        clip.currentTime = 0;
        clip.volume = 0.95;
        clip.play().catch(() => {});
    }

    function flash(kind = '') {
        const el = document.createElement('div');
        el.className = `game-flash ${kind}`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 700);
    }

    // ---------------------------------------------------------------------
    // Callouts: one at a time, never blocking clicks or typing
    // ---------------------------------------------------------------------
    const bannerQueue = [];
    let bannerBusy = false;

    function banner(text, sub = '', kind = '') {
        bannerQueue.push({ text, sub, kind });
        if (!bannerBusy) nextBanner();
    }

    function nextBanner() {
        const item = bannerQueue.shift();
        if (!item) { bannerBusy = false; return; }
        bannerBusy = true;
        const el = document.createElement('div');
        el.className = `game-banner ${item.kind}`;
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = `<strong>${escapeHtml(item.text)}</strong>${item.sub ? `<span>${escapeHtml(item.sub)}</span>` : ''}`;
        document.body.appendChild(el);
        setTimeout(() => { el.remove(); nextBanner(); }, item.kind === 'is-level' ? 2200 : 1300);
    }

    function floatXp(xp) {
        if (!xp || !hud) return;
        const anchor = hud.querySelector('.hud-xp');
        const rect = anchor.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'game-xp-float';
        el.textContent = `+${xp} XP`;
        el.style.left = `${rect.left + rect.width / 2}px`;
        el.style.top = `${rect.bottom + 4}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }

    // ---------------------------------------------------------------------
    // HUD and panel
    // ---------------------------------------------------------------------
    let hud = null;
    let panel = null;
    let state = null;
    let shownLevel = null;

    function buildHud() {
        const topbar = document.querySelector('.topbar');
        if (!topbar) return;
        hud = document.createElement('div');
        hud.className = 'game-hud';
        hud.setAttribute('role', 'region');
        hud.setAttribute('aria-label', T.hudAria);
        hud.innerHTML = `
            <button class="hud-hero" type="button" aria-expanded="false" title="${escapeHtml(T.heroTitle)}">
                <span class="hud-level">Lv <b class="hud-level-n">1</b></span>
                <span class="hud-xp"><span class="hud-xp-bar"><span class="hud-xp-fill"></span></span><span class="hud-xp-text"></span></span>
            </button>
            <span class="hud-stat hud-today"><i data-lucide="sun" aria-hidden="true"></i><span></span></span>
            <span class="hud-stat hud-week"><i data-lucide="calendar-days" aria-hidden="true"></i><span></span></span>
            <span class="hud-stat hud-streak"><i data-lucide="flame" aria-hidden="true"></i><span></span></span>
            <span class="hud-spacer"></span>
            <button class="hud-btn hud-log" type="button"><i data-lucide="plus" aria-hidden="true"></i><span>${escapeHtml(T.logTime)}</span></button>
            <button class="hud-btn hud-mute" type="button"><i data-lucide="volume-2" aria-hidden="true"></i></button>`;
        panel = document.createElement('div');
        panel.className = 'game-panel';
        panel.hidden = true;
        topbar.after(hud);
        hud.after(panel);

        hud.querySelector('.hud-hero').addEventListener('click', togglePanel);
        hud.querySelector('.hud-log').addEventListener('click', togglePanel);
        hud.querySelector('.hud-mute').addEventListener('click', () => {
            try { localStorage.setItem(MUTE_KEY, muted() ? '0' : '1'); } catch (_) {}
            renderMute();
            if (!muted()) SOUNDS.kill();
        });
        // Reviews announce kills: load the voice lines up front so they play at once
        if (root.location.pathname === '/review') Object.values(VOICE_LINES).forEach(voiceClip);
        panel.addEventListener('click', onPanelClick);
        panel.addEventListener('change', onPanelChange);
        panel.addEventListener('submit', onPanelSubmit);
        renderMute();
    }

    function renderMute() {
        const btn = hud.querySelector('.hud-mute');
        btn.innerHTML = `<i data-lucide="${muted() ? 'volume-x' : 'volume-2'}" aria-hidden="true"></i>`;
        btn.title = muted() ? T.unmute : T.mute;
        btn.setAttribute('aria-label', btn.title);
        refreshIcons();
    }

    function togglePanel() {
        panel.hidden = !panel.hidden;
        hud.querySelector('.hud-hero').setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) renderPanel();
    }

    function renderHud() {
        if (!hud || !state) return;
        const next = state.next_level_xp;
        hud.querySelector('.hud-level-n').textContent = state.level;
        hud.querySelector('.hud-xp-fill').style.width = `${Math.round((next ? state.progress : 1) * 100)}%`;
        hud.querySelector('.hud-xp-text').textContent = next ? `${fmt(state.xp)} / ${fmt(next)} XP` : `${fmt(state.xp)} XP`;
        const today = state.today;
        const todayText = today.family_day ? `${T.family} · ${hours(today.minutes)} ${T.h}`
            : today.target ? `${T.today} ${hours(today.minutes)} / ${hours(today.target)} ${T.h}`
                : `${T.weekend} · ${hours(today.minutes)} ${T.h}`;
        const todayEl = hud.querySelector('.hud-today');
        todayEl.querySelector('span').textContent = todayText;
        todayEl.classList.toggle('is-done', Boolean(today.target) && today.minutes >= today.target);
        const week = state.week;
        hud.querySelector('.hud-week span').textContent = `${T.week(week.number)} · ${hours(week.minutes)} / ${hours(week.target)} ${T.h}`;
        hud.querySelector('.hud-week').classList.toggle('is-done', week.minutes >= week.target);
        const streakEl = hud.querySelector('.hud-streak');
        streakEl.hidden = !state.streak_days;
        streakEl.querySelector('span').textContent = T.streak(state.streak_days);
        refreshIcons();
        if (!panel.hidden) renderPanel();
    }

    function renderPanel() {
        if (!state) return;
        const week = state.week;
        const lanes = LANES.map(lane => {
            const done = week.by_lane[lane] || 0;
            const target = week.maintenance ? 0 : week.lane_targets[lane];
            const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
            return `
                <div class="lane-row ${target && done >= target ? 'is-done' : ''}">
                    <span class="lane-name">${escapeHtml(T.lanes[lane])}${LANE_WEIGHTS[lane] ? ' ½' : ''}</span>
                    <span class="lane-bar"><span style="width:${pct}%"></span></span>
                    <span class="lane-num">${hours(done)}${target ? ` / ${hours(target)}` : ''} ${T.h}</span>
                </div>`;
        }).join('');
        const logs = state.today.logs.length
            ? state.today.logs.map(log => `
                <li>${escapeHtml(T.lanes[log.lane])} · ${log.minutes} ${T.minutes}${log.note ? ` · ${escapeHtml(log.note)}` : ''}
                    <button class="link-btn game-undo" type="button" data-log-id="${log.id}">${T.undo}</button></li>`).join('')
            : `<li class="muted">${T.nothingLogged}</li>`;
        panel.innerHTML = `
            <div class="game-panel-grid">
                <section>
                    <h3>${T.lanesTitle}${week.maintenance ? ` · ${T.maintenance}` : ''}</h3>
                    ${lanes}
                    <p class="game-totals">${state.next_level_xp ? T.totals(state.hours_total, fmt(state.next_level_xp - state.xp)) : T.maxLevel(state.hours_total)}</p>
                    <p class="game-hint">½ ${escapeHtml(T.halfNote)}</p>
                </section>
                <section>
                    <h3>${T.quickTitle}</h3>
                    <div class="game-presets">
                        ${T.presets.map((p, i) => `<button class="btn btn-secondary game-preset" type="button" data-preset="${i}">${escapeHtml(p.label)}</button>`).join('')}
                    </div>
                    <form class="game-custom">
                        <select name="lane" aria-label="${escapeHtml(T.other)}">${LANES.map(l => `<option value="${l}">${escapeHtml(T.lanes[l])}</option>`).join('')}</select>
                        <input name="minutes" type="number" min="1" max="300" value="20" aria-label="${T.minutes}"> <span>${T.minutes}</span>
                        <button class="btn btn-secondary" type="submit">${T.add}</button>
                    </form>
                    <h3>${T.loggedToday}</h3>
                    <ul class="game-logs">${logs}</ul>
                    <label class="game-family"><input type="checkbox" ${state.today.family_day ? 'checked' : ''}> ${T.familyLabel}</label>
                    <p class="game-hint">${T.familyHint}</p>
                </section>
            </div>`;
    }

    async function logTime(lane, minutes, note = '') {
        try {
            applyState(await api('POST', '/api/game/log', { lane, minutes, note, tz_offset: tz() }));
            floatXp(Math.round(minutes * (LANE_WEIGHTS[lane] || 1)));
            SOUNDS.kill();
        } catch (err) {
            banner(T.saveFailed + err.message, '', 'is-error');
        }
    }

    function onPanelClick(e) {
        const preset = e.target.closest('.game-preset');
        if (preset) {
            const p = T.presets[Number(preset.dataset.preset)];
            logTime(p.lane, p.minutes, p.label.split(' · ')[0]);
            return;
        }
        const undo = e.target.closest('.game-undo');
        if (undo) {
            api('DELETE', `/api/game/log/${undo.dataset.logId}?tz_offset=${tz()}`)
                .then(applyState)
                .catch(err => banner(T.saveFailed + err.message, '', 'is-error'));
        }
    }

    function onPanelChange(e) {
        if (!e.target.closest('.game-family')) return;
        api('POST', '/api/game/family-day', { on: e.target.checked, tz_offset: tz() })
            .then(applyState)
            .catch(err => banner(T.saveFailed + err.message, '', 'is-error'));
    }

    function onPanelSubmit(e) {
        e.preventDefault();
        const form = e.target.closest('.game-custom');
        if (!form) return;
        const minutes = Math.max(1, Math.min(300, parseInt(form.minutes.value, 10) || 0));
        logTime(form.lane.value, minutes);
    }

    function applyState(next) {
        if (!next) return;
        const before = shownLevel;
        state = next;
        shownLevel = next.level;
        renderHud();
        if (before !== null && next.level > before) {
            banner('Level up', T.levelUp(next.level), 'is-level');
            flash('is-gold');
            SOUNDS.levelUp();
            announce('Level up');
            hud.classList.add('is-leveling');
            setTimeout(() => hud.classList.remove('is-leveling'), 2200);
        }
    }

    async function loadState() {
        try { applyState(await api('GET', `/api/game/state?tz_offset=${tz()}`)); } catch (_) { /* offline: try later */ }
    }

    // ---------------------------------------------------------------------
    // Active-time tracking
    // ---------------------------------------------------------------------
    const pageLane = PAGE_LANES[root.location.pathname] || null;
    let lastActivity = Date.now();
    let pendingSeconds = 0;
    let laneOverride = null;
    let laneOverrideUntil = 0;

    function currentLane() {
        return laneOverride && Date.now() < laneOverrideUntil ? laneOverride : pageLane;
    }

    async function flush(keepalive = false) {
        const seconds = Math.round(pendingSeconds);
        if (!seconds || !currentLane()) return;
        const lane = currentLane();
        pendingSeconds = 0;
        if (state) {  // show it right away; the server stays the source of truth
            const effective = (seconds / 60) * (LANE_WEIGHTS[lane] || 1);
            state.today.minutes += effective;
            state.today.by_lane[lane] = (state.today.by_lane[lane] || 0) + seconds / 60;
            state.week.minutes += effective;
            state.week.by_lane[lane] = (state.week.by_lane[lane] || 0) + seconds / 60;
            renderHud();
        }
        // The server takes at most 120 s per beat; long locked-phone stretches go in chunks
        for (let left = seconds; left > 0; left -= 120) {
            try { await api('POST', '/api/game/heartbeat', { lane, seconds: Math.min(120, left), tz_offset: tz() }, keepalive); } catch (_) { break; }
        }
    }

    // Audio pages count the seconds actually played, even with the phone locked
    // (the position jump is added when the page wakes up again).
    function trackPlayback() {
        const lastPos = new WeakMap();
        const take = (audio) => {
            const before = lastPos.get(audio);
            const now = audio.currentTime || 0;
            if (before !== undefined && now > before && now - before < 1800) pendingSeconds += now - before;
            lastPos.set(audio, now);
        };
        document.addEventListener('play', (e) => { if (e.target instanceof HTMLMediaElement) lastPos.set(e.target, e.target.currentTime || 0); }, true);
        document.addEventListener('seeked', (e) => { if (e.target instanceof HTMLMediaElement) lastPos.set(e.target, e.target.currentTime || 0); }, true);
        ['timeupdate', 'pause', 'ended'].forEach(ev => document.addEventListener(ev, (e) => {
            if (e.target instanceof HTMLMediaElement) take(e.target);
            if (pendingSeconds >= FLUSH_SECONDS) flush();
        }, true));
        document.addEventListener('visibilitychange', () => {
            document.querySelectorAll('audio').forEach(a => { if (!a.paused) take(a); });
            if (document.hidden) flush(true); else { flush(); loadState(); }
        });
        root.addEventListener('pagehide', () => flush(true));
    }

    function startTracking() {
        if (!pageLane) return;
        if (pageLane === 'car') { trackPlayback(); return; }
        const mark = () => { lastActivity = Date.now(); };
        ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input', 'mousemove'].forEach(ev =>
            document.addEventListener(ev, mark, { passive: true, capture: true }));
        setInterval(() => {
            if (!document.hidden && Date.now() - lastActivity < IDLE_MS) pendingSeconds += TICK_MS / 1000;
            if (pendingSeconds >= FLUSH_SECONDS) flush();
        }, TICK_MS);
        document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); else loadState(); });
        root.addEventListener('pagehide', () => flush(true));
        setInterval(loadState, 5 * 60 * 1000);
    }

    // ---------------------------------------------------------------------
    // Kill feed (called by the review page)
    // ---------------------------------------------------------------------
    const session = { kills: 0, deaths: 0, bestCombo: 0, xp: 0 };
    let pendingKill = false;  // the callout already fired when the answer checked correct

    // The checked answer lights up the moment it is right
    function glowAnswer() {
        setTimeout(() => {
            const boxes = document.querySelectorAll('.attempt-result');
            const box = boxes[boxes.length - 1];
            if (!box) return;
            box.classList.remove('game-hit');
            void box.offsetWidth;  // restart the animation
            box.classList.add('game-hit');
        }, 0);
    }

    function showKill(combo, firstBlood, sub = '') {
        if (firstBlood) {
            banner('First blood', sub, 'is-first');
            flash('is-red');
            SOUNDS.big();
            announce('First blood');
        } else if (CALLOUTS[combo]) {
            banner(CALLOUTS[combo], sub, combo >= 5 ? 'is-big' : '');
            flash(combo >= 5 ? 'is-gold' : '');
            SOUNDS.big();
            announce(CALLOUTS[combo]);
        } else {
            banner(combo > 1 ? `Combo x${combo}` : 'Kill', sub, 'is-small');
            SOUNDS.kill(combo);
        }
        glowAnswer();
    }

    // A typed or spoken answer was right: react now, the XP follows when it is rated
    function onCorrect() {
        if (!state || pendingKill) return;
        pendingKill = true;
        showKill((state.today.combo || 0) + 1, !state.today.first_blood);
    }

    function onReview(feed) {
        if (!feed) return;
        session.xp += feed.xp || 0;
        if (feed.kill) {
            session.kills += 1;
            session.bestCombo = Math.max(session.bestCombo, feed.combo || 0);
            if (!pendingKill) showKill(feed.combo, feed.first_blood, `+${feed.xp} XP`);
        } else {
            if (feed.death) session.deaths += 1;
            if (!pendingKill) SOUNDS.miss();
        }
        pendingKill = false;
        floatXp(feed.xp);
        applyState(feed.state);
    }

    async function onWaveCleared(container) {
        let xp = 0;
        try {
            const res = await api('POST', '/api/game/wave-cleared', { tz_offset: tz() });
            xp = res.xp || 0;
            session.xp += xp;
            applyState(res.state);
        } catch (_) { /* the summary still shows */ }
        if (xp) {
            banner('Wave cleared', `+${xp} XP`, 'is-big');
            flash('is-gold');
            SOUNDS.wave();
            announce('Wave cleared');
        }
        if (container && session.kills + session.deaths > 0) {
            let box = container.querySelector('.game-summary');
            if (!box) {
                box = document.createElement('div');
                box.className = 'game-summary';
                const button = container.querySelector('.btn');
                container.insertBefore(box, button || null);
            }
            box.innerHTML = `<strong>${T.summaryTitle}</strong><span>${escapeHtml(T.summary(session))}</span>`;
        }
    }

    function setLane(lane, seconds = 120) {
        if (!LANES.includes(lane)) return;
        flush();
        laneOverride = lane;
        laneOverrideUntil = Date.now() + seconds * 1000;
    }

    function init() {
        if (!token()) return;
        buildHud();
        loadState();
        startTracking();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    root.FrenchGame = { onCorrect, onReview, onWaveCleared, setLane, refresh: loadState };
})(window);
