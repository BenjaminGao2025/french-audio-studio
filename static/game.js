/* ==========================================================================
   French Audio Studio - study progress (see game.py)
   A thin HUD under the header (today / this week vs the plan, days studied in
   the last 7 days), a panel to log study done outside the app, and active-time
   tracking on /study and /review.
   ========================================================================== */

(function (root) {
    'use strict';

    const I18N = root.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const TOKEN_KEY = 'frenchStudio.userToken';
    const LANES = ['listening', 'reading', 'speaking', 'writing', 'review', 'car'];
    // Pages whose time counts automatically; anything else can be logged by hand.
    // /listen counts the audio actually played (car/walk listening, worth half).
    const PAGE_LANES = { '/study': 'reading', '/write': 'writing', '/speak': 'speaking', '/review': 'review', '/listen': 'car' };
    const LANE_WEIGHTS = { car: 0.5 };
    const IDLE_MS = 120000;
    const TICK_MS = 5000;
    const FLUSH_SECONDS = 30;

    const TEXT = {
        en: {
            hudAria: 'Your progress', heroTitle: 'Open your progress',
            today: 'Today', week: (n) => (n ? `Week ${n}` : 'Before week 1'), h: 'h',
            daysStudied: (n) => `${n} of the last 7 days studied`,
            family: 'Family day', weekend: 'Weekend',
            logTime: 'Log time',
            questsTitle: 'Daily foundations',
            questsDone: (done, total) => `${done} / ${total} done`,
            questsHint: 'Small daily tasks: listening, writing and speaking. Tick them off as you finish.',
            lanesTitle: 'This week, by part of the plan', maintenance: 'Maintenance weeks: 5 h',
            skillsTitle: (h) => `TCF Skills (${h} h weekly target)`,
            skills: {
                CO: 'CO · Listening',
                CE: 'CE · Reading',
                EE: 'EE · Writing',
                EO: 'EO · Speaking',
                shared: 'Shared · Cards',
            },
            focusSkill: {
                CO: 'Focus: CO (Listening)',
                CE: 'Focus: CE (Reading)',
                EE: 'Focus: EE (Writing)',
                EO: 'Focus: EO (Speaking)',
            },
            lanes: { listening: 'Listening', reading: 'Reading', speaking: 'Speaking', writing: 'Writing', review: 'Review', car: 'Car / walk' },
            halfNote: 'Car and walk listening counts half: your eyes and mind are on the road.',
            quickTitle: 'Log study you did outside the app',
            presets: [
                { lane: 'speaking', minutes: 60, label: 'Teacher class · 1 h' },
                { lane: 'listening', minutes: 30, label: 'Listening · 30 min' },
                { lane: 'reading', minutes: 30, label: 'Reading · 30 min' },
                { lane: 'writing', minutes: 30, label: 'Writing · 30 min' },
                { lane: 'car', minutes: 60, label: 'Car listening · 1 h' },
                { lane: 'car', minutes: 30, label: 'Walk listening · 30 min' },
            ],
            other: 'Other', minutes: 'min', add: 'Add', undo: 'Undo',
            loggedToday: 'Logged today', nothingLogged: 'Nothing logged by hand today.',
            familyLabel: 'Today is a family day', familyHint: 'No target today.',
            totals: (h) => `${h} h studied in total`,
            saveFailed: 'Could not save: ',
        },
        zh: {
            hudAria: '学习进度', heroTitle: '打开进度面板',
            today: '今天', week: (n) => (n ? `第 ${n} 周` : '第 1 周之前'), h: '小时',
            daysStudied: (n) => `近 7 天学习 ${n} 天`,
            family: '家庭日', weekend: '周末',
            logTime: '记录时间',
            questsTitle: '每日基础',
            questsDone: (done, total) => `完成 ${done} / ${total}`,
            questsHint: '每天的小任务：听力、写作、口语。完成后打勾。',
            lanesTitle: '本周各模块（按计划分配）', maintenance: '保温期：每周 5 小时',
            skillsTitle: (h) => `TCF 四项技能（每周 ${h} 小时目标）`,
            skills: {
                CO: 'CO · 听力理解',
                CE: 'CE · 阅读理解',
                EE: 'EE · 书面表达',
                EO: 'EO · 口语表达',
                shared: '公共 · 卡片',
            },
            focusSkill: {
                CO: '补短板: CO 听力',
                CE: '补短板: CE 阅读',
                EE: '补短板: EE 写作',
                EO: '补短板: EO 口语',
            },
            lanes: { listening: '听力', reading: '阅读', speaking: '口语', writing: '写作', review: '复习', car: '开车·快走听' },
            halfNote: '开车和快走时听按一半计时：注意力主要在路上。',
            quickTitle: '记录在 App 之外的学习',
            presets: [
                { lane: 'speaking', minutes: 60, label: '老师课 · 1 小时' },
                { lane: 'listening', minutes: 30, label: '听力 · 30 分钟' },
                { lane: 'reading', minutes: 30, label: '阅读 · 30 分钟' },
                { lane: 'writing', minutes: 30, label: '写作 · 30 分钟' },
                { lane: 'car', minutes: 60, label: '开车听 · 1 小时' },
                { lane: 'car', minutes: 30, label: '快走听 · 30 分钟' },
            ],
            other: '其他', minutes: '分钟', add: '添加', undo: '撤销',
            loggedToday: '今天手动记录的', nothingLogged: '今天还没有手动记录。',
            familyLabel: '今天是家庭日', familyHint: '今天不设目标。',
            totals: (h) => `累计学习 ${h} 小时`,
            saveFailed: '保存失败：',
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];

    const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
    const tz = () => new Date().getTimezoneOffset();
    const hours = (minutes) => (Math.round((minutes / 60) * 10) / 10).toString();

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

    // A quiet error toast: saving failed, the time is still pending and will be retried.
    function notice(text) {
        const el = document.createElement('div');
        el.className = 'game-notice';
        el.setAttribute('role', 'status');
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    // ---------------------------------------------------------------------
    // HUD and panel
    // ---------------------------------------------------------------------
    let hud = null;
    let panel = null;
    let state = null;

    function buildHud() {
        const topbar = document.querySelector('.topbar');
        if (!topbar) return;
        hud = document.createElement('div');
        hud.className = 'game-hud';
        hud.setAttribute('role', 'region');
        hud.setAttribute('aria-label', T.hudAria);
        hud.innerHTML = `
            <button class="hud-hero" type="button" aria-expanded="false" title="${escapeHtml(T.heroTitle)}">
                <span class="hud-progress-label">${EN ? 'Progress' : '学习进度'}</span><span aria-hidden="true">⌄</span>
            </button>
            <span class="hud-stat hud-today"><i data-lucide="sun" aria-hidden="true"></i><span></span></span>
            <span class="hud-stat hud-week"><i data-lucide="calendar-days" aria-hidden="true"></i><span></span></span>
            <span class="hud-stat hud-days"><i data-lucide="calendar-check" aria-hidden="true"></i><span></span></span>
            <a class="hud-focus" href="/write" hidden><i data-lucide="compass" aria-hidden="true"></i><span></span></a>
            <span class="hud-spacer"></span>
            <button class="hud-btn hud-log" type="button"><i data-lucide="plus" aria-hidden="true"></i><span>${escapeHtml(T.logTime)}</span></button>`;
        panel = document.createElement('div');
        panel.className = 'game-panel';
        panel.id = 'learning-progress-panel';
        hud.querySelector('.hud-hero').setAttribute('aria-controls', panel.id);
        panel.hidden = true;
        topbar.after(hud);
        hud.after(panel);

        hud.querySelector('.hud-hero').addEventListener('click', togglePanel);
        hud.querySelector('.hud-log').addEventListener('click', togglePanel);
        panel.addEventListener('click', onPanelClick);
        panel.addEventListener('change', onPanelChange);
        panel.addEventListener('submit', onPanelSubmit);
    }

    function togglePanel() {
        panel.hidden = !panel.hidden;
        hud.querySelector('.hud-hero').setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) renderPanel();
    }

    function renderHud() {
        if (!hud || !state) return;
        const today = state.today;
        const todayText = today.family_day ? `${T.family} · ${hours(today.minutes)} ${T.h}`
            : today.target ? `${T.today} ${hours(today.minutes)} / ${hours(today.target)} ${T.h}`
                : `${T.weekend} · ${hours(today.minutes)} ${T.h}`;
        const todayEl = hud.querySelector('.hud-today');
        todayEl.querySelector('span').textContent = todayText;
        todayEl.dataset.short = today.target ? `${hours(today.minutes)}/${hours(today.target)} ${T.h}` : `${hours(today.minutes)} ${T.h}`;
        todayEl.title = todayText;
        todayEl.classList.toggle('is-done', Boolean(today.target) && today.minutes >= today.target);
        const week = state.week;
        hud.querySelector('.hud-week span').textContent = `${T.week(week.number)} · ${hours(week.minutes)} / ${hours(week.target)} ${T.h}`;
        hud.querySelector('.hud-week').classList.toggle('is-done', week.minutes >= week.target);
        hud.querySelector('.hud-days span').textContent = T.daysStudied(state.days_studied_7d || 0);

        const focusEl = hud.querySelector('.hud-focus');
        if (focusEl) {
            if (week.focus_skill && week.focus_skill.link) {
                focusEl.href = week.focus_skill.link;
                const sc = week.focus_skill.skill;
                focusEl.querySelector('span').textContent = (T.focusSkill && T.focusSkill[sc]) || `Focus: ${sc}`;
                focusEl.title = focusEl.querySelector('span').textContent;
                focusEl.hidden = false;
            } else {
                focusEl.hidden = true;
            }
        }

        refreshIcons();
        if (!panel.hidden) renderPanel();
    }

    const SKILL_GROUPS = [
        { key: 'CO', lanes: ['listening', 'car'], link: '/listen' },
        { key: 'CE', lanes: ['reading'], link: '/study' },
        { key: 'EE', lanes: ['writing'], link: '/write' },
        { key: 'EO', lanes: ['speaking'], link: '/speak' },
        { key: 'shared', lanes: ['review'], link: null },
    ];

    function renderPanel() {
        if (!state) return;
        const week = state.week;
        const skillsHtml = SKILL_GROUPS.map(group => {
            const skillData = (week.skills && week.skills[group.key]) || {};
            const done = skillData.minutes || 0;
            const target = skillData.target || 0;
            const titleText = (T.skills && T.skills[group.key]) || group.key;

            const lanesHtml = group.lanes.map(lane => {
                const laneDone = week.by_lane[lane] || 0;
                const laneTarget = week.maintenance ? 0 : week.lane_targets[lane];
                const pct = laneTarget ? Math.min(100, Math.round((laneDone / laneTarget) * 100)) : 0;
                return `
                    <div class="lane-row ${laneTarget && laneDone >= laneTarget ? 'is-done' : ''}">
                        <span class="lane-name">${escapeHtml(T.lanes[lane])}${LANE_WEIGHTS[lane] ? ' ½' : ''}</span>
                        <span class="lane-bar"><span style="width:${pct}%"></span></span>
                        <span class="lane-num">${hours(laneDone)}${laneTarget ? ` / ${hours(laneTarget)}` : ''} ${T.h}</span>
                    </div>`;
            }).join('');

            return `
                <div class="skill-group">
                    <div class="skill-group-header">
                        <span class="skill-group-title">
                            ${group.link
                                ? `<a class="skill-group-link" href="${escapeHtml(group.link)}"><span>${escapeHtml(titleText)}</span><i data-lucide="arrow-up-right" aria-hidden="true"></i></a>`
                                : `<span>${escapeHtml(titleText)}</span>`}
                        </span>
                        <span class="skill-group-progress ${target && done >= target ? 'is-done' : ''}">
                            ${hours(done)}${target ? ` / ${hours(target)}` : ''} ${T.h}
                        </span>
                    </div>
                    <div class="skill-group-lanes">
                        ${lanesHtml}
                    </div>
                </div>`;
        }).join('');

        const logs = state.today.logs.length
            ? state.today.logs.map(log => `
                <li>${escapeHtml(T.lanes[log.lane])} · ${log.minutes} ${T.minutes}${log.note ? ` · ${escapeHtml(log.note)}` : ''}
                    <button class="link-btn game-undo" type="button" data-log-id="${log.id}">${T.undo}</button></li>`).join('')
            : `<li class="muted">${T.nothingLogged}</li>`;
        const learning = state.learning;
        const quests = learning ? `<div class="learning-quests"><strong>${T.questsTitle}</strong> · ${T.questsDone(learning.quests.filter(q => q.done).length, learning.quests.length)}<p class="game-hint">${T.questsHint}</p>${learning.quests.map(q => `<a href="${escapeHtml(q.href)}">${q.done ? '✓ ' : '○ '}${escapeHtml(EN ? q.en : q.zh)}</a>`).join('')}<a href="/coach">${EN ? 'My plan & weekly review' : '我的安排与每周复盘'}</a></div>` : '';
        panel.innerHTML = `${quests}
            <div class="game-panel-grid">
                <section>
                    <h3>${T.skillsTitle ? T.skillsTitle(hours(week.target)) : T.lanesTitle}${week.maintenance ? ` · ${T.maintenance}` : ''}</h3>
                    ${skillsHtml}
                    <p class="game-totals">${T.totals(state.hours_total)}</p>
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
        const summary = document.createElement('div');
        summary.className = 'game-progress-summary';
        for (const selector of ['.hud-week', '.hud-days', '.hud-focus']) {
            summary.append(hud.querySelector(selector).cloneNode(true));
        }
        panel.prepend(summary);
    }

    async function logTime(lane, minutes, note = '') {
        try {
            applyState(await api('POST', '/api/game/log', { lane, minutes, note, tz_offset: tz() }));
        } catch (err) {
            notice(T.saveFailed + err.message);
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
                .catch(err => notice(T.saveFailed + err.message));
        }
    }

    function onPanelChange(e) {
        if (!e.target.closest('.game-family')) return;
        api('POST', '/api/game/family-day', { on: e.target.checked, tz_offset: tz() })
            .then(applyState)
            .catch(err => notice(T.saveFailed + err.message));
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
        state = next;
        renderHud();
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
    let flushing = false;
    let laneOverride = null;
    let laneOverrideUntil = 0;

    function currentLane() {
        return laneOverride && Date.now() < laneOverrideUntil ? laneOverride : pageLane;
    }

    function showLocalTime(lane, seconds) {
        if (!state) return;  // the server stays the source of truth
        const effective = (seconds / 60) * (LANE_WEIGHTS[lane] || 1);
        state.today.minutes += effective;
        state.today.by_lane[lane] = (state.today.by_lane[lane] || 0) + seconds / 60;
        state.week.minutes += effective;
        state.week.by_lane[lane] = (state.week.by_lane[lane] || 0) + seconds / 60;
        renderHud();
    }

    async function flush(keepalive = false) {
        if (flushing) return;
        const lane = currentLane();
        const seconds = Math.floor(pendingSeconds);
        if (!lane || seconds < 1) return;
        flushing = true;
        try {
            // Only drop what the server accepted: a failed beat leaves its seconds pending.
            // The server takes at most 120 s per beat; long locked-phone stretches go in chunks.
            for (let sent = 0; sent < seconds; sent += 120) {
                const chunk = Math.min(120, seconds - sent);
                try {
                    await api('POST', '/api/game/heartbeat', { lane, seconds: chunk, tz_offset: tz() }, keepalive);
                } catch (_) {
                    break;  // keep them; the next tick retries
                }
                pendingSeconds = Math.max(0, pendingSeconds - chunk);
                showLocalTime(lane, chunk);
            }
        } finally {
            flushing = false;
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
        document.addEventListener('play', (e) => { if (e.target instanceof HTMLMediaElement) { setLane(e.target.dataset.coach === 'listening' ? 'listening' : 'car', 3600); lastPos.set(e.target, e.target.currentTime || 0); } }, true);
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

    document.addEventListener('study:modechange', () => flush());

    function startTracking() {
        if (!pageLane) return;
        if (pageLane === 'car') { trackPlayback(); return; }
        const mark = () => { lastActivity = Date.now(); };
        ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input', 'mousemove'].forEach(ev =>
            document.addEventListener(ev, mark, { passive: true, capture: true }));
        setInterval(() => {
            if (!document.hidden && !document.querySelector('#study-personal:not([hidden])') && Date.now() - lastActivity < IDLE_MS) pendingSeconds += TICK_MS / 1000;
            if (pendingSeconds >= FLUSH_SECONDS) flush();
        }, TICK_MS);
        document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); else loadState(); });
        root.addEventListener('pagehide', () => flush(true));
        setInterval(loadState, 5 * 60 * 1000);
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

    root.FrenchGame = { setLane, refresh: loadState };
})(window);
