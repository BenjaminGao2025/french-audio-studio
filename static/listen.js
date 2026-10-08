/* ==========================================================================
   French Audio Studio - Listen while driving (/listen)
   Episodes are MP3 + LRC/SRT built on the server from the learner's own
   material. The learner picks a level (recommended from study hours), a
   length and an optional request; any episode can be remade with feedback,
   and the new one replaces it once ready.
   ========================================================================== */

(function () {
    'use strict';

    const I18N = window.FrenchI18n;
    const TOKEN_KEY = 'frenchStudio.userToken';
    const MODEL_KEY = 'frenchStudio.perplexityModel';
    const CHOICE_KEY = 'frenchStudio.listenChoice';
    const LEVELS = ['A1', 'A2', 'B1', 'B2'];
    const POLL_MS = 5000;

    const TEXT = {
        en: {
            pageTitle: 'Listen - 1000H French',
            heading: 'Listen while driving',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navWrite: 'Write', navSpeak: 'Speak', navReview: 'Review', navListen: 'Listen',
            loginTitle: 'Please log in first',
            loginDesc: 'Episodes are made from what you studied, so you need to log in.',
            loginBtn: 'Log in',
            introTitle: 'A French episode made from what you studied',
            introDesc: 'First the sentences you studied, then long sentences built step by step, then new dialogues and stories that use your words, and finally French only once more. France and Canada voices take turns.',
            levelLegend: 'Level',
            levelHint: (level, hours) => `· ${level} fits your ${hours} h of study`,
            levelDesc: {
                A1: 'The English meaning first, then the French slowly twice and once at normal speed. Short present-tense sentences.',
                A2: 'A little faster, English after every line, a few more tenses.',
                B1: 'Normal speed, longer sentences, TCF-style announcements and voicemails.',
                B2: 'French only (English in the subtitles), natural speed, TCF-style interviews.',
            },
            lengthLegend: 'Length',
            min20: '20 min', min30: '30 min', min45: '45 min', min60: '60 min',
            requestLabel: 'What do you want today? (optional)',
            requestPlaceholder: 'e.g. more numbers and dates; dialogues at the test centre; less English',
            makeEpisode: 'Make a new episode',
            makeHint: 'Takes a few minutes; longer episodes take longer. Every episode is different.',
            repeat: 'Repeat episodes',
            tipsTitle: 'How to use it',
            tipPhone: 'Play it here on your phone, or download the MP3 and the subtitles (LRC / SRT) and import them into an app such as 每日法语听力.',
            tipRepeat: 'When there is a pause, repeat out loud. The car is a good place to speak.',
            tipAdjust: 'Not quite right? Tap "Adjust" on the episode, say what to change, and the new episode replaces it.',
            tipSafety: 'Set it up before you drive. Do not use your phone while driving.',
            generating: 'Making this episode… it takes a few minutes.',
            remaking: 'Remaking: this episode is replaced when the new one is ready.',
            failed: 'This episode could not be made.',
            untitled: 'New episode',
            download: 'Download',
            mp3: 'MP3', lrc: 'Subtitles (LRC)', srt: 'Subtitles (SRT)',
            adjust: 'Adjust',
            adjustTitle: 'What should change?',
            adjustHint: 'The new episode replaces this one when it is ready.',
            adjustPlaceholder: 'e.g. too fast for me; more about numbers; fewer stories',
            easier: 'Easier', harder: 'Harder',
            phrases: { slower: 'Slower, please', lessEnglish: 'Less English', moreEnglish: 'More English', moreDialogue: 'More dialogues' },
            remake: 'Remake', cancel: 'Cancel',
            levelChange: (from, to) => (from === to ? `Level ${to}` : `Level ${from} → ${to}`),
            deleteEpisode: 'Delete this episode',
            confirmDelete: 'Tap again to delete',
            empty: 'No episodes yet. Make the first one.',
            requestFailed: (status) => `Request failed (HTTP ${status})`,
            minutes: (seconds) => `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`,
            targetMinutes: (m) => `${m} min`,
        },
        zh: {
            pageTitle: '开车听 - 1000H French',
            heading: '开车听',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navWrite: '写作', navSpeak: '口语', navReview: '今日复习', navListen: '开车听',
            loginTitle: '请先登录',
            loginDesc: '节目是用你学过的内容生成的，需要先登录。',
            loginBtn: '去登录',
            introTitle: '用你学过的内容，做一集法语节目',
            introDesc: '先复习你拆解过的句子，再一层层搭长句，然后是用你学过的词新编的对话和故事，最后纯法语再听一遍。法国和加拿大口音交替。',
            levelLegend: '难度',
            levelHint: (level, hours) => `· 按你学过的 ${hours} 小时，推荐 ${level}`,
            levelDesc: {
                A1: '先听英文意思，再听两遍慢速法语、一遍正常语速。句子短，以现在时为主。',
                A2: '慢速稍快一点，每句后面有英文，时态多一些。',
                B1: '正常语速，句子更长，加入 TCF 风格的广播通知和语音留言。',
                B2: '只说法语（英文只在字幕里），自然语速，加入 TCF 风格的采访。',
            },
            lengthLegend: '时长',
            min20: '20 分钟', min30: '30 分钟', min45: '45 分钟', min60: '60 分钟',
            requestLabel: '今天想听什么（可选）',
            requestPlaceholder: '比如：多练数字和日期；多一些在考试中心的对话；少一点英文',
            makeEpisode: '生成新的一集',
            makeHint: '需要几分钟，越长越久。每集内容都不一样。',
            repeat: '循环播放',
            tipsTitle: '怎么用',
            tipPhone: '在手机上直接播放，或下载 MP3 和字幕（LRC / SRT）导入「每日法语听力」等 App。',
            tipRepeat: '停顿的地方大声跟读，开车时正好可以开口练。',
            tipAdjust: '听完觉得不合适，点那一集的「调整」，说说哪里要改，新的一集会替换它。',
            tipSafety: '出发前准备好，开车时不要操作手机。',
            generating: '正在生成这一集……需要几分钟。',
            remaking: '正在重新生成：新的一集做好后会替换这一集。',
            failed: '这一集没能生成。',
            untitled: '新的一集',
            download: '下载',
            mp3: 'MP3', lrc: '字幕（LRC）', srt: '字幕（SRT）',
            adjust: '调整',
            adjustTitle: '哪里要改？',
            adjustHint: '新的一集做好后，会替换这一集。',
            adjustPlaceholder: '比如：太快了；多练数字；故事少一点',
            easier: '简单一点', harder: '难一点',
            phrases: { slower: '再慢一点', lessEnglish: '少点英文', moreEnglish: '多点英文', moreDialogue: '多一些对话' },
            remake: '重新生成', cancel: '取消',
            levelChange: (from, to) => (from === to ? `难度 ${to}` : `难度 ${from} → ${to}`),
            deleteEpisode: '删除这一集',
            confirmDelete: '再点一次删除',
            empty: '还没有节目，先生成第一集。',
            requestFailed: (status) => `请求失败（HTTP ${status}）`,
            minutes: (seconds) => `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`,
            targetMinutes: (m) => `${m} 分钟`,
        },
    };
    const T = TEXT[I18N.lang() === 'en' ? 'en' : 'zh'];

    const $ = (id) => document.getElementById(id);
    const els = {
        loginRequired: $('login-required'),
        intro: $('listen-intro'),
        form: $('episode-form'),
        makeBtn: $('make-episode-btn'),
        request: $('episode-request'),
        levelHint: $('level-hint'),
        levelDesc: $('level-desc'),
        list: $('episode-list'),
        error: $('listen-error'),
    };
    let pollTimer = null;
    let episodesById = new Map();
    let pendingReplace = new Set();  // ids being remade
    let choiceLoaded = false;

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }

    function getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
    }

    function showError(message) {
        els.error.textContent = message || '';
        els.error.hidden = !message;
    }

    async function api(method, path, body) {
        const res = await fetch(path, {
            method,
            headers: { Authorization: `Bearer ${getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        let data = {};
        try { data = await res.json(); } catch (_) { data = {}; }
        if (res.status === 401) {
            try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
            showLogin();
            throw new Error(data.detail?.message || T.requestFailed(401));
        }
        if (!res.ok) throw new Error(data.detail?.message || T.requestFailed(res.status));
        return data;
    }

    function showLogin() {
        els.loginRequired.hidden = false;
        els.intro.hidden = true;
        els.list.innerHTML = '';
    }

    // ---------------------------------------------------------------------
    // The settings form: level (recommended from study hours), length, request
    // ---------------------------------------------------------------------
    function savedChoice() {
        try { return JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}'); } catch (_) { return {}; }
    }

    function formChoice() {
        const level = (els.form.querySelector('input[name="level"]:checked') || {}).value;
        const minutes = Number((els.form.querySelector('input[name="minutes"]:checked') || {}).value || 20);
        return { level, minutes };
    }

    function setRadio(name, value) {
        const input = els.form.querySelector(`input[name="${name}"][value="${value}"]`);
        if (input) input.checked = true;
    }

    function renderLevelDesc() {
        const { level } = formChoice();
        els.levelDesc.textContent = level ? T.levelDesc[level] : '';
    }

    function applyRecommendation(data) {
        if (data.recommended_level) {
            els.levelHint.textContent = T.levelHint(data.recommended_level, Math.round((data.hours || 0) * 10) / 10);
            els.form.querySelectorAll('input[name="level"]').forEach(input => {
                input.closest('label').classList.toggle('is-recommended', input.value === data.recommended_level);
            });
        }
        if (!choiceLoaded) {
            choiceLoaded = true;
            const saved = savedChoice();
            setRadio('level', LEVELS.includes(saved.level) ? saved.level : (data.recommended_level || 'A1'));
            if (saved.minutes) setRadio('minutes', saved.minutes);
            renderLevelDesc();
        }
    }

    els.form.addEventListener('change', () => {
        renderLevelDesc();
        try { localStorage.setItem(CHOICE_KEY, JSON.stringify(formChoice())); } catch (_) {}
    });

    function modelQuery() {
        let model = '';
        try { model = localStorage.getItem(MODEL_KEY) || ''; } catch (_) {}
        return model ? `?model=${encodeURIComponent(model)}` : '';
    }

    els.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        els.makeBtn.disabled = true;
        try {
            const { level, minutes } = formChoice();
            await api('POST', `/api/episodes${modelQuery()}`, { level, minutes, request: els.request.value.trim() });
            els.request.value = '';
            await load();
        } catch (err) {
            showError(err.message);
        } finally {
            els.makeBtn.disabled = false;
        }
    });

    // ---------------------------------------------------------------------
    // Episodes
    // ---------------------------------------------------------------------
    function formatDate(iso) {
        return new Date(iso).toLocaleString(I18N.lang() === 'en' ? 'en-CA' : 'zh-CN', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    }

    // Level, plus the wanted length while it is being made (a ready episode shows its real length)
    function settingsLine(settings, withLength) {
        const parts = [];
        if (settings.level) parts.push(settings.level);
        if (withLength && settings.minutes) parts.push(T.targetMinutes(settings.minutes));
        return parts.join(' · ');
    }

    function episodeHtml(ep) {
        const settings = ep.settings || {};
        const title = escapeHtml(ep.title || T.untitled);
        const meta = [formatDate(ep.created_at), ep.status === 'ready' ? T.minutes(ep.duration) : '', settingsLine(settings, ep.status !== 'ready')]
            .filter(Boolean).join(' · ');
        const request = settings.request ? `<p class="episode-request">“${escapeHtml(settings.request)}”</p>` : '';
        let body = '';
        if (ep.status === 'generating') {
            body = `<p class="episode-status is-working"><span class="spinner" aria-hidden="true"></span>${T.generating}</p>`;
        } else if (ep.status === 'failed') {
            body = `<p class="episode-status is-failed">${T.failed} ${escapeHtml(ep.error || '')}</p>`;
        } else {
            const base = `/episodes/${ep.id}`;
            body = `
                <audio class="episode-audio" controls preload="none" src="${base}.mp3" data-title="${title}"></audio>
                ${pendingReplace.has(ep.id) ? `<p class="episode-status is-working"><span class="spinner" aria-hidden="true"></span>${T.remaking}</p>` : ''}
                <div class="episode-footer">
                    <div class="episode-downloads">
                        <span>${T.download}:</span>
                        <a href="${base}.mp3?download=true" download>${T.mp3}</a>
                        <a href="${base}.lrc?download=true" download>${T.lrc}</a>
                        <a href="${base}.srt?download=true" download>${T.srt}</a>
                    </div>
                    <button class="btn btn-secondary episode-adjust-btn" type="button">
                        <i data-lucide="sliders-horizontal" aria-hidden="true"></i><span>${T.adjust}</span>
                    </button>
                </div>`;
        }
        return `
            <article class="episode-card" data-id="${ep.id}">
                <div class="episode-head">
                    <div>
                        <h3>${title}</h3>
                        <p class="episode-meta">${escapeHtml(meta)}</p>
                        ${request}
                    </div>
                    ${ep.status === 'generating' ? '' : `
                        <button class="icon-btn episode-delete" type="button" title="${T.deleteEpisode}" aria-label="${T.deleteEpisode}">
                            <i data-lucide="trash-2"></i>
                        </button>`}
                </div>
                ${body}
            </article>`;
    }

    // Remake form under an episode: feedback, quick phrases, easier/harder
    function adjustFormHtml(ep) {
        const level = (ep.settings && ep.settings.level) || 'A1';
        const phrases = Object.entries(T.phrases)
            .map(([key, label]) => `<button class="btn btn-secondary adjust-phrase" type="button" data-phrase="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
            .join('');
        return `
            <form class="episode-adjust" data-level="${level}" data-from="${level}">
                <p class="adjust-title"><strong>${T.adjustTitle}</strong> <span>${T.adjustHint}</span></p>
                <div class="adjust-row">
                    <button class="btn btn-secondary adjust-level" type="button" data-delta="-1">${T.easier}</button>
                    <button class="btn btn-secondary adjust-level" type="button" data-delta="1">${T.harder}</button>
                    <span class="adjust-level-label">${T.levelChange(level, level)}</span>
                </div>
                <div class="adjust-row">${phrases}</div>
                <textarea rows="2" maxlength="500" placeholder="${escapeHtml(T.adjustPlaceholder)}"></textarea>
                <div class="adjust-row">
                    <button class="btn btn-primary" type="submit"><i data-lucide="refresh-cw" aria-hidden="true"></i><span>${T.remake}</span></button>
                    <button class="btn btn-secondary adjust-cancel" type="button">${T.cancel}</button>
                </div>
            </form>`;
    }

    function render(list) {
        episodesById = new Map(list.map(ep => [ep.id, ep]));
        pendingReplace = new Set([...pendingReplace].filter(id => {
            const ep = episodesById.get(id);
            return ep && list.some(other => other.status === 'generating');
        }));
        // Keep an episode that is playing (or being adjusted) untouched while the list refreshes
        const keep = new Set(Array.from(document.querySelectorAll('.episode-card')).filter(card =>
            Array.from(card.querySelectorAll('audio')).some(a => !a.paused) || card.querySelector('.episode-adjust')
        ).map(card => card.dataset.id));
        if (keep.size) {
            els.list.querySelectorAll('.episode-card').forEach(card => {
                if (!episodesById.has(card.dataset.id)) card.remove();
            });
            list.forEach((ep, index) => {
                if (keep.has(ep.id)) return;
                const existing = els.list.querySelector(`.episode-card[data-id="${ep.id}"]`);
                const html = episodeHtml(ep);
                if (existing) existing.outerHTML = html;
                else if (index === 0) els.list.insertAdjacentHTML('afterbegin', html);
                else els.list.querySelector(`.episode-card[data-id="${list[index - 1].id}"]`)?.insertAdjacentHTML('afterend', html);
            });
        } else {
            els.list.innerHTML = list.length ? list.map(episodeHtml).join('') : `<p class="episode-empty">${T.empty}</p>`;
        }
        refreshIcons();
        if (window.FrenchPlayback) window.FrenchPlayback.sync();
        clearTimeout(pollTimer);
        if (list.some(ep => ep.status === 'generating')) pollTimer = setTimeout(load, POLL_MS);
    }

    async function load() {
        try {
            const data = await api('GET', '/api/episodes');
            showError('');
            applyRecommendation(data);
            render(data.episodes || []);
        } catch (err) {
            showError(err.message);
        }
    }

    els.list.addEventListener('click', async (e) => {
        const card = e.target.closest('.episode-card');
        if (!card) return;
        const ep = episodesById.get(card.dataset.id);

        const del = e.target.closest('.episode-delete');
        if (del) {
            if (!del.classList.contains('confirming')) {
                del.classList.add('confirming');
                del.title = T.confirmDelete;
                setTimeout(() => { del.classList.remove('confirming'); del.title = T.deleteEpisode; }, 3000);
                return;
            }
            try {
                await api('DELETE', `/api/episodes/${card.dataset.id}`);
                card.remove();
                await load();
            } catch (err) {
                showError(err.message);
            }
            return;
        }

        if (e.target.closest('.episode-adjust-btn') && ep) {
            const open = card.querySelector('.episode-adjust');
            if (open) { open.remove(); return; }
            card.insertAdjacentHTML('beforeend', adjustFormHtml(ep));
            refreshIcons();
            card.querySelector('.episode-adjust textarea').focus();
            return;
        }

        const form = e.target.closest('.episode-adjust');
        if (!form) return;
        if (e.target.closest('.adjust-cancel')) { form.remove(); return; }
        const phrase = e.target.closest('.adjust-phrase');
        if (phrase) {
            const box = form.querySelector('textarea');
            const text = phrase.dataset.phrase;
            if (!box.value.includes(text)) box.value = box.value.trim() ? `${box.value.trim()}; ${text}` : text;
            phrase.classList.add('is-on');
            return;
        }
        const levelBtn = e.target.closest('.adjust-level');
        if (levelBtn) {
            const index = LEVELS.indexOf(form.dataset.level) + Number(levelBtn.dataset.delta);
            form.dataset.level = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
            form.querySelector('.adjust-level-label').textContent = T.levelChange(form.dataset.from, form.dataset.level);
        }
    });

    els.list.addEventListener('submit', async (e) => {
        const form = e.target.closest('.episode-adjust');
        if (!form) return;
        e.preventDefault();
        const card = form.closest('.episode-card');
        const ep = episodesById.get(card.dataset.id);
        if (!ep) return;
        const feedback = form.querySelector('textarea').value.trim();
        const before = (ep.settings && ep.settings.request) || '';
        const request = [before, feedback].filter(Boolean).join('; ').slice(0, 500);
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            await api('POST', `/api/episodes${modelQuery()}`, {
                level: form.dataset.level,
                minutes: (ep.settings && ep.settings.minutes) || formChoice().minutes,
                request,
                replace_id: ep.id,
            });
            pendingReplace.add(ep.id);
            form.remove();
            await load();
        } catch (err) {
            showError(err.message);
            submit.disabled = false;
        }
    });

    // One episode at a time, with a lock-screen title
    els.list.addEventListener('play', (e) => {
        const audio = e.target;
        if (!(audio instanceof HTMLAudioElement)) return;
        document.querySelectorAll('.episode-audio').forEach(other => { if (other !== audio) other.pause(); });
        if ('mediaSession' in navigator && window.MediaMetadata) {
            navigator.mediaSession.metadata = new MediaMetadata({ title: audio.dataset.title || '', artist: '1000H French' });
        }
    }, true);

    I18N.apply(TEXT);
    I18N.mountToggle($('lang-toggle'));
    refreshIcons();
    window.addEventListener('load', refreshIcons);
    if (!getToken()) {
        showLogin();
    } else {
        els.intro.hidden = false;
        load();
    }
})();
