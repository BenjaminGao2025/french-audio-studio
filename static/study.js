/* ==========================================================================
   French Audio Studio - Study & Shadowing Workbench Script
   Saves sentences/words as server-side FSRS review cards (reviewed on /review)
   ========================================================================== */

if (typeof window.activeTokensMap === 'undefined') {
    window.activeTokensMap = new Map();
}
var activeTokensMap = window.activeTokensMap;

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const { cleanFrenchToken, frenchPhoneticNormalize, calculateLevenshteinSimilarity, evaluateFrenchPronunciation } = window.SpeechEval;

function renderInteractiveWordsHtml(text) {
    if (!text) return '';
    // Match French words including internal apostrophes (e.g. n'autorisent, d'accord, l'homme, c'est)
    const regex = /(aujourd['’]hui|[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)?['’]?|[^\sA-Za-zÀ-ÖØ-öø-ÿŒœ]+|\s+)/gi;
    const tokens = text.match(regex) || [text];
    return tokens.map(token => {
        if (/^[A-Za-zÀ-ÖØ-öø-ÿŒœ]/i.test(token)) {
            const clean = token.replace(/['’]$/, '').trim() || token.trim();
            return `<span class="interactive-word" role="button" tabindex="0" data-word="${escapeHtml(clean)}" data-token="${escapeHtml(token.trim())}" title="${escapeHtml(clean)} · 点击查看释义与单读发音">${escapeHtml(token)}</span>`;
        }
        return escapeHtml(token);
    }).join('');
}

window.escapeHtml = escapeHtml;
window.cleanFrenchToken = cleanFrenchToken;
window.frenchPhoneticNormalize = frenchPhoneticNormalize;
window.calculateLevenshteinSimilarity = calculateLevenshteinSimilarity;
window.evaluateFrenchPronunciation = evaluateFrenchPronunciation;
window.renderInteractiveWordsHtml = renderInteractiveWordsHtml;

function initStudyWorkbench() {
    // Shared localStorage keys with main workbench
    const localKeyName = 'frenchStudio.perplexityApiKey';
    const sessionKeyName = 'frenchStudio.sessionApiKey';
    const modelKeyName = 'frenchStudio.perplexityModel';

    // DOM Elements - Connection
    const apiKeyInput = document.getElementById('api-key');
    const toggleKeyButton = document.getElementById('toggle-key');
    const rememberKey = document.getElementById('remember-key');
    const modelSelect = document.getElementById('model-select');
    const testConnectionButton = document.getElementById('test-connection');
    const connectionResult = document.getElementById('connection-result');
    const connectionResultTitle = document.getElementById('connection-result-title');
    const connectionResultDetail = document.getElementById('connection-result-detail');
    const connectionSummaryState = document.getElementById('connection-summary-state');
    const connectionSummaryText = connectionSummaryState ? connectionSummaryState.querySelector('.connection-summary-text') : null;

    // DOM Elements - Input
    const frenchInput = document.getElementById('french-input');
    const charCounter = document.getElementById('char-counter');
    const fillExampleButton = document.getElementById('fill-example-btn');
    const clearInputButton = document.getElementById('clear-input-btn');
    const analyzeButton = document.getElementById('analyze-btn');
    const analyzeButtonLabel = document.getElementById('analyze-btn-label');
    const statusMessage = document.getElementById('study-status-message');
    const studyInputPanel = document.querySelector('.study-input-panel');
    const actionRow = document.querySelector('.action-row');
    const inputCollapsedBar = document.getElementById('input-collapsed-bar');
    const collapsedBarText = document.getElementById('collapsed-bar-text');
    const btnExpandInput = document.getElementById('btn-expand-input');

    function collapseInputPanel(rawText) {
        if (!studyInputPanel || !inputCollapsedBar) return;
        studyInputPanel.hidden = true;
        if (actionRow) actionRow.hidden = true;
        inputCollapsedBar.hidden = false;
        if (collapsedBarText) {
            const clean = (rawText || '').trim();
            collapsedBarText.textContent = clean.length > 90 ? clean.slice(0, 90) + '...' : clean;
        }
        refreshIcons();
    }

    function expandInputPanel() {
        if (!studyInputPanel || !inputCollapsedBar) return;
        studyInputPanel.hidden = false;
        if (actionRow) actionRow.hidden = false;
        inputCollapsedBar.hidden = true;
        if (frenchInput) {
            frenchInput.focus();
        }
        refreshIcons();
    }

    // DOM Elements - Output Deck
    const studyDeckSection = document.getElementById('study-deck-section');
    const sentenceCountBadge = document.getElementById('sentence-count-badge');
    const sentencesContainer = document.getElementById('sentences-container');

    // DOM Elements - Topbar & Review Launcher
    const dueCardBadge = document.getElementById('due-card-badge');
    const todayReviewBanner = document.getElementById('today-review-banner');
    const todayReviewTitle = document.getElementById('today-review-title');
    const todayReviewDetail = document.getElementById('today-review-detail');

    // DOM Elements - User Auth & Trial
    const userAuthBtn = document.getElementById('user-auth-btn');
    const userAuthStatusText = document.getElementById('user-auth-status-text');
    const userTrialBadge = document.getElementById('user-trial-badge');
    const authModal = document.getElementById('auth-modal');
    const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
    const authFormContainer = document.getElementById('auth-form-container');
    const authUserProfile = document.getElementById('auth-user-profile');
    const authTabNotice = document.getElementById('auth-tab-notice');
    const authForm = document.getElementById('auth-form');
    const authEmailInput = document.getElementById('auth-email');
    const authPasswordInput = document.getElementById('auth-password');
    const authErrorMsg = document.getElementById('auth-error-msg');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSubmitLabel = document.getElementById('auth-submit-label');
    const profileEmail = document.getElementById('profile-email');
    const profileBadge = document.getElementById('profile-badge');
    const logoutBtn = document.getElementById('logout-btn');

    // DOM Elements - Query History
    const historyToggleBtn = document.getElementById('history-toggle-btn');
    const historyCountBadge = document.getElementById('history-count-badge');
    const historyModal = document.getElementById('history-modal');
    const historyTotalBadge = document.getElementById('history-total-badge');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');

    // DOM Elements - Floating Word Popover
    const floatingWordPopover = document.getElementById('floating-word-popover');
    const popoverWord = document.getElementById('popover-word');
    const popoverSpeakBtn = document.getElementById('popover-speak-btn');
    const popoverPhonetic = document.getElementById('popover-phonetic');
    const popoverPos = document.getElementById('popover-pos');
    const popoverLemma = document.getElementById('popover-lemma');
    const popoverCloseBtn = document.getElementById('popover-close-btn');
    const popoverLoading = document.getElementById('popover-loading');
    const popoverContent = document.getElementById('popover-content');
    const popoverCn = document.getElementById('popover-cn');
    const popoverEn = document.getElementById('popover-en');
    const popoverStarBtn = document.getElementById('popover-star-btn');
    const popoverStarText = document.getElementById('popover-star-text');

    // Speech Recognition API Detection
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    refreshIcons();
    window.addEventListener('load', refreshIcons);

    // -------------------------------------------------------------------------
    // 1. Settings & Key Management
    // -------------------------------------------------------------------------
    function initSettings() {
        const savedLocalKey = localStorage.getItem(localKeyName);
        const savedSessionKey = sessionStorage.getItem(sessionKeyName);
        if (savedLocalKey) {
            apiKeyInput.value = savedLocalKey;
            rememberKey.checked = true;
        } else if (savedSessionKey) {
            apiKeyInput.value = savedSessionKey;
        }

        const savedModel = localStorage.getItem(modelKeyName);
        if (savedModel && Array.from(modelSelect.options).some(opt => opt.value === savedModel)) {
            modelSelect.value = savedModel;
        }

        syncModelsFromBackend();

        if (apiKeyInput.value.trim()) {
            setConnectionState('idle', 'Key 已加载', '点击测试实际连接');
        } else {
            setConnectionState('idle', '未填写 Key', '在右上角连接设置填写 Key 或登录账号直接使用');
        }

        updateHistoryBadges();
        checkCurrentUser();
        refreshDueBadge();
    }

    async function syncModelsFromBackend() {
        if (!modelSelect) return;
        try {
            const resp = await fetch('/api/models');
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && Array.isArray(data.models) && data.models.length > 0) {
                modelSelect.innerHTML = '';
                data.models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.label + (m.recommended ? ' · 极速推荐' : '');
                    modelSelect.appendChild(opt);
                });
                const savedModel = localStorage.getItem(modelKeyName);
                if (savedModel && Array.from(modelSelect.options).some(opt => opt.value === savedModel)) {
                    modelSelect.value = savedModel;
                } else if (data.default && Array.from(modelSelect.options).some(opt => opt.value === data.default)) {
                    modelSelect.value = data.default;
                } else if (modelSelect.options.length > 0) {
                    modelSelect.selectedIndex = 0;
                }
            }
        } catch (err) {
            console.warn('Failed to sync models from backend', err);
        }
    }

    function saveApiKey() {
        const key = apiKeyInput.value.trim();
        if (key) {
            sessionStorage.setItem(sessionKeyName, key);
        } else {
            sessionStorage.removeItem(sessionKeyName);
        }

        if (rememberKey.checked && key) {
            localStorage.setItem(localKeyName, key);
        } else {
            localStorage.removeItem(localKeyName);
        }
        localStorage.setItem(modelKeyName, modelSelect.value);
    }

    function getEffectiveAuthToken() {
        const key = apiKeyInput.value.trim();
        if (key) return key;
        const userToken = localStorage.getItem(userTokenKey);
        if (userToken) return userToken;
        return null;
    }

    function requireAuthToken() {
        const token = getEffectiveAuthToken();
        if (!token) {
            openAuthModal();
            throw new Error('请先登录账号，或在【连接设置】中填写 API Key。');
        }
        if (apiKeyInput.value.trim()) {
            saveApiKey();
        }
        return token;
    }

    // Alias for backwards compatibility
    function requireApiKey() {
        return requireAuthToken();
    }

    function setConnectionState(state, title, detail) {
        if (connectionResult) {
            connectionResult.dataset.state = state;
            connectionResultTitle.textContent = title;
            connectionResultDetail.textContent = detail;
        }
        if (connectionSummaryState) {
            connectionSummaryState.dataset.state = state;
            connectionSummaryState.title = `${title}: ${detail}`;
            if (connectionSummaryText) {
                connectionSummaryText.textContent = state === 'success' ? '已连接' : (state === 'error' ? '失败' : title);
            }
        }
    }

    async function testConnection() {
        try {
            const token = requireAuthToken();
            const model = modelSelect.value;
            setConnectionState('testing', '正在测试', '正在验证 API Key / 用户权益与模型连通性...');
            testConnectionButton.disabled = true;

            const res = await fetch('/api/connection/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ model }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail?.message || data.detail || '连接测试失败');
            }
            setConnectionState('success', '连接正常', `${data.label} 连接成功并正常响应`);
        } catch (err) {
            setConnectionState('error', '连接失败', err.message);
        } finally {
            testConnectionButton.disabled = false;
        }
    }

    // -------------------------------------------------------------------------
    // 2. Audio Playback Engine (Edge-TTS + Fallback Web Speech)
    // -------------------------------------------------------------------------
    let currentActiveAudio = null;
    let currentAudioCleanup = null;
    let currentGlobalRecordingStopper = null;

    function stopAllAudio() {
        if (currentAudioCleanup) {
            const cleanup = currentAudioCleanup;
            currentAudioCleanup = null;
            try {
                cleanup();
            } catch (e) {
                console.warn('Audio cleanup error:', e);
            }
        }
        if (currentActiveAudio) {
            const audio = currentActiveAudio;
            currentActiveAudio = null;
            try {
                audio.pause();
                audio.currentTime = 0;
            } catch (e) {}
        }
        if ('speechSynthesis' in window) {
            try {
                window.speechSynthesis.cancel();
            } catch (e) {}
        }
    }

    function stopAnyOngoingRecording() {
        if (currentGlobalRecordingStopper) {
            const stopper = currentGlobalRecordingStopper;
            currentGlobalRecordingStopper = null;
            try {
                stopper();
            } catch (e) {
                console.warn('Error stopping current recording:', e);
            }
        }
    }

    function playFrenchSpeech(text, onEndCallback = null) {
        if (!text || !text.trim()) return;
        const cleanText = text.trim();

        // 1. Stop any previously active playback
        stopAllAudio();

        const audioUrl = `/tts?text=${encodeURIComponent(cleanText)}&voice=fr-FR-DeniseNeural`;
        const audio = new Audio(audioUrl);
        currentActiveAudio = audio;

        let isFinished = false;
        const finish = () => {
            if (isFinished) return;
            isFinished = true;
            if (currentActiveAudio === audio) {
                currentActiveAudio = null;
            }
            if (currentAudioCleanup === cleanup) {
                currentAudioCleanup = null;
            }
            if (onEndCallback) onEndCallback();
        };

        const cleanup = () => {
            if (!isFinished) {
                isFinished = true;
                if (onEndCallback) onEndCallback();
            }
        };
        currentAudioCleanup = cleanup;

        audio.addEventListener('ended', finish);

        audio.addEventListener('error', () => {
            if (isFinished) return;
            console.warn('Audio error, falling back to Web Speech');
            if ('speechSynthesis' in window) {
                try { window.speechSynthesis.cancel(); } catch (e) {}
                const utterance = new SpeechSynthesisUtterance(cleanText);
                utterance.lang = 'fr-FR';
                utterance.rate = 0.95;
                utterance.onend = finish;
                utterance.onerror = finish;
                window.speechSynthesis.speak(utterance);
            } else {
                finish();
            }
        });

        audio.play().catch(e => {
            if (isFinished) return;
            console.warn('Audio play interrupted, falling back to Web Speech:', e);
            if ('speechSynthesis' in window) {
                try { window.speechSynthesis.cancel(); } catch (e) {}
                const utterance = new SpeechSynthesisUtterance(cleanText);
                utterance.lang = 'fr-FR';
                utterance.rate = 0.95;
                utterance.onend = finish;
                utterance.onerror = finish;
                window.speechSynthesis.speak(utterance);
            } else {
                finish();
            }
        });
    }

    // -------------------------------------------------------------------------
    // 4. Spaced Repetition — server-side FSRS deck (reviewed on /review)
    // -------------------------------------------------------------------------
    const srsNotesByKey = new Map();       // sentence key -> saved note with its cards
    const sentenceContextByKey = new Map(); // sentence key -> translations + grammar from analysis

    function srsSentenceKey(sentence) {
        return (sentence || '').replace(/’/g, "'").replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function getUserToken() {
        return localStorage.getItem(userTokenKey) || '';
    }

    function getNewCardLimit() {
        const saved = parseInt(localStorage.getItem('frenchStudio.srs.newLimit') || '', 10);
        return Number.isFinite(saved) ? saved : 10;
    }

    async function srsApi(method, path, body) {
        const token = getUserToken();
        if (!token) {
            openAuthModal();
            throw new Error('复习卡片保存在服务器上，请先登录。');
        }
        const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail?.message || `请求失败（HTTP ${res.status}）`);
        }
        return data;
    }

    function rememberNote(note) {
        if (note && note.sentence) srsNotesByKey.set(srsSentenceKey(note.sentence), note);
    }

    function forgetCard(sentence, cardId) {
        const key = srsSentenceKey(sentence);
        const note = srsNotesByKey.get(key);
        if (!note) return;
        note.cards = note.cards.filter(c => c.id !== cardId);
        if (note.cards.length === 0) srsNotesByKey.delete(key);
    }

    function findTargetCard(sentence, token) {
        const note = srsNotesByKey.get(srsSentenceKey(sentence || token));
        const clean = (token || '').trim().toLowerCase();
        if (!note || !clean) return null;
        return note.cards.find(c => (c.mode === 'cloze' || c.mode === 'recognize') && c.target.toLowerCase() === clean) || null;
    }

    function sentenceCards(sentence) {
        const note = srsNotesByKey.get(srsSentenceKey(sentence));
        return note ? note.cards.filter(c => c.mode === 'listen' || c.mode === 'speak') : [];
    }

    function showSrsError(err) {
        statusMessage.className = 'status-message status-error';
        statusMessage.textContent = err.message;
    }

    async function refreshDueBadge() {
        if (!getUserToken()) {
            if (dueCardBadge) dueCardBadge.hidden = true;
            if (todayReviewBanner) todayReviewBanner.hidden = true;
            return;
        }
        try {
            const data = await srsApi('GET', `/api/srs/queue?tz_offset=${new Date().getTimezoneOffset()}&new_limit=${getNewCardLimit()}`);
            const { total, review, learning, new: fresh, reviewed_today: done } = data.counts;
            if (dueCardBadge) {
                dueCardBadge.textContent = String(total);
                dueCardBadge.hidden = total === 0;
            }
            if (todayReviewBanner) {
                todayReviewBanner.hidden = total === 0;
                todayReviewBanner.classList.toggle('is-done', total === 0);
                if (todayReviewTitle) todayReviewTitle.textContent = `今天有 ${total} 张卡片要复习`;
                if (todayReviewDetail) {
                    const minutes = Math.max(1, Math.round(total * 20 / 60));
                    const parts = [];
                    if (review + learning) parts.push(`复习 ${review + learning}`);
                    if (fresh) parts.push(`新卡 ${fresh}`);
                    todayReviewDetail.textContent = `${parts.join(' · ')} · 约 ${minutes} 分钟${done ? ` · 今天已复习 ${done} 次` : ''}。先复习，再学新句子。`;
                }
            }
        } catch (err) {
            console.warn('Failed to load review counts:', err);
        }
    }

    async function refreshSrsStates(sentences) {
        if (!getUserToken() || !sentences || sentences.length === 0) {
            updateTableStarStates();
            return;
        }
        try {
            const data = await srsApi('POST', '/api/srs/notes/lookup', {
                sentences: sentences.map(s => s.sentence || s.original || '').filter(Boolean),
            });
            (data.notes || []).forEach(rememberNote);
        } catch (err) {
            console.warn('Failed to load saved cards:', err);
        }
        updateTableStarStates();
    }

    function updateTableStarStates() {
        document.querySelectorAll('.btn-token-star').forEach(btn => {
            const saved = Boolean(findTargetCard(btn.dataset.sentence, btn.dataset.token));
            btn.classList.toggle('active', saved);
            btn.title = saved ? '已加入复习（点击移除这张挖空卡）' : '加入复习：在句子里挖空这个词';
        });
        document.querySelectorAll('.btn-sentence-save').forEach(btn => {
            const saved = sentenceCards(btn.dataset.sentence).length > 0;
            btn.classList.toggle('active', saved);
            btn.title = saved ? '已加入复习（点击移除这句的「听」「说」卡片）' : '加入复习：生成「听」和「说」两张卡片';
            const label = btn.querySelector('.sentence-save-label');
            if (label) label.textContent = saved ? '已加入复习' : '加入复习';
        });
        updatePopoverStarState();
    }

    function sentenceNotePayload(sentence) {
        const ctx = sentenceContextByKey.get(srsSentenceKey(sentence)) || {};
        return {
            sentence,
            translation_zh: ctx.translation_zh || '',
            translation_en: ctx.translation_en || '',
            extra: ctx.grammar && ctx.grammar.length ? { grammar: ctx.grammar } : {},
        };
    }

    async function toggleTargetCard({ token, sentence, meta }) {
        const cleanToken = (token || '').trim();
        if (!cleanToken) return;
        const existing = findTargetCard(sentence, cleanToken);
        try {
            if (existing) {
                await srsApi('DELETE', `/api/srs/cards/${encodeURIComponent(existing.id)}`);
                forgetCard(sentence || cleanToken, existing.id);
            } else {
                const inSentence = Boolean(sentence) && sentence.toLowerCase().includes(cleanToken.toLowerCase());
                const payload = sentence ? sentenceNotePayload(sentence) : { sentence: cleanToken };
                payload.targets = [{ text: cleanToken, mode: inSentence ? 'cloze' : 'recognize', meta: meta || {} }];
                rememberNote(await srsApi('POST', '/api/srs/notes', payload));
            }
        } catch (err) {
            showSrsError(err);
        }
        updateTableStarStates();
        refreshDueBadge();
    }

    async function toggleSentenceCards(sentence) {
        if (!sentence) return;
        const existing = sentenceCards(sentence);
        try {
            if (existing.length > 0) {
                for (const card of existing) {
                    await srsApi('DELETE', `/api/srs/cards/${encodeURIComponent(card.id)}`);
                    forgetCard(sentence, card.id);
                }
            } else {
                const payload = sentenceNotePayload(sentence);
                payload.modes = ['listen', 'speak'];
                rememberNote(await srsApi('POST', '/api/srs/notes', payload));
            }
        } catch (err) {
            showSrsError(err);
        }
        updateTableStarStates();
        refreshDueBadge();
    }

    // -------------------------------------------------------------------------
    // 5. Render Study & Breakdown Deck
    // -------------------------------------------------------------------------
    function isFrenchPronunciationFragment(word, sentenceText = '') {
        if (!word || typeof word !== 'string') return false;
        const clean = word.trim().replace(/^['"“‘]+|['"”’]+$/g, '');
        if (!clean) return false;
        const lower = clean.toLowerCase();

        // 1. English common grammatical/explanation words are NEVER French audio targets
        const englishStopWords = new Set([
            'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into', 'like', 
            'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 
            'around', 'among', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 
            'do', 'does', 'did', 'can', 'could', 'shall', 'should', 'will', 'would', 'may', 'might', 'must',
            'it', 'its', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'him', 
            'her', 'us', 'them', 'my', 'your', 'his', 'their', 'our', 'and', 'but', 'or', 'nor', 'so', 'yet', 
            'if', 'because', 'although', 'since', 'unless', 'not', 'no', 'sound', 'sounds', 'silent', 'letter', 
            'letters', 'word', 'words', 'pronounced', 'pronounce', 'pronunciation', 'liaison', 'vowel', 'vowels', 
            'consonant', 'consonants', 'syllable', 'syllables', 'stress', 'stressed', 'accent', 'accents', 'nasal', 
            'nasals', 'link', 'linked', 'linking', 'elision', 'mute', 'voiced', 'unvoiced', 'ending', 'endings', 
            'prefix', 'suffix', 'root', 'rule', 'rules', 'example', 'examples', 'note', 'notice', 'remember', 
            'always', 'never', 'usually', 'often', 'sometimes', 'here', 'there', 'make', 'makes', 'made', 'say', 
            'says', 'said', 'drop', 'dropped', 'keep', 'kept', 'change', 'changes', 'same', 'different', 'similar', 
            'meaning', 'means', 'mean', 'english', 'french', 'instead', 'rather', 'both', 'each', 'every', 'all', 
            'any', 'some', 'such', 'than', 'then', 'also', 'just', 'only', 'very', 'well', 'how', 'why', 'what', 
            'when', 'where', 'which', 'who', 'whom', 'whose', 'see', 'listen', 'hear', 'use', 'used'
        ]);
        if (englishStopWords.has(lower)) {
            return false;
        }

        // 2. If it contains French-specific accents / ligatures (e.g. é, è, ê, à, ç, œ, etc.) -> Definitely French
        if (/[àâçéèêëîïôùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŸŒÆ]/.test(clean)) {
            return true;
        }

        // 3. If it starts or ends with hyphen (e.g. "-s", "-ent", "-an", "-e", "in-", "-x") -> Phonics affix fragment
        if (/^-[a-zà-ÿœæ]{1,6}$/i.test(clean) || /^[a-zà-ÿœæ]{1,6}-$/i.test(clean)) {
            return true;
        }

        // 4. Common French pronunciation letters / liaisons / phonemes (e.g. "x", "z", "s", "eu", "ou", "an", "en", "in", "on", "un", "ai", "ei", "oi", "eau", "au", "ch", "gn", "ill", "tion")
        const frenchPhonemes = new Set([
            'x', 'z', 's', 'c', 'ç', 't', 'd', 'p', 'g', 'r', 'n', 'm', 'h', 'j', 'l',
            'an', 'en', 'in', 'on', 'un', 'ain', 'ein', 'aim', 'eim', 'om', 'am', 'im',
            'ou', 'oi', 'ui', 'eu', 'œu', 'ai', 'ei', 'au', 'eau', 'er', 'ez', 'et', 'ent',
            'ch', 'gn', 'ph', 'th', 'qu', 'gu', 'il', 'ill', 'tion', 'ss'
        ]);

        // 5. Does it exist in the active sentence's French token map or sentence text?
        if (window.activeTokensMap && (window.activeTokensMap.has(lower) || window.activeTokensMap.has(clean))) {
            return true;
        }
        if (sentenceText) {
            const cleanSentence = sentenceText.toLowerCase();
            const regex = new RegExp(`(?:^|[^a-zà-öø-ÿœæ])${lower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:$|[^a-zà-öø-ÿœæ])`, 'i');
            if (regex.test(cleanSentence)) {
                return true;
            }
        }

        // 6. Check if it's one of the frenchPhonemes (excluding English ambiguity like 'in', 'on', 'an', 'as', 'at' unless prefixed with -)
        const ambiguousEnglishFrench = new Set(['in', 'on', 'an', 'as', 'at', 'or', 'so', 'me', 'to', 'no', 'us', 'do', 'he', 'be']);
        if (frenchPhonemes.has(lower) && !ambiguousEnglishFrench.has(lower)) {
            return true;
        }

        // 7. Multi-word French phrases (e.g. "deux ans", "grand homme", "tout à fait")
        if (clean.includes(' ')) {
            const words = clean.split(/\s+/);
            const allEnglish = words.every(w => englishStopWords.has(w.toLowerCase()));
            if (!allEnglish) {
                return true;
            }
        }

        // 8. If clean length >= 3 and not an English stopword, check if it looks like French vocabulary (e.g. "deux", "ans", "diplômes", "beaux")
        if (clean.length >= 3 && !englishStopWords.has(lower)) {
            return true;
        }

        return false;
    }

    function cleanAlignmentToken(str) {
        if (!str || typeof str !== 'string') return '';
        const cleaned = str.replace(/^[\s(\[«"“'‘.,;:!?—]+|[\s)\]»"”'’.,;:!?—]+$/g, '').trim();
        return cleaned || str.trim();
    }

    function parsePronunciationTip(tip, sentenceText = '') {
        if (!tip || typeof tip !== 'string') {
            return { target: '', explanation: tip || '', audioText: sentenceText || '' };
        }

        const trimmed = tip.trim();

        // 1. Try "French phrase : explanation" pattern
        // e.g. "doivent: The -ent ending...", "leurs diplômes: The 's' in...", "les autorités: link the s..."
        const colonMatch = trimmed.match(/^([^:：]{1,50})\s*[:：]\s*(.+)$/s);
        if (colonMatch) {
            let rawPrefix = colonMatch[1].trim();
            let rawExplanation = colonMatch[2].trim();

            // Check if prefix is in the form: 'sound' in 'word' or "the sound in word"
            // e.g. "'in-' in 'informations'" or "the 's' in 'leurs'" or "in- in informations"
            const inWordMatch = rawPrefix.match(/(?:the\s+)?['"“‘]?([A-Za-zÀ-ÿœæŒÆ-]{1,15})['"”’]?\s+(?:in|of)\s+['"“‘]?([A-Za-zÀ-ÿœæŒÆ-]{2,25})['"”’]?/i);
            if (inWordMatch) {
                const sound = inWordMatch[1].trim();
                const word = inWordMatch[2].trim();
                const cleanExplanation = rawExplanation.replace(/^(?:the\s+)?['"“‘]?[A-Za-zÀ-ÿœæŒÆ-]{1,15}['"”’]?\s+(?:in|of)\s+['"“‘]?[A-Za-zÀ-ÿœæŒÆ-]{2,25}['"”’]?\s*[:：]?\s*/i, '');
                return {
                    target: `${word} (${sound})`,
                    explanation: `The '${sound}' in '${word}' ${cleanExplanation.replace(/^sounds\s+like/i, 'sounds like')}`,
                    audioText: word
                };
            }

            let candidate = rawPrefix.replace(/^['"“‘]+|['"”’]+$/g, '').trim();
            candidate = candidate.replace(/['"“‘”’]/g, '').trim();
            const lower = candidate.toLowerCase();
            const nonFrenchPrefixes = [
                'silent', 'liaison', 'note', 'warning', 'tip', 'pronunciation',
                'remember', 'rule', 'watch', 'pay', 'be careful', 'in french', 'notice'
            ];
            const isEnglishPrefix = nonFrenchPrefixes.some(p => lower.startsWith(p));
            const wordCount = candidate.split(/\s+/).length;

            if (!isEnglishPrefix && wordCount <= 5 && candidate.length > 0 && isFrenchPronunciationFragment(candidate, sentenceText)) {
                return {
                    target: candidate,
                    explanation: rawExplanation,
                    audioText: candidate.replace(/^-+|-+$/g, '') || candidate
                };
            }
        }

        // 2. Try looking for quoted French word/phrase: '...' or "..."
        const quoteMatch = trimmed.match(/['"“‘]([A-Za-zÀ-ÿœæŒÆ\s-]{1,35})['"”’]/);
        if (quoteMatch) {
            const candidate = quoteMatch[1].trim();
            if (isFrenchPronunciationFragment(candidate, sentenceText)) {
                return {
                    target: candidate,
                    explanation: trimmed,
                    audioText: candidate.replace(/^-+|-+$/g, '') || candidate
                };
            }
        }

        // 3. Fallback: general tip
        return {
            target: '',
            explanation: trimmed,
            audioText: sentenceText || ''
        };
    }

    function renderPronunciationTipItem(tip, sentenceText = '') {
        const parsed = parsePronunciationTip(tip, sentenceText);
        const audioText = parsed.audioText || parsed.target || sentenceText || '';
        const hasTarget = Boolean(parsed.target);

        // Format explanation: replace quoted French words with clickable audio chips (filter out English words)
        let explanationHtml = escapeHtml(parsed.explanation);
        explanationHtml = explanationHtml.replace(/(?:&quot;|&#039;|&#x27;|['"“‘])([A-Za-zÀ-ÿœæŒÆ\s-]{1,35})(?:&quot;|&#039;|&#x27;|['"”’])/g, (match, word) => {
            const cleanWord = word.trim();
            if (isFrenchPronunciationFragment(cleanWord, sentenceText)) {
                const speechText = cleanWord.replace(/^-+|-+$/g, '') || cleanWord;
                return `<button class="chip-tip-audio" type="button" data-speech="${escapeHtml(speechText)}" title="点击试听: ${escapeHtml(cleanWord)}"><span>${escapeHtml(cleanWord)}</span><i data-lucide="volume-2"></i></button>`;
            }
            return `‘${escapeHtml(cleanWord)}’`;
        });

        // Also turn parentheses with active French vocabulary into clickable chips, e.g. (diplômes)
        explanationHtml = explanationHtml.replace(/\(([A-Za-zÀ-ÿœæŒÆ-]{1,25})\)/g, (match, word) => {
            const cleanWord = word.trim();
            if (isFrenchPronunciationFragment(cleanWord, sentenceText)) {
                const speechText = cleanWord.replace(/^-+|-+$/g, '') || cleanWord;
                return `(<button class="chip-tip-audio" type="button" data-speech="${escapeHtml(speechText)}" title="点击试听: ${escapeHtml(cleanWord)}"><span>${escapeHtml(cleanWord)}</span><i data-lucide="volume-2"></i></button>)`;
            }
            return match;
        });

        const buttonHtml = hasTarget
            ? `<button class="btn-tip-audio" type="button" data-speech="${escapeHtml(audioText)}" title="收听「${escapeHtml(audioText)}」标准发音">
                <i data-lucide="volume-2"></i>
                <span class="tip-target-text">${escapeHtml(parsed.target)}</span>
                <span class="tip-badge-listen">范读</span>
               </button>`
            : `<button class="btn-tip-audio icon-only" type="button" data-speech="${escapeHtml(audioText)}" title="收听标准发音">
                <i data-lucide="volume-2"></i>
                <span class="tip-badge-listen">收听</span>
               </button>`;

        return `
            <li class="pronunciation-tip-item">
                <div class="tip-audio-col">
                    ${buttonHtml}
                </div>
                <div class="tip-content-col">
                    <span class="tip-explanation-text">${explanationHtml}</span>
                </div>
            </li>
        `;
    }

    function highlightBuildupDiff(currentFr, prevFr) {
        if (!currentFr) return '';
        if (!prevFr) return escapeHtml(currentFr);

        const normalizeToken = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

        const currPieces = currentFr.split(/(\s+)/);
        const prevWords = prevFr.split(/\s+/).map(normalizeToken).filter(Boolean);
        const currWords = [];
        const wordPieceIndices = [];

        currPieces.forEach((piece, idx) => {
            if (!/^\s+$/.test(piece) && piece.length > 0) {
                currWords.push(normalizeToken(piece));
                wordPieceIndices.push(idx);
            }
        });

        if (currWords.length === 0 || prevWords.length === 0) {
            return escapeHtml(currentFr);
        }

        const m = prevWords.length;
        const n = currWords.length;
        const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (prevWords[i - 1] === currWords[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        const matchedInCurr = new Set();
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (prevWords[i - 1] === currWords[j - 1]) {
                matchedInCurr.add(j - 1);
                i--;
                j--;
            } else if (dp[i - 1][j] >= dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }

        const isPieceNew = new Array(currPieces.length).fill(false);
        wordPieceIndices.forEach((pieceIdx, wordIdx) => {
            if (!matchedInCurr.has(wordIdx)) {
                isPieceNew[pieceIdx] = true;
            }
        });

        for (let k = 1; k < currPieces.length - 1; k++) {
            if (/^\s+$/.test(currPieces[k]) && isPieceNew[k - 1] && isPieceNew[k + 1]) {
                isPieceNew[k] = true;
            }
        }

        let result = '';
        let inMark = false;

        for (let k = 0; k < currPieces.length; k++) {
            const piece = currPieces[k];
            const isNew = isPieceNew[k];

            if (isNew && !inMark) {
                result += '<mark class="buildup-new-token">';
                inMark = true;
            } else if (!isNew && inMark) {
                result += '</mark>';
                inMark = false;
            }
            result += escapeHtml(piece);
        }
        if (inMark) {
            result += '</mark>';
        }

        return result;
    }

    function getPosCategory(pos) {
        if (!pos) return 'other';
        const p = pos.toLowerCase().trim();
        if (/\badv\b|adverb|adv\./i.test(p)) return 'adv';
        if (/\bverb\b|action|auxilia|infinitif|participe|\bv\./i.test(p)) return 'verb';
        if (/\bnoun\b|naming|substantif|\bnom\b|\bn\.m|\bn\.f/i.test(p)) return 'noun';
        if (/\badj\b|adjective|describing|adj\./i.test(p)) return 'adj';
        if (/pointer|connecting|linking|owner|possess|prep|pron|det|art|conj|function|relative|particle/i.test(p)) return 'function';
        return 'other';
    }

    function getPosTagClass(pos) {
        const cat = getPosCategory(pos);
        switch (cat) {
            case 'verb': return 'pos-verb';
            case 'noun': return 'pos-noun';
            case 'adj': return 'pos-adj';
            case 'adv': return 'pos-adv';
            case 'function': return 'pos-function';
            default: return 'pos-other';
        }
    }

    function isFunctionWordPos(pos) {
        return getPosCategory(pos) === 'function';
    }

    function renderWordBreakdownCard(w, sentenceText = '', transZh = '') {
        const tokenText = w.fr || w.token || '';
        const lemma = w.lemma && w.lemma !== tokenText ? w.lemma : '';
        const pos = w.type || w.pos || '';
        const ipa = w.ipa || w.phonetic || '';
        const meaning = w.meaning || w.explanation_en || '';
        const why = w.why || '';
        const engLink = w.english_link || '';
        const falseFriend = Boolean(w.false_friend);
        const isSaved = Boolean(findTargetCard(sentenceText, tokenText));
        const posCat = getPosCategory(pos);
        const posClass = getPosTagClass(pos);
        const isFunc = isFunctionWordPos(pos);

        let linkCellHtml = '';
        if (falseFriend) {
            linkCellHtml = `
                <div class="false-friend-badge" title="假朋友警示：与英文形似但含义不同">
                    <i data-lucide="alert-triangle"></i>
                    <span>False friend! ${escapeHtml(engLink || why || 'Different meaning')}</span>
                </div>
            `;
        } else if (engLink) {
            linkCellHtml = `
                <div class="english-link-pill" title="英文联想借词">
                    <i data-lucide="link"></i>
                    <span>${escapeHtml(tokenText)} → <strong>${escapeHtml(engLink)}</strong></span>
                </div>
            `;
        }

        const fullExpEn = `${meaning}${why ? ' (' + why + ')' : ''}`;

        return `
            <div class="word-card ${isFunc ? 'is-function-word' : 'is-content-word'}" data-pos-cat="${posCat}">
                <div class="word-card-top">
                    <div class="word-card-token-group">
                        <span class="token-word" title="点击查看释义">${escapeHtml(tokenText)}</span>
                        <button class="btn-token-speak" type="button" title="点击发音" data-speech="${escapeHtml(tokenText)}">
                            <i data-lucide="volume-2"></i>
                        </button>
                        <button class="btn-token-star ${isSaved ? 'active' : ''}" type="button"
                            title="${isSaved ? '已加入复习（点击移除这张挖空卡）' : '加入复习：在句子里挖空这个词'}"
                            data-token="${escapeHtml(tokenText)}"
                            data-lemma="${escapeHtml(lemma)}"
                            data-pos="${escapeHtml(pos)}"
                            data-phonetic="${escapeHtml(ipa)}"
                            data-exp-en="${escapeHtml(fullExpEn)}"
                            data-exp-cn="${escapeHtml(w.meaning_zh || w.explanation_cn || '')}"
                            data-sentence="${escapeHtml(sentenceText)}"
                            data-sentence-cn="${escapeHtml(transZh)}">
                            <i data-lucide="star"></i>
                        </button>
                    </div>
                    <div class="word-card-tags">
                        ${pos ? `<span class="pos-tag ${posClass}">${escapeHtml(pos)}</span>` : ''}
                        ${ipa ? `<span class="phonetic-tag">${escapeHtml(formatFriendlyPhonetic(ipa))}</span>` : ''}
                        ${lemma ? `<span class="lemma-tag">原形: ${escapeHtml(lemma)}</span>` : ''}
                    </div>
                </div>
                <div class="word-card-body">
                    <div class="word-meaning">${escapeHtml(meaning)}</div>
                    ${w.meaning_zh ? `<div class="word-meaning-zh">${escapeHtml(w.meaning_zh)}</div>` : ''}
                    ${why ? `<div class="word-why"><span class="why-label">Why:</span> ${escapeHtml(why)}</div>` : ''}
                </div>
                ${linkCellHtml ? `
                    <div class="word-card-footer">
                        ${linkCellHtml}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderStudyDeck(sentences) {
        window.renderStudyDeck = renderStudyDeck;
        sentencesContainer.innerHTML = '';
        if (!window.activeTokensMap) {
            window.activeTokensMap = new Map();
        }
        window.activeTokensMap.clear();

        if (!sentences || sentences.length === 0) {
            studyDeckSection.hidden = true;
            return;
        }

        studyDeckSection.hidden = false;
        sentenceCountBadge.textContent = `共 ${sentences.length} 句`;

        sentences.forEach((s, idx) => {
            const isV2 = s.schemaVersion === 2 || Boolean(s.words && s.words.length > 0) || Boolean(s.build_up && s.build_up.length > 0) || Boolean(s.alignment && s.alignment.length > 0);
            const sentenceText = s.sentence || s.original || '';
            const transEn = s.translation_en || '';
            const transZh = s.translation_zh || s.translation_cn || '';
            sentenceContextByKey.set(srsSentenceKey(sentenceText), {
                translation_zh: transZh,
                translation_en: transEn,
                grammar: (s.grammar_points || []).slice(0, 3).map(g => ({
                    title: g.title || '',
                    explanation: g.explanation || '',
                    hook: g.hook || '',
                })),
            });

            // Index words/tokens for instant popover lookup
            const wordsList = isV2 ? (s.words || []) : (s.tokens || []);
            wordsList.forEach(w => {
                const tokenText = w.fr || w.token || '';
                if (tokenText) {
                    const lemma = w.lemma || tokenText;
                    const pos = w.type || w.pos || '';
                    const ipa = w.ipa || w.phonetic || '';
                    const meaning = w.meaning || w.explanation_en || '';
                    const why = w.why || '';
                    const fullExpEn = `${meaning}${why ? ' (' + why + ')' : ''}`;
                    const entry = {
                        token: tokenText,
                        lemma: lemma,
                        pos: pos,
                        phonetic: ipa,
                        explanation_cn: w.meaning_zh || w.explanation_cn || '',
                        explanation_en: fullExpEn,
                        sentence: sentenceText,
                        sentence_cn: transZh,
                        sentence_en: transEn,
                    };
                    window.activeTokensMap.set(tokenText.toLowerCase(), entry);
                    if (lemma) window.activeTokensMap.set(lemma.toLowerCase(), entry);
                }
            });

            const card = document.createElement('article');
            card.className = `sentence-card ${isV2 ? 'is-v2-card' : 'is-v1-card'}`;
            card.dataset.index = idx;

            // Shared Shadowing & Scoring HTML
            const shadowingHtml = `
                <div class="shadowing-panel">
                    <div class="shadowing-header">
                        <div class="shadowing-title">
                            <i data-lucide="mic"></i>
                            <span>即时跟读打分 (Shadowing & Scoring)</span>
                        </div>
                        <span class="shadowing-guide">点击麦克风朗读该句，AI 将从发音完整度、相似度与漏读进行智能评测</span>
                    </div>
                    <div class="shadowing-body">
                        <button class="btn-record" type="button">
                            <i data-lucide="mic"></i>
                            <span class="record-btn-text">点击开始录音跟读</span>
                        </button>
                    </div>
                    <div class="score-result-card" hidden>
                        <div class="score-summary-bar">
                            <div class="score-badge-group">
                                <span class="score-number-pill excellent">--</span>
                                <span class="score-rating-text">评测中...</span>
                            </div>
                            <div class="score-metrics">
                                <span>准确度: <strong class="metric-acc">--%</strong></span>
                                <span>完整度: <strong class="metric-comp">--%</strong></span>
                            </div>
                        </div>
                        <div class="diff-result-box"></div>
                        <div class="diff-legend">
                            <span class="diff-legend-item"><span class="diff-dot dot-green"></span> 发音准确</span>
                            <span class="diff-legend-item"><span class="diff-dot dot-yellow"></span> 接近/轻微差异</span>
                            <span class="diff-legend-item"><span class="diff-dot dot-red"></span> 漏读或需纠正</span>
                        </div>
                        <div class="shadow-audio-controls">
                            <button class="btn-audio-pill btn-play-model" type="button">
                                <i data-lucide="volume-2"></i>
                                <span>官方范读</span>
                            </button>
                            <button class="btn-audio-pill btn-play-user" type="button" disabled>
                                <i data-lucide="play"></i>
                                <span>我的录音</span>
                            </button>
                            <button class="btn-audio-pill btn-retry" type="button">
                                <i data-lucide="rotate-ccw"></i>
                                <span>重新跟读</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            if (isV2) {
                // ==================== SCHEMA V2 RENDERING ====================
                const wordCount = sentenceText.trim().split(/\s+/).filter(Boolean).length;
                const isShortSentence = wordCount <= 5;
                const hasValidBuildup = Boolean(s.build_up && s.build_up.length > 1 && !isShortSentence);

                // 1. Sentence Hero: French text + Interlinear Gloss + Translations
                const interlinearHtml = (s.alignment && s.alignment.length > 0) ? `
                    <div class="interlinear-gloss">
                        <div class="gloss-track">
                            ${s.alignment.map(a => `
                                <div class="gloss-pair">
                                    <span class="gloss-fr">${escapeHtml(cleanAlignmentToken(a.fr))}</span>
                                    <span class="gloss-en">${escapeHtml(cleanAlignmentToken(a.en))}</span>
                                </div>
                            `).join('')}
                        </div>
                        ${s.order_note ? `
                            <div class="gloss-order-note">
                                <i data-lucide="info"></i>
                                <span>${escapeHtml(s.order_note)}</span>
                            </div>
                        ` : ''}
                    </div>
                ` : '';

                // 1b. Feynman self-test: the learner explains first, the AI only points out gaps
                const feynmanSelfTestHtml = `
                    <div class="feynman-selftest">
                        <div class="feynman-selftest-head">
                            <span class="feynman-anchor-badge">🧠 费曼自测</span>
                            <span class="feynman-selftest-sub">先别看下面的讲解。用中文讲给自己听：这句话在说什么？最关键的语法或搭配为什么这么用？</span>
                        </div>
                        <textarea class="feynman-input" rows="3" maxlength="2000" placeholder="例：这句是说……；aucune 本身就是否定，所以没有 pas……"></textarea>
                        <input class="feynman-variation" type="text" maxlength="500" autocomplete="off" spellcheck="false" placeholder="（可选）换一个词，自己造一个新的法语句子">
                        <div class="feynman-actions">
                            ${SpeechRecognition ? `
                                <button class="btn-feynman-mic" type="button" title="用中文说出你的讲解（语音转文字）">
                                    <i data-lucide="mic"></i><span class="feynman-mic-label">用说的</span>
                                </button>
                            ` : ''}
                            <button class="btn-feynman-check" type="button">
                                <i data-lucide="search-check"></i><span>让 AI 找漏洞</span>
                            </button>
                        </div>
                        <div class="feynman-feedback" hidden></div>
                    </div>
                `;

                const heroHtml = `
                    <div class="sentence-hero">
                        <div class="sentence-meta-row">
                            <div class="meta-row-left" style="display: flex; align-items: center; gap: 8px;">
                                <span class="sentence-index-pill">Phrase ${idx + 1}</span>
                                <div class="hero-tags">
                                    <span class="v2-badge">B1 精析</span>
                                    ${isShortSentence ? '<span class="badge badge-short-phrase">短语</span>' : ''}
                                </div>
                            </div>
                            ${sentences.length > 1 ? `
                                <button class="btn-hero-collapse" type="button" title="折叠本句">
                                    <i data-lucide="chevron-up"></i>
                                    <span>收起</span>
                                </button>
                            ` : ''}
                        </div>
                        <div class="sentence-text-row">
                            <p class="sentence-french-text">${renderInteractiveWordsHtml(sentenceText)}</p>
                            <button class="btn-speak-round" type="button" title="收听整句标准发音" aria-label="朗读句子">
                                <i data-lucide="volume-2"></i>
                            </button>
                            <button class="btn-sentence-save" type="button" data-sentence="${escapeHtml(sentenceText)}" title="加入复习：生成「听」和「说」两张卡片">
                                <i data-lucide="bookmark-plus"></i>
                                <span class="sentence-save-label">加入复习</span>
                            </button>
                        </div>
                        ${interlinearHtml}
                        <div class="sentence-translations">
                            <div class="translation-en translation-primary">${escapeHtml(transEn)}</div>
                            ${transZh ? `<div class="translation-zh translation-secondary">${escapeHtml(transZh)}</div>` : ''}
                        </div>
                        ${feynmanSelfTestHtml}
                    </div>
                `;

                // 2. Sentence Build-up (一层一层搭句子 - 5词及以内短句/标题无需生硬拆解)
                let buildupHtml = '';
                if (hasValidBuildup) {
                    const stepsHtml = s.build_up.map((step, sIdx) => {
                        const isFinal = sIdx === s.build_up.length - 1;
                        const prevStep = sIdx > 0 ? s.build_up[sIdx - 1] : null;
                        const prevFr = prevStep ? prevStep.fr : '';
                        const highlightedFr = highlightBuildupDiff(step.fr, prevFr);
                        return `
                            <div class="buildup-step-row ${isFinal ? 'is-final-step' : ''}">
                                <div class="buildup-step-badge">Step ${sIdx + 1}</div>
                                <div class="buildup-step-content">
                                    <div class="buildup-fr-row">
                                        <span class="buildup-fr-text">${highlightedFr}</span>
                                        ${isFinal ? `<span class="final-step-tag">原句</span>` : ''}
                                        <div class="buildup-action-group">
                                            <button class="btn-buildup-speak" type="button" title="点击听范读发音" data-speech="${escapeHtml(step.fr)}">
                                                <i data-lucide="volume-2"></i>
                                                <span>发音</span>
                                            </button>
                                            <button class="btn-buildup-record" type="button" title="录音跟读此递进步骤并智能打分" data-sentence="${escapeHtml(step.fr)}">
                                                <i data-lucide="mic"></i>
                                                <span class="record-btn-text">跟读打分</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="buildup-en-text">${escapeHtml(step.en)}</div>
                                    ${step.new ? `
                                        <div class="buildup-new-note">
                                            <span class="new-tag">New:</span> ${escapeHtml(step.new)}
                                        </div>
                                    ` : ''}
                                    <div class="buildup-score-card" hidden>
                                        <div class="buildup-score-bar">
                                            <div class="buildup-score-left">
                                                <span class="score-number-pill sm excellent">--</span>
                                                <span class="score-rating-text sm">评测中...</span>
                                                <span class="buildup-score-metrics">准确度: <strong class="metric-acc">--%</strong> | 完整度: <strong class="metric-comp">--%</strong></span>
                                            </div>
                                            <div class="buildup-audio-controls">
                                                <button class="btn-mini-audio btn-play-model" type="button" title="官方范读" data-label="范读">
                                                    <i data-lucide="volume-2"></i>
                                                    <span>范读</span>
                                                </button>
                                                <button class="btn-mini-audio btn-play-user" type="button" title="回听我的录音" disabled>
                                                    <i data-lucide="play"></i>
                                                    <span>我的录音</span>
                                                </button>
                                                <button class="btn-mini-audio btn-retry" type="button" title="重新录音跟读">
                                                    <i data-lucide="rotate-ccw"></i>
                                                    <span>重练</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div class="diff-result-box sm"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');

                    buildupHtml = `
                        <div class="study-card-section buildup-section">
                            <div class="buildup-section-header">
                                <div class="section-title" style="margin-bottom: 0;">
                                    <i data-lucide="layers"></i>
                                    <span>一层一层搭句子 (Sentence Build-up)</span>
                                </div>
                                <div class="feynman-mode-switch" role="group" aria-label="学习模式切换">
                                    <button class="btn-feynman-toggle active" data-mode="normal" type="button" title="对照跟读：显示完整法语文本">
                                        <i data-lucide="eye"></i>
                                        <span>对照跟读</span>
                                    </button>
                                    <button class="btn-feynman-toggle" data-mode="blind" type="button" title="费曼盲测复述：遮挡关键句式，检验记忆并闭卷复述">
                                        <i data-lucide="brain"></i>
                                        <span>费曼盲测复述</span>
                                        <span class="feynman-badge">推荐</span>
                                    </button>
                                </div>
                            </div>
                            <div class="feynman-tip-banner" hidden>
                                <span>🧠 <strong>费曼认知挑战</strong>：递进关键词已遮挡。看着释义，凭借脑内记忆说出这句法语！</span>
                                <button class="btn-reveal-all" type="button">一键揭晓</button>
                            </div>
                            <div class="buildup-steps-list">
                                ${stepsHtml}
                            </div>
                        </div>
                    `;
                }

                // 4. Word-by-word Analysis Cards (2 columns, POS color-coded, function words collapsible)
                const contentWords = [];
                const functionWords = [];

                wordsList.forEach(w => {
                    const pos = w.type || w.pos || '';
                    if (isFunctionWordPos(pos)) {
                        functionWords.push(w);
                    } else {
                        contentWords.push(w);
                    }
                });

                const effectiveContentWords = (contentWords.length === 0) ? wordsList : contentWords;
                const effectiveFunctionWords = (contentWords.length === 0) ? [] : functionWords;

                const contentCardsHtml = effectiveContentWords.map(w => renderWordBreakdownCard(w, sentenceText, transZh)).join('');
                const functionCardsHtml = effectiveFunctionWords.map(w => renderWordBreakdownCard(w, sentenceText, transZh)).join('');
                const hasFunctionWords = effectiveFunctionWords.length > 0;
                const functionTokensPreview = effectiveFunctionWords.map(w => escapeHtml(w.fr || w.token || '')).join(' · ');

                const wordsSectionHtml = `
                    <div class="study-card-section words-cards-section">
                        <div class="section-title">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i data-lucide="book-open"></i>
                                <span>逐词剖析 (Word Breakdown)</span>
                            </div>
                            <div class="words-filter-tabs">
                                <button class="btn-words-filter ${hasFunctionWords ? 'active' : ''}" data-filter="content" type="button">核心实词 (${effectiveContentWords.length})</button>
                                <button class="btn-words-filter ${!hasFunctionWords ? 'active' : ''}" data-filter="all" type="button">全部 (${wordsList.length})</button>
                                ${hasFunctionWords ? `
                                    <button class="btn-words-filter" data-filter="function" type="button">仅看虚词 (${effectiveFunctionWords.length})</button>
                                ` : ''}
                            </div>
                        </div>

                        <div class="words-cards-container">
                            <div class="words-cards-grid">
                                ${contentCardsHtml}
                            </div>

                            ${hasFunctionWords ? `
                                <div class="function-words-collapse-section">
                                    <div class="function-words-summary-bar" role="button" tabindex="0" title="点击展开/收起基础虚词详细卡片">
                                        <div class="fw-summary-left">
                                            <span class="fw-summary-badge">基础虚词</span>
                                            <span class="fw-summary-tokens">${functionTokensPreview}</span>
                                            <span class="fw-summary-count">共 ${effectiveFunctionWords.length} 词</span>
                                        </div>
                                        <div class="fw-summary-right">
                                            <span class="fw-toggle-label">展开解析</span>
                                            <i data-lucide="chevron-down" class="fw-chevron"></i>
                                        </div>
                                    </div>
                                    <div class="function-words-cards-grid" hidden>
                                        ${functionCardsHtml}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;

                // 5. Grammar Points + Memory Hooks
                let grammarHtml = '';
                if (s.grammar_points && s.grammar_points.length > 0) {
                    const pointsHtml = s.grammar_points.map(g => {
                        return `
                            <div class="grammar-point-card">
                                <div class="grammar-point-header">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span class="grammar-bullet">📌</span>
                                        <h4 class="grammar-point-title">${escapeHtml(g.title)}</h4>
                                    </div>
                                </div>
                                <div class="grammar-point-body">
                                    <p class="grammar-point-exp">${escapeHtml(g.explanation)}</p>
                                    ${g.hook ? `
                                        <div class="grammar-hook-inline feynman-hook-pill">
                                            <span class="hook-icon">🧠</span>
                                            <span class="hook-text"><strong>记忆钩子：</strong> ${escapeHtml(g.hook)}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('');

                    grammarHtml = `
                        <div class="study-card-section grammar-section">
                            <div class="section-title">
                                <i data-lucide="sparkles"></i>
                                <span>语法考点与记忆钩子 (Grammar & Memory Hooks)</span>
                            </div>
                            <div class="grammar-points-list">
                                ${pointsHtml}
                            </div>
                        </div>
                    `;
                }

                // 6. Pronunciation Tips (Interactive with audio playback and clickable chips)
                let pronTipsHtml = '';
                if (s.pronunciation_tips && s.pronunciation_tips.length > 0) {
                    const tipsHtml = s.pronunciation_tips.map(tip => renderPronunciationTipItem(tip, sentenceText)).join('');

                    pronTipsHtml = `
                        <div class="study-card-section pronunciation-section">
                            <div class="section-title">
                                <i data-lucide="volume-2"></i>
                                <span>发音重点与连音提示 (Pronunciation Tips)</span>
                            </div>
                            <ul class="pronunciation-tips-list">
                                ${tipsHtml}
                            </ul>
                        </div>
                    `;
                }

                const isMultiSentence = sentences.length > 1;
                const isCollapsed = isMultiSentence && idx > 0;

                const accordionHeaderHtml = isMultiSentence ? `
                    <div class="card-accordion-header" role="button" tabindex="0" title="点击展开/折叠此句分析">
                        <div class="accordion-header-left">
                            <span class="sentence-index-pill">Phrase ${idx + 1}</span>
                            <span class="accordion-preview-fr">${escapeHtml(sentenceText.length > 65 ? sentenceText.slice(0, 65) + '...' : sentenceText)}</span>
                        </div>
                        <div class="accordion-header-right">
                            <button class="btn-token-speak btn-accordion-speak" type="button" title="朗读原句" data-speech="${escapeHtml(sentenceText)}">
                                <i data-lucide="volume-2"></i>
                            </button>
                            <span class="accordion-preview-trans">${escapeHtml(transZh || transEn)}</span>
                            <i data-lucide="chevron-down" class="accordion-chevron"></i>
                        </div>
                    </div>
                ` : '';

                const cardContentHtml = `
                    <div class="card-content-wrapper">
                        ${heroHtml}
                        <div class="card-tabs-bar" role="tablist">
                            ${hasValidBuildup ? `
                                <button class="card-tab-btn active" data-tab="buildup" type="button" role="tab" aria-selected="true">
                                    <i data-lucide="layers"></i>
                                    <span>搭句子</span>
                                    <span class="tab-pill">${s.build_up.length}</span>
                                </button>
                            ` : ''}
                            <button class="card-tab-btn ${!hasValidBuildup ? 'active' : ''}" data-tab="words" type="button" role="tab" aria-selected="${!hasValidBuildup}">
                                <i data-lucide="book-open"></i>
                                <span>逐词剖析</span>
                                <span class="tab-pill">${wordsList.length}</span>
                            </button>
                            ${s.grammar_points && s.grammar_points.length > 0 ? `
                                <button class="card-tab-btn" data-tab="grammar" type="button" role="tab" aria-selected="false">
                                    <i data-lucide="sparkles"></i>
                                    <span>语法考点</span>
                                    <span class="tab-pill">${s.grammar_points.length}</span>
                                </button>
                            ` : ''}
                            ${s.pronunciation_tips && s.pronunciation_tips.length > 0 ? `
                                <button class="card-tab-btn" data-tab="pron" type="button" role="tab" aria-selected="false">
                                    <i data-lucide="volume-2"></i>
                                    <span>发音重点</span>
                                    <span class="tab-pill">${s.pronunciation_tips.length}</span>
                                </button>
                            ` : ''}
                            ${!hasValidBuildup ? `
                                <button class="card-tab-btn" data-tab="shadowing" type="button" role="tab" aria-selected="false">
                                    <i data-lucide="mic"></i>
                                    <span>跟读打分</span>
                                </button>
                            ` : ''}
                        </div>
                        <div class="card-tab-body">
                            ${hasValidBuildup ? `<div class="card-tab-panel active" data-panel="buildup">${buildupHtml}</div>` : ''}
                            <div class="card-tab-panel ${!hasValidBuildup ? 'active' : ''}" data-panel="words" ${hasValidBuildup ? 'hidden' : ''}>${wordsSectionHtml}</div>
                            ${s.grammar_points && s.grammar_points.length > 0 ? `<div class="card-tab-panel" data-panel="grammar" hidden>${grammarHtml}</div>` : ''}
                            ${s.pronunciation_tips && s.pronunciation_tips.length > 0 ? `<div class="card-tab-panel" data-panel="pron" hidden>${pronTipsHtml}</div>` : ''}
                            ${!hasValidBuildup ? `<div class="card-tab-panel" data-panel="shadowing" hidden>${shadowingHtml}</div>` : ''}
                        </div>
                    </div>
                `;

                card.className = `sentence-card ${isV2 ? 'is-v2-card' : 'is-v1-card'} ${isCollapsed ? 'is-accordion-collapsed' : 'is-accordion-expanded'}`;
                card.innerHTML = accordionHeaderHtml + cardContentHtml;
            } else {
                // ==================== LEGACY V1 RENDERING ====================
                const heroHtml = `
                    <div class="sentence-hero">
                        <div class="sentence-meta-row">
                            <span class="sentence-index-pill">Phrase ${idx + 1}</span>
                            <span class="schema-version-pill legacy-pill">旧版中文精析</span>
                        </div>
                        <div class="sentence-text-row">
                            <p class="sentence-french-text">${renderInteractiveWordsHtml(sentenceText)}</p>
                            <button class="btn-speak-round" type="button" title="收听整句标准发音" aria-label="朗读句子">
                                <i data-lucide="volume-2"></i>
                            </button>
                            <button class="btn-sentence-save" type="button" data-sentence="${escapeHtml(sentenceText)}" title="加入复习：生成「听」和「说」两张卡片">
                                <i data-lucide="bookmark-plus"></i>
                                <span class="sentence-save-label">加入复习</span>
                            </button>
                        </div>
                        <div class="sentence-translations">
                            <div class="translation-cn">${escapeHtml(transZh)}</div>
                            <div class="translation-en">${escapeHtml(transEn)}</div>
                        </div>
                    </div>
                `;

                let rowsHtml = '';
                wordsList.forEach(tok => {
                    const tokenText = tok.token || tok.fr || '';
                    const lemma = tok.lemma && tok.lemma !== tokenText ? tok.lemma : '';
                    const pos = tok.pos || tok.type || '';
                    const phonetic = tok.phonetic || tok.ipa || '';
                    const expEn = tok.explanation_en || tok.meaning || '';
                    const expCn = tok.explanation_cn || '';
                    const isSaved = Boolean(findTargetCard(sentenceText, tokenText));

                    rowsHtml += `
                        <tr>
                            <td>
                                <div class="token-cell">
                                    <div class="token-main-row">
                                        <span class="token-word">${escapeHtml(tokenText)}</span>
                                        <div class="token-actions">
                                            <button class="btn-token-speak" type="button" title="点击发音" data-speech="${escapeHtml(tokenText)}">
                                                <i data-lucide="volume-2"></i>
                                            </button>
                                            <button class="btn-token-star ${isSaved ? 'active' : ''}" type="button"
                                                title="${isSaved ? '已加入复习（点击移除这张挖空卡）' : '加入复习：在句子里挖空这个词'}"
                                                data-token="${escapeHtml(tokenText)}"
                                                data-lemma="${escapeHtml(lemma)}"
                                                data-pos="${escapeHtml(pos)}"
                                                data-phonetic="${escapeHtml(phonetic)}"
                                                data-exp-en="${escapeHtml(expEn)}"
                                                data-exp-cn="${escapeHtml(expCn)}"
                                                data-sentence="${escapeHtml(sentenceText)}"
                                                data-sentence-cn="${escapeHtml(transZh)}">
                                                <i data-lucide="star"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="token-details">
                                        ${pos ? `<span class="pos-tag">${escapeHtml(pos)}</span>` : ''}
                                        ${phonetic ? `<span class="phonetic-tag">${escapeHtml(formatFriendlyPhonetic(phonetic))}</span>` : ''}
                                        ${lemma ? `<span class="lemma-tag">原形: ${escapeHtml(lemma)}</span>` : ''}
                                    </div>
                                </div>
                            </td>
                            <td class="explanation-en-cell">${escapeHtml(expEn)}</td>
                            <td class="explanation-cn-cell">${escapeHtml(expCn)}</td>
                        </tr>
                    `;
                });

                const tableHtml = `
                    <div class="table-wrapper">
                        <table class="breakdown-table">
                            <thead>
                                <tr>
                                    <th>① 词汇 / 词组短语 (Forme & Audio)</th>
                                    <th>② 英文简明解释 (Anglais)</th>
                                    <th>③ 中文释义与语法搭配 (Chinois)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                `;

                card.innerHTML = heroHtml + shadowingHtml + tableHtml;
            }

            sentencesContainer.appendChild(card);
            attachSentenceCardEvents(card, sentenceText, transZh, transEn);
        });

        refreshIcons();
        refreshSrsStates(sentences);
    }

    function renderFeynmanFeedback(fb) {
        const verdictText = { solid: '讲清楚了', partial: '讲到了一部分', missing: '还没抓住要点' }[fb.verdict] || '';
        const list = (items, cls, mark) => items && items.length
            ? `<ul class="${cls}">${items.map(t => `<li><span class="fb-mark">${mark}</span>${escapeHtml(t)}</li>`).join('')}</ul>`
            : '';
        let variationHtml = '';
        if (fb.variation) {
            variationHtml = fb.variation.ok
                ? `<p class="fb-variation ok">✓ 你造的句子没问题${fb.variation.note ? '：' + escapeHtml(fb.variation.note) : ''}</p>`
                : `<p class="fb-variation fix">✗ 你造的句子可以改成：<strong>${escapeHtml(fb.variation.corrected)}</strong>${fb.variation.note ? '<br>' + escapeHtml(fb.variation.note) : ''}</p>`;
        }
        return `
            <p class="fb-verdict verdict-${escapeHtml(fb.verdict)}">${verdictText}</p>
            ${list(fb.got_right, 'fb-right', '✓')}
            ${list(fb.gaps, 'fb-gaps', '△')}
            ${variationHtml}
            ${fb.follow_up ? `<p class="fb-followup"><strong>追问：</strong>${escapeHtml(fb.follow_up)}<span class="fb-followup-hint">（在上面补充你的回答，再找一次漏洞）</span></p>` : ''}
        `;
    }

    function bindFeynmanSelfTest(root, sentence) {
        const input = root.querySelector('.feynman-input');
        const variationInput = root.querySelector('.feynman-variation');
        const checkBtn = root.querySelector('.btn-feynman-check');
        const micBtn = root.querySelector('.btn-feynman-mic');
        const feedback = root.querySelector('.feynman-feedback');
        [input, variationInput].forEach(el => el.addEventListener('click', e => e.stopPropagation()));

        let micRecognition = null;
        if (micBtn) {
            micBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const label = micBtn.querySelector('.feynman-mic-label');
                if (micRecognition) {
                    micRecognition.stop();
                    return;
                }
                stopAllAudio();
                stopAnyOngoingRecording();
                const base = input.value.trim();
                micRecognition = new SpeechRecognition();
                micRecognition.lang = 'zh-CN';
                micRecognition.continuous = true;
                micRecognition.interimResults = true;
                micRecognition.onresult = (event) => {
                    let text = '';
                    for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
                    input.value = base ? `${base} ${text}` : text;
                };
                micRecognition.onend = () => {
                    micRecognition = null;
                    micBtn.classList.remove('recording');
                    if (label) label.textContent = '用说的';
                };
                micRecognition.start();
                micBtn.classList.add('recording');
                if (label) label.textContent = '说完点这里';
            });
        }

        checkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const explanation = input.value.trim();
            if (!explanation) {
                input.focus();
                input.placeholder = '先写（或说）几句你自己的理解，哪怕只有一句。';
                return;
            }
            const ctx = sentenceContextByKey.get(srsSentenceKey(sentence)) || {};
            checkBtn.disabled = true;
            feedback.hidden = false;
            feedback.innerHTML = '<p class="fb-loading">AI 正在对照你的讲解找漏洞…</p>';
            try {
                const res = await fetch('/api/feynman', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${requireAuthToken()}` },
                    body: JSON.stringify({
                        sentence,
                        translation_zh: ctx.translation_zh || '',
                        grammar_points: (ctx.grammar || []).map(g => ({ title: g.title, explanation: g.explanation })),
                        explanation,
                        variation: variationInput.value.trim(),
                        model: modelSelect.value,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail?.message || data.detail || '请求失败');
                feedback.innerHTML = renderFeynmanFeedback(data);
            } catch (err) {
                feedback.innerHTML = `<p class="fb-error">${escapeHtml(err.message)}</p>`;
            } finally {
                checkBtn.disabled = false;
            }
        });
    }

    function attachSentenceCardEvents(card, targetSentence, transCn = '', transEn = '') {
        // Tab switching
        const tabBtns = card.querySelectorAll('.card-tab-btn');
        const tabPanels = card.querySelectorAll('.card-tab-panel');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetTab = btn.dataset.tab;
                tabBtns.forEach(b => {
                    const isActive = b === btn;
                    b.classList.toggle('active', isActive);
                    b.setAttribute('aria-selected', String(isActive));
                });
                tabPanels.forEach(p => {
                    const isMatch = p.dataset.panel === targetTab;
                    p.classList.toggle('active', isMatch);
                    p.hidden = !isMatch;
                });
                refreshIcons();
            });
        });

        // Multi-sentence accordion toggle
        const accordionHeader = card.querySelector('.card-accordion-header');
        if (accordionHeader) {
            accordionHeader.addEventListener('click', (e) => {
                if (e.target.closest('.btn-accordion-speak')) return;
                const isCollapsed = card.classList.contains('is-accordion-collapsed');
                card.classList.toggle('is-accordion-collapsed', !isCollapsed);
                card.classList.toggle('is-accordion-expanded', isCollapsed);
                refreshIcons();
            });
            const accSpeakBtn = accordionHeader.querySelector('.btn-accordion-speak');
            if (accSpeakBtn) {
                accSpeakBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    accSpeakBtn.style.transform = 'scale(1.2)';
                    playFrenchSpeech(targetSentence, () => {
                        accSpeakBtn.style.transform = '';
                    });
                });
            }
        }

        const btnHeroCollapse = card.querySelector('.btn-hero-collapse');
        if (btnHeroCollapse) {
            btnHeroCollapse.addEventListener('click', (e) => {
                e.stopPropagation();
                card.classList.add('is-accordion-collapsed');
                card.classList.remove('is-accordion-expanded');
                refreshIcons();
            });
        }

        // 0. Interactive Word & Token Click Delegation
        card.addEventListener('click', (e) => {
            const interactiveWord = e.target.closest('.interactive-word');
            if (interactiveWord) {
                e.stopPropagation();
                const word = interactiveWord.dataset.word || interactiveWord.dataset.token || interactiveWord.textContent.trim();
                showPopoverForElement(word, interactiveWord, {
                    sentence: targetSentence,
                    sentence_cn: transCn
                });
                return;
            }
            const tokenWord = e.target.closest('.token-word');
            if (tokenWord) {
                e.stopPropagation();
                const word = tokenWord.textContent.trim();
                showPopoverForElement(word, tokenWord, {
                    sentence: targetSentence,
                    sentence_cn: transCn
                });
                return;
            }
        });

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const interactiveWord = e.target.closest('.interactive-word');
                if (interactiveWord) {
                    e.preventDefault();
                    e.stopPropagation();
                    const word = interactiveWord.dataset.word || interactiveWord.dataset.token || interactiveWord.textContent.trim();
                    showPopoverForElement(word, interactiveWord, {
                        sentence: targetSentence,
                        sentence_cn: transCn
                    });
                }
            }
        });

        // 1. Full Sentence Pronunciation Button
        const heroSpeakBtn = card.querySelector('.btn-speak-round');
        heroSpeakBtn.addEventListener('click', () => {
            heroSpeakBtn.disabled = true;
            playFrenchSpeech(targetSentence, () => {
                heroSpeakBtn.disabled = false;
            });
        });

        // 2. Token Pronunciation Buttons
        const tokenSpeakBtns = card.querySelectorAll('.btn-token-speak');
        tokenSpeakBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const word = btn.dataset.speech;
                if (word) {
                    btn.style.transform = 'scale(1.2)';
                    playFrenchSpeech(word, () => {
                        btn.style.transform = '';
                    });
                }
            });
        });

        // 2b. Build-up Step Pronunciation Buttons
        const buildupSpeakBtns = card.querySelectorAll('.btn-buildup-speak');
        buildupSpeakBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const phrase = btn.dataset.speech;
                if (phrase) {
                    btn.classList.add('playing');
                    btn.style.transform = 'scale(1.05)';
                    playFrenchSpeech(phrase, () => {
                        btn.classList.remove('playing');
                        btn.style.transform = '';
                    });
                }
            });
        });

        // 2c. Pronunciation Tip Audio Buttons & Inline Word Chips
        const tipAudioBtns = card.querySelectorAll('.btn-tip-audio, .chip-tip-audio');
        tipAudioBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const speechText = btn.dataset.speech;
                if (!speechText) return;

                btn.classList.add('playing');
                playFrenchSpeech(speechText, () => {
                    btn.classList.remove('playing');
                });
            });
        });

        // 2b. Feynman self-test
        const selfTest = card.querySelector('.feynman-selftest');
        if (selfTest) bindFeynmanSelfTest(selfTest, targetSentence);

        // 3. Review cards: word star = cloze card, hero button = listen + speak cards
        card.querySelectorAll('.btn-token-star').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTargetCard({
                    token: btn.dataset.token,
                    sentence: btn.dataset.sentence,
                    meta: {
                        meaning_zh: btn.dataset.expCn,
                        meaning_en: btn.dataset.expEn,
                        lemma: btn.dataset.lemma,
                        pos: btn.dataset.pos,
                        ipa: btn.dataset.phonetic,
                    },
                });
            });
        });

        card.querySelectorAll('.btn-sentence-save').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSentenceCards(btn.dataset.sentence);
            });
        });

        // 3c. Word Breakdown Filter Tabs & Function Words Accordion
        const filterBtns = card.querySelectorAll('.btn-words-filter');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filter = btn.dataset.filter;
                const contentGrid = card.querySelector('.words-cards-grid');
                const fwSection = card.querySelector('.function-words-collapse-section');
                const fwGrid = card.querySelector('.function-words-cards-grid');
                const fwSummary = card.querySelector('.function-words-summary-bar');

                if (filter === 'all') {
                    if (contentGrid) contentGrid.hidden = false;
                    if (fwSection) {
                        fwSection.hidden = false;
                        if (fwGrid) fwGrid.hidden = false;
                        if (fwSummary) {
                            fwSummary.classList.add('is-expanded');
                            const label = fwSummary.querySelector('.fw-toggle-label');
                            if (label) label.textContent = '收起解析';
                        }
                    }
                } else if (filter === 'content') {
                    if (contentGrid) contentGrid.hidden = false;
                    if (fwSection) {
                        fwSection.hidden = false;
                        if (fwGrid) fwGrid.hidden = true;
                        if (fwSummary) {
                            fwSummary.classList.remove('is-expanded');
                            const label = fwSummary.querySelector('.fw-toggle-label');
                            if (label) label.textContent = '展开解析';
                        }
                    }
                } else if (filter === 'function') {
                    if (contentGrid) contentGrid.hidden = true;
                    if (fwSection) {
                        fwSection.hidden = false;
                        if (fwGrid) fwGrid.hidden = false;
                        if (fwSummary) {
                            fwSummary.classList.add('is-expanded');
                            const label = fwSummary.querySelector('.fw-toggle-label');
                            if (label) label.textContent = '收起解析';
                        }
                    }
                }
                refreshIcons();
            });
        });

        const fwSummaryBar = card.querySelector('.function-words-summary-bar');
        const fwCardsGrid = card.querySelector('.function-words-cards-grid');
        if (fwSummaryBar && fwCardsGrid) {
            fwSummaryBar.addEventListener('click', () => {
                const isHidden = fwCardsGrid.hidden;
                fwCardsGrid.hidden = !isHidden;
                fwSummaryBar.classList.toggle('is-expanded', isHidden);
                const label = fwSummaryBar.querySelector('.fw-toggle-label');
                if (label) label.textContent = isHidden ? '收起解析' : '展开解析';
                refreshIcons();
            });
            fwSummaryBar.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fwSummaryBar.click();
                }
            });
        }

        // 4. Shadowing Controllers (Main sentence + Every buildup step!)
        function bindShadowingController(scopeElement, sentenceText, transNote = '', isCompact = false) {
            if (!scopeElement || !sentenceText) return;

            const recordBtn = scopeElement.querySelector('.btn-record, .btn-buildup-record');
            if (!recordBtn) return;

            const recordBtnText = recordBtn.querySelector('.record-btn-text, .buildup-record-label');
            const scoreCard = scopeElement.querySelector('.score-result-card, .buildup-score-card');
            if (!scoreCard) return;

            const scorePill = scoreCard.querySelector('.score-number-pill');
            const scoreRatingText = scoreCard.querySelector('.score-rating-text');
            const metricAcc = scoreCard.querySelector('.metric-acc');
            const metricComp = scoreCard.querySelector('.metric-comp');
            const diffBox = scoreCard.querySelector('.diff-result-box');
            const playModelBtn = scoreCard.querySelector('.btn-play-model, .btn-buildup-play-model');
            const playUserBtn = scoreCard.querySelector('.btn-play-user, .btn-buildup-play-user');
            const retryBtn = scoreCard.querySelector('.btn-retry, .btn-buildup-retry');

            let mediaRecorder = null;
            let audioChunks = [];
            let userAudioUrl = null;
            let isRecording = false;
            let recognition = null;
            let recognitionTranscript = '';

            let isModelPlaying = false;
            let isUserPlaying = false;

            const modelLabel = (playModelBtn && playModelBtn.dataset.label) || (isCompact ? '范读' : '官方范读');

            function resetModelBtn() {
                isModelPlaying = false;
                if (playModelBtn) {
                    playModelBtn.classList.remove('playing');
                    playModelBtn.innerHTML = `<i data-lucide="volume-2"></i><span>${modelLabel}</span>`;
                    refreshIcons();
                }
            }

            function resetUserBtn() {
                isUserPlaying = false;
                if (playUserBtn) {
                    playUserBtn.classList.remove('playing');
                    playUserBtn.innerHTML = `<i data-lucide="play"></i><span>我的录音</span>`;
                    refreshIcons();
                }
            }

            if (playModelBtn) {
                playModelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isModelPlaying) {
                        stopAllAudio();
                        return;
                    }

                    stopAllAudio();

                    isModelPlaying = true;
                    playModelBtn.classList.add('playing');
                    playModelBtn.innerHTML = `<i data-lucide="square"></i><span>停止</span>`;
                    refreshIcons();

                    playFrenchSpeech(sentenceText, () => {
                        resetModelBtn();
                    });
                });
            }

            if (playUserBtn) {
                playUserBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!userAudioUrl) return;

                    if (isUserPlaying) {
                        stopAllAudio();
                        return;
                    }

                    stopAllAudio();

                    const userAudio = new Audio(userAudioUrl);
                    currentActiveAudio = userAudio;

                    isUserPlaying = true;
                    playUserBtn.classList.add('playing');
                    playUserBtn.innerHTML = `<i data-lucide="square"></i><span>停止</span>`;
                    refreshIcons();

                    let finished = false;
                    const handleUserAudioEnd = () => {
                        if (finished) return;
                        finished = true;
                        if (currentActiveAudio === userAudio) {
                            currentActiveAudio = null;
                        }
                        if (currentAudioCleanup === userCleanup) {
                            currentAudioCleanup = null;
                        }
                        resetUserBtn();
                    };

                    const userCleanup = () => {
                        if (!finished) {
                            finished = true;
                            resetUserBtn();
                        }
                    };
                    currentAudioCleanup = userCleanup;

                    userAudio.addEventListener('ended', handleUserAudioEnd);
                    userAudio.addEventListener('error', handleUserAudioEnd);

                    userAudio.play().catch(err => {
                        console.warn('User audio play interrupted or failed:', err);
                        handleUserAudioEnd();
                    });
                });
            }

            if (diffBox) {
                diffBox.addEventListener('click', (e) => {
                    const diffWord = e.target.closest('.diff-word');
                    if (!diffWord) return;
                    e.stopPropagation();
                    const word = diffWord.dataset.word || diffWord.textContent.trim();
                    showPopoverForElement(word, diffWord, {
                        sentence: sentenceText,
                        sentence_cn: transNote
                    });
                });
            }

            if (retryBtn) {
                retryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    stopAllAudio();
                    scoreCard.hidden = true;
                    recordBtn.click();
                });
            }

            recordBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isRecording) {
                    stopRecording();
                } else {
                    await startRecording();
                }
            });

            async function startRecording() {
                try {
                    stopAllAudio();
                    stopAnyOngoingRecording();

                    audioChunks = [];
                    recognitionTranscript = '';

                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    mediaRecorder.ondataavailable = (e) => {
                        if (e.data.size > 0) audioChunks.push(e.data);
                    };
                    mediaRecorder.onstop = () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                        if (userAudioUrl) URL.revokeObjectURL(userAudioUrl);
                        userAudioUrl = URL.createObjectURL(audioBlob);
                        if (playUserBtn) playUserBtn.disabled = false;
                        resetUserBtn();
                        stream.getTracks().forEach(track => track.stop());
                    };
                    mediaRecorder.start();

                    if (SpeechRecognition) {
                        recognition = new SpeechRecognition();
                        recognition.lang = 'fr-FR';
                        recognition.continuous = true;
                        recognition.interimResults = true;

                        recognition.onresult = (event) => {
                            let finalTrans = '';
                            for (let i = 0; i < event.results.length; ++i) {
                                finalTrans += event.results[i][0].transcript + ' ';
                            }
                            recognitionTranscript = finalTrans.trim();
                        };

                        recognition.onerror = (event) => {
                            console.warn('SpeechRecognition error:', event.error);
                        };

                        recognition.start();
                    }

                    isRecording = true;
                    currentGlobalRecordingStopper = stopRecording;
                    recordBtn.classList.add('recording');
                    if (recordBtnText) {
                        recordBtnText.textContent = isCompact ? '⏹ 点击评测' : '⏹ 朗读完成，点击评测';
                    }
                } catch (err) {
                    alert('无法调用麦克风：' + err.message);
                }
            }

            function stopRecording() {
                if (!isRecording) return;
                isRecording = false;
                if (currentGlobalRecordingStopper === stopRecording) {
                    currentGlobalRecordingStopper = null;
                }
                recordBtn.classList.remove('recording');
                if (recordBtnText) {
                    recordBtnText.textContent = '🎙 再次跟读';
                }

                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                }

                if (recognition) {
                    try {
                        recognition.stop();
                    } catch (e) {}
                }

                setTimeout(() => {
                    evaluateAndDisplay();
                }, 500);
            }

            function evaluateAndDisplay() {
                const evaluation = evaluateFrenchPronunciation(sentenceText, recognitionTranscript);

                if (scorePill) {
                    scorePill.textContent = `${evaluation.overallScore}`;
                    scorePill.className = `score-number-pill ${isCompact ? 'sm' : ''} ${evaluation.ratingClass}`;
                }
                if (scoreRatingText) scoreRatingText.textContent = evaluation.ratingText;
                if (metricAcc) metricAcc.textContent = `${evaluation.accuracy}%`;
                if (metricComp) metricComp.textContent = `${evaluation.completeness}%`;

                if (diffBox) {
                    diffBox.innerHTML = '';
                    if (evaluation.wordResults.length > 0) {
                        evaluation.wordResults.forEach(item => {
                            const wordSpan = document.createElement('span');
                            wordSpan.className = `diff-word ${item.status}`;
                            wordSpan.textContent = item.word;
                            wordSpan.dataset.word = item.word;
                            wordSpan.title = `相似度得分: ${item.score} / 100 · 点击查看释义与单读发音`;
                            diffBox.appendChild(wordSpan);
                            diffBox.appendChild(document.createTextNode(' '));
                        });
                    } else {
                        diffBox.textContent = recognitionTranscript || '未检测到清晰发音，请重试。';
                    }
                }

                scoreCard.hidden = false;
                // Automatically unmask this step if in blind mode
                scopeElement.classList.add('step-revealed');
                scopeElement.querySelectorAll('.buildup-new-token').forEach(t => t.classList.add('revealed'));
                refreshIcons();
            }
        }

        // Attach controller to the main sentence shadowing panel (bottom of card)
        const mainShadowingPanel = card.querySelector('.shadowing-panel');
        if (mainShadowingPanel) {
            bindShadowingController(mainShadowingPanel, targetSentence, transCn, false);
        }

        // Attach controller to EVERY step in Sentence Build-up (一层一层搭句子逐句跟读打分!)
        const stepRows = card.querySelectorAll('.buildup-step-row');
        stepRows.forEach(stepRow => {
            const stepRecordBtn = stepRow.querySelector('.btn-buildup-record');
            const stepSentence = stepRecordBtn ? stepRecordBtn.dataset.sentence : null;
            if (stepSentence) {
                bindShadowingController(stepRow, stepSentence, transCn, true);
            }
        });

        // 5. Feynman Blind Mode Toggle & Cloze Click Handlers
        const buildupSection = card.querySelector('.buildup-section');
        if (buildupSection) {
            const stepsList = buildupSection.querySelector('.buildup-steps-list');
            const feynmanToggles = buildupSection.querySelectorAll('.btn-feynman-toggle');
            const tipBanner = buildupSection.querySelector('.feynman-tip-banner');
            const revealAllBtn = buildupSection.querySelector('.btn-reveal-all');

            feynmanToggles.forEach(toggleBtn => {
                toggleBtn.addEventListener('click', () => {
                    const mode = toggleBtn.dataset.mode;
                    feynmanToggles.forEach(b => b.classList.toggle('active', b === toggleBtn));

                    if (mode === 'blind') {
                        if (stepsList) stepsList.classList.add('is-blind-mode');
                        if (tipBanner) tipBanner.hidden = false;
                        if (revealAllBtn) {
                            revealAllBtn.dataset.revealed = 'false';
                            revealAllBtn.textContent = '一键揭晓';
                        }
                    } else {
                        if (stepsList) stepsList.classList.remove('is-blind-mode');
                        if (tipBanner) tipBanner.hidden = true;
                    }
                    refreshIcons();
                });
            });

            if (revealAllBtn && stepsList) {
                revealAllBtn.addEventListener('click', () => {
                    const isAllRevealed = revealAllBtn.dataset.revealed === 'true';
                    const allTokens = stepsList.querySelectorAll('.buildup-new-token');
                    const allStepRows = stepsList.querySelectorAll('.buildup-step-row');

                    if (isAllRevealed) {
                        allTokens.forEach(t => t.classList.remove('revealed'));
                        allStepRows.forEach(r => r.classList.remove('step-revealed'));
                        revealAllBtn.dataset.revealed = 'false';
                        revealAllBtn.textContent = '一键揭晓';
                    } else {
                        allTokens.forEach(t => t.classList.add('revealed'));
                        allStepRows.forEach(r => r.classList.add('step-revealed'));
                        revealAllBtn.dataset.revealed = 'true';
                        revealAllBtn.textContent = '重新遮挡';
                    }
                });
            }

            // Click individual cloze token to reveal/re-mask
            if (stepsList) {
                stepsList.addEventListener('click', (e) => {
                    if (!stepsList.classList.contains('is-blind-mode')) return;

                    const token = e.target.closest('.buildup-new-token');
                    if (token) {
                        token.classList.toggle('revealed');
                        return;
                    }

                    const firstRowText = e.target.closest('.buildup-step-row:first-child .buildup-fr-text');
                    if (firstRowText) {
                        const firstRow = firstRowText.closest('.buildup-step-row');
                        if (firstRow) firstRow.classList.toggle('step-revealed');
                    }
                });
            }
        }
    }
    window.renderStudyDeck = renderStudyDeck;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // -------------------------------------------------------------------------
    // 6. User Account (login only; sign-up is closed for this personal tool)
    // -------------------------------------------------------------------------
    const userTokenKey = 'frenchStudio.userToken';
    let currentAuthTab = 'login';
    let currentAuthUser = null;

    function openAuthModal() {
        if (authErrorMsg) authErrorMsg.hidden = true;
        if (currentAuthUser) {
            if (authFormContainer) authFormContainer.hidden = true;
            if (authUserProfile) authUserProfile.hidden = false;
        } else {
            if (authFormContainer) authFormContainer.hidden = false;
            if (authUserProfile) authUserProfile.hidden = true;
            switchAuthTab(currentAuthTab);
        }
        if (authModal) authModal.hidden = false;
        refreshIcons();
    }

    function closeAuthModal() {
        if (authModal) authModal.hidden = true;
    }

    function switchAuthTab(tab) {
        currentAuthTab = tab;
        if (authErrorMsg) authErrorMsg.hidden = true;
        if (authSubmitLabel) authSubmitLabel.textContent = '登录';
        refreshIcons();
    }

    async function checkCurrentUser() {
        const token = localStorage.getItem(userTokenKey);
        if (!token) {
            updateAuthUI(null);
            return;
        }
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) {
                localStorage.removeItem(userTokenKey);
                updateAuthUI(null);
                return;
            }
            const user = await res.json();
            currentAuthUser = user;
            updateAuthUI(user);
        } catch (e) {
            console.warn('Check user failed:', e);
        }
    }

    function updateAuthUI(user) {
        if (user) {
            currentAuthUser = user;
            const shortName = user.email.split('@')[0];
            if (userAuthStatusText) userAuthStatusText.textContent = shortName;
            if (userTrialBadge) {
                userTrialBadge.textContent = `剩 ${user.days_left} 天`;
                userTrialBadge.hidden = user.plan === 'pro';
            }
            if (profileEmail) profileEmail.textContent = user.email;
            if (profileBadge) profileBadge.textContent = user.plan === 'pro' ? '长期有效' : `有效期剩 ${user.days_left} 天`;
        } else {
            currentAuthUser = null;
            if (userAuthStatusText) userAuthStatusText.textContent = '登录';
            if (userTrialBadge) userTrialBadge.hidden = true;
        }
        refreshIcons();
    }

    async function handleAuthSubmit(e) {
        e.preventDefault();
        const email = authEmailInput ? authEmailInput.value.trim() : '';
        const password = authPasswordInput ? authPasswordInput.value.trim() : '';
        if (!email || !password) return;

        if (authErrorMsg) authErrorMsg.hidden = true;
        if (authSubmitBtn) authSubmitBtn.disabled = true;

        const endpoint = '/api/auth/login';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail?.message || data.detail || '操作失败');
            }

            localStorage.setItem(userTokenKey, data.token);
            updateAuthUI(data.user);
            closeAuthModal();
            refreshDueBadge();
            const renderedSentences = Array.from(document.querySelectorAll('.btn-sentence-save'))
                .map(btn => ({ sentence: btn.dataset.sentence }));
            refreshSrsStates(renderedSentences);
            statusMessage.className = 'status-message status-success';
            statusMessage.textContent = '登录成功！欢迎回来。';
        } catch (err) {
            if (authErrorMsg) {
                authErrorMsg.textContent = err.message;
                authErrorMsg.hidden = false;
            }
        } finally {
            if (authSubmitBtn) authSubmitBtn.disabled = false;
        }
    }

    function handleLogout() {
        localStorage.removeItem(userTokenKey);
        srsNotesByKey.clear();
        updateTableStarStates();
        refreshDueBadge();
        updateAuthUI(null);
        closeAuthModal();
        statusMessage.className = 'status-message status-info';
        statusMessage.textContent = '已退出登录。';
    }

    // -------------------------------------------------------------------------
    // 7. Query History Manager (Unified via FrenchHistory)
    // -------------------------------------------------------------------------
    function saveHistoryItem(text, sentences) {
        if (!text || !sentences || sentences.length === 0) return;
        if (window.FrenchHistory) {
            window.FrenchHistory.saveStudyRecord(text, sentences, modelSelect ? modelSelect.value : 'grok-4.6');
        }
    }

    function updateHistoryBadges() {
        if (window.FrenchHistory) {
            window.FrenchHistory.updateBadges();
        }
    }


    // -------------------------------------------------------------------------
    // 8. Interactive Word Breakdown & Lexical Popover (A1 Beginner Optimized)
    // -------------------------------------------------------------------------
    function formatFriendlyPhonetic(raw) {
        if (!raw) return '';
        let str = String(raw).trim();
        str = str.replace(/^[/[\\(\s]+/, '').replace(/[/\]\\)\s]+$/, '').trim();
        str = str.replace(/[.·•\-]/g, '');
        str = str.replace(/[ʁʀ]/g, 'r');
        str = str.replace(/ɡ/g, 'g');
        if (!str) return '';
        return `[${str}]`;
    }

    const BASIC_FRENCH_WORDS = {
        // Pronouns
        "je": { token: "je", lemma: "je", pos: "pron. pers.", phonetic: "/ʒə/", explanation_cn: "我 (第一人称单数主格代词)", explanation_en: "I (subject pronoun)" },
        "j'": { token: "j'", lemma: "je", pos: "pron. pers.", phonetic: "/ʒ/", explanation_cn: "我 (je 在元音或哑音h前的省音形式)", explanation_en: "I (elision of je)" },
        "tu": { token: "tu", lemma: "tu", pos: "pron. pers.", phonetic: "/ty/", explanation_cn: "你 (第二人称单数主格代词)", explanation_en: "you (singular/informal)" },
        "il": { token: "il", lemma: "il", pos: "pron. pers.", phonetic: "/il/", explanation_cn: "他 / 它 (第三人称阳性单数主格代词)", explanation_en: "he / it" },
        "elle": { token: "elle", lemma: "elle", pos: "pron. pers.", phonetic: "/ɛl/", explanation_cn: "她 / 它 (第三人称阴性单数主格代词)", explanation_en: "she / it" },
        "on": { token: "on", lemma: "on", pos: "pron. indéf.", phonetic: "/ɔ̃/", explanation_cn: "人们 / 我们 (泛指人称代词，常作口语中的我们)", explanation_en: "one / we / people" },
        "nous": { token: "nous", lemma: "nous", pos: "pron. pers.", phonetic: "/nu/", explanation_cn: "我们 (第一人称复数代词)", explanation_en: "we / us" },
        "vous": { token: "vous", lemma: "vous", pos: "pron. pers.", phonetic: "/vu/", explanation_cn: "您 / 你们 (第二人称尊称或复数代词)", explanation_en: "you (formal/plural)" },
        "ils": { token: "ils", lemma: "ils", pos: "pron. pers.", phonetic: "/il/", explanation_cn: "他们 (第三人称阳性复数代词)", explanation_en: "they (masculine)" },
        "elles": { token: "elles", lemma: "elles", pos: "pron. pers.", phonetic: "/ɛl/", explanation_cn: "她们 (第三人称阴性复数代词)", explanation_en: "they (feminine)" },
        "me": { token: "me", lemma: "me", pos: "pron. pers.", phonetic: "/mə/", explanation_cn: "我 / 我自己 (第一人称宾格/自反代词)", explanation_en: "me / myself" },
        "m'": { token: "m'", lemma: "me", pos: "pron. pers.", phonetic: "/m/", explanation_cn: "我 / 我自己 (me 在元音前的省音形式)", explanation_en: "me / myself (elision of me)" },
        "te": { token: "te", lemma: "te", pos: "pron. pers.", phonetic: "/tə/", explanation_cn: "你 / 你自己 (第二人称宾格/自反代词)", explanation_en: "you / yourself" },
        "t'": { token: "t'", lemma: "te", pos: "pron. pers.", phonetic: "/t/", explanation_cn: "你 / 你自己 (te 在元音前的省音形式)", explanation_en: "you / yourself (elision of te)" },
        "se": { token: "se", lemma: "se", pos: "pron. réfl.", phonetic: "/sə/", explanation_cn: "他自己/她自己/他们自己 (第三人称自反代词)", explanation_en: "himself / herself / themselves" },
        "s'": { token: "s'", lemma: "se", pos: "pron. réfl.", phonetic: "/s/", explanation_cn: "自反代词 (se 在元音前的省音形式)", explanation_en: "himself / herself (elision of se)" },
        "moi": { token: "moi", lemma: "moi", pos: "pron. tonique", phonetic: "/mwa/", explanation_cn: "我 (重读人称代词)", explanation_en: "me (disjunctive pronoun)" },
        "toi": { token: "toi", lemma: "toi", pos: "pron. tonique", phonetic: "/twa/", explanation_cn: "你 (重读人称代词)", explanation_en: "you (disjunctive pronoun)" },
        "lui": { token: "lui", lemma: "lui", pos: "pron. pers.", phonetic: "/lɥi/", explanation_cn: "他 / 她 (重读代词或间接宾语代词: 向他/向她)", explanation_en: "him / her / to him / to her" },
        "leur": { token: "leur", lemma: "leur", pos: "pron. / adj.", phonetic: "/lœʁ/", explanation_cn: "向他们 (间接宾格代词) 或 他们的 (主有形容词)", explanation_en: "to them / their" },
        "y": { token: "y", lemma: "y", pos: "pron. adv.", phonetic: "/i/", explanation_cn: "在那里 / 对某事 (副代词，代替 à+名词等)", explanation_en: "there / in it / to it" },
        "en": { token: "en", lemma: "en", pos: "pron. / prép.", phonetic: "/ɑ̃/", explanation_cn: "副代词 (从中，一些) 或 介词 (在…中，乘…)", explanation_en: "of it / some / in / by" },

        // Demonstratives & Relatives
        "ce": { token: "ce", lemma: "ce", pos: "adj. / pron.", phonetic: "/sə/", explanation_cn: "这个 (阳性指示形容词) 或 这/它 (指示代词)", explanation_en: "this / that / it" },
        "c'": { token: "c'", lemma: "ce", pos: "pron. dém.", phonetic: "/s/", explanation_cn: "这 / 它 (ce 在元音前的省音形式，如 c'est)", explanation_en: "this / it (elision of ce)" },
        "cet": { token: "cet", lemma: "ce", pos: "adj. dém.", phonetic: "/sɛt/", explanation_cn: "这个 (ce 在元音或哑音h开头的阳性单数名词前)", explanation_en: "this / that (masc. before vowel)" },
        "cette": { token: "cette", lemma: "ce", pos: "adj. dém.", phonetic: "/sɛt/", explanation_cn: "这个 (阴性单数指示形容词)", explanation_en: "this / that (feminine)" },
        "ces": { token: "ces", lemma: "ce", pos: "adj. dém.", phonetic: "/se/", explanation_cn: "这些 / 那些 (复数指示形容词)", explanation_en: "these / those" },
        "ça": { token: "ça", lemma: "cela", pos: "pron. dém.", phonetic: "/sa/", explanation_cn: "这个 / 那个 (指示代词口语形式)", explanation_en: "that / this / it" },
        "qui": { token: "qui", lemma: "qui", pos: "pron. rel.", phonetic: "/ki/", explanation_cn: "谁 / 哪个 (主格关系代词或疑问代词)", explanation_en: "who / which / that" },
        "que": { token: "que", lemma: "que", pos: "pron. / conj.", phonetic: "/kə/", explanation_cn: "宾格关系代词 (什么/引导从句) 或 比较级连接词 (比)", explanation_en: "what / that / than" },
        "qu'": { token: "qu'", lemma: "que", pos: "pron. / conj.", phonetic: "/k/", explanation_cn: "que 在元音开头的省音形式", explanation_en: "what / that (elision of que)" },
        "quoi": { token: "quoi", lemma: "quoi", pos: "pron. interr.", phonetic: "/kwa/", explanation_cn: "什么 (重读疑问代词)", explanation_en: "what" },
        "dont": { token: "dont", lemma: "dont", pos: "pron. rel.", phonetic: "/dɔ̃/", explanation_cn: "其中 / 关于它的 (代替 de+先行词 的关系代词)", explanation_en: "whose / of which" },

        // Articles & Contractions
        "le": { token: "le", lemma: "le", pos: "art. déf.", phonetic: "/lə/", explanation_cn: "定冠词 (阳性单数): 这个 / 表特指或类别", explanation_en: "the (masculine singular)" },
        "la": { token: "la", lemma: "la", pos: "art. déf.", phonetic: "/la/", explanation_cn: "定冠词 (阴性单数): 这个 / 表特指或类别", explanation_en: "the (feminine singular)" },
        "les": { token: "les", lemma: "le", pos: "art. déf.", phonetic: "/le/", explanation_cn: "定冠词 (复数): 这些 / 那些", explanation_en: "the (plural)" },
        "l'": { token: "l'", lemma: "le", pos: "art. déf.", phonetic: "/l/", explanation_cn: "定冠词 (le/la 在元音或哑音h前的省音形式)", explanation_en: "the (elision of le/la)" },
        "un": { token: "un", lemma: "un", pos: "art. indéf.", phonetic: "/œ̃/", explanation_cn: "一个 (阳性单数不定冠词 / 数词1)", explanation_en: "a / an / one (masculine)" },
        "une": { token: "une", lemma: "un", pos: "art. indéf.", phonetic: "/yn/", explanation_cn: "一个 (阴性单数不定冠词 / 数词1)", explanation_en: "a / an / one (feminine)" },
        "des": { token: "des", lemma: "des", pos: "art. indéf. / contracté", phonetic: "/de/", explanation_cn: "1. 不定冠词复数 (一些，若干); 2. 缩合冠词 de+les (来自…的)", explanation_en: "some / of the (plural)" },
        "du": { token: "du", lemma: "du", pos: "art. part. / contracté", phonetic: "/dy/", explanation_cn: "1. 部分冠词 (一些阳性不可数); 2. 缩合冠词 de+le (来自…的)", explanation_en: "some / of the (contraction of de + le)" },
        "au": { token: "au", lemma: "à + le", pos: "art. contracté", phonetic: "/o/", explanation_cn: "在…，去… (介词 à 与阳性定冠词 le 的缩合形式)", explanation_en: "at the / to the (contraction of à + le)" },
        "aux": { token: "aux", lemma: "à + les", pos: "art. contracté", phonetic: "/o/", explanation_cn: "在…，去… (介词 à 与复数定冠词 les 的缩合形式)", explanation_en: "at the / to the (contraction of à + les)" },

        // Prepositions
        "à": { token: "à", lemma: "à", pos: "prép.", phonetic: "/a/", explanation_cn: "在，到，向，给 (基础介词)", explanation_en: "at, to, in" },
        "de": { token: "de", lemma: "de", pos: "prép.", phonetic: "/də/", explanation_cn: "…的，来自，从，关于 (基础介词)", explanation_en: "of, from, about" },
        "d'": { token: "d'", lemma: "de", pos: "prép.", phonetic: "/d/", explanation_cn: "…的，从，来自 (de 在元音或哑音h前的省音形式)", explanation_en: "of, from (elision of de)" },
        "dans": { token: "dans", lemma: "dans", pos: "prép.", phonetic: "/dɑ̃/", explanation_cn: "在…里面，在…之内，在…之后(时间)", explanation_en: "in, inside, into" },
        "pour": { token: "pour", lemma: "pour", pos: "prép.", phonetic: "/puʁ/", explanation_cn: "为了，对于，给", explanation_en: "for, in order to" },
        "avec": { token: "avec", lemma: "avec", pos: "prép.", phonetic: "/a.vɛk/", explanation_cn: "和…一起，带有，用", explanation_en: "with" },
        "sur": { token: "sur", lemma: "sur", pos: "prép.", phonetic: "/syʁ/", explanation_cn: "在…上面，关于", explanation_en: "on, upon, above" },
        "sous": { token: "sous", lemma: "sous", pos: "prép.", phonetic: "/su/", explanation_cn: "在…下面", explanation_en: "under, beneath" },
        "par": { token: "par", lemma: "par", pos: "prép.", phonetic: "/paʁ/", explanation_cn: "由，被，通过，经由", explanation_en: "by, through" },
        "chez": { token: "chez", lemma: "chez", pos: "prép.", phonetic: "/ʃe/", explanation_cn: "在…家，在…处", explanation_en: "at the home/place of" },
        "sans": { token: "sans", lemma: "sans", pos: "prép.", phonetic: "/sɑ̃/", explanation_cn: "没有，无", explanation_en: "without" },
        "vers": { token: "vers", lemma: "vers", pos: "prép.", phonetic: "/vɛʁ/", explanation_cn: "朝向，接近", explanation_en: "towards, around" },
        "entre": { token: "entre", lemma: "entre", pos: "prép.", phonetic: "/ɑ̃tʁ/", explanation_cn: "在…之间", explanation_en: "between, among" },
        "pendant": { token: "pendant", lemma: "pendant", pos: "prép.", phonetic: "/pɑ̃.dɑ̃/", explanation_cn: "在…期间", explanation_en: "during, for" },
        "avant": { token: "avant", lemma: "avant", pos: "prép.", phonetic: "/a.vɑ̃/", explanation_cn: "在…之前", explanation_en: "before" },
        "après": { token: "après", lemma: "après", pos: "prép.", phonetic: "/a.pʁɛ/", explanation_cn: "在…之后", explanation_en: "after" },
        "depuis": { token: "depuis", lemma: "depuis", pos: "prép.", phonetic: "/də.pɥi/", explanation_cn: "自从，已有…时间", explanation_en: "since, for" },

        // Conjunctions
        "et": { token: "et", lemma: "et", pos: "conj.", phonetic: "/e/", explanation_cn: "和，与，并且 (并列连词，注意从不联诵)", explanation_en: "and" },
        "ou": { token: "ou", lemma: "ou", pos: "conj.", phonetic: "/u/", explanation_cn: "或者，还是 (选择连词)", explanation_en: "or" },
        "où": { token: "où", lemma: "où", pos: "adv. / pron.", phonetic: "/u/", explanation_cn: "在哪里，在…的地方 (疑问副词或关系代词)", explanation_en: "where" },
        "mais": { token: "mais", lemma: "mais", pos: "conj.", phonetic: "/mɛ/", explanation_cn: "但是，可是 (转折连词)", explanation_en: "but" },
        "donc": { token: "donc", lemma: "donc", pos: "conj.", phonetic: "/dɔ̃k/", explanation_cn: "因此，所以", explanation_en: "therefore, so" },
        "car": { token: "car", lemma: "car", pos: "conj.", phonetic: "/kaʁ/", explanation_cn: "因为 (并列连词)", explanation_en: "because, for" },
        "ni": { token: "ni", lemma: "ni", pos: "conj.", phonetic: "/ni/", explanation_cn: "既不…也不…", explanation_en: "neither / nor" },
        "si": { token: "si", lemma: "si", pos: "conj. / adv.", phonetic: "/si/", explanation_cn: "如果 (条件从句) / 对否定的肯定回答: 怎么不", explanation_en: "if / so / yes" },
        "comme": { token: "comme", lemma: "comme", pos: "conj. / adv.", phonetic: "/kɔm/", explanation_cn: "如同，正如，既然，因为", explanation_en: "as, like, since" },
        "quand": { token: "quand", lemma: "quand", pos: "conj.", phonetic: "/kɑ̃/", explanation_cn: "当…的时候", explanation_en: "when" },

        // Negations & Adverbs
        "ne": { token: "ne", lemma: "ne", pos: "adv. nég.", phonetic: "/nə/", explanation_cn: "不 (否定词前半部分，与 pas 搭配)", explanation_en: "not (negative particle)" },
        "n'": { token: "n'", lemma: "ne", pos: "adv. nég.", phonetic: "/n/", explanation_cn: "不 (ne 在元音前的省音形式)", explanation_en: "not (elision of ne)" },
        "pas": { token: "pas", lemma: "pas", pos: "adv. nég.", phonetic: "/pa/", explanation_cn: "不，没有 (否定核心副词)", explanation_en: "not" },
        "plus": { token: "plus", lemma: "plus", pos: "adv.", phonetic: "/ply/ 或 /plys/", explanation_cn: "更多，再加上；在否定句 ne...plus 中表不再", explanation_en: "more / no more" },
        "jamais": { token: "jamais", lemma: "jamais", pos: "adv.", phonetic: "/ʒa.mɛ/", explanation_cn: "从不，绝不 (ne...jamais)", explanation_en: "never" },
        "rien": { token: "rien", lemma: "rien", pos: "pron. indéf.", phonetic: "/ʁjɛ̃/", explanation_cn: "什么也没有，无事 (ne...rien)", explanation_en: "nothing" },
        "toujours": { token: "toujours", lemma: "toujours", pos: "adv.", phonetic: "/tu.ʒuʁ/", explanation_cn: "总是，一直，仍然", explanation_en: "always, still" },
        "souvent": { token: "souvent", lemma: "souvent", pos: "adv.", phonetic: "/su.vɑ̃/", explanation_cn: "经常，常常", explanation_en: "often" },
        "très": { token: "très", lemma: "très", pos: "adv.", phonetic: "/tʁɛ/", explanation_cn: "非常，很", explanation_en: "very" },
        "bien": { token: "bien", lemma: "bien", pos: "adv.", phonetic: "/bjɛ̃/", explanation_cn: "好，很好，确实", explanation_en: "well, good" },
        "mal": { token: "mal", lemma: "mal", pos: "adv. / n.m.", phonetic: "/mal/", explanation_cn: "坏，糟糕，不好；痛苦", explanation_en: "badly, poor" },
        "ici": { token: "ici", lemma: "ici", pos: "adv.", phonetic: "/i.si/", explanation_cn: "这里，这儿", explanation_en: "here" },
        "là": { token: "là", lemma: "là", pos: "adv.", phonetic: "/la/", explanation_cn: "那里，那儿", explanation_en: "there" },
        "trop": { token: "trop", lemma: "trop", pos: "adv.", phonetic: "/tʁo/", explanation_cn: "太，过于，过多", explanation_en: "too, too much" },
        "beaucoup": { token: "beaucoup", lemma: "beaucoup", pos: "adv.", phonetic: "/bo.ku/", explanation_cn: "许多，很多", explanation_en: "a lot, much" },
        "peu": { token: "peu", lemma: "peu", pos: "adv.", phonetic: "/pø/", explanation_cn: "少，不多", explanation_en: "little, few" },
        "aussi": { token: "aussi", lemma: "aussi", pos: "adv.", phonetic: "/o.si/", explanation_cn: "也，同样地", explanation_en: "also, too" },
        "maintenant": { token: "maintenant", lemma: "maintenant", pos: "adv.", phonetic: "/mɛ̃t.nɑ̃/", explanation_cn: "现在，如今", explanation_en: "now" },
        "aujourd'hui": { token: "aujourd'hui", lemma: "aujourd'hui", pos: "adv.", phonetic: "/o.ʒuʁ.dɥi/", explanation_cn: "今天", explanation_en: "today" },
        "hier": { token: "hier", lemma: "hier", pos: "adv.", phonetic: "/jɛʁ/", explanation_cn: "昨天", explanation_en: "yesterday" },
        "demain": { token: "demain", lemma: "demain", pos: "adv.", phonetic: "/də.mɛ̃/", explanation_cn: "明天", explanation_en: "tomorrow" },
        "oui": { token: "oui", lemma: "oui", pos: "adv.", phonetic: "/wi/", explanation_cn: "是，是的", explanation_en: "yes" },
        "non": { token: "non", lemma: "non", pos: "adv.", phonetic: "/nɔ̃/", explanation_cn: "不，不是", explanation_en: "no" },
        "merci": { token: "merci", lemma: "merci", pos: "interj. / n.", phonetic: "/mɛʁ.si/", explanation_cn: "谢谢", explanation_en: "thank you" },
        "bonjour": { token: "bonjour", lemma: "bonjour", pos: "interj. / n.m.", phonetic: "/bɔ̃.ʒuʁ/", explanation_cn: "你好，早上好", explanation_en: "hello, good morning" },

        // Possessives
        "mon": { token: "mon", lemma: "mon", pos: "adj. poss.", phonetic: "/mɔ̃/", explanation_cn: "我的 (阳性单数)", explanation_en: "my (masculine)" },
        "ma": { token: "ma", lemma: "mon", pos: "adj. poss.", phonetic: "/ma/", explanation_cn: "我的 (阴性单数)", explanation_en: "my (feminine)" },
        "mes": { token: "mes", lemma: "mon", pos: "adj. poss.", phonetic: "/me/", explanation_cn: "我的 (复数)", explanation_en: "my (plural)" },
        "ton": { token: "ton", lemma: "ton", pos: "adj. poss.", phonetic: "/tɔ̃/", explanation_cn: "你的 (阳性单数)", explanation_en: "your (masculine)" },
        "ta": { token: "ta", lemma: "ton", pos: "adj. poss.", phonetic: "/ta/", explanation_cn: "你的 (阴性单数)", explanation_en: "your (feminine)" },
        "tes": { token: "tes", lemma: "ton", pos: "adj. poss.", phonetic: "/te/", explanation_cn: "你的 (复数)", explanation_en: "your (plural)" },
        "son": { token: "son", lemma: "son", pos: "adj. poss.", phonetic: "/sɔ̃/", explanation_cn: "他的 / 她的 (阳性单数)", explanation_en: "his / her / its (masculine)" },
        "sa": { token: "sa", lemma: "son", pos: "adj. poss.", phonetic: "/sa/", explanation_cn: "他的 / 她的 (阴性单数)", explanation_en: "his / her / its (feminine)" },
        "ses": { token: "ses", lemma: "son", pos: "adj. poss.", phonetic: "/se/", explanation_cn: "他的 / 她的 (复数)", explanation_en: "his / her / its (plural)" },
        "notre": { token: "notre", lemma: "notre", pos: "adj. poss.", phonetic: "/nɔtʁ/", explanation_cn: "我们的 (单数)", explanation_en: "our" },
        "nos": { token: "nos", lemma: "notre", pos: "adj. poss.", phonetic: "/no/", explanation_cn: "我们的 (复数)", explanation_en: "our (plural)" },
        "votre": { token: "votre", lemma: "votre", pos: "adj. poss.", phonetic: "/vɔtʁ/", explanation_cn: "您的 / 你们的 (单数)", explanation_en: "your" },
        "vos": { token: "vos", lemma: "votre", pos: "adj. poss.", phonetic: "/vo/", explanation_cn: "您的 / 你们的 (复数)", explanation_en: "your (plural)" },

        // Verbs: être
        "être": { token: "être", lemma: "être", pos: "v. aux.", phonetic: "/ɛtʁ/", explanation_cn: "是，存在 (动词原形/助动词)", explanation_en: "to be" },
        "suis": { token: "suis", lemma: "être", pos: "v.", phonetic: "/sɥi/", explanation_cn: "是 (être 的第一人称单数直陈式现在时)", explanation_en: "am (first-person singular present of être)" },
        "es": { token: "es", lemma: "être", pos: "v.", phonetic: "/ɛ/", explanation_cn: "是 (être 的第二人称单数直陈式现在时)", explanation_en: "are (second-person singular present of être)" },
        "est": { token: "est", lemma: "être", pos: "v.", phonetic: "/ɛ/", explanation_cn: "是 (être 的第三人称单数直陈式现在时)", explanation_en: "is (third-person singular present of être)" },
        "sommes": { token: "sommes", lemma: "être", pos: "v.", phonetic: "/sɔm/", explanation_cn: "是 (être 的第一人称复数直陈式现在时)", explanation_en: "are (first-person plural present of être)" },
        "êtes": { token: "êtes", lemma: "être", pos: "v.", phonetic: "/ɛt/", explanation_cn: "是 (être 的第二人称复数直陈式现在时)", explanation_en: "are (second-person plural present of être)" },
        "sont": { token: "sont", lemma: "être", pos: "v.", phonetic: "/sɔ̃/", explanation_cn: "是 (être 的第三人称复数直陈式现在时)", explanation_en: "are (third-person plural present of être)" },
        "été": { token: "été", lemma: "être", pos: "p.p. / n.m.", phonetic: "/e.te/", explanation_cn: "曾经是 (être 过去分词) 或 夏天(名词)", explanation_en: "been / summer" },

        // Verbs: avoir
        "avoir": { token: "avoir", lemma: "avoir", pos: "v. aux.", phonetic: "/a.vwaʁ/", explanation_cn: "有，拥有 (动词原形/助动词)", explanation_en: "to have" },
        "ai": { token: "ai", lemma: "avoir", pos: "v.", phonetic: "/e/", explanation_cn: "有 (avoir 的第一人称单数直陈式现在时，如 J'ai)", explanation_en: "have (first-person singular present of avoir)" },
        "as": { token: "as", lemma: "avoir", pos: "v.", phonetic: "/a/", explanation_cn: "有 (avoir 的第二人称单数直陈式现在时)", explanation_en: "have (second-person singular present of avoir)" },
        "a": { token: "a", lemma: "avoir", pos: "v.", phonetic: "/a/", explanation_cn: "有 (avoir 的第三人称单数直陈式现在时)", explanation_en: "has (third-person singular present of avoir)" },
        "avons": { token: "avons", lemma: "avoir", pos: "v.", phonetic: "/a.vɔ̃/", explanation_cn: "有 (avoir 的第一人称复数直陈式现在时)", explanation_en: "have (first-person plural present of avoir)" },
        "avez": { token: "avez", lemma: "avoir", pos: "v.", phonetic: "/a.ve/", explanation_cn: "有 (avoir 的第二人称复数直陈式现在时)", explanation_en: "have (second-person plural present of avoir)" },
        "ont": { token: "ont", lemma: "avoir", pos: "v.", phonetic: "/ɔ̃/", explanation_cn: "有 (avoir 的第三人称复数直陈式现在时)", explanation_en: "have (third-person plural present of avoir)" },
        "eu": { token: "eu", lemma: "avoir", pos: "p.p.", phonetic: "/y/", explanation_cn: "曾经有 (avoir 的过去分词)", explanation_en: "had (past participle of avoir)" },
        "ayant": { token: "ayant", lemma: "avoir", pos: "part. prés.", phonetic: "/ɛ.jɑ̃/", explanation_cn: "有着，具有 (avoir 的现在分词)", explanation_en: "having, possessing (present participle of avoir)" },

        // Verbs: aller
        "aller": { token: "aller", lemma: "aller", pos: "v.", phonetic: "/a.le/", explanation_cn: "去，前往 (动词原形)", explanation_en: "to go" },
        "vais": { token: "vais", lemma: "aller", pos: "v.", phonetic: "/vɛ/", explanation_cn: "去 (aller 的第一人称单数直陈式现在时)", explanation_en: "go (first-person singular present of aller)" },
        "vas": { token: "vas", lemma: "aller", pos: "v.", phonetic: "/va/", explanation_cn: "去 (aller 的第二人称单数直陈式现在时)", explanation_en: "go (second-person singular present of aller)" },
        "va": { token: "va", lemma: "aller", pos: "v.", phonetic: "/va/", explanation_cn: "去 (aller 的第三人称单数直陈式现在时)", explanation_en: "goes (third-person singular present of aller)" },
        "allons": { token: "allons", lemma: "aller", pos: "v.", phonetic: "/a.lɔ̃/", explanation_cn: "去 (aller 的第一人称复数直陈式现在时)", explanation_en: "go (first-person plural present of aller)" },
        "allez": { token: "allez", lemma: "aller", pos: "v.", phonetic: "/a.le/", explanation_cn: "去 (aller 的第二人称复数直陈式现在时)", explanation_en: "go (second-person plural present of aller)" },
        "vont": { token: "vont", lemma: "aller", pos: "v.", phonetic: "/vɔ̃/", explanation_cn: "去 (aller 的第三人称复数直陈式现在时)", explanation_en: "go (third-person plural present of aller)" },

        // Verbs: faire
        "faire": { token: "faire", lemma: "faire", pos: "v.", phonetic: "/fɛʁ/", explanation_cn: "做，制造，从事 (动词原形)", explanation_en: "to do / to make" },
        "fais": { token: "fais", lemma: "faire", pos: "v.", phonetic: "/fɛ/", explanation_cn: "做 (faire 的第一/二人称单数直陈式现在时)", explanation_en: "do / make (present tense of faire)" },
        "fait": { token: "fait", lemma: "faire", pos: "v. / n.m.", phonetic: "/fɛ/", explanation_cn: "做 (faire 第三人称现在时) 或 事实(名词)", explanation_en: "does / makes / fact" },
        "faisons": { token: "faisons", lemma: "faire", pos: "v.", phonetic: "/fə.zɔ̃/", explanation_cn: "做 (faire 的第一人称复数直陈式现在时)", explanation_en: "do / make" },
        "faites": { token: "faites", lemma: "faire", pos: "v.", phonetic: "/fɛt/", explanation_cn: "做 (faire 的第二人称复数直陈式现在时)", explanation_en: "do / make" },
        "font": { token: "font", lemma: "faire", pos: "v.", phonetic: "/fɔ̃/", explanation_cn: "做 (faire 的第三人称复数直陈式现在时)", explanation_en: "do / make" },

        // Verbs: pouvoir, vouloir, devoir, savoir, voir, venir, dire, prendre
        "pouvoir": { token: "pouvoir", lemma: "pouvoir", pos: "v.", phonetic: "/pu.vwaʁ/", explanation_cn: "能够，可以 (动词原形)", explanation_en: "to be able to, can" },
        "peux": { token: "peux", lemma: "pouvoir", pos: "v.", phonetic: "/pø/", explanation_cn: "能，可以 (pouvoir 的第一人称单数现在时)", explanation_en: "can (first-person singular of pouvoir)" },
        "peut": { token: "peut", lemma: "pouvoir", pos: "v.", phonetic: "/pø/", explanation_cn: "能，可以 (pouvoir 的第三人称单数现在时)", explanation_en: "can (third-person singular of pouvoir)" },
        "vouloir": { token: "vouloir", lemma: "vouloir", pos: "v.", phonetic: "/vu.lwaʁ/", explanation_cn: "想要，意愿 (动词原形)", explanation_en: "to want" },
        "veux": { token: "veux", lemma: "vouloir", pos: "v.", phonetic: "/vø/", explanation_cn: "想，要 (vouloir 的第一/二人称单数现在时)", explanation_en: "want (present tense of vouloir)" },
        "veut": { token: "veut", lemma: "vouloir", pos: "v.", phonetic: "/vø/", explanation_cn: "想，要 (vouloir 的第三人称单数现在时)", explanation_en: "wants (third-person singular of vouloir)" },
        "devoir": { token: "devoir", lemma: "devoir", pos: "v.", phonetic: "/də.vwaʁ/", explanation_cn: "应当，必须 (动词原形)", explanation_en: "to have to, must" },
        "dois": { token: "dois", lemma: "devoir", pos: "v.", phonetic: "/dwa/", explanation_cn: "必须，应该 (devoir 的第一/二人称单数现在时)", explanation_en: "must / should" },
        "doit": { token: "doit", lemma: "devoir", pos: "v.", phonetic: "/dwa/", explanation_cn: "必须，应该 (devoir 的第三人称单数现在时)", explanation_en: "must / should" },
        "savoir": { token: "savoir", lemma: "savoir", pos: "v.", phonetic: "/sa.vwaʁ/", explanation_cn: "知道，获悉 (动词原形)", explanation_en: "to know" },
        "sais": { token: "sais", lemma: "savoir", pos: "v.", phonetic: "/sɛ/", explanation_cn: "知道 (savoir 的第一/二人称单数现在时)", explanation_en: "know" },
        "sait": { token: "sait", lemma: "savoir", pos: "v.", phonetic: "/sɛ/", explanation_cn: "知道 (savoir 的第三人称单数现在时)", explanation_en: "knows" },
        "voir": { token: "voir", lemma: "voir", pos: "v.", phonetic: "/vwaʁ/", explanation_cn: "看见，理解 (动词原形)", explanation_en: "to see" },
        "vois": { token: "vois", lemma: "voir", pos: "v.", phonetic: "/vwa/", explanation_cn: "看见 (voir 的第一/二人称单数现在时)", explanation_en: "see" },
        "voit": { token: "voit", lemma: "voir", pos: "v.", phonetic: "/vwa/", explanation_cn: "看见 (voir 的第三人称单数现在时)", explanation_en: "sees" },
        "venir": { token: "venir", lemma: "venir", pos: "v.", phonetic: "/və.niʁ/", explanation_cn: "来，来自 (动词原形)", explanation_en: "to come" },
        "viens": { token: "viens", lemma: "venir", pos: "v.", phonetic: "/vjɛ̃/", explanation_cn: "来 (venir 的第一/二人称单数现在时)", explanation_en: "come" },
        "vient": { token: "vient", lemma: "venir", pos: "v.", phonetic: "/vjɛ̃/", explanation_cn: "来 (venir 的第三人称单数现在时)", explanation_en: "comes" },
        "dire": { token: "dire", lemma: "dire", pos: "v.", phonetic: "/diʁ/", explanation_cn: "说，讲述 (动词原形)", explanation_en: "to say / to tell" },
        "dis": { token: "dis", lemma: "dire", pos: "v.", phonetic: "/di/", explanation_cn: "说 (dire 的第一/二人称单数现在时)", explanation_en: "say" },
        "dit": { token: "dit", lemma: "dire", pos: "v.", phonetic: "/di/", explanation_cn: "说 (dire 的第三人称单数现在时)", explanation_en: "says" },
        "prendre": { token: "prendre", lemma: "prendre", pos: "v.", phonetic: "/pʁɑ̃dʁ/", explanation_cn: "拿，取，乘坐，吃喝 (动词原形)", explanation_en: "to take" },
        "prends": { token: "prends", lemma: "prendre", pos: "v.", phonetic: "/pʁɑ̃/", explanation_cn: "拿，乘 (prendre 的第一/二人称单数现在时)", explanation_en: "take" },
    };

    Object.values(BASIC_FRENCH_WORDS).forEach(item => {
        if (item.phonetic) item.phonetic = formatFriendlyPhonetic(item.phonetic);
    });

    function renderInteractiveWordsHtml(text) {
        if (!text) return '';
        // Match French words including internal apostrophes (e.g. n'autorisent, d'accord, l'homme, c'est)
        const regex = /(aujourd['’]hui|[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)?['’]?|[^\sA-Za-zÀ-ÖØ-öø-ÿŒœ]+|\s+)/gi;
        const tokens = text.match(regex) || [text];
        return tokens.map(token => {
            if (/^[A-Za-zÀ-ÖØ-öø-ÿŒœ]/i.test(token)) {
                const clean = token.replace(/['’]$/, '').trim() || token.trim();
                return `<span class="interactive-word" role="button" tabindex="0" data-word="${escapeHtml(clean)}" data-token="${escapeHtml(token.trim())}" title="${escapeHtml(clean)} · 点击查看释义与单读发音">${escapeHtml(token)}</span>`;
            }
            return escapeHtml(token);
        }).join('');
    }
    window.renderInteractiveWordsHtml = renderInteractiveWordsHtml;

    let currentPopoverCard = null;
    let currentActiveWordEl = null;
    let currentPopoverTarget = null;

    function closeWordPopover() {
        if (floatingWordPopover) {
            floatingWordPopover.hidden = true;
            floatingWordPopover.style.display = 'none';
        }
        if (popoverLoading) {
            popoverLoading.hidden = true;
            popoverLoading.style.display = 'none';
        }
        if (currentActiveWordEl && currentActiveWordEl.classList) {
            currentActiveWordEl.classList.remove('is-active-word');
        }
        currentActiveWordEl = null;
        currentPopoverTarget = null;
    }

    function positionPopover(target) {
        const el = target || currentPopoverTarget;
        if (!floatingWordPopover || !el || floatingWordPopover.hidden) return;

        const rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return;

        const popoverWidth = 290;
        floatingWordPopover.style.display = 'flex';
        const popoverHeight = floatingWordPopover.offsetHeight || 160;

        let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));

        // Arrow sticks out ~8.5px from popover edge (12px rotated square with -6px offset).
        // With 16px clearance gap from the target bounding box:
        // When above: bottom of popover is rect.top - 16px; arrow tip is rect.top - 7.5px.
        // When below: top of popover is rect.bottom + 16px; arrow tip is rect.bottom + 7.5px.
        // The clicked word is 100% visible and unobstructed with a clean, comfortable gap!
        const arrowClearance = 16;
        let top;
        let isArrowTop = false;

        // Check vertical clearance: need popoverHeight + clearance + 65px safe margin (topbar/header)
        const spaceAbove = rect.top - popoverHeight - arrowClearance;
        const spaceBelow = window.innerHeight - (rect.bottom + popoverHeight + arrowClearance);

        if (spaceAbove < 65 && spaceBelow >= 0) {
            // Not enough room above, flip below word
            top = rect.bottom + arrowClearance;
            isArrowTop = true;
            floatingWordPopover.classList.add('arrow-top');
        } else if (spaceAbove < 65 && spaceBelow < 0) {
            // Screen is very cramped vertically; choose the side with more space
            if (spaceAbove > spaceBelow) {
                top = Math.max(12, rect.top - popoverHeight - arrowClearance);
                isArrowTop = false;
                floatingWordPopover.classList.remove('arrow-top');
            } else {
                top = Math.min(window.innerHeight - popoverHeight - 12, rect.bottom + arrowClearance);
                isArrowTop = true;
                floatingWordPopover.classList.add('arrow-top');
            }
        } else {
            // Plenty of room above
            top = rect.top - popoverHeight - arrowClearance;
            isArrowTop = false;
            floatingWordPopover.classList.remove('arrow-top');
        }

        floatingWordPopover.style.left = `${left}px`;
        floatingWordPopover.style.top = `${top}px`;

        // Dynamically align arrow with word horizontal center
        const arrowEl = floatingWordPopover.querySelector('.popover-arrow');
        if (arrowEl) {
            const elCenter = rect.left + (rect.width / 2);
            const arrowLeft = Math.max(18, Math.min(popoverWidth - 18, elCenter - left));
            arrowEl.style.left = `${arrowLeft}px`;
        }
    }

    function renderPopoverData(item) {
        currentPopoverCard = item;
        popoverWord.textContent = item.token;
        const friendlyPhonetic = formatFriendlyPhonetic(item.phonetic || '');
        popoverPhonetic.textContent = friendlyPhonetic;
        if (friendlyPhonetic) {
            popoverPhonetic.hidden = false;
        } else {
            popoverPhonetic.hidden = true;
        }
        if (item.pos) {
            popoverPos.textContent = item.pos;
            popoverPos.hidden = false;
        } else {
            popoverPos.hidden = true;
        }
        if (item.lemma && item.lemma.toLowerCase() !== item.token.toLowerCase()) {
            popoverLemma.textContent = `原形: ${item.lemma}`;
            popoverLemma.hidden = false;
        } else {
            popoverLemma.hidden = true;
        }

        if (item.explanation_cn) {
            popoverCn.textContent = item.explanation_cn;
            popoverEn.textContent = item.explanation_en || '';
        } else {
            popoverCn.textContent = item.explanation_en || '语境词汇';
            popoverEn.textContent = '';
        }
        if (popoverLoading) {
            popoverLoading.hidden = true;
            popoverLoading.style.display = 'none';
        }
        if (popoverContent) {
            popoverContent.hidden = false;
            popoverContent.style.display = 'block';
        }

        updatePopoverStarState();
        refreshIcons();

        // Reposition popover accurately with new rendered height
        positionPopover(currentPopoverTarget);
        requestAnimationFrame(() => positionPopover(currentPopoverTarget));
    }

    function updatePopoverStarState() {
        if (!popoverStarBtn || !currentPopoverCard) return;
        const exists = Boolean(findTargetCard(currentPopoverCard.sentence, currentPopoverCard.token));
        popoverStarBtn.classList.toggle('active', exists);
        popoverStarBtn.title = exists ? '已加入复习（点击移除）' : '加入复习 (快捷键 S)';
        if (popoverStarText) popoverStarText.textContent = exists ? '已加入复习' : '加入复习';
    }

    async function showPopoverForElement(rawWord, element, context = {}) {
        if (!floatingWordPopover || !element) return;

        // Clean punctuation, apostrophes, quotes, commas, dots
        const cleanWord = (rawWord || '').replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '').trim();
        if (!cleanWord || cleanWord.length > 40 || !/[a-zA-ZÀ-ÿ]/.test(cleanWord)) return;

        const rect = element.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return;

        currentPopoverTarget = element;

        // Show and set to fixed viewport positioning
        floatingWordPopover.hidden = false;
        floatingWordPopover.style.display = 'flex';
        floatingWordPopover.style.position = 'fixed';
        floatingWordPopover.style.zIndex = '9999';

        // Active highlight state on the element
        if (currentActiveWordEl && currentActiveWordEl !== element) {
            if (currentActiveWordEl.classList) {
                currentActiveWordEl.classList.remove('is-active-word');
            }
        }
        currentActiveWordEl = (element && element.classList) ? element : null;
        if (currentActiveWordEl) {
            currentActiveWordEl.classList.add('is-active-word');
        }

        // Pronounce single word immediately (handling elisions like c', d', l')
        const lower = cleanWord.toLowerCase();
        const speechWord = (cleanWord.endsWith("'") || cleanWord.endsWith("’"))
            ? (BASIC_FRENCH_WORDS[lower]?.lemma || cleanWord)
            : cleanWord;
        playFrenchSpeech(speechWord);

        // 1. Check local cache from active tokens in analyzed sentence (0ms instant)
        let localMatch = (window.activeTokensMap || new Map()).get(lower);
        if (!localMatch) {
            // Also check elision base word (e.g. n'autorisent -> autorisent, l'homme -> homme)
            const elisionMatch = lower.match(/^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i);
            if (elisionMatch && elisionMatch[2]) {
                localMatch = (window.activeTokensMap || new Map()).get(elisionMatch[2]);
            }
        }
        if (localMatch) {
            const item = Object.assign({}, localMatch, { token: cleanWord });
            if (context.sentence) item.sentence = context.sentence;
            if (context.sentence_cn) item.sentence_cn = context.sentence_cn;
            renderPopoverData(item);
            return;
        }

        // 2. Check built-in beginner A1 dictionary (0ms instant)
        let basicMatch = BASIC_FRENCH_WORDS[lower];
        if (!basicMatch) {
            const elisionMatch = lower.match(/^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i);
            if (elisionMatch && elisionMatch[2]) {
                basicMatch = BASIC_FRENCH_WORDS[elisionMatch[2]];
            }
        }
        if (basicMatch) {
            const item = Object.assign({}, basicMatch, {
                token: cleanWord,
                sentence: context.sentence || '',
                sentence_cn: context.sentence_cn || ''
            });
            if (!window.activeTokensMap) window.activeTokensMap = new Map();
            window.activeTokensMap.set(lower, item);
            renderPopoverData(item);
            return;
        }

        // 3. Fallback to server /api/lookup
        popoverWord.textContent = cleanWord;
        popoverPhonetic.textContent = '';
        popoverPos.hidden = true;
        popoverLemma.hidden = true;
        if (popoverLoading) {
            popoverLoading.hidden = false;
            popoverLoading.style.display = 'flex';
        }
        if (popoverContent) {
            popoverContent.hidden = true;
            popoverContent.style.display = 'none';
        }
        currentPopoverCard = {
            token: cleanWord,
            lemma: cleanWord,
            pos: '',
            phonetic: '',
            explanation_cn: '查询中...',
            explanation_en: '',
            sentence: context.sentence || '',
            sentence_cn: context.sentence_cn || ''
        };
        updatePopoverStarState();
        refreshIcons();
        positionPopover(element);

        try {
            const token = getEffectiveAuthToken();
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await fetch(`/api/lookup?word=${encodeURIComponent(cleanWord)}`, { headers });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail?.message || '查词失败');
            }
            const data = await res.json();
            const item = Object.assign({}, data, {
                sentence: context.sentence || '',
                sentence_cn: context.sentence_cn || ''
            });
            if (!window.activeTokensMap) window.activeTokensMap = new Map();
            window.activeTokensMap.set(lower, item);
            if (!floatingWordPopover.hidden && popoverWord.textContent === cleanWord) {
                renderPopoverData(item);
            }
        } catch (err) {
            if (!floatingWordPopover.hidden && popoverWord.textContent === cleanWord) {
                if (popoverLoading) {
                    popoverLoading.hidden = true;
                    popoverLoading.style.display = 'none';
                }
                if (popoverContent) {
                    popoverContent.hidden = false;
                    popoverContent.style.display = 'block';
                }
                popoverCn.textContent = '暂无法获取释义';
                popoverEn.textContent = err.message;
                positionPopover(element);
            }
        }
    }

    async function handleWordDoubleClick(e) {
        if (floatingWordPopover && floatingWordPopover.contains(e.target)) return;
        if (e.target.closest('.interactive-word, .diff-word, .token-word, .btn-token-speak, .btn-token-star, .btn-speak-round, .floating-word-popover')) {
            return;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const rawSelected = selection.toString().trim();
        if (!rawSelected) return;

        const cleanWord = rawSelected.replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '').trim();
        if (!cleanWord || cleanWord.length > 40 || !/[a-zA-ZÀ-ÿ]/.test(cleanWord)) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        showPopoverForElement(cleanWord, { getBoundingClientRect: () => rect });
    }

    // -------------------------------------------------------------------------
    // 9. Text Analysis Request
    // -------------------------------------------------------------------------
    async function startAnalysis() {
        const text = frenchInput.value.trim();
        if (!text) {
            statusMessage.textContent = '请先输入需要拆解或学习的法语文本。';
            statusMessage.style.color = '#e11d48';
            frenchInput.focus();
            return;
        }

        try {
            const token = requireAuthToken();
            const model = modelSelect.value;

            analyzeButton.classList.add('is-loading');
            analyzeButton.disabled = true;
            analyzeButtonLabel.textContent = '正在智能拆解与精析...';
            statusMessage.className = 'status-message status-working';
            statusMessage.textContent = '正在调用 LLM 进行全句切分与意群搭配深度三列解析，请稍候...';

            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ text, model }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail?.message || data.detail || '分析请求失败');
            }

            renderStudyDeck(data.sentences || []);
            saveHistoryItem(text, data.sentences || []);
            collapseInputPanel(text);

            statusMessage.className = 'status-message status-success';
            statusMessage.textContent = '拆解完成！先试着自己讲讲这句话（费曼自测），再看讲解；想背的句子点「加入复习」，想背的词点 ⭐、点击 🔊 即时发音，或进行跟读打分。';
        } catch (err) {
            statusMessage.className = 'status-message status-error';
            statusMessage.textContent = `拆解失败: ${err.message}`;
        } finally {
            analyzeButton.classList.remove('is-loading');
            analyzeButton.disabled = false;
            analyzeButtonLabel.textContent = '开始拆解与精析';
        }
    }

    // -------------------------------------------------------------------------
    // 9. Event Bindings
    // -------------------------------------------------------------------------
    initSettings();

    // Textarea counter
    frenchInput.addEventListener('input', () => {
        charCounter.textContent = `${frenchInput.value.length} / 15000`;
    });

    // Fill Example
    fillExampleButton.addEventListener('click', () => {
        frenchInput.value = "Elle comprend 40 questions portant sur des documents de la vie quotidienne et ayant des objectifs différents.";
        charCounter.textContent = `${frenchInput.value.length} / 15000`;
        startAnalysis();
    });

    // Clear
    clearInputButton.addEventListener('click', () => {
        frenchInput.value = '';
        charCounter.textContent = '0 / 15000';
        sentencesContainer.innerHTML = '';
        studyDeckSection.hidden = true;
        statusMessage.textContent = '';
        expandInputPanel();
    });

    if (btnExpandInput) {
        btnExpandInput.addEventListener('click', expandInputPanel);
    }

    // Analyze click
    analyzeButton.addEventListener('click', startAnalysis);

    // Key settings
    apiKeyInput.addEventListener('change', saveApiKey);
    rememberKey.addEventListener('change', saveApiKey);
    modelSelect.addEventListener('change', saveApiKey);
    testConnectionButton.addEventListener('click', testConnection);

    toggleKeyButton.addEventListener('click', () => {
        const isPwd = apiKeyInput.type === 'password';
        apiKeyInput.type = isPwd ? 'text' : 'password';
        toggleKeyButton.innerHTML = `<i data-lucide="${isPwd ? 'eye-off' : 'eye'}"></i>`;
        refreshIcons();
    });

    // Auth Modal Bindings
    if (userAuthBtn) userAuthBtn.addEventListener('click', openAuthModal);
    if (closeAuthModalBtn) closeAuthModalBtn.addEventListener('click', closeAuthModal);
    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) closeAuthModal();
        });
    }
    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Initialize Unified History
    if (window.FrenchHistory) {
        window.FrenchHistory.init({
            currentPage: 'study',
            onRestoreStudy: (item) => {
                // 1. Stop any currently playing audio
                stopAllAudio();

                // 2. Clean URL params so page reload won't re-trigger analysis
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, '', window.location.pathname);
                }

                if (item.text) {
                    frenchInput.value = item.text;
                    charCounter.textContent = `${item.text.length} / 15000`;
                }
                if (item.sentences && item.sentences.length > 0) {
                    renderStudyDeck(item.sentences);
                    statusMessage.className = 'status-message status-success';
                    statusMessage.textContent = `已成功从历史记录恢复（共 ${item.sentenceCount || item.sentences.length} 句），无需重新消耗 Token。`;
                    window.scrollTo({ top: studyDeckSection.offsetTop - 80, behavior: 'smooth' });
                } else if (item.text) {
                    statusMessage.className = 'status-message status-info';
                    statusMessage.textContent = '已填入历史音频文本，点击“开始拆解与精析”即可生成语法词汇卡片。';
                }
            },
            onReanalyzeStudy: (item) => {
                stopAllAudio();
                if (item.text) {
                    frenchInput.value = item.text;
                    charCounter.textContent = `${item.text.length} / 15000`;
                    startAnalysis();
                }
            },
        });
    }

    // Floating Lexical Popover Bindings
    if (popoverCloseBtn) popoverCloseBtn.addEventListener('click', closeWordPopover);
    if (popoverSpeakBtn) {
        popoverSpeakBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentPopoverCard && currentPopoverCard.token) {
                playFrenchSpeech(currentPopoverCard.token);
            }
        });
    }
    if (popoverPhonetic) {
        popoverPhonetic.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentPopoverCard && currentPopoverCard.token) {
                playFrenchSpeech(currentPopoverCard.token);
            }
        });
    }
    if (popoverStarBtn) {
        popoverStarBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!currentPopoverCard) return;
            const c = currentPopoverCard;
            await toggleTargetCard({
                token: c.token,
                sentence: c.sentence || '',
                meta: {
                    meaning_zh: c.explanation_cn,
                    meaning_en: c.explanation_en,
                    lemma: c.lemma,
                    pos: c.pos,
                    ipa: c.phonetic,
                    hook: c.hook,
                },
            });
        });
    }

    document.addEventListener('click', (e) => {
        const wordEl = e.target.closest('.interactive-word, .diff-word, .token-word');
        if (wordEl) {
            e.stopPropagation();
            const card = wordEl.closest('.sentence-card');
            const targetSentence = card ? (card.querySelector('.sentence-french-text')?.textContent || '') : '';
            const transCn = card ? (card.querySelector('.translation-cn')?.textContent || '') : '';
            const word = wordEl.dataset.word || wordEl.dataset.token || wordEl.textContent.trim();
            showPopoverForElement(word, wordEl, {
                sentence: targetSentence,
                sentence_cn: transCn
            });
        }
    });

    document.addEventListener('dblclick', handleWordDoubleClick);
    document.addEventListener('mousedown', (e) => {
        if (floatingWordPopover && !floatingWordPopover.hidden) {
            if (!floatingWordPopover.contains(e.target) && !e.target.closest('.interactive-word, .diff-word, .token-word')) {
                closeWordPopover();
            }
        }
    });

    window.addEventListener('scroll', () => {
        if (floatingWordPopover && !floatingWordPopover.hidden) {
            closeWordPopover();
        }
    }, { passive: true });

    window.addEventListener('resize', () => {
        if (floatingWordPopover && !floatingWordPopover.hidden) {
            positionPopover();
        }
    }, { passive: true });

    // Global Keyboard listener for the word popover
    document.addEventListener('keydown', (e) => {
        const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        if (typing && e.key !== 'Escape') return;

        // Close word popover on Escape
        if (e.key === 'Escape' && floatingWordPopover && !floatingWordPopover.hidden) {
            closeWordPopover();
            return;
        }

        // Replay word in popover on 'R' if popover is active
        if ((e.key === 'r' || e.key === 'R') && floatingWordPopover && !floatingWordPopover.hidden) {
            if (currentPopoverCard && currentPopoverCard.token) {
                e.preventDefault();
                playFrenchSpeech(currentPopoverCard.token);
                return;
            }
        }

        // Star word in popover on 'S' if popover is active
        if ((e.key === 's' || e.key === 'S') && floatingWordPopover && !floatingWordPopover.hidden) {
            if (popoverStarBtn) {
                e.preventDefault();
                popoverStarBtn.click();
                return;
            }
        }
    });

    // Check prefilled URL query param `?text=...`
    window.renderStudyDeck = renderStudyDeck;
    const urlParams = new URLSearchParams(window.location.search);
    const prefillText = urlParams.get('text');
    if (urlParams.get('login') === '1' && !localStorage.getItem(userTokenKey)) {
        openAuthModal();
    }
    if (prefillText) {
        frenchInput.value = decodeURIComponent(prefillText);
        charCounter.textContent = `${frenchInput.value.length} / 15000`;
        setTimeout(() => {
            if (getEffectiveAuthToken()) {
                startAnalysis();
            }
        }, 300);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudyWorkbench);
} else {
    initStudyWorkbench();
}

