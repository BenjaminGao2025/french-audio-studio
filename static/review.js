/* ==========================================================================
   French Audio Studio - Daily Review (/review)
   Active recall on sentence cards scheduled server-side with FSRS:
     listen    - hear the sentence without text, recall the meaning
     speak     - see the Chinese meaning, say the French (speech recognition scores it)
     cloze     - type the missing chunk back into the sentence
     recognize - legacy word card: see the word, recall the meaning
     grammar   - apply a grammar point: fill the blank in a new example sentence
   ========================================================================== */

(function () {
    'use strict';

    const TOKEN_KEY = 'frenchStudio.userToken';
    const NEW_LIMIT_KEY = 'frenchStudio.srs.newLimit';
    const MIN_IMPORTANCE_KEY = 'frenchStudio.srs.minImportance';
    const LEGACY_DECK_KEY = 'frenchStudio.ankiDeck';
    const LEGACY_IMPORTED_KEY = 'frenchStudio.ankiDeck.importedAt';
    const LEARN_AHEAD_MS = 20 * 60 * 1000;
    const VOICE = 'fr-FR-DeniseNeural';
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;


    const I18N = window.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const pick = I18N.pick;

    const TEXT = {
        en: {
            pageTitle: "Today's Review - 1000H French",
            heading: "Today's Review",
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navReview: 'Review', navListen: 'Listen',
            newLimit: 'New / day', newLimitTitle: 'Maximum number of new cards introduced per day',
            priority: 'Priority', priorityTitle: 'Only review cards at least this important',
            priorityAll: 'All', importanceTitle: (n) => `Importance ${n} of 5`,
            library: 'Card library',
            loginTitle: 'Your cards are saved on the server. Please log in first.',
            loginDesc: 'Once you log in, your phone and computer share the same cards and progress.',
            loginBtn: 'Log in',
            legacyBefore: 'This browser still has', legacyAfter: 'old word cards',
            legacyDesc: 'Importing turns them into new review cards: a word that appears in its example sentence becomes a fill-in card, the rest become recall cards. The old data is not deleted.',
            import: 'Import', notNow: 'Not now',
            countLearning: 'learning', countReview: 'review', countNew: 'new',
            countLearningTitle: 'Just learned: comes back in a few minutes',
            countReviewTitle: 'Due for review', countNewTitle: 'New cards introduced today',
            progressAria: "Today's progress",
            reveal: 'Show answer', spaceKey: 'Enter · Space',
            gradeHint: 'How hard was it to remember?',
            rating1: 'Again', rating2: 'Hard', rating3: 'Good', rating4: 'Easy',
            doneDefault: 'Done for today', doneDefaultDesc: 'Spaced repetition brings each card back just before you would forget it.',
            studyNew: 'Study new sentences',
            searchPlaceholder: 'Search sentences, words or meanings',
            modeListen: 'Listen', taskListen: 'Listen without reading. Say the meaning to yourself, then show the answer.',
            modeSpeak: 'Speak', taskSpeak: 'Say the whole sentence in French. It does not have to be perfect: try first, then check.',
            modeCloze: 'Fill in', taskCloze: 'Type the missing French.',
            modeRecognize: 'Recall', taskRecognize: 'Think of what this word means, then show the answer.',
            modeGrammar: 'Grammar', taskGrammar: 'Use the grammar rule to fill in the blank in a new sentence.',
            stateNew: 'New', stateLearning: 'Learning', stateRelearning: 'Relearning', stateReview: 'Review',
            sessionExpired: 'Your login has expired. Please log in again.',
            requestFailed: (status) => `Request failed (HTTP ${status})`,
            play: 'Play', slow: 'Slow', pronounce: 'Pronounce',
            noAsr: 'This browser has no speech recognition (Chrome, Edge and Safari do). Say it out loud, then show the answer to compare.',
            speakFrench: 'Speak French', doneTapToScore: 'Done, tap to score', tryAgain: 'Try again', myRecording: 'My recording',
            points: '/100', heard: 'Heard: ', nothingHeard: '(no voice detected)',
            correct: 'Correct!', accentsOnly: 'Right, but check the accents', veryClose: 'Very close, check the spelling',
            notQuite: 'Not quite', noAnswer: 'No answer', youWrote: 'You wrote: ', answer: 'Answer: ',
            playSentence: 'Play the sentence', slowReplay: 'Slow replay',
            noTranslation: '(No translation yet)', showEnglish: 'Show English', showInitials: 'Show first letters',
            blankMeans: 'Blank means: ', rule: 'Rule: ', hint: 'Hint: ',
            clozePlaceholder: 'Type the missing French here', check: 'Check',
            memoryHook: 'Memory hook: ', originLabel: 'The sentence you studied', playOriginal: 'Play the original sentence',
            baseForm: 'base form ', grammarNotes: (n) => `Grammar notes (${n})`,
            suggestion: (name) => ` (based on your answer: "${name}")`,
            saveFailed: 'Could not save the rating: ',
            doneCount: (n) => `Done for today: ${n} reviews`, nothingDue: 'Nothing to review right now',
            doneDesc: 'Spaced repetition brings each card back just before you would forget it. See you tomorrow.',
            emptyDesc: 'Go to Study, learn a few new sentences and tap "Add to review". They will show up here.',
            imported: (n) => `Imported ${n} cards. They will appear gradually, within your daily new-card limit.`,
            importFailed: 'Import failed: ',
            notStarted: 'not started', dueNow: 'due', dueIn: (t) => `in ${t}`,
            deckStats: (notes, cards, searching) => `${notes} sentences · ${cards} cards${searching ? ' (search results)' : ''}`,
            deleteCard: 'Delete this card',
            deckEmpty: 'No cards yet. On the Study page, tap "Add to review" or the star next to a word.',
            interval: (s) => s < 60 ? '<1 min' : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h`
                : s < 30 * 86400 ? `${Math.round(s / 86400)} d` : s < 365 * 86400 ? `${(s / 2592000).toFixed(1).replace(/\.0$/, '')} mo`
                : `${(s / 31536000).toFixed(1).replace(/\.0$/, '')} y`,
        },
        zh: {
            pageTitle: '今日复习 - 1000H French',
            heading: '今日复习',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navReview: '今日复习', navListen: '开车听',
            newLimit: '每天新卡', newLimitTitle: '每天最多引入多少张新卡',
            priority: '重点', priorityTitle: '只复习重要度不低于所选星级的卡片',
            priorityAll: '全部', importanceTitle: (n) => `重要度 ${n} / 5`,
            library: '卡片库',
            loginTitle: '复习卡片保存在服务器上，请先登录',
            loginDesc: '登录后，手机和电脑看到的是同一套卡片和复习进度。',
            loginBtn: '去登录',
            legacyBefore: '这个浏览器里还有', legacyAfter: '张旧生词卡',
            legacyDesc: '导入后会变成新的复习卡：词在例句里的，变成「填空」卡；其余变成「认词」卡。旧数据不会删除。',
            import: '导入', notNow: '暂不',
            countLearning: '学习中', countReview: '复习', countNew: '新卡',
            countLearningTitle: '刚学、几分钟后要再见一次的卡',
            countReviewTitle: '到期该复习的卡', countNewTitle: '今天新引入的卡',
            progressAria: '今日进度',
            reveal: '显示答案', spaceKey: 'Enter · 空格',
            gradeHint: '刚才想起来有多难？',
            rating1: '重来', rating2: '困难', rating3: '良好', rating4: '简单',
            doneDefault: '今天的复习完成了', doneDefaultDesc: '间隔重复会在你快要忘记的时候再把卡片送回来。',
            studyNew: '去学新句子',
            searchPlaceholder: '搜索句子、词或中文意思',
            modeListen: '听', taskListen: '只听，不看文字。心里（或小声）说出它的中文意思，然后看答案。',
            modeSpeak: '说', taskSpeak: '看着中文，用法语把整句说出来。说不全也没关系，先说再看答案。',
            modeCloze: '填', taskCloze: '把空格里的法语写出来。',
            modeRecognize: '认', taskRecognize: '想一想这个词是什么意思，然后看答案。',
            modeGrammar: '语法', taskGrammar: '用这条语法规则，把新句子里的空填出来。',
            stateNew: '新卡', stateLearning: '学习中', stateRelearning: '重新学习', stateReview: '复习',
            sessionExpired: '登录已失效，请重新登录。',
            requestFailed: (status) => `请求失败（HTTP ${status}）`,

            play: '播放', slow: '慢速', pronounce: '发音',
            noAsr: '这个浏览器不支持语音识别（Chrome / Edge / Safari 支持）。请大声说出来，再点「显示答案」对照。',
            speakFrench: '开口说法语', doneTapToScore: '说完了，点这里评分', tryAgain: '再说一次', myRecording: '我的录音',
            points: '分', heard: '识别到：', nothingHeard: '（没有识别到声音）',
            correct: '完全正确', accentsOnly: '对了，但注意重音符号', veryClose: '很接近，拼写有出入',
            notQuite: '不对', noAnswer: '没有作答', youWrote: '你写的：', answer: '答案：',
            playSentence: '播放句子', slowReplay: '慢速再听',
            noTranslation: '（这句还没有中文翻译）', showEnglish: '看英文提示', showInitials: '看首字母提示',
            blankMeans: '空格的意思：', rule: '规则：', hint: '提示：',
            clozePlaceholder: '在这里输入缺的法语', check: '检查',
            memoryHook: '记忆钩子：', originLabel: '你学过的原句', playOriginal: '播放原句',
            baseForm: '原形 ', grammarNotes: (n) => `这句的语法要点（${n}）`,
            suggestion: (name) => `（按你的作答，建议「${name}」）`,
            saveFailed: '保存评分失败：',
            doneCount: (n) => `今天的复习完成了，共 ${n} 次`, nothingDue: '现在没有要复习的卡片',
            doneDesc: '间隔重复会在你快要忘记的时候再把卡片送回来。明天再来。',
            emptyDesc: '去「拆解与复述」学几句新句子，点「加入复习」，它们就会出现在这里。',
            imported: (n) => `已导入 ${n} 张卡片。它们会按每天新卡上限逐步出现。`,
            importFailed: '导入失败：',
            notStarted: '未开始', dueNow: '已到期', dueIn: (t) => `${t}后`,
            deckStats: (notes, cards, searching) => `${notes} 个句子 · ${cards} 张卡片${searching ? '（搜索结果）' : ''}`,
            deleteCard: '删除这张卡',
            deckEmpty: '还没有卡片。在「拆解与复述」页点「加入复习」或单词旁的 ⭐。',
            interval: (s) => s < 60 ? '<1分钟' : s < 3600 ? `${Math.round(s / 60)}分钟` : s < 86400 ? `${Math.round(s / 3600)}小时`
                : s < 30 * 86400 ? `${Math.round(s / 86400)}天` : s < 365 * 86400 ? `${(s / 2592000).toFixed(1).replace(/\.0$/, '')}个月`
                : `${(s / 31536000).toFixed(1).replace(/\.0$/, '')}年`,
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];

    const MODE_INFO = {
        listen: { icon: 'headphones', label: T.modeListen, task: T.taskListen },
        speak: { icon: 'mic', label: T.modeSpeak, task: T.taskSpeak },
        cloze: { icon: 'pencil-line', label: T.modeCloze, task: T.taskCloze },
        recognize: { icon: 'eye', label: T.modeRecognize, task: T.taskRecognize },
        grammar: { icon: 'puzzle', label: T.modeGrammar, task: T.taskGrammar },
    };
    const STATE_LABELS = { new: T.stateNew, learning: T.stateLearning, relearning: T.stateRelearning, review: T.stateReview };
    const RATING_NAMES = { 1: T.rating1, 2: T.rating2, 3: T.rating3, 4: T.rating4 };

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
        minImportanceSelect: $('min-importance-select'),
        cardImportance: $('card-importance'),
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
        scoring: false,
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

    function getMinImportance() {
        const saved = parseInt(localStorage.getItem(MIN_IMPORTANCE_KEY) || '', 10);
        return saved >= 1 && saved <= 5 ? saved : 1;
    }

    function renderImportance(card) {
        els.cardImportance.querySelectorAll('button[data-level]').forEach(btn => {
            const n = Number(btn.dataset.level);
            btn.classList.toggle('filled', n <= (card.importance || 3));
            btn.title = T.importanceTitle(n);
        });
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
            try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
            showLoginRequired();
            throw new Error(T.sessionExpired);
        }
        if (!res.ok) {
            throw new Error(data.detail?.message || T.requestFailed(res.status));
        }
        return data;
    }

    function formatInterval(seconds) {
        return T.interval(seconds);
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

    // Whole-word, case-insensitive match (so "en" does not blank the inside of "prends")
    // Align the typed answer with the correct one letter by letter (edit distance with backtrace).
    // Every mistake is marked on the learner's line: bad = wrong/extra letter, gap = a letter is
    // missing here, accent = only the accent differs. The answer line stays neutral and only
    // highlights (fix) the letters the learner has to change or add.
    function letterDiff(typed, answer) {
        const a = Array.from(typed.trim());
        const b = Array.from(answer.trim());
        const norm = (ch) => ch.toLowerCase().replace(/[\u2019\u02bc]/g, "'");
        const cost = (x, y) => (norm(x) === norm(y) ? 0 : stripAccents(norm(x)) === stripAccents(norm(y)) ? 0.5 : 1);
        const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost(a[i - 1], b[j - 1]));
            }
        }
        const typedParts = [];
        const answerParts = [];
        let i = a.length;
        let j = b.length;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + cost(a[i - 1], b[j - 1])) {
                const c = cost(a[i - 1], b[j - 1]);
                typedParts.unshift([a[i - 1], c === 0 ? 'ok' : c === 0.5 ? 'accent' : 'bad']);
                answerParts.unshift([b[j - 1], c === 0 ? 'ok' : 'fix']);
                i--; j--;
            } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
                typedParts.unshift([a[i - 1], 'bad']);
                i--;
            } else {
                typedParts.unshift(['_', 'gap']);
                answerParts.unshift([b[j - 1], 'fix']);
                j--;
            }
        }
        const render = (parts) => parts.map(([ch, cls]) => `<span class="ch-${cls}">${escapeHtml(ch === ' ' ? '\u00a0' : ch)}</span>`).join('');
        return { typed: render(typedParts), answer: render(answerParts) };
    }

    function splitAroundTarget(sentence, target) {
        const t = (target || '').trim();
        if (!t || !sentence) return null;
        const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const start = /^[\p{L}\d]/u.test(t) ? '(?<![\\p{L}\\d])' : '';
        const end = /[\p{L}\d]$/u.test(t) ? '(?![\\p{L}\\d])' : '';
        const match = new RegExp(start + escaped + end, 'iu').exec(sentence);
        if (!match) return null;
        return [sentence.slice(0, match.index), match[0], sentence.slice(match.index + match[0].length)];
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
        if (window.FrenchPlayback) window.FrenchPlayback.setActive(false);
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    function cardSpeech(card) {
        if (card.mode === 'recognize') return card.target;
        if (card.mode === 'grammar') return (card.target_meta && card.target_meta.full_fr) || card.note.sentence;
        return card.note.sentence;
    }

    // French text with every word wrapped so a tap reads it aloud
    function clickableFr(text) {
        return String(text || '')
            .split(/([A-Za-zÀ-ÖØ-öø-ÿŒœ0-9]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)*)/)
            .map((part, i) => (i % 2
                ? `<span class="fr-word" data-speech="${escapeHtml(part)}">${escapeHtml(part)}</span>`
                : escapeHtml(part)))
            .join('');
    }

    // Word popover and word book shared with the study page (static/word-popover.js):
    // the same star (add to / remove from review) and importance stars.
    const wordBook = window.FrenchWordPopover.createWordBook({
        getToken: () => getToken(),
        notePayload(sentence) {
            const note = session.current && session.current.note;
            if (!note || note.sentence !== sentence) return { sentence };
            return { sentence, translation_zh: note.translation_zh || '', translation_en: note.translation_en || '', extra: note.extra || {} };
        },
        onChange: () => wordPopover.refreshSaved(),
        onError: (err) => showError(err.message),
    });

    // The card's own target word already carries its meaning, so it shows instantly.
    const wordPopover = window.FrenchWordPopover.create({
        speak: (text) => playFrench(text, 1, { once: true }),
        getAuthToken: () => getToken(),
        wordSelector: '.fr-word',
        localLookup(lower) {
            const card = session.current;
            const meta = (card && card.target_meta) || {};
            if (!card || !card.target || card.target.toLowerCase() !== lower) return null;
            if (!meta.meaning_en && !meta.meaning_zh) return null;
            return { lemma: meta.lemma, pos: meta.pos, phonetic: meta.ipa, explanation_en: meta.meaning_en, explanation_cn: meta.meaning_zh };
        },
        saving: wordBook.popoverSaving,
    });

    function ttsUrl(text) {
        return `/tts?text=${encodeURIComponent(text.trim())}&voice=${VOICE}`;
    }

    // With Repeat on (playback.js) the same text plays again until stopped; word lookups play once
    function playFrench(text, rate = 1, options = {}) {
        if (!text) return;
        stopAudio();
        const repeat = !options.once && window.FrenchPlayback && window.FrenchPlayback.repeat();
        const audio = new Audio(ttsUrl(text));
        audio.playbackRate = rate;
        currentAudio = audio;
        if (repeat) {
            window.FrenchPlayback.setActive(true, stopAudio);
            audio.addEventListener('ended', () => {
                setTimeout(() => {
                    if (currentAudio !== audio) return;
                    if (!window.FrenchPlayback.repeat()) {  // Repeat was switched off meanwhile
                        stopAudio();
                        return;
                    }
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                }, 800);
            });
        }
        audio.play().catch((err) => {
            // Interrupted by another play/stop: do not fall back to reading the old text.
            if (currentAudio !== audio || (err && err.name === 'AbortError')) return;
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'fr-FR';
                utterance.rate = rate;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utterance);
            }
        });
    }

    function audioButtons(text, label = T.play) {
        return `
            <div class="audio-buttons">
                <button class="btn btn-secondary btn-play" type="button" data-speech="${escapeHtml(text)}" data-rate="1">
                    <i data-lucide="volume-2"></i><span>${label}</span> <kbd>R</kbd>
                </button>
                <button class="btn btn-secondary btn-play" type="button" data-speech="${escapeHtml(text)}" data-rate="0.75">
                    <i data-lucide="snail"></i><span>${T.slow}</span>
                </button>
                ${window.FrenchPlayback ? window.FrenchPlayback.toggleHtml() : ''}
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
                <p class="attempt-note">${T.noAsr}</p>`;
            return;
        }
        els.attemptArea.innerHTML = `
            <button id="record-btn" class="btn btn-record" type="button">
                <i data-lucide="mic"></i><span class="record-label">${T.speakFrench}</span>
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
                    holder.innerHTML = `<span>${T.myRecording}</span><audio controls src="${url}"></audio>`;
                    holder.hidden = false;
                };
                state.mediaRecorder.start();
            } catch (err) {
                console.warn('Recording unavailable:', err);
            }
            recognition.start();
            recorder = state;
            recordBtn.classList.add('recording');
            recordBtn.querySelector('.record-label').textContent = T.doneTapToScore;
        });
    }

    function finishSpeaking(card) {
        const state = recorder;
        stopRecorder();
        session.scoring = true;
        const recordBtn = $('record-btn');
        if (recordBtn) {
            recordBtn.classList.remove('recording');
            recordBtn.querySelector('.record-label').textContent = T.tryAgain;
        }
        // Give the recognizer a moment to deliver its final result.
        setTimeout(() => {
            session.scoring = false;
            if (session.current !== card || session.revealed) return;
            const transcript = state ? state.transcript : '';
            const evaluation = window.SpeechEval.evaluateFrenchPronunciation(card.note.sentence, transcript);
            session.attempt = {
                answer: transcript,
                score: evaluation.overallScore,
                suggested: evaluation.overallScore >= 85 ? 3 : evaluation.overallScore >= 60 ? 2 : 1,
                html: `
                    <div class="attempt-result">
                        <div class="attempt-score score-${evaluation.ratingClass}">${evaluation.overallScore}<small>${T.points}</small></div>
                        <div>
                            <div class="diff-words">${evaluation.wordResults.map(w =>
                                `<span class="diff-word ${w.status}">${escapeHtml(w.word)}</span>`).join(' ')}</div>
                            <p class="attempt-heard">${T.heard}${escapeHtml(transcript || T.nothingHeard)}</p>
                        </div>
                    </div>`,
            };
            if (session.attempt.suggested >= 3 && window.FrenchGame) window.FrenchGame.onCorrect();
            reveal();
        }, 600);
    }

    // ---------------------------------------------------------------------
    // Cloze attempt
    // ---------------------------------------------------------------------
    function checkCloze(card) {
        const input = $('cloze-input');
        const typed = input ? input.value : '';
        const answer = card.mode === 'grammar' ? ((card.target_meta && card.target_meta.answer) || '') : card.target;
        const expected = normalizeAnswer(answer);
        const given = normalizeAnswer(typed);
        let verdict;
        let suggested;
        if (given && given === expected) {
            verdict = { cls: 'correct', text: T.correct };
            suggested = 3;
        } else if (given && stripAccents(given) === stripAccents(expected)) {
            verdict = { cls: 'close', text: T.accentsOnly };
            suggested = 2;
        } else if (given && window.SpeechEval.calculateLevenshteinSimilarity(given, expected) >= 0.7) {
            verdict = { cls: 'close', text: T.veryClose };
            suggested = 2;
        } else {
            verdict = { cls: 'wrong', text: given ? T.notQuite : T.noAnswer };
            suggested = 1;
        }
        const diff = given ? letterDiff(typed, answer) : null;
        session.attempt = {
            answer: typed,
            score: null,
            suggested,
            html: `
                <div class="attempt-result cloze-result ${verdict.cls}">
                    <strong>${verdict.text}</strong>
                    ${diff ? `<span>${T.youWrote}<b class="letter-diff">${diff.typed}</b></span>` : ''}
                    <span>${T.answer}<b class="letter-diff is-answer fr-word" data-speech="${escapeHtml(answer)}">${diff ? diff.answer : escapeHtml(answer)}</b></span>
                </div>`,
        };
        if (suggested >= 3 && window.FrenchGame) window.FrenchGame.onCorrect();
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
                    <button class="btn-listen-big btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="1" aria-label="${T.playSentence}">
                        <i data-lucide="volume-2"></i>
                    </button>
                    <button class="btn btn-secondary btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="0.75">
                        <i data-lucide="snail"></i><span>${T.slowReplay}</span>
                    </button>
                </div>`;
        } else if (card.mode === 'speak') {
            html += `
                <div class="speak-prompt">
                    <p class="prompt-zh">${escapeHtml(pick(note.translation_zh, note.translation_en) || T.noTranslation)}</p>
                    ${!EN && note.translation_zh && note.translation_en ? `
                        <details class="prompt-hint"><summary>${T.showEnglish}</summary><p>${escapeHtml(note.translation_en)}</p></details>` : ''}
                    <details class="prompt-hint"><summary>${T.showInitials}</summary><p class="initials">${escapeHtml(initialsHint(note.sentence))}</p></details>
                </div>`;
        } else if (card.mode === 'cloze') {
            const parts = splitAroundTarget(note.sentence, card.target);
            const width = Math.max(4, card.target.length);
            const sentenceHtml = parts
                ? `${clickableFr(parts[0])}<span class="cloze-blank" style="min-width:${width}ch">?</span>${clickableFr(parts[2])}`
                : `<span class="cloze-blank" style="min-width:${width}ch">?</span>`;
            const clue = pick(meta.meaning_zh, meta.meaning_en);
            html += `
                <div class="cloze-prompt">
                    <p class="prompt-fr">${sentenceHtml}</p>
                    ${pick(note.translation_zh, note.translation_en) ? `<p class="prompt-sub">${escapeHtml(pick(note.translation_zh, note.translation_en))}</p>` : ''}
                    ${clue ? `<p class="prompt-clue">${T.blankMeans}${escapeHtml(clue)}</p>` : ''}
                    <details class="prompt-hint"><summary>${T.showInitials}</summary><p class="initials">${escapeHtml(initialsHint(card.target))}</p></details>
                </div>`;
        } else if (card.mode === 'grammar') {
            const [before, after] = (meta.prompt_fr || '____').split('____');
            const width = Math.max(4, (meta.answer || '').length);
            html += `
                <div class="cloze-prompt">
                    <p class="grammar-rule-pill">${T.rule}${escapeHtml(card.target)}</p>
                    <p class="prompt-fr">${clickableFr(before)}<span class="cloze-blank" style="min-width:${width}ch">?</span>${clickableFr(after)}</p>
                    ${meta.full_en ? `<p class="prompt-sub">${escapeHtml(meta.full_en)}</p>` : ''}
                    ${meta.hint ? `<p class="prompt-clue">${T.hint}${escapeHtml(meta.hint)}</p>` : ''}
                </div>`;
        } else {
            html += `
                <div class="recognize-prompt">
                    <p class="prompt-word">${clickableFr(card.target)}</p>
                    ${meta.ipa ? `<p class="prompt-sub">${escapeHtml(window.SpeechEval.formatFriendlyPhonetic(meta.ipa))}</p>` : ''}
                    ${audioButtons(card.target, T.pronounce)}
                </div>`;
        }
        els.promptArea.innerHTML = html;

        els.attemptArea.innerHTML = '';
        if (card.mode === 'speak') {
            renderSpeakAttempt(card);
        } else if (card.mode === 'cloze' || card.mode === 'grammar') {
            els.attemptArea.innerHTML = `
                <form id="cloze-form" class="cloze-form" autocomplete="off">
                    <input id="cloze-input" type="text" maxlength="200" placeholder="${T.clozePlaceholder}" autocapitalize="off" spellcheck="false">
                    <button class="btn btn-primary" type="submit">${T.check} <kbd>Enter</kbd></button>
                </form>`;
            $('cloze-form').addEventListener('submit', (e) => {
                e.preventDefault();
                checkCloze(card);
            });
            setTimeout(() => { const input = $('cloze-input'); if (input) input.focus(); }, 50);
        }
    }

    function renderGrammarAnswer(card) {
        const note = card.note;
        const meta = card.target_meta || {};
        const [before, after] = (meta.prompt_fr || '').split('____');
        els.answerArea.innerHTML = `
            ${session.attempt ? session.attempt.html : ''}
            <div class="answer-sentence">
                <p class="answer-fr">${clickableFr(before)}<mark>${clickableFr(meta.answer)}</mark>${clickableFr(after)}</p>
                ${audioButtons(meta.full_fr || '')}
                ${meta.full_en ? `<p class="answer-en">${escapeHtml(meta.full_en)}</p>` : ''}
            </div>
            <div class="answer-target">
                <strong>${escapeHtml(card.target)}</strong>
                ${meta.rule ? `<p>${escapeHtml(meta.rule)}</p>` : ''}
                ${meta.hook ? `<p class="target-hook">${T.memoryHook}${escapeHtml(meta.hook)}</p>` : ''}
            </div>
            <div class="answer-origin">
                <span class="origin-label">${T.originLabel}</span>
                <p class="answer-fr origin-fr">${clickableFr(note.sentence)}
                    <button class="icon-btn btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="1" title="${T.playOriginal}"><i data-lucide="volume-2"></i></button>
                </p>
                ${pick(note.translation_zh, note.translation_en) ? `<p class="answer-en">${escapeHtml(pick(note.translation_zh, note.translation_en))}</p>` : ''}
            </div>`;
    }

    function renderAnswer(card) {
        if (card.mode === 'grammar') {
            renderGrammarAnswer(card);
            return;
        }
        const note = card.note;
        const meta = card.target_meta || {};
        const parts = card.target ? splitAroundTarget(note.sentence, card.target) : null;
        const sentenceHtml = parts
            ? `${clickableFr(parts[0])}<mark>${clickableFr(parts[1])}</mark>${clickableFr(parts[2])}`
            : clickableFr(note.sentence);
        const grammar = (note.extra && note.extra.grammar) || [];
        const metaBits = [meta.pos, meta.lemma && meta.lemma !== card.target ? `${T.baseForm}${meta.lemma}` : '', window.SpeechEval.formatFriendlyPhonetic(meta.ipa)].filter(Boolean);

        els.answerArea.innerHTML = `
            ${session.attempt ? session.attempt.html : ''}
            <div class="answer-sentence">
                <p class="answer-fr">${sentenceHtml}</p>
                ${audioButtons(note.sentence)}
                ${EN
                    ? (pick(note.translation_zh, note.translation_en) ? `<p class="answer-zh">${escapeHtml(pick(note.translation_zh, note.translation_en))}</p>` : '')
                    : `${note.translation_zh ? `<p class="answer-zh">${escapeHtml(note.translation_zh)}</p>` : ''}
                       ${note.translation_en ? `<p class="answer-en">${escapeHtml(note.translation_en)}</p>` : ''}`}
            </div>
            ${card.target ? `
                <div class="answer-target">
                    <strong>${clickableFr(card.target)}</strong>
                    ${metaBits.length ? `<span class="target-meta">${metaBits.map(escapeHtml).join(' · ')}</span>` : ''}
                    ${EN
                        ? (pick(meta.meaning_zh, meta.meaning_en) ? `<p>${escapeHtml(pick(meta.meaning_zh, meta.meaning_en))}</p>` : '')
                        : `${meta.meaning_zh ? `<p>${escapeHtml(meta.meaning_zh)}</p>` : ''}
                           ${meta.meaning_en ? `<p class="answer-en">${escapeHtml(meta.meaning_en)}</p>` : ''}`}
                    ${meta.hook ? `<p class="target-hook">${T.memoryHook}${escapeHtml(meta.hook)}</p>` : ''}
                </div>` : ''}
            ${grammar.length ? `
                <details class="answer-grammar">
                    <summary>${T.grammarNotes(grammar.length)}</summary>
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
        wordPopover.close();
        session.revealed = false;
        session.attempt = null;
        session.scoring = false;
        session.startedAt = Date.now();

        const info = MODE_INFO[card.mode] || MODE_INFO.listen;
        els.modeBadge.className = `mode-badge mode-${card.mode}`;
        els.modeBadge.innerHTML = `<i data-lucide="${info.icon}"></i><span>${info.label}</span>`;
        els.cardState.textContent = STATE_LABELS[card.state] || '';
        renderImportance(card);

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
        if (!card || session.revealed || session.scoring) return;
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
            ? T.suggestion(RATING_NAMES[session.attempt.suggested])
            : '';
        els.gradeRow.hidden = false;
        refreshIcons();

        if (card.mode === 'speak' || card.mode === 'cloze' || card.mode === 'grammar') playFrench(cardSpeech(card));
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
                answer: session.attempt ? ((session.attempt.answer || '').slice(0, 500) || null) : null,
                tz_offset: new Date().getTimezoneOffset(),
            });
            if (window.FrenchGame) window.FrenchGame.onReview(updated.game);
            session.reviewed += 1;
            if ((updated.state === 'learning' || updated.state === 'relearning')
                && Date.parse(updated.due) - Date.now() <= LEARN_AHEAD_MS) {
                session.learning.push(updated);
                session.total += 1;
            }
            showError('');
            showNext();
        } catch (err) {
            showError(T.saveFailed + err.message);
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
            els.doneTitle.textContent = session.reviewed ? T.doneCount(session.reviewed) : T.nothingDue;
            els.doneDetail.textContent = session.reviewed
                ? T.doneDesc
                : T.emptyDesc;
            // Today's queue is gone: that is a cleared wave (once a day), plus the match summary
            if (session.reviewed && window.FrenchGame) window.FrenchGame.onWaveCleared(els.done);
            refreshIcons();
            return;
        }
        els.done.hidden = true;
        renderCard(card);
        const upcoming = session.queue[0];
        if (upcoming) {
            fetch(ttsUrl(cardSpeech(upcoming))).catch(() => {});
        }
    }

    async function loadQueue() {
        showError('');
        const data = await api('GET', `/api/srs/queue?tz_offset=${new Date().getTimezoneOffset()}&new_limit=${getNewLimit()}&min_importance=${getMinImportance()}`);
        const now = Date.now();
        const notYetDue = c => (c.state === 'learning' || c.state === 'relearning') && Date.parse(c.due) > now;
        session.queue = (data.cards || []).filter(c => !notYetDue(c));
        session.learning = (data.cards || []).filter(notYetDue);
        session.reviewed = 0;
        session.total = session.queue.length + session.learning.length;
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
                els.legacyImport.innerHTML = `<p>${T.imported(result.imported)}</p>`;
                await loadQueue();
            } catch (err) {
                showError(T.importFailed + err.message);
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
        if (card.state === 'new') return T.notStarted;
        const seconds = (Date.parse(card.due) - Date.now()) / 1000;
        return seconds <= 0 ? T.dueNow : T.dueIn(formatInterval(seconds));
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
            els.deckStats.textContent = T.deckStats(notes.size, data.cards.length, Boolean(q));
            els.deckList.innerHTML = notes.size ? Array.from(notes.values()).map(({ note, cards }) => `
                <article class="deck-note">
                    <div class="deck-note-text">
                        <p class="deck-note-fr" data-sentence="${escapeHtml(note.sentence)}">${clickableFr(note.sentence)}
                            <button class="icon-btn btn-play" type="button" data-speech="${escapeHtml(note.sentence)}" data-rate="1" title="${T.play}"><i data-lucide="volume-2"></i></button>
                        </p>
                        ${pick(note.translation_zh, note.translation_en) ? `<p class="deck-note-zh">${escapeHtml(pick(note.translation_zh, note.translation_en))}</p>` : ''}
                    </div>
                    <div class="deck-note-cards">
                        ${cards.map(card => `
                            <span class="deck-card-chip mode-${card.mode}">
                                <i data-lucide="${(MODE_INFO[card.mode] || MODE_INFO.listen).icon}"></i>
                                ${MODE_INFO[card.mode] ? MODE_INFO[card.mode].label : card.mode}${card.target ? `：${escapeHtml(card.target)}` : ''} ${'★'.repeat(card.importance || 3)}
                                <em>${STATE_LABELS[card.state] || ''} · ${dueLabel(card)}</em>
                                <button class="chip-delete" type="button" data-card-id="${escapeHtml(card.id)}" title="${T.deleteCard}">×</button>
                            </span>`).join('')}
                    </div>
                </article>`).join('') : `<p class="deck-empty">${T.deckEmpty}</p>`;
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
        const word = e.target.closest('.fr-word');
        if (word) {
            // A word in the card library belongs to that row's sentence, otherwise to the current card
            const row = word.closest('[data-sentence]');
            const card = session.current;
            const sentence = row ? row.dataset.sentence : (card && card.note ? card.note.sentence : '');
            wordPopover.show(word.dataset.speech, word, { sentence });
            return;
        }
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
        if (session.current && (session.current.mode === 'cloze' || session.current.mode === 'grammar')) {
            checkCloze(session.current);
        } else {
            reveal();
        }
    });

    els.gradeButtons.forEach(btn => {
        btn.addEventListener('click', () => grade(Number(btn.dataset.rating)));
    });

    document.addEventListener('keydown', (e) => {
        if (!session.current || els.stage.hidden) return;
        // Enter continues: it shows the answer, then takes the suggested rating (Good if none),
        // also from the fill-in box once the answer has been checked
        if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && !e.target.closest('.floating-word-popover, .game-panel, .btn-grade')) {
            const inClozeBox = e.target.id === 'cloze-input';
            if (session.revealed && !session.grading) {
                e.preventDefault();
                grade((session.attempt && session.attempt.suggested) || 3);
                return;
            }
            if (!inClozeBox && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(e.target.tagName)) {
                e.preventDefault();
                els.revealBtn.click();
                return;
            }
        }
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
        if (typing) return;
        if (e.code === 'Space' && !session.revealed) {
            e.preventDefault();
            els.revealBtn.click();
        } else if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            grade(Number(e.key));
        } else if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            const card = session.current;
            playFrench(card.mode === 'grammar' && !session.revealed ? '' : cardSpeech(card));
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

    els.cardImportance.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-level]');
        const card = session.current;
        if (!btn || !card) return;
        const level = Number(btn.dataset.level);
        try {
            await api('POST', '/api/srs/importance', { card_ids: [card.id], importance: level });
            card.importance = level;
            renderImportance(card);
        } catch (err) {
            showError(err.message);
        }
    });

    els.minImportanceSelect.value = String(getMinImportance());
    els.minImportanceSelect.addEventListener('change', () => {
        localStorage.setItem(MIN_IMPORTANCE_KEY, els.minImportanceSelect.value);
        if (getToken()) loadQueue().catch(err => showError(err.message));
    });

    els.newLimitSelect.value = String(getNewLimit());
    els.newLimitSelect.addEventListener('change', () => {
        localStorage.setItem(NEW_LIMIT_KEY, els.newLimitSelect.value);
        if (getToken()) loadQueue().catch(err => showError(err.message));
    });

    // ---------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------
    I18N.apply(TEXT);
    I18N.mountToggle($('lang-toggle'));
    refreshIcons();
    window.addEventListener('load', refreshIcons);
    if (!getToken()) {
        showLoginRequired();
        return;
    }
    setupLegacyImport();
    wordBook.load();
    loadQueue().catch(err => showError(err.message));
})();
