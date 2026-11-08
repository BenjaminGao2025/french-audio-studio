/* ==========================================================================
   Dictation practice on /study: 默写 (see the English, write the French) and
   听写 (hear the sentence, write it down), for the whole sentence or step by step.

   While an exercise is open its card holds only the exercise: the sentence head,
   structure bar and tabs are detached from the page (kept in memory, restored on
   exit), so no French of the target is on screen or in the accessibility tree
   until the learner checks or reveals the answer.

   tokenize / grade mirror dictation.py and are used only when the server cannot
   grade (signed out, offline); tests/fixtures/dictation_cases.json keeps both in step.
   ========================================================================== */
(function (root) {
    'use strict';

    // ---------------------------------------------------------------------
    // Grading (same rules as dictation.py)
    // ---------------------------------------------------------------------
    const APOSTROPHES = new Set(['’', '‘', 'ʼ', '`', '´', '′', "'"]);
    const ELISION_PREFIXES = new Set(['l', 'd', 'j', 'm', 't', 's', 'n', 'c', 'ç', 'qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu']);
    const ACCENT_CREDIT = 0.5;
    const KINDS = ['ok', 'accent', 'wrong', 'missing', 'extra'];
    const MAX_STEPS = 8;  // dictation.MAX_STEPS
    const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

    function norm(surface) {
        const text = Array.from(String(surface).normalize('NFC').toLowerCase())
            .map(ch => (APOSTROPHES.has(ch) ? "'" : ch)).join('');
        return text.replace(/œ/g, 'oe').replace(/æ/g, 'ae');
    }
    const stripApostrophes = text => text.replace(/'/g, '');
    const fold = text => text.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
    const isWordChar = ch => APOSTROPHES.has(ch) || WORD_CHAR.test(ch);

    function trimApostrophes(chars) {
        let a = 0;
        let b = chars.length;
        while (a < b && APOSTROPHES.has(chars[a])) a++;
        while (b > a && APOSTROPHES.has(chars[b - 1])) b--;
        return chars.slice(a, b);
    }

    function splitElision(surface) {
        const parts = [];
        // A quote mark typed as an apostrophe before a word ('J'ai faim') is punctuation, never part of the word
        let rest = Array.from(surface);
        while (rest.length && APOSTROPHES.has(rest[0])) rest = rest.slice(1);
        for (;;) {
            const cut = rest.findIndex(ch => APOSTROPHES.has(ch));
            if (cut <= 0 || !ELISION_PREFIXES.has(norm(rest.slice(0, cut).join('')))) break;
            parts.push(rest.slice(0, cut + 1).join(''));
            let next = cut + 1;
            while (next < rest.length && APOSTROPHES.has(rest[next])) next++;
            rest = rest.slice(next);
            if (!rest.length) return parts;
        }
        if (rest.length > 1 && APOSTROPHES.has(rest[rest.length - 1]) && ELISION_PREFIXES.has(norm(rest.slice(0, -1).join('')))) {
            parts.push(rest.join(''));
            return parts;
        }
        rest = trimApostrophes(rest);
        if (rest.length) parts.push(rest.join(''));
        return parts;
    }

    function tokenize(text) {
        const tokens = [];
        let word = [];
        for (const ch of Array.from(String(text == null ? '' : text).normalize('NFC') + ' ')) {
            if (isWordChar(ch)) { word.push(ch); continue; }
            if (word.length) {
                splitElision(word.join('')).forEach(part => tokens.push({ text: part, norm: norm(part) }));
                word = [];
            }
        }
        return tokens;
    }

    function compareWords(actual, expected) {
        if (actual === expected) return 'ok';
        if (fold(stripApostrophes(actual)) === fold(stripApostrophes(expected))) return 'accent';
        return 'wrong';
    }

    function splitMerged(actual, expected) {
        const merged = new Map();
        for (let i = 0; i + 1 < expected.length; i++) {
            if (!expected[i].norm.endsWith("'")) continue;
            const head = fold(stripApostrophes(expected[i].norm));
            const key = head + fold(stripApostrophes(expected[i + 1].norm));
            if (!merged.has(key)) merged.set(key, Array.from(head).length);
        }
        const known = new Set(expected.map(t => t.norm));
        const out = [];
        actual.forEach(token => {
            const n = token.norm;
            const cut = !n.includes("'") && !known.has(n) ? merged.get(fold(n)) : undefined;
            if (!cut) { out.push(token); return; }
            const normChars = Array.from(n);
            const textChars = Array.from(token.text);
            const surface = textChars.length === normChars.length ? textChars : normChars;
            out.push({ text: surface.slice(0, cut).join(''), norm: normChars.slice(0, cut).join('') });
            out.push({ text: surface.slice(cut).join(''), norm: normChars.slice(cut).join('') });
        });
        return out;
    }

    const COST = { ok: 0, accent: ACCENT_CREDIT, wrong: 1 };

    function align(expected, actual) {
        const n = expected.length;
        const m = actual.length;
        const kinds = expected.map(e => actual.map(a => compareWords(a.norm, e.norm)));
        const dist = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                dist[i][j] = Math.min(dist[i - 1][j - 1] + COST[kinds[i - 1][j - 1]], dist[i - 1][j] + 1, dist[i][j - 1] + 1);
            }
        }
        const ops = [];
        let i = n;
        let j = m;
        while (i || j) {
            if (i && j && dist[i][j] === dist[i - 1][j - 1] + COST[kinds[i - 1][j - 1]]) {
                ops.push({ kind: kinds[i - 1][j - 1], expected: expected[i - 1].text, actual: actual[j - 1].text });
                i--; j--;
            } else if (i && dist[i][j] === dist[i - 1][j] + 1) {
                ops.push({ kind: 'missing', expected: expected[i - 1].text, actual: '' });
                i--;
            } else {
                ops.push({ kind: 'extra', expected: '', actual: actual[j - 1].text });
                j--;
            }
        }
        return ops.reverse();
    }

    function grade(expected, answer) {
        const want = tokenize(expected);
        const ops = align(want, splitMerged(tokenize(answer), want));
        const counts = { ok: 0, accent: 0, wrong: 0, missing: 0, extra: 0 };
        ops.forEach(op => { counts[op.kind] += 1; });
        const total = want.length + counts.extra;
        const score = total ? (counts.ok + ACCENT_CREDIT * counts.accent) / total : 1;
        return {
            ops,
            counts,
            accuracy: Math.floor(score * 100 + 0.5),
            correct: total > 0 && counts.ok === want.length && counts.extra === 0,
            accent_only: counts.accent > 0 && !(counts.wrong || counts.missing || counts.extra),
        };
    }

    const sameWords = (a, b) => tokenize(a).map(t => t.norm).join(' ') === tokenize(b).map(t => t.norm).join(' ');

    // Step 0 is the whole sentence, 1..N the build-up steps (dictation.targets on the server)
    function localTargets(data) {
        const sentence = data.sentence || '';
        const translation = data.translationEn || '';
        const steps = (data.steps || []).slice(0, MAX_STEPS).filter(s => s && tokenize(s.fr).length);
        const usable = steps.length >= 2 ? steps : [];
        let whole = translation;
        if (!whole && usable.length && sameWords(usable[usable.length - 1].fr, sentence)) whole = usable[usable.length - 1].en || '';
        const out = [{ step: 0, expected: sentence, prompt_en: whole, note: '' }];
        usable.forEach((s, k) => out.push({
            step: k + 1,
            expected: s.fr,
            prompt_en: s.en || (sameWords(s.fr, sentence) ? translation : ''),
            note: s.new || '',
        }));
        return out;
    }

    // ---------------------------------------------------------------------
    // Exercise view
    // ---------------------------------------------------------------------
    const TEXT = {
        en: {
            kicker: { write: 'Recall', listen: 'Dictation' },
            sentenceOf: (k, n) => `Sentence ${k} / ${n}`,
            modeAria: 'Study mode', modeNormal: 'Show all', modeBlind: 'Test me', modeWrite: 'Recall', modeListen: 'Dictation',
            back: 'Back to the card',
            scopeAria: 'What to practise', scopeWhole: 'Whole sentence', scopeSteps: n => `Step by step (${n})`,
            wholeSentence: 'Whole sentence', stepOf: (k, n) => `Step ${k} / ${n}`, stepAria: (k, extra) => `Step ${k}${extra}`,
            promptLabel: 'Write this in French:',
            noPrompt: 'This step has no English prompt. Practise it as dictation, or skip it.',
            noPromptWhole: 'This sentence has no English translation. Practise it as dictation.',
            listenThis: 'Practise by listening', skip: 'Skip',
            play: 'Play', playSlow: 'Slow', showHint: 'Show the English hint', hideHint: 'Hide the hint',
            inputLabel: 'Your French', placeholder: 'Type the French here…  (Enter to check)',
            check: 'Check', checking: 'Checking…', reveal: 'Show the answer',
            emptyAnswer: 'Write your answer first.',
            correctAnswer: 'Correct answer', listenAnswer: 'Listen',
            verdictCorrect: 'All correct ✓', verdictAccent: 'Only accents to fix', verdictClose: 'Almost there', verdictRetry: 'Have another go',
            revealed: 'Answer shown (not scored).',
            legend: { ok: 'right', accent: 'accent', wrong: 'wrong', missing: 'missing', extra: 'extra' },
            srKind: { ok: 'right: ', accent: 'accent: ', wrong: 'wrong: ', missing: 'missing: ', extra: 'extra: ' },
            youWrote: 'you wrote',
            saved: 'Saved to your practice history.',
            unsaved: 'Checked, but the history could not be saved this time. Your score is still shown.',
            localOnly: 'Checked on this device: log in to save your practice history.',
            serverDown: 'Checked on this device: the server is busy or unreachable, so this try is not saved.',
            retry: 'Try again', next: 'Next step', again: 'Start over', done: 'All steps done. Try the whole sentence too.',
            ai: 'AI review (Chinese)', aiTitle: 'Ask the AI to explain the mistakes in Chinese. Only runs when you click.',
            aiLoading: 'The AI is reviewing…', aiFailed: 'AI review failed. Please try again later.', aiTip: 'Tip: ',
            aiNeedsSave: 'AI review needs a saved attempt (log in, then check again).',
            stats: s => `${s.attempts} ${s.attempts === 1 ? 'try' : 'tries'} · best ${s.best}% · last ${s.last}%${s.accent_only ? ` · ${s.accent_only} accent-only` : ''}`,
            noStats: 'First try', loginForStats: 'Log in to keep a history',
            history: 'History', historyEmpty: 'No saved tries yet.',
            historyRow: (a, when) => `${when} · ${a.accuracy}%${a.counts && a.counts.accent ? ` · accents ${a.counts.accent}` : ''}`,
        },
        zh: {
            kicker: { write: '默写', listen: '听写' },
            sentenceOf: (k, n) => `第 ${k} / ${n} 句`,
            modeAria: '学习模式切换', modeNormal: '全部显示', modeBlind: '考考我', modeWrite: '默写', modeListen: '听写',
            back: '返回卡片',
            scopeAria: '练习范围', scopeWhole: '整句', scopeSteps: n => `逐步（${n} 步）`,
            wholeSentence: '整句', stepOf: (k, n) => `第 ${k} / ${n} 步`, stepAria: (k, extra) => `第 ${k} 步${extra}`,
            promptLabel: '用法语写出：',
            noPrompt: '这一步没有英文提示。可以改成听写练这一步，或者跳过。',
            noPromptWhole: '这句话没有英文翻译，可以改成听写来练。',
            listenThis: '改成听写', skip: '跳过',
            play: '播放', playSlow: '慢速', showHint: '显示英文提示', hideHint: '收起提示',
            inputLabel: '你的法语', placeholder: '在这里输入法语…（回车检查）',
            check: '检查', checking: '检查中…', reveal: '直接看答案',
            emptyAnswer: '请先写下你的答案。',
            correctAnswer: '正确答案', listenAnswer: '听读音',
            verdictCorrect: '全对 ✓', verdictAccent: '只差重音', verdictClose: '差一点', verdictRetry: '再试一次吧',
            revealed: '已显示答案（本次不计分）。',
            legend: { ok: '对', accent: '重音', wrong: '错', missing: '漏写', extra: '多写' },
            srKind: { ok: '对：', accent: '重音：', wrong: '错：', missing: '漏写：', extra: '多写：' },
            youWrote: '你写的',
            saved: '已保存到练习记录。',
            unsaved: '已评分，但这次的练习记录没能保存。分数照常显示。',
            localOnly: '已在本机评分：登录后才会保存练习记录。',
            serverDown: '已在本机评分：服务器繁忙或连不上，这次不会保存。',
            retry: '再写一次', next: '下一步', again: '从头再来', done: '所有步骤完成！再试试整句吧。',
            ai: 'AI 批改（中文）', aiTitle: '让 AI 用中文解释错在哪里。只在你点击时调用。',
            aiLoading: 'AI 批改中…', aiFailed: 'AI 批改失败，请稍后再试。', aiTip: '小建议：',
            aiNeedsSave: 'AI 批改需要已保存的作答（请登录后再检查一次）。',
            stats: s => `练过 ${s.attempts} 次 · 最好 ${s.best}% · 上次 ${s.last}%${s.accent_only ? ` · 重音小错 ${s.accent_only} 次` : ''}`,
            noStats: '第一次练', loginForStats: '登录后保存练习记录',
            history: '记录', historyEmpty: '还没有保存的练习。',
            historyRow: (a, when) => `${when} · ${a.accuracy}%${a.counts && a.counts.accent ? ` · 重音小错 ${a.counts.accent}` : ''}`,
        },
    };
    let uid = 0;

    // A phone's tab row scrolls sideways: keep the active tab in view (the page itself does not move)
    function revealTab(btn) {
        const bar = btn && btn.parentElement;
        if (!bar || bar.scrollWidth <= bar.clientWidth) return;
        const offset = btn.getBoundingClientRect().left - bar.getBoundingClientRect().left;
        bar.scrollLeft = Math.max(0, bar.scrollLeft + offset - (bar.clientWidth - btn.offsetWidth) / 2);
    }

    function defaultEscape(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function create(deps = {}) {
        const lang = deps.lang || (root.FrenchI18n && root.FrenchI18n.lang && root.FrenchI18n.lang() === 'en' ? 'en' : 'zh');
        const T = TEXT[lang === 'en' ? 'en' : 'zh'];
        const esc = deps.escapeHtml || defaultEscape;
        const fetchFn = deps.fetch || ((...args) => root.fetch(...args));
        const getToken = deps.getToken || (() => '');
        const states = new WeakMap();

        const icons = () => { if (deps.refreshIcons) deps.refreshIcons(); };
        const stopAudio = () => { if (deps.stopAudio) deps.stopAudio(); };

        async function api(method, url, body) {
            const token = getToken();
            if (!token) return { status: 0, data: null, offline: 'login' };
            try {
                const res = await fetchFn(url, {
                    method,
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: body === undefined ? undefined : JSON.stringify(body),
                });
                let data = null;
                try { data = await res.json(); } catch (_) { data = null; }
                return { status: res.status, ok: res.ok, data };
            } catch (_) {
                return { status: 0, data: null, offline: 'network' };
            }
        }

        function ensureItem(state) {
            if (!state.itemPromise) {
                const { data } = state;
                state.itemPromise = api('POST', '/api/dictation/items', {
                    sentence: data.sentence,
                    translation_en: data.translationEn || '',
                    build_up: state.targets.length > 1 ? (data.steps || []).slice(0, MAX_STEPS).map(s => ({ fr: s.fr || '', en: s.en || '', new: s.new || '' })) : [],
                }).then(res => {
                    if (res.ok && res.data && res.data.item_id) {
                        state.item = res.data;
                        return res.data;
                    }
                    state.itemPromise = null;  // retry on the next check
                    state.offline = res.offline === 'login' || res.status === 401 ? 'login' : 'server';
                    return null;
                });
            }
            return state.itemPromise;
        }

        function currentTarget(state) {
            return state.targets[state.scope === 'steps' ? state.step : 0];
        }

        function summaryFor(state, target) {
            const s = state.item && state.item.summary && state.item.summary[state.mode];
            return s ? s[String(target.step)] : null;
        }

        function statsText(state, target) {
            if (!getToken()) return T.loginForStats;
            const s = summaryFor(state, target);
            return s && s.attempts ? T.stats(s) : T.noStats;
        }

        function open(card, data, mode) {
            if (!card || !data || !data.sentence) return;
            stopAudio();
            let state = states.get(card);
            if (!state) {
                const parked = document.createDocumentFragment();
                while (card.firstChild) parked.appendChild(card.firstChild);
                state = { card, data, parked, targets: localTargets(data), item: null, itemPromise: null, offline: '', done: {} };
                state.scope = 'whole';
                state.step = 1;
                states.set(card, state);
                card.classList.add('is-dictating');
            }
            state.mode = mode === 'listen' ? 'listen' : 'write';
            renderView(state);
            ensureItem(state).then(() => { if (states.get(card) === state && !state.checked) updateStats(state); });
        }

        function contextFor(element) {
            const card = element?.closest?.('.sentence-card');
            const state = card && states.get(card);
            if (!state || !element.closest('.dictation-result')) return null;
            const expected = state.wordTarget || '';
            const full = state.data.sentence || '';
            // Prefix build-up steps share the full sentence cache. A non-prefix/rearranged step
            // is its own actual sentence; never guess its occurrence in the full sentence.
            const sentence = full.startsWith(expected) ? full : expected;
            return { sentence, sentence_cn: state.data.translationZh || '', practice: true };
        }

        function close(card) {
            const state = states.get(card);
            if (!state) return false;
            stopAudio();
            states.delete(card);
            card.replaceChildren(state.parked);
            card.classList.remove('is-dictating');
            return true;
        }

        function exit(state, mode) {
            const { card } = state;
            close(card);
            if (deps.onExit) deps.onExit(card, mode);
        }

        function renderView(state) {
            const { card, data } = state;
            const hasSteps = state.targets.length > 1;
            const n = state.targets.length - 1;
            const viewId = state.viewId || (state.viewId = `dictation-view-${++uid}`);
            // The card's own tab row (data.tabs from study.js), so leaving is one tap on any other tab
            const tabs = Array.isArray(data.tabs) && data.tabs.length ? data.tabs
                : [{ id: 'recall', label: T.modeWrite, mode: 'write' }, { id: 'dictation', label: T.modeListen, mode: 'listen' }];
            const tabBtn = t => {
                const active = Boolean(t.mode) && state.mode === t.mode;
                const action = t.mode ? `data-dictation-mode="${esc(t.mode)}"` : `data-exit-tab="${esc(t.id)}"`;
                return `<button class="card-tab-btn${active ? ' active' : ''}" type="button" role="tab" data-tab="${esc(t.id)}" ${action} aria-selected="${active}"${active ? ' aria-controls="' + esc(viewId) + '"' : ''}>${esc(t.label)}</button>`;
            };
            card.innerHTML = `
                <div class="card-tabs-bar dictation-tabs" role="tablist" aria-label="${esc(T.modeAria)}">${tabs.map(tabBtn).join('')}</div>
                <div class="dictation-view" id="${esc(viewId)}" role="tabpanel" data-mode="${state.mode}" data-scope="${state.scope}">
                    <div class="dictation-head">
                        <div class="dictation-heading">
                            <h3 class="dictation-kicker">${esc(T.kicker[state.mode])} · ${esc(T.sentenceOf((data.index || 0) + 1, data.total || 1))}</h3>
                        </div>
                        <button class="btn btn-secondary dictation-back" type="button" data-exit-mode="back">${esc(T.back)}</button>
                    </div>
                    ${`
                        <div class="dictation-scope" role="group" aria-label="${esc(T.scopeAria)}">
                            <button class="btn btn-secondary dictation-scope-btn" type="button" data-scope="whole" aria-pressed="${state.scope === 'whole'}">${esc(T.scopeWhole)}</button>
                            ${hasSteps ? `<button class="btn btn-secondary dictation-scope-btn" type="button" data-scope="steps" aria-pressed="${state.scope === 'steps'}">${esc(T.scopeSteps(n))}</button>` : ''}
                        </div>
                    `}
                    <div class="dictation-task"></div>
                </div>
            `;
            card.querySelectorAll('[data-dictation-mode]').forEach(btn => btn.addEventListener('click', () => {
                if (btn.dataset.dictationMode === state.mode) return;
                open(card, data, btn.dataset.dictationMode);
            }));
            card.querySelectorAll('[data-exit-mode]').forEach(btn => btn.addEventListener('click', () => exit(state, btn.dataset.exitMode)));
            card.querySelectorAll('[data-exit-tab]').forEach(btn => btn.addEventListener('click', () => exit(state, btn.dataset.exitTab)));
            card.querySelectorAll('.dictation-scope-btn').forEach(btn => btn.addEventListener('click', () => {
                if (btn.dataset.scope === state.scope) return;
                state.scope = btn.dataset.scope;
                state.step = 1;
                renderView(state);
            }));
            revealTab(card.querySelector('.dictation-tabs .card-tab-btn.active'));
            renderTask(state);
        }

        function renderTask(state) {
            const { card } = state;
            const task = card.querySelector('.dictation-task');
            const target = currentTarget(state);
            const n = state.targets.length - 1;
            const id = `dictation-input-${++uid}`;
            const prompt = target.prompt_en;
            state.checked = false;
            stopAudio();
            const progress = state.scope === 'steps' ? `
                <ol class="dictation-progress">
                    ${state.targets.slice(1).map(t => {
                        const done = state.done[t.step];
                        const cls = t.step === state.step ? 'is-current' : done !== undefined ? 'is-done' : '';
                        return `<li class="${cls}" aria-label="${esc(T.stepAria(t.step, done !== undefined ? ` · ${done}%` : ''))}"${t.step === state.step ? ' aria-current="step"' : ''}></li>`;
                    }).join('')}
                </ol>` : '';
            const promptHtml = state.mode === 'write'
                ? (prompt
                    ? `<p class="dictation-prompt-label">${esc(T.promptLabel)}</p><p class="dictation-prompt" lang="en">${esc(prompt)}</p>`
                    : `<div class="dictation-noprompt" role="note">
                            <p>${esc(target.step === 0 ? T.noPromptWhole : T.noPrompt)}</p>
                            <div class="dictation-noprompt-actions">
                                <button class="btn btn-secondary dictation-switch-listen" type="button">${esc(T.listenThis)}</button>
                                ${state.scope === 'steps' && state.step < n ? `<button class="btn btn-secondary dictation-skip" type="button">${esc(T.skip)}</button>` : ''}
                            </div>
                       </div>`)
                : `<div class="dictation-audio">
                        <button class="btn btn-secondary dictation-play" type="button" data-rate="1"><i data-lucide="volume-2"></i><span>${esc(T.play)}</span></button>
                        <button class="btn btn-secondary dictation-play" type="button" data-rate="0.75"><i data-lucide="snail"></i><span>${esc(T.playSlow)}</span></button>
                        ${prompt ? `<button class="dictation-hint-btn" type="button" aria-expanded="false">${esc(T.showHint)}</button>` : ''}
                   </div>
                   ${prompt ? `<p class="dictation-prompt dictation-hint" lang="en" hidden>${esc(prompt)}</p>` : ''}`;
            task.innerHTML = `
                <div class="dictation-step-head">
                    ${state.scope === 'steps' ? `<span class="dictation-step-label">${esc(T.stepOf(state.step, n))}</span>` : ''}
                    <span class="dictation-stats">${esc(statsText(state, target))}</span>
                    ${getToken() ? `<button class="dictation-history-btn" type="button" aria-expanded="false">${esc(T.history)}</button>` : ''}
                </div>
                <ul class="dictation-history" hidden></ul>
                ${progress}
                ${promptHtml}
                <label class="dictation-input-label" for="${id}">${esc(T.inputLabel)}</label>
                <textarea class="dictation-input" id="${id}" rows="2" maxlength="1000" lang="fr" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T.placeholder)}"></textarea>
                <p class="dictation-message" role="status" aria-live="polite"></p>
                <div class="dictation-actions">
                    <button class="btn btn-primary dictation-check" type="button">${esc(T.check)}</button>
                    <button class="btn btn-secondary dictation-reveal" type="button">${esc(T.reveal)}</button>
                </div>
                <div class="dictation-result" hidden></div>
            `;
            bindTask(state, task, target);
            icons();
            const focusEl = state.mode === 'listen' ? task.querySelector('.dictation-play') : task.querySelector('.dictation-input');
            if (focusEl) focusEl.focus({ preventScroll: true });
        }

        function updateStats(state) {
            const el = state.card.querySelector('.dictation-stats');
            if (el) el.textContent = statsText(state, currentTarget(state));
        }

        function play(state, text, rate) {
            if (!deps.play || !text) return;
            deps.play(text, { voice: state.data.voice, rate });
        }

        function bindTask(state, task, target) {
            const input = task.querySelector('.dictation-input');
            const message = task.querySelector('.dictation-message');
            task.querySelectorAll('.dictation-play').forEach(btn => btn.addEventListener('click', () => play(state, target.expected, Number(btn.dataset.rate) || 1)));
            const hintBtn = task.querySelector('.dictation-hint-btn');
            if (hintBtn) {
                hintBtn.addEventListener('click', () => {
                    const hint = task.querySelector('.dictation-hint');
                    const show = hint.hidden;
                    hint.hidden = !show;
                    hintBtn.setAttribute('aria-expanded', String(show));
                    hintBtn.textContent = show ? T.hideHint : T.showHint;
                });
            }
            const listenBtn = task.querySelector('.dictation-switch-listen');
            if (listenBtn) listenBtn.addEventListener('click', () => open(state.card, state.data, 'listen'));
            const skipBtn = task.querySelector('.dictation-skip');
            if (skipBtn) skipBtn.addEventListener('click', () => { state.step += 1; renderTask(state); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    if (!state.checked) check(state, task, target);
                }
            });
            task.querySelector('.dictation-check').addEventListener('click', () => check(state, task, target));
            task.querySelector('.dictation-reveal').addEventListener('click', () => {
                message.textContent = '';
                showResult(state, task, target, null, 'revealed');
            });
            const historyBtn = task.querySelector('.dictation-history-btn');
            if (historyBtn) historyBtn.addEventListener('click', () => toggleHistory(state, task, target, historyBtn));
        }

        async function toggleHistory(state, task, target, btn) {
            const list = task.querySelector('.dictation-history');
            if (!list.hidden) {
                list.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                return;
            }
            list.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            list.innerHTML = '';
            const item = await ensureItem(state);
            if (!item) { list.innerHTML = `<li>${esc(T.historyEmpty)}</li>`; return; }
            const qs = `item_id=${encodeURIComponent(item.item_id)}&mode=${state.mode}&step=${target.step}&limit=10`;
            const res = await api('GET', `/api/dictation/attempts?${qs}`);
            const attempts = res.ok && res.data && Array.isArray(res.data.attempts) ? res.data.attempts : [];
            // Scores and dates only: past answers may spell out the French before this try is checked
            list.innerHTML = attempts.length
                ? attempts.map(a => `<li>${esc(T.historyRow(a, formatWhen(a.created_at)))}</li>`).join('')
                : `<li>${esc(T.historyEmpty)}</li>`;
        }

        function formatWhen(iso) {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            const pad = v => String(v).padStart(2, '0');
            return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }

        async function check(state, task, target) {
            const input = task.querySelector('.dictation-input');
            const message = task.querySelector('.dictation-message');
            const checkBtn = task.querySelector('.dictation-check');
            const answer = input.value;
            if (!answer.trim()) {
                message.textContent = T.emptyAnswer;
                input.focus();
                return;
            }
            if (state.busy) return;
            state.busy = true;
            message.textContent = '';
            checkBtn.disabled = true;
            checkBtn.textContent = T.checking;
            checkBtn.setAttribute('aria-busy', 'true');
            let result = null;
            let saveState = 'local';
            try {
                const item = await ensureItem(state);
                if (item) {
                    const res = await api('POST', '/api/dictation/attempts', { item_id: item.item_id, mode: state.mode, step: target.step, answer });
                    if (res.ok && res.data && Array.isArray(res.data.ops)) {
                        result = res.data;
                        saveState = res.data.saved ? 'saved' : 'unsaved';
                        if (res.data.summary && state.item && state.item.summary && state.item.summary[state.mode]) {
                            state.item.summary[state.mode][String(target.step)] = res.data.summary;
                        }
                    } else {
                        saveState = res.offline === 'login' || res.status === 401 ? 'local' : 'server';
                    }
                } else {
                    saveState = state.offline === 'login' || !getToken() ? 'local' : 'server';
                }
            } finally {
                state.busy = false;
            }
            if (states.get(state.card) !== state || !task.isConnected) return;  // the learner left meanwhile
            if (!result) {
                result = { ...grade(target.expected, answer), expected: target.expected, note: target.note, attempt_id: null, saved: false };
            }
            showResult(state, task, target, result, saveState);
        }

        // Each visible French token carries its proven offset in the exercise target. Wrong
        // learner text is deliberately unmapped, even if that word occurs elsewhere in the target.
        function practiceWord(word, start, end, actual = false) {
            return `<span class="interactive-word" lang="fr" role="button" tabindex="0" data-word="${esc(word)}" ${actual || start < 0 ? 'data-context-unavailable="true"' : `data-context-start="${start}" data-context-end="${end}"`}>${esc(word)}</span>`;
        }

        function resultWords(result, expected) {
            let cursor = 0;
            return result.ops.map(op => {
                const at = op.expected ? expected.indexOf(op.expected, cursor) : -1;
                if (at >= 0) cursor = at + op.expected.length;
                const right = practiceWord(op.expected || '', at, at + (op.expected || '').length);
                const wrong = practiceWord(op.actual || '', -1, -1, true);
                const sr = `<span class="dictation-sr" lang="${T === TEXT.en ? 'en' : 'zh'}">${esc(T.srKind[op.kind])}</span>`;
                if (op.kind === 'ok') return `<span class="dt-word dt-ok">${sr}${right}</span>`;
                if (op.kind === 'missing') return `<span class="dt-word dt-missing">${sr}<span class="dt-fix">${right}</span></span>`;
                if (op.kind === 'wrong' || op.kind === 'accent') return `<span class="dt-word dt-${op.kind}" title="${esc(`${T.youWrote}: ${op.actual}`)}">${sr}<s class="dt-yours">${wrong}</s><span class="dt-fix">${right}</span></span>`;
                return `<span class="dt-word dt-extra">${sr}<s class="dt-yours">${wrong}</s></span>`;
            }).join(' ');
        }

        function answerWords(expected) {
            return expected.replace(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*['’]?/gu,
                (word, start) => practiceWord(word, start, start + word.length));
        }

        function showResult(state, task, target, result, saveState) {
            state.checked = true;
            state.wordTarget = target.expected;
            const box = task.querySelector('.dictation-result');
            const n = state.targets.length - 1;
            const expected = result ? result.expected : target.expected;
            const note = result ? result.note : target.note;
            let scoreHtml = '';
            if (result) {
                const verdict = result.correct ? T.verdictCorrect : result.accent_only ? T.verdictAccent : result.accuracy >= 80 ? T.verdictClose : T.verdictRetry;
                const tone = result.correct ? 'is-correct' : result.accent_only ? 'is-accent' : 'is-wrong';
                scoreHtml = `
                    <div class="dictation-score ${tone}">
                        <strong class="dictation-accuracy">${esc(result.accuracy)}%</strong>
                        <span class="dictation-verdict">${esc(verdict)}</span>
                    </div>
                    <p class="dictation-diff" lang="fr">${resultWords(result, expected)}</p>
                    <p class="dictation-legend">${KINDS.filter(k => result.counts[k]).map(k => `<span class="dt-key dt-key-${k}">${esc(T.legend[k])} ${esc(result.counts[k])}</span>`).join('')}</p>
                `;
                if (state.scope === 'steps') state.done[target.step] = result.accuracy;
            }
            const saveText = !result ? T.revealed
                : saveState === 'saved' ? T.saved
                : saveState === 'unsaved' ? T.unsaved
                : saveState === 'server' ? T.serverDown : T.localOnly;
            const canAi = result && !result.correct;
            const isLast = state.scope !== 'steps' || state.step >= n;
            box.innerHTML = `
                ${scoreHtml}
                <div class="dictation-answer">
                    <span class="dictation-answer-label">${esc(T.correctAnswer)}</span>
                    <p class="dictation-answer-text" lang="fr">${answerWords(expected)}</p>
                    <button class="btn btn-secondary dictation-play-answer" type="button"><i data-lucide="volume-2"></i><span>${esc(T.listenAnswer)}</span></button>
                </div>
                ${note ? `<p class="dictation-note">${esc(note)}</p>` : ''}
                <p class="dictation-save-state" data-state="${esc(result ? saveState : 'revealed')}">${esc(saveText)}</p>
                <div class="dictation-next">
                    <button class="btn ${state.scope === 'steps' ? 'btn-secondary' : 'btn-primary'} dictation-retry" type="button">${esc(T.retry)}</button>
                    ${state.scope === 'steps' ? (isLast
                        ? `<button class="btn btn-primary dictation-again" type="button">${esc(T.again)}</button>`
                        : `<button class="btn btn-primary dictation-next-step" type="button">${esc(T.next)}</button>`) : ''}
                    ${canAi ? `<button class="btn btn-secondary dictation-ai-btn" type="button" title="${esc(T.aiTitle)}"><i data-lucide="sparkles"></i><span>${esc(T.ai)}</span></button>` : ''}
                </div>
                ${state.scope === 'steps' && isLast && result ? `<p class="dictation-done">${esc(T.done)}</p>` : ''}
                <div class="dictation-ai" aria-live="polite" hidden></div>
            `;
            box.hidden = false;
            const checkBtn = task.querySelector('.dictation-check');
            checkBtn.disabled = true;
            checkBtn.textContent = T.check;
            checkBtn.setAttribute('aria-busy', 'false');
            task.querySelector('.dictation-reveal').disabled = true;
            task.querySelector('.dictation-actions').hidden = true;
            task.querySelector('.dictation-input').readOnly = true;
            task.querySelectorAll('.dictation-progress li').forEach((li, k) => {
                const step = k + 1;
                if (state.done[step] !== undefined && step !== state.step) li.className = 'is-done';
                li.setAttribute('aria-label', T.stepAria(step, state.done[step] !== undefined ? ` · ${state.done[step]}%` : ''));
            });
            updateStats(state);
            box.querySelector('.dictation-play-answer').addEventListener('click', () => play(state, expected, 1));
            box.querySelector('.dictation-retry').addEventListener('click', () => renderTask(state));
            const nextBtn = box.querySelector('.dictation-next-step');
            if (nextBtn) nextBtn.addEventListener('click', () => { state.step += 1; renderTask(state); });
            const againBtn = box.querySelector('.dictation-again');
            if (againBtn) againBtn.addEventListener('click', () => { state.step = 1; state.done = {}; renderTask(state); });
            const aiBtn = box.querySelector('.dictation-ai-btn');
            if (aiBtn) aiBtn.addEventListener('click', () => requestAi(state, box, result, aiBtn));
            icons();
            (nextBtn || againBtn || box.querySelector('.dictation-retry')).focus({ preventScroll: true });
        }

        async function requestAi(state, box, result, btn) {
            const panel = box.querySelector('.dictation-ai');
            panel.hidden = false;
            if (!result.attempt_id) {
                panel.innerHTML = `<p class="dictation-ai-error">${esc(T.aiNeedsSave)}</p>`;
                return;
            }
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            panel.innerHTML = `<p class="dictation-ai-loading">${esc(T.aiLoading)}</p>`;
            const res = await api('POST', `/api/dictation/attempts/${encodeURIComponent(result.attempt_id)}/ai`);
            if (!box.isConnected) return;
            btn.setAttribute('aria-busy', 'false');
            const fb = res.ok && res.data && res.data.feedback;
            if (!fb) {
                const detail = res.data && res.data.detail;
                const msg = detail && typeof detail === 'object' && detail.message ? detail.message : T.aiFailed;
                panel.innerHTML = `<p class="dictation-ai-error">${esc(msg)}</p>`;
                btn.disabled = false;
                return;
            }
            const points = Array.isArray(fb.points) ? fb.points : [];
            panel.innerHTML = `
                ${fb.summary ? `<p class="dictation-ai-summary">${esc(fb.summary)}</p>` : ''}
                ${points.length ? `<ul class="dictation-ai-points">${points.map(p => `
                    <li>
                        ${p.wrong || p.right ? `<span class="dictation-ai-pair" lang="fr">${p.wrong ? `<s>${esc(p.wrong)}</s> → ` : ''}<strong>${esc(p.right)}</strong></span>` : ''}
                        <span class="dictation-ai-why">${esc(p.why)}</span>
                    </li>`).join('')}</ul>` : ''}
                ${fb.tip ? `<p class="dictation-ai-tip">${esc(T.aiTip)}${esc(fb.tip)}</p>` : ''}
            `;
        }

        return { contextFor, open, close, isOpen: card => states.has(card) };
    }

    const api = { tokenize, grade, localTargets, create, revealTab, ACCENT_CREDIT, TEXT };
    root.FrenchDictation = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
