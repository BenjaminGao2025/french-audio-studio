/* ==========================================================================
   French Audio Studio - Daily Review (/review)
   Active recall on sentence cards scheduled server-side with FSRS:
     listen    - hear the sentence without text, recall the meaning
     speak     - see the Chinese meaning, say the French (speech recognition scores it)
     cloze     - type the missing chunk back into the sentence
     recognize - legacy word card: see the word, recall the meaning
   ========================================================================== */

(function () {
    'use strict';

    const TOKEN_KEY = 'frenchStudio.userToken';
    const NEW_LIMIT_KEY = 'frenchStudio.srs.newLimit';
    const LEGACY_DECK_KEY = 'frenchStudio.ankiDeck';
    const LEGACY_IMPORTED_KEY = 'frenchStudio.ankiDeck.importedAt';
    const LEARN_AHEAD_MS = 20 * 60 * 1000;
    const VOICE = 'fr-FR-DeniseNeural';
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

    const MODE_INFO = {
        listen: { icon: 'headphones', label: '听', task: '只听，不看文字。心里（或小声）说出它的中文意思，然后看答案。' },
        speak: { icon: 'mic', label: '说', task: '看着中文，用法语把整句说出来。说不全也没关系，先说再看答案。' },
        cloze: { icon: 'pencil-line', label: '填', task: '把空格里的法语写出来。' },
        recognize: { icon: 'eye', label: '认', task: '想一想这个词是什么意思，然后看答案。' },
    };
    const STATE_LABELS = { new: '新卡', learning: '学习中', relearning: '重新学习', review: '复习' };
    const RATING_NAMES = { 1: '重来', 2: '困难', 3: '良好', 4: '简单' };

    const $ = (id) => document.getElementById(id);
    const els = {
        loginRequired: $('login-required'),
        legacyImport: $('legacy-import'),
        legacyCount: $('legacy-count'),
        legacyImportBtn: $('legacy-import-btn'),
        legacyDismissBtn: $('legacy-dismiss-btn'),
        summary: $('review-summary'),
        countLearning: $('count-learning'),
        countReview: $('count-review'),
        countNew: $('count-new'),
        progressBar: $('progress-bar'),
        progressText: $('progress-text'),
        stage: $('review-stage'),
        modeBadge: $('mode-badge'),
        cardState: $('card-state'),
        promptArea: $('prompt-area'),
        attemptArea: $('attempt-area'),
        revealBtn: $('reveal-btn'),
        answerArea: $('answer-area'),
        gradeRow: $('grade-row'),
        gradeSuggestion: $('grade-suggestion'),
        gradeButtons: document.querySelectorAll('.btn-grade'),
        done: $('review-done'),
        doneTitle: $('done-title'),
        doneDetail: $('done-detail'),
        browser: $('deck-browser'),
        toggleBrowserBtn: $('toggle-browser-btn'),
        deckSearch: $('deck-search'),
        deckStats: $('deck-stats'),
        deckList: $('deck-list'),
        newLimitSelect: $('new-limit-select'),
        error: $('review-error'),
    };

    const session = {
        queue: [],
        learning: [],
        current: null,
        revealed: false,
        grading: false,
        startedAt: 0,
        attempt: null,
        reviewed: 0,
        total: 0,
    };

    let currentAudio = null;
    let recorder = null;

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    function getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
    }

    function getNewLimit() {
        const saved = parseInt(localStorage.getItem(NEW_LIMIT_KEY) || '', 10);
        return Number.isFinite(saved) ? saved : 10;
    }

    function showError(message) {
        els.error.textContent = message;
        els.error.hidden = !message;
    }

    async function api(method, path, body) {
        const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            showLoginRequired();
            throw new Error('登录已失效，请重新登录。');
        }
        if (!res.ok) {
            throw new Error(data.detail?.message || `请求失败（HTTP ${res.status}）`);
        }
        return data;
    }

    function formatInterval(seconds) {
        if (seconds < 60) return '<1分钟';
        if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)}小时`;
        const days = seconds / 86400;
        if (days < 30) return `${Math.round(days)}天`;
        if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}个月`;
        return `${(days / 365).toFixed(1).replace(/\.0$/, '')}年`;
    }

    function normalizeAnswer(str) {
        return (str || '')
            .replace(/[’ʼ]/g, "'")
            .replace(/[.,!?;:«»"]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function stripAccents(str) {
        return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function splitAroundTarget(sentence, target) {
        const index = (sentence || '').toLowerCase().indexOf((target || '').toLowerCase());
        if (!target || index < 0) return null;
        return [sentence.slice(0, index), sentence.slice(index, index + target.length), sentence.slice(index + target.length)];
    }

    function initialsHint(sentence) {
        return (sentence || '').replace(/([A-Za-zÀ-ÖØ-öø-ÿŒœ])([A-Za-zÀ-ÖØ-öø-ÿŒœ]*)/g,
            (_, first, rest) => first + rest.replace(/./g, '_'));
    }

    // ---------------------------------------------------------------------
    // Audio
    // ---------------------------------------------------------------------
    function stopAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    }

    function playFrench(text, rate = 1) {
        if (!text) return;
        stopAudio();
        const audio = new Audio(`/tts?text=${encodeURIComponent(text.trim())}&voice=${VOICE}`);
        audio.playbackRate = rate;
        currentAudio = audio;
        audio.play().catch(() => {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'fr-FR';
                utterance.rate = rate;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utterance);
            }
        });
    }

    function audioButtons(text, label = '播放') {
        return `
            <div class="audio-buttons">
                <button class="btn btn-secondary btn-play" type="button" data-speech="${escapeHtml(text)}" data-rate="1">
                    <i data-lucide="volume-2"></i><span>${label}</span> <kbd>R</kbd>
                </button>
                <button class="btn btn-secondary btn-play" type="button" data-speech="${escapeHtml(text)}" data-rate="0.75">
                    <i data-lucide="snail"></i><span>慢速</span>
                </button>
            </div>`;
    }

    // ---------------------------------------------------------------------
    // Speaking attempt (speech recognition + optional recording playback)
    // ---------------------------------------------------------------------
    function stopRecorder() {
        if (!recorder) return;
        const r = recorder;
        recorder = null;
        try { if (r.recognition) r.recognition.stop(); } catch (_) {}
        try { if (r.mediaRecorder && r.mediaRecorder.state !== 'inactive') r.mediaRecorder.stop(); } catch (_) {}
    }

    function renderSpeakAttempt(card) {
        if (!SpeechRecognition) {
            els.attemptArea.innerHTML = `
                <p class="attempt-note">这个浏览器不支持语音识别（Chrome / Edge / Safari 支持）。请大声说出来，再点「显示答案」对照。</p>`;
            return;
        }
        els.attemptArea.innerHTML = `
            <button id="record-btn" class="btn btn-record" type="button">
                <i data-lucide="mic"></i><span class="record-label">开口说法语</span>
            </button>
            <p id="live-transcript" class="live-transcript" hidden></p>
            <div id="my-recording" hidden></div>`;
        const recordBtn = $('record-btn');
        const live = $('live-transcript');

        recordBtn.addEventListener('click', async () => {
            if (recorder) {
                finishSpeaking(card);
                return;
            }
            stopAudio();
            const recognition = new SpeechRecognition();
            recognition.lang = 'fr-FR';
            recognition.continuous = true;
            recognition.interimResults = true;
            const state = { recognition, transcript: '', mediaRecorder: null, chunks: [] };
            recognition.onresult = (event) => {
                let text = '';
                for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + ' ';
                state.transcript = text.trim();
                live.hidden = false;
                live.textContent = state.transcript;
            };
            recognition.onerror = (event) => console.warn('SpeechRecognition error:', event.error);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                state.mediaRecorder = new MediaRecorder(stream);
                state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.chunks.push(e.data); };
                state.mediaRecorder.onstop = () => {
                    stream.getTracks().forEach(t => t.stop());
                    const holder = $('my-recording');
                    if (!holder || !state.chunks.length) return;
                    const url = URL.createObjectURL(new Blob(state.chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' }));
                    holder.innerHTML = `<span>我的录音</span><audio controls src="${url}"></audio>`;
                    holder.hidden = false;
                };
                state.mediaRecorder.start();
            } catch (err) {
                console.warn('Recording unavailable:', err);
            }
            recognition.start();
            recorder = state;
            recordBtn.classList.add('recording');
            recordBtn.querySelector('.record-label').textContent = '说完了，点这里评分';
        });
    }

    function finishSpeaking(card) {
        const state = recorder;
        stopRecorder();
        const recordBtn = $('record-btn');
        if (recordBtn) {
            recordBtn.classList.remove('recording');
            recordBtn.querySelector('.record-label').textContent = '再说一次';
        }
        // Give the recognizer a moment to deliver its final result.
        setTimeout(() => {
            const transcript = state ? state.transcript : '';
            const evaluation = window.SpeechEval.evaluateFrenchPronunciation(card.note.sentence, transcript);
            session.attempt = {
                answer: transcript,
                score: evaluation.overallScore,
                suggested: evaluation.overallScore >= 85 ? 3 : evaluation.overallScore >= 60 ? 2 : 1,
                html: `
                    <div class="attempt-result">
                        <div class="attempt-score score-${evaluation.ratingClass}">${evaluation.overallScore}<small>分</small></div>
                        <div>
                            <div class="diff-words">${evaluation.wordResults.map(w =>
                                `<span class="diff-word ${w.status}">${escapeHtml(w.word)}</span>`).join(' ')}</div>
                            <p class="attempt-heard">识别到：${escapeHtml(transcript || '（没有识别到声音）')}</p>
                        </div>
                    </div>`,
            };
            reveal();
        }, 600);
    }

    // ---------------------------------------------------------------------
    // Cloze attempt
    // ---------------------------------------------------------------------
    function checkCloze(card) {
        const input = $('cloze-input');
        const typed = input ? input.value : '';
        const expected = normalizeAnswer(card.target);
        const given = normalizeAnswer(typed);
        let verdict;
        let suggested;
        if (given && given === expected) {
            verdict = { cls: 'correct', text: '完全正确' };
            suggested = 3;
        } else if (given && stripAccents(given) === stripAccents(expected)) {
            verdict = { cls: 'close', text: '对了，但注意重音符号' };
            suggested = 2;
        } else if (given && window.SpeechEval.calculateLevenshteinSimilarity(given, expected) >= 0.7) {
            verdict = { cls: 'close', text: '很接近，拼写有出入' };
            suggested = 2;
        } else {
            verdict = { cls: 'wrong', text: given ? '不对' : '没有作答' };
            suggested = 1;
        }
        session.attempt = {
            answer: typed,
            score: null,
            suggested,
            html: `
                <div class="attempt-result cloze-result ${verdict.cls}">
                    <strong>${verdict.text}</strong>
                    ${given ? `<span>你写的：<b>${escapeHtml(typed)}</b></span>` : ''}
                    <span>答案：<b>${escapeHtml(card.target)}</b></span>
                </div>`,
        };
        reveal();
    }

    // ---------------------------------------------------------------------
    // Card rendering
    // ---------------------------------------------------------------------
    function renderPrompt(card) {
        const note = card.note;
        const meta = card.target_meta || {};
        const info = MODE_INFO[card.mode] || MODE_INFO.listen;
        let html = `<p class="task-line">${info.task}</p>`;

        if (card.mode === 'listen') {
            html += `
                <div class="listen-prompt">
                    <button class="btn-listen-big btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="1" aria-label="播放句子">
                        <i data-lucide="volume-2"></i>
                    </button>
                    <button class="btn btn-secondary btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="0.75">
                        <i data-lucide="snail"></i><span>慢速再听</span>
                    </button>
                </div>`;
        } else if (card.mode === 'speak') {
            html += `
                <div class="speak-prompt">
                    <p class="prompt-zh">${escapeHtml(note.translation_zh || note.translation_en || '（这句还没有中文翻译）')}</p>
                    ${note.translation_zh && note.translation_en ? `
                        <details class="prompt-hint"><summary>看英文提示</summary><p>${escapeHtml(note.translation_en)}</p></details>` : ''}
                    <details class="prompt-hint"><summary>看首字母提示</summary><p class="initials">${escapeHtml(initialsHint(note.sentence))}</p></details>
                </div>`;
        } else if (card.mode === 'cloze') {
            const parts = splitAroundTarget(note.sentence, card.target);
            const width = Math.max(4, card.target.length);
            const sentenceHtml = parts
                ? `${escapeHtml(parts[0])}<span class="cloze-blank" style="min-width:${width}ch">?</span>${escapeHtml(parts[2])}`
                : escapeHtml(note.sentence);
            const clue = meta.meaning_zh || meta.meaning_en || '';
            html += `
                <div class="cloze-prompt">
                    <p class="prompt-fr">${sentenceHtml}</p>
                    ${note.translation_zh ? `<p class="prompt-sub">${escapeHtml(note.translation_zh)}</p>` : ''}
                    ${clue ? `<p class="prompt-clue">空格的意思：${escapeHtml(clue)}</p>` : ''}
                    <details class="prompt-hint"><summary>看首字母提示</summary><p class="initials">${escapeHtml(initialsHint(card.target))}</p></details>
                </div>`;
        } else {
            html += `
                <div class="recognize-prompt">
                    <p class="prompt-word">${escapeHtml(card.target)}</p>
                    ${meta.ipa ? `<p class="prompt-sub">${escapeHtml(meta.ipa)}</p>` : ''}
                    ${audioButtons(card.target, '发音')}
                </div>`;
        }
        els.promptArea.innerHTML = html;

        els.attemptArea.innerHTML = '';
        if (card.mode === 'speak') {
            renderSpeakAttempt(card);
        } else if (card.mode === 'cloze') {
            els.attemptArea.innerHTML = `
                <form id="cloze-form" class="cloze-form" autocomplete="off">
                    <input id="cloze-input" type="text" placeholder="在这里输入缺的法语" autocapitalize="off" spellcheck="false">
                    <button class="btn btn-primary" type="submit">检查 <kbd>Enter</kbd></button>
                </form>`;
            $('cloze-form').addEventListener('submit', (e) => {
                e.preventDefault();
                checkCloze(card);
            });
            setTimeout(() => { const input = $('cloze-input'); if (input) input.focus(); }, 50);
        }
    }

    function renderAnswer(card) {
        const note = card.note;
        const meta = card.target_meta || {};
        const parts = card.target ? splitAroundTarget(note.sentence, card.target) : null;
        const sentenceHtml = parts
            ? `${escapeHtml(parts[0])}<mark>${escapeHtml(parts[1])}</mark>${escapeHtml(parts[2])}`
            : escapeHtml(note.sentence);
        const grammar = (note.extra && note.extra.grammar) || [];
        const metaBits = [meta.pos, meta.lemma && meta.lemma !== card.target ? `原形 ${meta.lemma}` : '', meta.ipa].filter(Boolean);

        els.answerArea.innerHTML = `
            ${session.attempt ? session.attempt.html : ''}
            <div class="answer-sentence">
                <p class="answer-fr">${sentenceHtml}</p>
                ${audioButtons(note.sentence)}
                ${note.translation_zh ? `<p class="answer-zh">${escapeHtml(note.translation_zh)}</p>` : ''}
                ${note.translation_en ? `<p class="answer-en">${escapeHtml(note.translation_en)}</p>` : ''}
            </div>
            ${card.target ? `
                <div class="answer-target">
                    <strong>${escapeHtml(card.target)}</strong>
                    ${metaBits.length ? `<span class="target-meta">${metaBits.map(escapeHtml).join(' · ')}</span>` : ''}
                    ${meta.meaning_zh ? `<p>${escapeHtml(meta.meaning_zh)}</p>` : ''}
                    ${meta.meaning_en ? `<p class="answer-en">${escapeHtml(meta.meaning_en)}</p>` : ''}
                    ${meta.hook ? `<p class="target-hook">记忆钩子：${escapeHtml(meta.hook)}</p>` : ''}
                </div>` : ''}
            ${grammar.length ? `
                <details class="answer-grammar">
                    <summary>这句的语法要点（${grammar.length}）</summary>
                    ${grammar.map(g => `
                        <div class="grammar-item">
                            <strong>${escapeHtml(g.title)}</strong>
                            ${g.explanation ? `<p>${escapeHtml(g.explanation)}</p>` : ''}
                            ${g.hook ? `<p class="target-hook">${escapeHtml(g.hook)}</p>` : ''}
                        </div>`).join('')}
                </details>` : ''}`;
    }

    function renderCard(card) {
        session.current = card;
        session.revealed = false;
        session.attempt = null;
        session.startedAt = Date.now();

        const info = MODE_INFO[card.mode] || MODE_INFO.listen;
        els.modeBadge.className = `mode-badge mode-${card.mode}`;
        els.modeBadge.innerHTML = `<i data-lucide="${info.icon}"></i><span>${info.label}</span>`;
        els.cardState.textContent = STATE_LABELS[card.state] || '';

        renderPrompt(card);
        els.answerArea.hidden = true;
        els.answerArea.innerHTML = '';
        els.gradeRow.hidden = true;
        els.revealBtn.hidden = false;
        els.stage.hidden = false;
        refreshIcons();

        if (card.mode === 'listen') playFrench(card.note.sentence);
        if (card.mode === 'recognize') playFrench(card.target);
    }

    function reveal() {
        const card = session.current;
        if (!card || session.revealed) return;
        if (recorder) {
            finishSpeaking(card);
            return;
        }
        session.revealed = true;
        els.revealBtn.hidden = true;
        const form = $('cloze-form');
        if (form) form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });

        renderAnswer(card);
        els.answerArea.hidden = false;

        els.gradeButtons.forEach(btn => {
            const rating = btn.dataset.rating;
            const seconds = card.intervals ? card.intervals[rating] : null;
            btn.querySelector('.grade-interval').textContent = seconds == null ? '' : formatInterval(seconds);
            btn.classList.toggle('is-suggested', Boolean(session.attempt && session.attempt.suggested === Number(rating)));
            btn.disabled = false;
        });
        els.gradeSuggestion.textContent = session.attempt
            ? `（按你的作答，建议「${RATING_NAMES[session.attempt.suggested]}」）`
            : '';
        els.gradeRow.hidden = false;
        refreshIcons();

        if (card.mode === 'speak' || card.mode === 'cloze') playFrench(card.note.sentence);
    }

    async function grade(rating) {
        const card = session.current;
        if (!card || !session.revealed || session.grading) return;
        session.grading = true;
        els.gradeButtons.forEach(btn => { btn.disabled = true; });
        stopAudio();
        try {
            const updated = await api('POST', `/api/srs/cards/${encodeURIComponent(card.id)}/review`, {
                rating,
                duration_ms: Math.min(Date.now() - session.startedAt, 3600000),
                score: session.attempt ? session.attempt.score : null,
                answer: session.attempt ? (session.attempt.answer || null) : null,
            });
            session.reviewed += 1;
            if ((updated.state === 'learning' || updated.state === 'relearning')
                && Date.parse(updated.due) - Date.now() <= LEARN_AHEAD_MS) {
                session.learning.push(updated);
                session.total += 1;
            }
            showError('');
            showNext();
        } catch (err) {
            showError(`保存评分失败：${err.message}`);
            els.gradeButtons.forEach(btn => { btn.disabled = false; });
        } finally {
            session.grading = false;
        }
    }

    function nextCard() {
        session.learning.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
        if (session.learning.length && Date.parse(session.learning[0].due) <= Date.now()) {
            return session.learning.shift();
        }
        if (session.queue.length) return session.queue.shift();
        // Nothing else left: show short-step learning cards a bit early.
        return session.learning.shift() || null;
    }

    function updateProgress() {
        const total = Math.max(session.total, session.reviewed);
        els.progressText.textContent = `${session.reviewed} / ${total}`;
        els.progressBar.style.width = total ? `${Math.round(session.reviewed / total * 100)}%` : '0%';
    }

    function showNext() {
        stopRecorder();
        updateProgress();
        const card = nextCard();
        if (!card) {
            session.current = null;
            els.stage.hidden = true;
            els.done.hidden = false;
            els.doneTitle.textContent = session.reviewed ? `今天的复习完成了，共 ${session.reviewed} 次` : '现在没有要复习的卡片';
            els.doneDetail.textContent = session.reviewed
                ? '间隔重复会在你快要忘记的时候再把卡片送回来。明天再来。'
                : '去「拆解与复述」学几句新句子，点「加入复习」，它们就会出现在这里。';
            refreshIcons();
            return;
        }
        els.done.hidden = true;
        renderCard(card);
    }

    async function loadQueue() {
        showError('');
        const data = await api('GET', `/api/srs/queue?tz_offset=${new Date().getTimezoneOffset()}&new_limit=${getNewLimit()}`);
        session.queue = data.cards || [];
        session.learning = [];
        session.reviewed = 0;
        session.total = session.queue.length;
        els.countLearning.textContent = data.counts.learning;
        els.countReview.textContent = data.counts.review;
        els.countNew.textContent = data.counts.new;
        els.summary.hidden = false;
        showNext();
    }

    // ---------------------------------------------------------------------
    // Legacy browser deck import
    // ---------------------------------------------------------------------
    function legacyCards() {
        try {
            if (localStorage.getItem(LEGACY_IMPORTED_KEY)) return [];
            const cards = JSON.parse(localStorage.getItem(LEGACY_DECK_KEY) || '[]');
            return Array.isArray(cards) ? cards : [];
        } catch (_) {
            return [];
        }
    }

    function setupLegacyImport() {
        const cards = legacyCards();
        if (!cards.length) return;
        els.legacyCount.textContent = cards.length;
        els.legacyImport.hidden = false;
        els.legacyImportBtn.addEventListener('click', async () => {
            els.legacyImportBtn.disabled = true;
            try {
                const result = await api('POST', '/api/srs/import', { cards });
                localStorage.setItem(LEGACY_IMPORTED_KEY, new Date().toISOString());
                els.legacyImport.innerHTML = `<p>已导入 ${result.imported} 张卡片。它们会按每天新卡上限逐步出现。</p>`;
                await loadQueue();
            } catch (err) {
                showError(`导入失败：${err.message}`);
                els.legacyImportBtn.disabled = false;
            }
        });
        els.legacyDismissBtn.addEventListener('click', () => { els.legacyImport.hidden = true; });
    }

    // ---------------------------------------------------------------------
    // Card browser
    // ---------------------------------------------------------------------
    let searchTimer = null;

    function dueLabel(card) {
        if (card.state === 'new') return '未开始';
        const seconds = (Date.parse(card.due) - Date.now()) / 1000;
        return seconds <= 0 ? '已到期' : `${formatInterval(seconds)}后`;
    }

    async function renderBrowser() {
        const q = els.deckSearch.value.trim();
        try {
            const data = await api('GET', `/api/srs/cards?q=${encodeURIComponent(q)}`);
            const notes = new Map();
            data.cards.forEach(card => {
                if (!notes.has(card.note_id)) notes.set(card.note_id, { note: card.note, cards: [] });
                notes.get(card.note_id).cards.push(card);
            });
            els.deckStats.textContent = `${notes.size} 个句子 · ${data.cards.length} 张卡片${q ? '（搜索结果）' : ''}`;
            els.deckList.innerHTML = notes.size ? Array.from(notes.values()).map(({ note, cards }) => `
                <article class="deck-note">
                    <div class="deck-note-text">
                        <p class="deck-note-fr">${escapeHtml(note.sentence)}
                            <button class="icon-btn btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="1" title="播放"><i data-lucide="volume-2"></i></button>
                        </p>
                        ${note.translation_zh ? `<p class="deck-note-zh">${escapeHtml(note.translation_zh)}</p>` : ''}
                    </div>
                    <div class="deck-note-cards">
                        ${cards.map(card => `
                            <span class="deck-card-chip mode-${card.mode}">
                                <i data-lucide="${(MODE_INFO[card.mode] || MODE_INFO.listen).icon}"></i>
                                ${MODE_INFO[card.mode] ? MODE_INFO[card.mode].label : card.mode}${card.target ? `：${escapeHtml(card.target)}` : ''}
                                <em>${STATE_LABELS[card.state] || ''} · ${dueLabel(card)}</em>
                                <button class="chip-delete" type="button" data-card-id="${escapeHtml(card.id)}" title="删除这张卡">×</button>
                            </span>`).join('')}
                    </div>
                </article>`).join('') : '<p class="deck-empty">还没有卡片。在「拆解与复述」页点「加入复习」或单词旁的 ⭐。</p>';
            refreshIcons();
        } catch (err) {
            showError(err.message);
        }
    }

    // ---------------------------------------------------------------------
    // Login state
    // ---------------------------------------------------------------------
    function showLoginRequired() {
        els.loginRequired.hidden = false;
        [els.summary, els.stage, els.done, els.browser, els.legacyImport].forEach(el => { el.hidden = true; });
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    document.addEventListener('click', (e) => {
        const play = e.target.closest('.btn-play');
        if (play) {
            playFrench(play.dataset.speech, parseFloat(play.dataset.rate || '1'));
            return;
        }
        const del = e.target.closest('.chip-delete');
        if (del) {
            api('DELETE', `/api/srs/cards/${encodeURIComponent(del.dataset.cardId)}`)
                .then(renderBrowser)
                .catch(err => showError(err.message));
        }
    });

    els.revealBtn.addEventListener('click', () => {
        if (session.current && session.current.mode === 'cloze') {
            checkCloze(session.current);
        } else {
            reveal();
        }
    });

    els.gradeButtons.forEach(btn => {
        btn.addEventListener('click', () => grade(Number(btn.dataset.rating)));
    });

    document.addEventListener('keydown', (e) => {
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
        if (typing || !session.current || els.stage.hidden) return;
        if (e.code === 'Space' && !session.revealed) {
            e.preventDefault();
            els.revealBtn.click();
        } else if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            grade(Number(e.key));
        } else if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            const card = session.current;
            playFrench(card.mode === 'recognize' && !session.revealed ? card.target : card.note.sentence);
        }
    });

    els.toggleBrowserBtn.addEventListener('click', () => {
        if (!getToken()) return;
        els.browser.hidden = !els.browser.hidden;
        if (!els.browser.hidden) {
            renderBrowser();
            els.browser.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    els.deckSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderBrowser, 250);
    });

    els.newLimitSelect.value = String(getNewLimit());
    els.newLimitSelect.addEventListener('change', () => {
        localStorage.setItem(NEW_LIMIT_KEY, els.newLimitSelect.value);
        if (getToken()) loadQueue().catch(err => showError(err.message));
    });

    // ---------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------
    refreshIcons();
    window.addEventListener('load', refreshIcons);
    if (!getToken()) {
        showLoginRequired();
        return;
    }
    setupLegacyImport();
    loadQueue().catch(err => showError(err.message));
})();
