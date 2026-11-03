/* ==========================================================================
   1000H French - Grammar map
   Three blocks (noun group / verb / sentence building). Each grammar point shows how many of the
   learner's own analysed sentences used it; a tap lists those sentences.
   ========================================================================== */
(() => {
    'use strict';
    const I18N = window.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const pick = I18N.pick;
    const TOKEN_KEY = 'frenchStudio.userToken';

    const TEXT = {
        en: {
            pageTitle: 'Grammar map - 1000H French',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navWrite: 'Write', navSpeak: 'Speak', navReview: 'Review', navListen: 'Listen', navGrammar: 'Grammar map',
            heading: 'Grammar map',
            intro: 'Every sentence you study lights up the grammar it uses. No rule tables to memorise: meet a rule in enough sentences and it sticks.',
            loginCta: 'Log in to see your grammar map',
            loading: 'Loading your grammar map…',
            loadFailed: 'Could not load the grammar map. Please try again.',
            seenTotal: (seen, total) => `${seen} of ${total} grammar points seen so far`,
            blockSeen: (seen, total) => `${seen} / ${total} seen`,
            seenTimes: (n) => n ? `seen ${n} time${n === 1 ? '' : 's'}` : 'not seen yet',
            focus: 'Core',
            focusTitle: 'Core of A1–A2: present tense and passé composé',
            yourSentences: 'Your sentences', loadingSentences: 'Loading…',
            noSentences: 'No sentence with this point yet. Study a few sentences and it will show up here.',
            sentencesFailed: 'Could not load the sentences.',
        },
        zh: {
            pageTitle: '语法地图 - 1000H French',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navWrite: '写作', navSpeak: '口语', navReview: '今日复习', navListen: '开车听', navGrammar: '语法地图',
            heading: '语法地图',
            intro: '你在「拆解与复述」里学过的每一句，都会在这里点亮它用到的语法。不用背规则表：句子见多了，规则就记住了。',
            loginCta: '登录后查看你的语法地图',
            loading: '正在加载你的语法地图…',
            loadFailed: '语法地图加载失败，请稍后再试。',
            seenTotal: (seen, total) => `已经见过 ${seen} / ${total} 个语法点`,
            blockSeen: (seen, total) => `见过 ${seen} / ${total}`,
            seenTimes: (n) => n ? `见过 ${n} 次` : '还没见过',
            focus: '重点',
            focusTitle: 'A1–A2 的核心：现在时和复合过去时',
            yourSentences: '你学过的句子', loadingSentences: '加载中…',
            noSentences: '还没有用到这个语法点的句子。去拆解几句，它就会出现在这里。',
            sentencesFailed: '句子加载失败。',
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];
    I18N.apply(TEXT);
    I18N.mountToggle(document.getElementById('lang-toggle'));

    const $ = id => document.getElementById(id);
    const status = $('grammar-status');
    const mapEl = $('grammar-map');
    const BLOCK_IDS = ['N', 'V', 'S'];

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function token() {
        try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
    }

    function showLogin() {
        status.textContent = '';
        $('grammar-login').hidden = false;
    }

    async function api(path) {
        const res = await fetch(path, { headers: { Authorization: `Bearer ${token()}` } });
        if (res.status === 401) {
            showLogin();
            throw new Error('login_required');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    function pointHtml(p) {
        const panelId = `grammar-panel-${p.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
        return `
            <li class="grammar-point ${p.focus ? 'is-focus' : ''} ${p.count ? 'is-seen' : ''}" id="${escapeHtml(p.id)}">
                <button class="grammar-point-btn" type="button" data-gid="${escapeHtml(p.id)}" aria-expanded="false" aria-controls="${panelId}">
                    <span class="grammar-point-name">${escapeHtml(pick(p.zh, p.en))}</span>
                    <span class="grammar-point-fr" lang="fr">${escapeHtml(p.fr)}</span>
                    <span class="grammar-point-meta">
                        ${p.focus ? `<span class="grammar-focus-badge" title="${T.focusTitle}">${T.focus}</span>` : ''}
                        <span class="grammar-level">${escapeHtml(p.level)}</span>
                        <span class="grammar-count">${T.seenTimes(Number(p.count) || 0)}</span>
                    </span>
                </button>
                <div class="grammar-point-panel" id="${panelId}" hidden></div>
            </li>
        `;
    }

    function renderMap(data) {
        const blocks = (data.blocks || []).filter(b => BLOCK_IDS.includes(b.id));
        const total = blocks.reduce((n, b) => n + b.points.length, 0);
        status.textContent = T.seenTotal(Number(data.seen) || 0, total);
        mapEl.innerHTML = blocks.map(b => {
            const seen = b.points.filter(p => p.count).length;
            return `
                <section class="grammar-block" data-block="${b.id}" aria-labelledby="grammar-block-${b.id}">
                    <header class="grammar-block-head">
                        <h2 id="grammar-block-${b.id}">${escapeHtml(pick(b.zh, b.en))}</h2>
                        <span class="grammar-block-seen">${T.blockSeen(seen, b.points.length)}</span>
                    </header>
                    <ul class="grammar-points">${b.points.map(pointHtml).join('')}</ul>
                </section>
            `;
        }).join('');
        mapEl.querySelectorAll('.grammar-point-btn').forEach(btn => btn.addEventListener('click', () => togglePoint(btn)));
        openFromHash();
    }

    function sentencesHtml(point, sentences) {
        const list = sentences.length
            ? `<ul class="grammar-sentences">${sentences.map(s => `<li lang="fr">${escapeHtml(s.sentence)}</li>`).join('')}</ul>`
            : `<p class="grammar-empty">${T.noSentences}</p>`;
        return `
            <p class="grammar-explain">${escapeHtml(point.explain_zh)}</p>
            <h3 class="grammar-sentences-title">${T.yourSentences}</h3>
            ${list}
        `;
    }

    async function togglePoint(btn, open = btn.getAttribute('aria-expanded') !== 'true') {
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        btn.setAttribute('aria-expanded', String(open));
        btn.closest('.grammar-point').classList.toggle('is-open', open);
        panel.hidden = !open;
        if (!open || panel.dataset.loaded) return;
        panel.innerHTML = `<p class="grammar-empty">${T.loadingSentences}</p>`;
        try {
            const data = await api(`/api/grammar/${encodeURIComponent(btn.dataset.gid)}/sentences`);
            panel.innerHTML = sentencesHtml(data.point || {}, data.sentences || []);
            panel.dataset.loaded = '1';
        } catch (_) {
            panel.innerHTML = `<p class="grammar-empty">${T.sentencesFailed}</p>`;
        }
    }

    // /grammar#V.present.pouvoir (from a chip on /study) opens that point
    function openFromHash() {
        const gid = decodeURIComponent((location.hash || '').slice(1));
        if (!gid) return;
        const btn = [...mapEl.querySelectorAll('.grammar-point-btn')].find(b => b.dataset.gid === gid);
        if (!btn) return;
        if (btn.getAttribute('aria-expanded') !== 'true') togglePoint(btn, true);
        btn.scrollIntoView({ block: 'center' });
        btn.focus({ preventScroll: true });
    }
    window.addEventListener('hashchange', openFromHash);

    async function load() {
        if (!token()) { showLogin(); return; }
        status.textContent = T.loading;
        try {
            renderMap(await api('/api/grammar/map'));
        } catch (err) {
            if (err.message !== 'login_required') status.textContent = T.loadFailed;
        }
    }

    window.FrenchGrammarMap = { renderMap, sentencesHtml, escapeHtml };
    load();
})();
