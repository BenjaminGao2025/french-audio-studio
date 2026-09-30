/* ==========================================================================
   French Audio Studio - Listen while driving (/listen)
   Episodes are MP3 + LRC/SRT built on the server from the learner's own
   material; this page makes new ones, plays them and offers downloads.
   ========================================================================== */

(function () {
    'use strict';

    const I18N = window.FrenchI18n;
    const TOKEN_KEY = 'frenchStudio.userToken';
    const MODEL_KEY = 'frenchStudio.perplexityModel';
    const POLL_MS = 5000;

    const TEXT = {
        en: {
            pageTitle: 'Listen - 1000H French',
            heading: 'Listen while driving',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navReview: 'Review', navListen: 'Listen',
            loginTitle: 'Please log in first',
            loginDesc: 'Episodes are made from what you studied, so you need to log in.',
            loginBtn: 'Log in',
            introTitle: 'Your own French episodes for the road',
            introDesc: 'Each episode is about 15–20 minutes: first the sentences you studied (French → English → slow French → a pause to repeat), then long sentences built step by step, then short new dialogues and stories that use your words (first with English, then French only), and finally French only once more. France and Canada voices take turns.',
            tipPhone: 'Play it here on your phone, or download the MP3 and the subtitles (LRC / SRT) and import them into an app such as 每日法语听力.',
            tipRepeat: 'When there is a pause, repeat out loud. The car is a good place to speak.',
            tipSafety: 'Set it up before you drive. Do not use your phone while driving.',
            makeEpisode: 'Make a new episode',
            makeHint: 'Takes about 1–2 minutes. Every episode is different.',
            generating: 'Making this episode… (about 1–2 minutes)',
            failed: 'This episode could not be made.',
            untitled: 'New episode',
            download: 'Download',
            mp3: 'MP3', lrc: 'Subtitles (LRC)', srt: 'Subtitles (SRT)',
            deleteEpisode: 'Delete this episode',
            confirmDelete: 'Tap again to delete',
            empty: 'No episodes yet. Make the first one.',
            requestFailed: (status) => `Request failed (HTTP ${status})`,
            minutes: (seconds) => `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`,
        },
        zh: {
            pageTitle: '开车听 - 1000H French',
            heading: '开车听',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navReview: '今日复习', navListen: '开车听',
            loginTitle: '请先登录',
            loginDesc: '节目是用你学过的内容生成的，需要先登录。',
            loginBtn: '去登录',
            introTitle: '用你学过的内容，做成开车时听的节目',
            introDesc: '每集约 15–20 分钟：先复习你拆解过的句子（法语 → 英文 → 慢速法语 → 停顿跟读），再一层层搭长句，然后是用你学过的词新编的小对话和小故事（先带英文、再纯法语），最后纯法语再听一遍。法国和加拿大口音交替。',
            tipPhone: '在手机上直接播放，或下载 MP3 和字幕（LRC / SRT）导入「每日法语听力」等 App。',
            tipRepeat: '停顿的地方大声跟读，开车时正好可以开口练。',
            tipSafety: '出发前准备好，开车时不要操作手机。',
            makeEpisode: '生成新的一集',
            makeHint: '大约需要 1–2 分钟。每集内容都不一样。',
            generating: '正在生成这一集……（约 1–2 分钟）',
            failed: '这一集没能生成。',
            untitled: '新的一集',
            download: '下载',
            mp3: 'MP3', lrc: '字幕（LRC）', srt: '字幕（SRT）',
            deleteEpisode: '删除这一集',
            confirmDelete: '再点一次删除',
            empty: '还没有节目，先生成第一集。',
            requestFailed: (status) => `请求失败（HTTP ${status}）`,
            minutes: (seconds) => `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`,
        },
    };
    const T = TEXT[I18N.lang() === 'en' ? 'en' : 'zh'];

    const $ = (id) => document.getElementById(id);
    const els = {
        loginRequired: $('login-required'),
        intro: $('listen-intro'),
        makeBtn: $('make-episode-btn'),
        list: $('episode-list'),
        error: $('listen-error'),
    };
    let pollTimer = null;

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

    async function api(method, path) {
        const res = await fetch(path, { method, headers: { Authorization: `Bearer ${getToken()}` } });
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

    function formatDate(iso) {
        const date = new Date(iso);
        return date.toLocaleString(I18N.lang() === 'en' ? 'en-CA' : 'zh-CN', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    }

    function episodeHtml(ep) {
        const title = escapeHtml(ep.title || T.untitled);
        const meta = [formatDate(ep.created_at), ep.status === 'ready' ? T.minutes(ep.duration) : ''].filter(Boolean).join(' · ');
        let body = '';
        if (ep.status === 'generating') {
            body = `<p class="episode-status is-working"><span class="spinner" aria-hidden="true"></span>${T.generating}</p>`;
        } else if (ep.status === 'failed') {
            body = `<p class="episode-status is-failed">${T.failed} ${escapeHtml(ep.error || '')}</p>`;
        } else {
            const base = `/episodes/${ep.id}`;
            body = `
                <audio class="episode-audio" controls preload="none" src="${base}.mp3" data-title="${title}"></audio>
                <div class="episode-downloads">
                    <span>${T.download}:</span>
                    <a href="${base}.mp3?download=true" download>${T.mp3}</a>
                    <a href="${base}.lrc?download=true" download>${T.lrc}</a>
                    <a href="${base}.srt?download=true" download>${T.srt}</a>
                </div>`;
        }
        return `
            <article class="episode-card" data-id="${ep.id}">
                <div class="episode-head">
                    <div>
                        <h3>${title}</h3>
                        <p class="episode-meta">${escapeHtml(meta)}</p>
                    </div>
                    ${ep.status === 'generating' ? '' : `
                        <button class="icon-btn episode-delete" type="button" title="${T.deleteEpisode}" aria-label="${T.deleteEpisode}">
                            <i data-lucide="trash-2"></i>
                        </button>`}
                </div>
                ${body}
            </article>`;
    }

    function render(list) {
        // Keep an episode that is playing untouched while the list refreshes
        const playing = Array.from(document.querySelectorAll('.episode-audio')).find(a => !a.paused);
        if (playing) {
            const card = playing.closest('.episode-card');
            list.forEach(ep => {
                if (ep.id !== card.dataset.id) {
                    const existing = els.list.querySelector(`.episode-card[data-id="${ep.id}"]`);
                    const html = episodeHtml(ep);
                    if (existing) existing.outerHTML = html;
                    else els.list.insertAdjacentHTML('afterbegin', html);
                }
            });
        } else {
            els.list.innerHTML = list.length ? list.map(episodeHtml).join('') : `<p class="episode-empty">${T.empty}</p>`;
        }
        refreshIcons();
        const busy = list.some(ep => ep.status === 'generating');
        els.makeBtn.disabled = busy;
        clearTimeout(pollTimer);
        if (busy) pollTimer = setTimeout(load, POLL_MS);
    }

    async function load() {
        try {
            const data = await api('GET', '/api/episodes');
            showError('');
            render(data.episodes || []);
        } catch (err) {
            showError(err.message);
        }
    }

    els.makeBtn.addEventListener('click', async () => {
        els.makeBtn.disabled = true;
        try {
            let model = '';
            try { model = localStorage.getItem(MODEL_KEY) || ''; } catch (_) {}
            await api('POST', `/api/episodes${model ? `?model=${encodeURIComponent(model)}` : ''}`);
            await load();
        } catch (err) {
            showError(err.message);
            els.makeBtn.disabled = false;
        }
    });

    els.list.addEventListener('click', async (e) => {
        const del = e.target.closest('.episode-delete');
        if (!del) return;
        if (!del.classList.contains('confirming')) {
            del.classList.add('confirming');
            del.title = T.confirmDelete;
            setTimeout(() => { del.classList.remove('confirming'); del.title = T.deleteEpisode; }, 3000);
            return;
        }
        try {
            await api('DELETE', `/api/episodes/${del.closest('.episode-card').dataset.id}`);
            await load();
        } catch (err) {
            showError(err.message);
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
