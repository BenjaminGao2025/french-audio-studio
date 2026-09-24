/* ==========================================================================
   French Audio Studio - Study & Shadowing Workbench Script
   Includes Spaced-Repetition Flashcard (Anki SM-2) Deck Manager
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

function cleanFrenchToken(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '')
        .trim();
}

function frenchPhoneticNormalize(word) {
    if (!word) return '';
    let w = word.toLowerCase().trim();
    w = w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '');
    // Decompose accents for phonetic tolerance (e.g. é -> e, à -> a, ç -> c)
    w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // In French, verbal 3rd person plural ending -ent is 100% silent (e.g. autorisent -> autorise)
    if (w.endsWith('ent') && w.length >= 5) {
        w = w.slice(0, -2);
    }
    // In French, plural nominal/adjectival endings -s and -x are silent (e.g. canadiennes -> canadienne, autorités -> autorite)
    if ((w.endsWith('s') || w.endsWith('x')) && w.length >= 3) {
        w = w.slice(0, -1);
    }
    return w;
}

function calculateLevenshteinSimilarity(s1, s2) {
    if (!s1 && !s2) return 1.0;
    if (!s1 || !s2) return 0.0;
    if (s1 === s2) return 1.0;

    const m = s1.length;
    const n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }

    const distance = dp[m][n];
    const maxLen = Math.max(m, n);
    return maxLen === 0 ? 1.0 : 1.0 - (distance / maxLen);
}

function evaluateFrenchPronunciation(targetSentence, spokenTranscript) {
    // Extract words from target sentence, preserving elisions (e.g. n'autorisent, d'accord, c'est)
    const rawTargetWords = (targetSentence || '').match(/(?:aujourd['’]hui|[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)?['’]?|[0-9]+)/gi) || [];
    const targetWords = rawTargetWords
        .map(w => ({ raw: w, clean: cleanFrenchToken(w), norm: frenchPhoneticNormalize(w) }))
        .filter(item => item.clean.length > 0);

    if (targetWords.length === 0) {
        return {
            overallScore: 100,
            accuracy: 100,
            completeness: 100,
            ratingText: '卓越 (Excellent !)',
            ratingClass: 'excellent',
            wordResults: [],
        };
    }

    const spokenTokens = (spokenTranscript || '')
        .split(/\s+/)
        .filter(w => w.length > 0);

    const wordResults = [];
    let totalScoreSum = 0;
    let matchedCount = 0;

    targetWords.forEach((target, targetIdx) => {
        let bestSim = 0;

        // Check if target has an elision prefix (n', d', l', c', j', m', t', s', qu')
        let baseNorm = '';
        const elisionMatch = target.raw.match(/^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i);
        if (elisionMatch && elisionMatch[2]) {
            baseNorm = frenchPhoneticNormalize(elisionMatch[2]);
        }

        // 1. Single token comparison (with phonetic normalization & silent endings tolerance)
        for (let i = 0; i < spokenTokens.length; i++) {
            const sp = spokenTokens[i];
            const normSp = frenchPhoneticNormalize(sp);

            // Check normalized Levenshtein similarity
            let sim = calculateLevenshteinSimilarity(target.norm, normSp);

            // If target is an elision word (e.g. n'autorisent, d'accord), also check against base word (e.g. autorisent)
            // In connected French speech ("canadiennes n'autorisent"), the n' elision merges with preceding [n]
            if (baseNorm) {
                const baseSim = calculateLevenshteinSimilarity(baseNorm, normSp);
                if (baseSim >= 0.82) {
                    sim = Math.max(sim, Math.min(1.0, baseSim + 0.05));
                }
            }
            if (sim > bestSim) bestSim = sim;
        }

        // 2. Adjacent two-token combination match
        // Handles cases where ASR inserts a space after apostrophe: "n'" + "autorisent", or "l'" + "homme"
        for (let i = 0; i < spokenTokens.length - 1; i++) {
            const combo = spokenTokens[i] + spokenTokens[i + 1];
            const normCombo = frenchPhoneticNormalize(combo);
            const sim = calculateLevenshteinSimilarity(target.norm, normCombo);
            if (sim > bestSim) bestSim = sim;
        }

        // 3. French enchaînement / assimilation check:
        // When preceding word ends in 'n' (like "canadiennes") and current word starts with n' (like "n'autorisent"),
        // the double [n] naturally fuses into a single [n] in fluent speech: [kanadjɛnotɔʁiz].
        // If the base verb (autorisent) is recognized, it is an authentic continuous pronunciation.
        if (baseNorm && targetIdx > 0) {
            const prevTargetNorm = targetWords[targetIdx - 1].norm;
            if (prevTargetNorm.endsWith('n') || prevTargetNorm.endsWith('ne')) {
                for (let i = 0; i < spokenTokens.length; i++) {
                    const normSp = frenchPhoneticNormalize(spokenTokens[i]);
                    if (calculateLevenshteinSimilarity(baseNorm, normSp) >= 0.85) {
                        bestSim = Math.max(bestSim, 1.0);
                    }
                }
            }
        }

        let status = 'missed';
        if (bestSim >= 0.82) {
            status = 'correct';
            matchedCount++;
        } else if (bestSim >= 0.55) {
            status = 'acceptable';
            matchedCount += 0.5;
        }

        const wordScore = Math.round(bestSim * 100);
        totalScoreSum += wordScore;

        wordResults.push({
            word: target.raw,
            score: wordScore,
            status: status,
        });
    });

    const accuracy = Math.round(totalScoreSum / targetWords.length);
    const completeness = Math.min(100, Math.round((matchedCount / targetWords.length) * 100));
    const overallScore = Math.round(accuracy * 0.7 + completeness * 0.3);

    let ratingText = '有待提高 (À travailler)';
    let ratingClass = 'needs-work';

    if (overallScore >= 90) {
        ratingText = '卓越 (Excellent !)';
        ratingClass = 'excellent';
    } else if (overallScore >= 75) {
        ratingText = '良好 (Très bien !)';
        ratingClass = 'good';
    } else if (overallScore >= 60) {
        ratingText = '及格 (Passable)';
        ratingClass = 'pass';
    }

    return {
        overallScore,
        accuracy,
        completeness,
        ratingText,
        ratingClass,
        wordResults,
    };
}

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

    // Initialize Anki Deck Manager
    const deckManager = window.AnkiDeck ? new window.AnkiDeck.DeckManager() : null;

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

    // DOM Elements - Output Deck
    const studyDeckSection = document.getElementById('study-deck-section');
    const sentenceCountBadge = document.getElementById('sentence-count-badge');
    const sentencesContainer = document.getElementById('sentences-container');

    // DOM Elements - Topbar & Deck Launcher
    const openDeckBtn = document.getElementById('open-deck-btn');
    const dueCardBadge = document.getElementById('due-card-badge');

    // DOM Elements - User Auth & Trial
    const userAuthBtn = document.getElementById('user-auth-btn');
    const userAuthStatusText = document.getElementById('user-auth-status-text');
    const userTrialBadge = document.getElementById('user-trial-badge');
    const authModal = document.getElementById('auth-modal');
    const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
    const authFormContainer = document.getElementById('auth-form-container');
    const authUserProfile = document.getElementById('auth-user-profile');
    const tabRegisterBtn = document.getElementById('tab-register-btn');
    const tabLoginBtn = document.getElementById('tab-login-btn');
    const authTabNotice = document.getElementById('auth-tab-notice');
    const authForm = document.getElementById('auth-form');
    const authEmailInput = document.getElementById('auth-email');
    const authPasswordInput = document.getElementById('auth-password');
    const authErrorMsg = document.getElementById('auth-error-msg');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSubmitLabel = document.getElementById('auth-submit-label');
    const profileEmail = document.getElementById('profile-email');
    const profileBadge = document.getElementById('profile-badge');
    const profileDaysLeft = document.getElementById('profile-days-left');
    const profileExpiresAt = document.getElementById('profile-expires-at');
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

    // DOM Elements - Flashcard Review Modal
    const flashcardModal = document.getElementById('flashcard-modal');
    const modalProgressBadge = document.getElementById('review-progress-badge');
    const exportDeckBtn = document.getElementById('export-deck-btn');
    const exportDeckBtn2 = document.getElementById('export-deck-btn-2');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const studyAllCardsBtn = document.getElementById('study-all-cards-btn');
    const totalCardCountSpan = document.getElementById('total-card-count');

    const cardStage = document.getElementById('card-stage');
    const cardFrontFace = document.getElementById('card-front-face');
    const cardBackFace = document.getElementById('card-back-face');
    const cardFrontWord = document.getElementById('card-front-word');
    const cardSpeakBtn = document.getElementById('card-speak-btn');
    const cardFrontPhonetic = document.getElementById('card-front-phonetic');
    const cardQuoteBox = document.getElementById('card-quote-box');
    const cardFrontSentence = document.getElementById('card-front-sentence');
    const cardBackPos = document.getElementById('card-back-pos');
    const cardBackLemma = document.getElementById('card-back-lemma');
    const cardBackCn = document.getElementById('card-back-cn');
    const cardBackEn = document.getElementById('card-back-en');
    const cardSentenceCn = document.getElementById('card-sentence-cn');
    const cardBackSpeakBtn = document.getElementById('card-back-speak-btn');
    const cardSentenceSpeakBtn = document.getElementById('card-sentence-speak-btn');

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

    const deckEmptyScreen = document.getElementById('deck-empty-screen');
    const emptyScreenTitle = document.getElementById('empty-screen-title');
    const emptyScreenDesc = document.getElementById('empty-screen-desc');
    const modalRatingFooter = document.getElementById('modal-rating-footer');
    const gradeButtons = document.querySelectorAll('.btn-grade');

    // Flashcard Session State
    let reviewQueue = [];
    let currentQueueIndex = 0;
    let isCardFlipped = false;

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

        updateDeckBadge();
        updateHistoryBadges();
        checkCurrentUser();
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
            throw new Error('请先登录账号（新用户免费赠送 60 天试用）或在【连接设置】中填写 API Key。');
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
    // 3. Pronunciation & Shadowing Scoring Algorithm
    // -------------------------------------------------------------------------
    function cleanFrenchToken(str) {
        return (str || '')
            .toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '')
            .trim();
    }

    function frenchPhoneticNormalize(word) {
        if (!word) return '';
        let w = word.toLowerCase().trim();
        w = w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '');
        // Decompose accents for phonetic tolerance (e.g. é -> e, à -> a, ç -> c)
        w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // In French, verbal 3rd person plural ending -ent is 100% silent (e.g. autorisent -> autorise)
        if (w.endsWith('ent') && w.length >= 5) {
            w = w.slice(0, -2);
        }
        // In French, plural nominal/adjectival endings -s and -x are silent (e.g. canadiennes -> canadienne, autorités -> autorite)
        if ((w.endsWith('s') || w.endsWith('x')) && w.length >= 3) {
            w = w.slice(0, -1);
        }
        return w;
    }

    function calculateLevenshteinSimilarity(s1, s2) {
        if (!s1 && !s2) return 1.0;
        if (!s1 || !s2) return 0.0;
        if (s1 === s2) return 1.0;

        const m = s1.length;
        const n = s2.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }

        const distance = dp[m][n];
        const maxLen = Math.max(m, n);
        return maxLen === 0 ? 1.0 : 1.0 - (distance / maxLen);
    }

    function evaluateFrenchPronunciation(targetSentence, spokenTranscript) {
        // Extract words from target sentence, preserving elisions (e.g. n'autorisent, d'accord, c'est)
        const rawTargetWords = (targetSentence || '').match(/(?:aujourd['’]hui|[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)?['’]?|[0-9]+)/gi) || [];
        const targetWords = rawTargetWords
            .map(w => ({ raw: w, clean: cleanFrenchToken(w), norm: frenchPhoneticNormalize(w) }))
            .filter(item => item.clean.length > 0);

        if (targetWords.length === 0) {
            return {
                overallScore: 100,
                accuracy: 100,
                completeness: 100,
                ratingText: '卓越 (Excellent !)',
                ratingClass: 'excellent',
                wordResults: [],
            };
        }

        const spokenTokens = (spokenTranscript || '')
            .split(/\s+/)
            .filter(w => w.length > 0);

        const wordResults = [];
        let totalScoreSum = 0;
        let matchedCount = 0;

        targetWords.forEach((target, targetIdx) => {
            let bestSim = 0;

            // Check if target has an elision prefix (n', d', l', c', j', m', t', s', qu')
            let baseNorm = '';
            const elisionMatch = target.raw.match(/^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i);
            if (elisionMatch && elisionMatch[2]) {
                baseNorm = frenchPhoneticNormalize(elisionMatch[2]);
            }

            // 1. Single token comparison (with phonetic normalization & silent endings tolerance)
            for (let i = 0; i < spokenTokens.length; i++) {
                const sp = spokenTokens[i];
                const normSp = frenchPhoneticNormalize(sp);

                // Check normalized Levenshtein similarity
                let sim = calculateLevenshteinSimilarity(target.norm, normSp);

                // If target is an elision word (e.g. n'autorisent, d'accord), also check against base word (e.g. autorisent)
                // In connected French speech ("canadiennes n'autorisent"), the n' elision merges with preceding [n]
                if (baseNorm) {
                    const baseSim = calculateLevenshteinSimilarity(baseNorm, normSp);
                    if (baseSim >= 0.82) {
                        sim = Math.max(sim, Math.min(1.0, baseSim + 0.05));
                    }
                }
                if (sim > bestSim) bestSim = sim;
            }

            // 2. Adjacent two-token combination match
            // Handles cases where ASR inserts a space after apostrophe: "n'" + "autorisent", or "l'" + "homme"
            for (let i = 0; i < spokenTokens.length - 1; i++) {
                const combo = spokenTokens[i] + spokenTokens[i + 1];
                const normCombo = frenchPhoneticNormalize(combo);
                const sim = calculateLevenshteinSimilarity(target.norm, normCombo);
                if (sim > bestSim) bestSim = sim;
            }

            // 3. French enchaînement / assimilation check:
            // When preceding word ends in 'n' (like "canadiennes") and current word starts with n' (like "n'autorisent"),
            // the double [n] naturally fuses into a single [n] in fluent speech: [kanadjɛnotɔʁiz].
            // If the base verb (autorisent) is recognized, it is an authentic continuous pronunciation.
            if (baseNorm && targetIdx > 0) {
                const prevTargetNorm = targetWords[targetIdx - 1].norm;
                if (prevTargetNorm.endsWith('n') || prevTargetNorm.endsWith('ne')) {
                    for (let i = 0; i < spokenTokens.length; i++) {
                        const normSp = frenchPhoneticNormalize(spokenTokens[i]);
                        if (calculateLevenshteinSimilarity(baseNorm, normSp) >= 0.85) {
                            bestSim = Math.max(bestSim, 1.0);
                        }
                    }
                }
            }

            let status = 'missed';
            if (bestSim >= 0.82) {
                status = 'correct';
                matchedCount++;
            } else if (bestSim >= 0.55) {
                status = 'acceptable';
                matchedCount += 0.5;
            }

            const wordScore = Math.round(bestSim * 100);
            totalScoreSum += wordScore;

            wordResults.push({
                word: target.raw,
                score: wordScore,
                status: status,
            });
        });

        const accuracy = Math.round(totalScoreSum / targetWords.length);
        const completeness = Math.min(100, Math.round((matchedCount / targetWords.length) * 100));
        const overallScore = Math.round(accuracy * 0.7 + completeness * 0.3);

        let ratingText = '有待提高 (À travailler)';
        let ratingClass = 'needs-work';

        if (overallScore >= 90) {
            ratingText = '卓越 (Excellent !)';
            ratingClass = 'excellent';
        } else if (overallScore >= 75) {
            ratingText = '良好 (Très bien !)';
            ratingClass = 'good';
        } else if (overallScore >= 60) {
            ratingText = '及格 (Passable)';
            ratingClass = 'pass';
        }

        return {
            overallScore,
            accuracy,
            completeness,
            ratingText,
            ratingClass,
            wordResults,
        };
    }
    window.evaluateFrenchPronunciation = evaluateFrenchPronunciation;

    // -------------------------------------------------------------------------
    // 4. Anki Spaced Repetition (SM-2) Deck Integration
    // -------------------------------------------------------------------------
    function updateDeckBadge() {
        if (!deckManager || !dueCardBadge) return;
        const dueCount = deckManager.countDue();
        const totalCount = deckManager.countTotal();

        dueCardBadge.textContent = `${dueCount}`;
        if (dueCount > 0) {
            dueCardBadge.className = 'deck-badge has-due';
            dueCardBadge.title = `今日有 ${dueCount} 张卡片待复习 (总计 ${totalCount} 张)`;
        } else {
            dueCardBadge.className = 'deck-badge all-done';
            dueCardBadge.title = `今日复习已完成 (总计 ${totalCount} 张)`;
        }
    }

    function highlightToken(sentence, token) {
        if (!sentence || !token) return escapeHtml(sentence || '');
        try {
            const regex = new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return escapeHtml(sentence).replace(regex, '<strong style="color: var(--primary); text-decoration: underline;">$1</strong>');
        } catch (e) {
            return escapeHtml(sentence);
        }
    }

    function openDeckModal(mode = 'due') {
        if (!deckManager || !flashcardModal) return;

        if (mode === 'due') {
            reviewQueue = deckManager.getDueCards();
        } else {
            reviewQueue = deckManager.getAllCards();
        }

        currentQueueIndex = 0;
        isCardFlipped = false;
        flashcardModal.hidden = false;
        displayCurrentCard();
    }

    function closeDeckModal() {
        if (!flashcardModal) return;
        flashcardModal.hidden = true;
        updateDeckBadge();
        updateTableStarStates();
    }

    function updateTableStarStates() {
        if (!deckManager) return;
        const starBtns = document.querySelectorAll('.btn-token-star');
        starBtns.forEach(btn => {
            const token = btn.dataset.token;
            if (token && deckManager.hasCard(token)) {
                btn.classList.add('active');
                btn.title = '已加入生词卡 (点击移除)';
            } else {
                btn.classList.remove('active');
                btn.title = '加入生词卡 (Anki)';
            }
        });
    }

    function displayCurrentCard() {
        if (reviewQueue.length === 0 || currentQueueIndex >= reviewQueue.length) {
            // Completion / Empty state
            cardStage.hidden = true;
            modalRatingFooter.hidden = true;
            deckEmptyScreen.hidden = false;

            const total = deckManager ? deckManager.countTotal() : 0;
            if (total === 0) {
                emptyScreenTitle.textContent = '生词本还是空的';
                emptyScreenDesc.textContent = '在文本拆解列表中点击词组或单词旁的 ⭐ 按钮，即可将生词加入 Anki 记忆库。';
                studyAllCardsBtn.hidden = true;
            } else {
                emptyScreenTitle.textContent = '🎉 今日待复习生词已全部完成！';
                emptyScreenDesc.textContent = '遵循 Anki SM-2 间隔记忆算法，已复习的卡片将在未来最佳艾宾浩斯复习节点再次出现。';
                studyAllCardsBtn.hidden = false;
                totalCardCountSpan.textContent = total;
            }
            modalProgressBadge.textContent = '已完成';
            refreshIcons();
            return;
        }

        const currentCard = reviewQueue[currentQueueIndex];
        cardStage.hidden = false;
        deckEmptyScreen.hidden = true;

        // Reset to front face
        isCardFlipped = false;
        cardFrontFace.hidden = false;
        cardBackFace.hidden = true;
        modalRatingFooter.hidden = true;

        // Populate front content
        cardFrontWord.textContent = currentCard.token;
        cardFrontPhonetic.textContent = formatFriendlyPhonetic(currentCard.phonetic || '');

        if (currentCard.sentence) {
            cardFrontSentence.innerHTML = highlightToken(currentCard.sentence, currentCard.token);
            cardQuoteBox.hidden = false;
        } else {
            cardQuoteBox.hidden = true;
        }

        // Populate back content
        cardBackPos.textContent = currentCard.pos || '';
        cardBackPos.hidden = !currentCard.pos;

        if (currentCard.lemma && currentCard.lemma.toLowerCase() !== currentCard.token.toLowerCase()) {
            cardBackLemma.textContent = `原形: ${currentCard.lemma}`;
            cardBackLemma.hidden = false;
        } else {
            cardBackLemma.hidden = true;
        }

        cardBackCn.textContent = currentCard.explanation_cn || '暂无释义';
        cardBackEn.textContent = currentCard.explanation_en || '';
        cardSentenceCn.textContent = currentCard.sentence_cn || '';

        modalProgressBadge.textContent = `${currentQueueIndex + 1} / ${reviewQueue.length}`;

        // Compute estimated interval labels for 4 grade buttons based on SM-2
        updateGradeButtonIntervals(currentCard);

        // Auto-play pronunciation of the French word
        if (currentCard.token) {
            try {
                playFrenchSpeech(currentCard.token);
            } catch (e) {
                console.warn('Auto play speech prevented:', e);
            }
        }

        refreshIcons();
    }

    function updateGradeButtonIntervals(card) {
        const interval = card.interval || 0;
        const ef = card.easeFactor || 2.5;
        const rep = card.repetitions || 0;

        let hardDays = rep === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
        let goodDays = rep === 0 ? 1 : (rep === 1 ? 6 : Math.round(interval * ef));
        let easyDays = rep === 0 ? 3 : (rep === 1 ? 8 : Math.round(interval * ef * 1.3));

        const gradeInterval1 = document.querySelector('.btn-grade.grade-1 .grade-interval');
        const gradeInterval2 = document.querySelector('.btn-grade.grade-2 .grade-interval');
        const gradeInterval3 = document.querySelector('.btn-grade.grade-3 .grade-interval');
        const gradeInterval4 = document.querySelector('.btn-grade.grade-4 .grade-interval');

        if (gradeInterval1) gradeInterval1.textContent = '<1天';
        if (gradeInterval2) gradeInterval2.textContent = `${hardDays}天`;
        if (gradeInterval3) gradeInterval3.textContent = `${goodDays}天`;
        if (gradeInterval4) gradeInterval4.textContent = `${easyDays}天`;
    }

    function flipCurrentCard() {
        if (cardStage.hidden || currentQueueIndex >= reviewQueue.length) return;
        if (!isCardFlipped) {
            isCardFlipped = true;
            cardFrontFace.hidden = true;
            cardBackFace.hidden = false;
            modalRatingFooter.hidden = false;
            refreshIcons();
        }
    }

    function rateCurrentCard(grade) {
        if (!deckManager || currentQueueIndex >= reviewQueue.length) return;
        const currentCard = reviewQueue[currentQueueIndex];

        deckManager.reviewCard(currentCard.id, grade);

        // If grade === 1 (Again), append back to review queue for this session
        if (grade === 1) {
            reviewQueue.push(currentCard);
        }

        currentQueueIndex++;
        displayCurrentCard();
        updateDeckBadge();
    }

    // -------------------------------------------------------------------------
    // 5. Render Study & Breakdown Deck
    // -------------------------------------------------------------------------
    function renderStudyDeck(sentences) {
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
                        explanation_cn: w.explanation_cn || '',
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
                // 1. Sentence Hero: French text + Large English translation + Small Chinese translation
                const heroHtml = `
                    <div class="sentence-hero">
                        <div class="sentence-meta-row">
                            <span class="sentence-index-pill">Phrase ${idx + 1}</span>
                            <span class="v2-badge">Simple English Breakdown</span>
                        </div>
                        <div class="sentence-text-row">
                            <p class="sentence-french-text">${renderInteractiveWordsHtml(sentenceText)}</p>
                            <button class="btn-speak-round" type="button" title="收听整句标准发音" aria-label="朗读句子">
                                <i data-lucide="volume-2"></i>
                            </button>
                        </div>
                        <div class="sentence-translations">
                            <div class="translation-en translation-primary">${escapeHtml(transEn)}</div>
                            ${transZh ? `<div class="translation-zh translation-secondary">${escapeHtml(transZh)}</div>` : ''}
                        </div>
                    </div>
                `;

                // 2. Word-by-word Alignment Table
                let alignmentHtml = '';
                if (s.alignment && s.alignment.length > 0) {
                    const alignColsFr = s.alignment.map(a => `<td><span class="align-chip-fr">${escapeHtml(a.fr)}</span></td>`).join('');
                    const alignColsEn = s.alignment.map(a => `<td><span class="align-chip-en">${escapeHtml(a.en)}</span></td>`).join('');
                    alignmentHtml = `
                        <div class="study-card-section alignment-section">
                            <div class="section-title">
                                <i data-lucide="arrow-left-right"></i>
                                <span>词序对照 (Word-by-word Alignment)</span>
                            </div>
                            <div class="alignment-table-wrapper">
                                <table class="alignment-table">
                                    <tbody>
                                        <tr class="alignment-row-fr">
                                            <th class="alignment-label">FR</th>
                                            ${alignColsFr}
                                        </tr>
                                        <tr class="alignment-row-en">
                                            <th class="alignment-label">EN</th>
                                            ${alignColsEn}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            ${s.order_note ? `
                                <div class="alignment-note">
                                    <i data-lucide="info"></i>
                                    <span>${escapeHtml(s.order_note)}</span>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }

                // 3. Sentence Build-up (一层一层搭句子)
                let buildupHtml = '';
                if (s.build_up && s.build_up.length > 0) {
                    const stepsHtml = s.build_up.map((step, sIdx) => {
                        const isFinal = sIdx === s.build_up.length - 1;
                        return `
                            <div class="buildup-step-row ${isFinal ? 'is-final-step' : ''}">
                                <div class="buildup-step-badge">Step ${sIdx + 1}</div>
                                <div class="buildup-step-content">
                                    <div class="buildup-fr-row">
                                        <button class="btn-buildup-speak" type="button" title="点击朗读该递进步骤" data-speech="${escapeHtml(step.fr)}">
                                            <i data-lucide="volume-2"></i>
                                        </button>
                                        <span class="buildup-fr-text">${escapeHtml(step.fr)}</span>
                                        ${isFinal ? `<span class="final-step-tag">原句</span>` : ''}
                                    </div>
                                    <div class="buildup-en-text">${escapeHtml(step.en)}</div>
                                    ${step.new ? `
                                        <div class="buildup-new-note">
                                            <span class="new-tag">New:</span> ${escapeHtml(step.new)}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('');

                    buildupHtml = `
                        <div class="study-card-section buildup-section">
                            <div class="section-title">
                                <i data-lucide="layers"></i>
                                <span>一层一层搭句子 (Sentence Build-up)</span>
                            </div>
                            <div class="buildup-steps-list">
                                ${stepsHtml}
                            </div>
                        </div>
                    `;
                }

                // 4. Word-by-word Analysis Table (3 columns)
                let wordRowsHtml = '';
                wordsList.forEach(w => {
                    const tokenText = w.fr || w.token || '';
                    const lemma = w.lemma && w.lemma !== tokenText ? w.lemma : '';
                    const pos = w.type || w.pos || '';
                    const ipa = w.ipa || w.phonetic || '';
                    const meaning = w.meaning || w.explanation_en || '';
                    const why = w.why || '';
                    const engLink = w.english_link || '';
                    const falseFriend = Boolean(w.false_friend);
                    const isSaved = deckManager ? deckManager.hasCard(tokenText) : false;

                    let linkCellHtml = '<span class="text-muted">—</span>';
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

                    wordRowsHtml += `
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
                                                title="${isSaved ? '已加入生词卡 (点击移除)' : '加入生词卡 (Anki)'}"
                                                data-token="${escapeHtml(tokenText)}"
                                                data-lemma="${escapeHtml(lemma)}"
                                                data-pos="${escapeHtml(pos)}"
                                                data-phonetic="${escapeHtml(ipa)}"
                                                data-exp-en="${escapeHtml(fullExpEn)}"
                                                data-exp-cn="${escapeHtml(w.explanation_cn || '')}"
                                                data-sentence="${escapeHtml(sentenceText)}"
                                                data-sentence-cn="${escapeHtml(transZh)}">
                                                <i data-lucide="star"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="token-details">
                                        ${pos ? `<span class="pos-tag">${escapeHtml(pos)}</span>` : ''}
                                        ${ipa ? `<span class="phonetic-tag">${escapeHtml(formatFriendlyPhonetic(ipa))}</span>` : ''}
                                        ${lemma ? `<span class="lemma-tag">原形: ${escapeHtml(lemma)}</span>` : ''}
                                    </div>
                                </div>
                            </td>
                            <td class="explanation-meaning-cell">
                                <div class="word-meaning">${escapeHtml(meaning)}</div>
                                ${why ? `<div class="word-why"><span class="why-label">Why:</span>${escapeHtml(why)}</div>` : ''}
                            </td>
                            <td class="explanation-link-cell">
                                ${linkCellHtml}
                            </td>
                        </tr>
                    `;
                });

                const wordsTableHtml = `
                    <div class="study-card-section words-table-section">
                        <div class="section-title">
                            <i data-lucide="book-open"></i>
                            <span>逐词剖析表 (Word Breakdown)</span>
                        </div>
                        <div class="table-wrapper">
                            <table class="breakdown-table v2-breakdown-table">
                                <thead>
                                    <tr>
                                        <th style="width: 32%;">① 词汇 / 原形 (Word & Form)</th>
                                        <th style="width: 44%;">② 英文简释与原因 (Meaning & Why)</th>
                                        <th style="width: 24%;">③ 英文关联 (English Link)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${wordRowsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                // 5. Grammar Points + Memory Hooks
                let grammarHtml = '';
                if (s.grammar_points && s.grammar_points.length > 0) {
                    const pointsHtml = s.grammar_points.map(g => `
                        <div class="grammar-point-card">
                            <div class="grammar-point-header">
                                <span class="grammar-bullet">📌</span>
                                <h4 class="grammar-point-title">${escapeHtml(g.title)}</h4>
                            </div>
                            <div class="grammar-point-body">
                                <p class="grammar-point-exp">${escapeHtml(g.explanation)}</p>
                                ${g.hook ? `
                                    <div class="grammar-point-hook">
                                        <span class="hook-icon">💡</span>
                                        <span><strong>Memory hook:</strong> ${escapeHtml(g.hook)}</span>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `).join('');

                    grammarHtml = `
                        <div class="study-card-section grammar-section">
                            <div class="section-title">
                                <i data-lucide="sparkles"></i>
                                <span>语法点与记忆钩子 (Grammar & Memory Hooks)</span>
                            </div>
                            <div class="grammar-points-list">
                                ${pointsHtml}
                            </div>
                        </div>
                    `;
                }

                // 6. Pronunciation Tips
                let pronTipsHtml = '';
                if (s.pronunciation_tips && s.pronunciation_tips.length > 0) {
                    const tipsHtml = s.pronunciation_tips.map(tip => `
                        <li class="pronunciation-tip-item">
                            <i data-lucide="volume-1"></i>
                            <span>${escapeHtml(tip)}</span>
                        </li>
                    `).join('');

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

                card.innerHTML = heroHtml + alignmentHtml + buildupHtml + wordsTableHtml + grammarHtml + pronTipsHtml + shadowingHtml;
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
                    const isSaved = deckManager ? deckManager.hasCard(tokenText) : false;

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
                                                title="${isSaved ? '已加入生词卡 (点击移除)' : '加入生词卡 (Anki)'}"
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
    }

    function attachSentenceCardEvents(card, targetSentence, transCn = '', transEn = '') {
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
                    btn.style.transform = 'scale(1.2)';
                    playFrenchSpeech(phrase, () => {
                        btn.style.transform = '';
                    });
                }
            });
        });

        // 3. Token Anki Star Buttons
        const tokenStarBtns = card.querySelectorAll('.btn-token-star');
        tokenStarBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!deckManager) return;
                const token = btn.dataset.token;
                if (!token) return;

                if (deckManager.hasCard(token)) {
                    deckManager.removeCard(token);
                    btn.classList.remove('active');
                    btn.title = '加入生词卡 (Anki)';
                } else {
                    deckManager.addCard({
                        token: token,
                        lemma: btn.dataset.lemma,
                        pos: btn.dataset.pos,
                        phonetic: btn.dataset.phonetic,
                        explanation_en: btn.dataset.expEn,
                        explanation_cn: btn.dataset.expCn,
                        sentence: btn.dataset.sentence,
                        sentence_cn: btn.dataset.sentenceCn,
                    });
                    btn.classList.add('active');
                    btn.title = '已加入生词卡 (点击移除)';
                }

                updateDeckBadge();
                refreshIcons();
            });
        });

        // 4. Shadowing Recording & Scoring Logic
        const recordBtn = card.querySelector('.btn-record');
        const recordBtnText = recordBtn.querySelector('.record-btn-text');
        const scoreCard = card.querySelector('.score-result-card');
        const scorePill = card.querySelector('.score-number-pill');
        const scoreRatingText = card.querySelector('.score-rating-text');
        const metricAcc = card.querySelector('.metric-acc');
        const metricComp = card.querySelector('.metric-comp');
        const diffBox = card.querySelector('.diff-result-box');
        const playModelBtn = card.querySelector('.btn-play-model');
        const playUserBtn = card.querySelector('.btn-play-user');
        const retryBtn = card.querySelector('.btn-retry');

        let mediaRecorder = null;
        let audioChunks = [];
        let userAudioUrl = null;
        let isRecording = false;
        let recognition = null;
        let recognitionTranscript = '';

        let isModelPlaying = false;
        let isUserPlaying = false;

        function resetModelBtn() {
            isModelPlaying = false;
            if (playModelBtn) {
                playModelBtn.classList.remove('playing');
                playModelBtn.innerHTML = `<i data-lucide="volume-2"></i><span>官方范读</span>`;
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

        playModelBtn.addEventListener('click', () => {
            if (isModelPlaying) {
                stopAllAudio();
                return;
            }

            stopAllAudio();

            isModelPlaying = true;
            playModelBtn.classList.add('playing');
            playModelBtn.innerHTML = `<i data-lucide="square"></i><span>停止范读</span>`;
            refreshIcons();

            playFrenchSpeech(targetSentence, () => {
                resetModelBtn();
            });
        });

        playUserBtn.addEventListener('click', () => {
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
            playUserBtn.innerHTML = `<i data-lucide="square"></i><span>停止播放</span>`;
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

            userAudio.play().catch(e => {
                console.warn('User audio play interrupted or failed:', e);
                handleUserAudioEnd();
            });
        });

        if (diffBox) {
            diffBox.addEventListener('click', (e) => {
                const diffWord = e.target.closest('.diff-word');
                if (!diffWord) return;
                e.stopPropagation();
                const word = diffWord.dataset.word || diffWord.textContent.trim();
                showPopoverForElement(word, diffWord, {
                    sentence: targetSentence,
                    sentence_cn: transCn
                });
            });
        }

        retryBtn.addEventListener('click', () => {
            stopAllAudio();
            scoreCard.hidden = true;
            recordBtn.click();
        });

        recordBtn.addEventListener('click', async () => {
            if (isRecording) {
                stopRecording();
            } else {
                await startRecording();
            }
        });

        async function startRecording() {
            try {
                stopAllAudio();
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
                    playUserBtn.disabled = false;
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
                recordBtn.classList.add('recording');
                recordBtnText.textContent = '⏹ 朗读完成，点击评测';
            } catch (err) {
                alert('无法调用麦克风：' + err.message);
            }
        }

        function stopRecording() {
            if (!isRecording) return;
            isRecording = false;
            recordBtn.classList.remove('recording');
            recordBtnText.textContent = '🎙 再次跟读';

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
            const evaluation = evaluateFrenchPronunciation(targetSentence, recognitionTranscript);

            scorePill.textContent = `${evaluation.overallScore}`;
            scorePill.className = `score-number-pill ${evaluation.ratingClass}`;
            scoreRatingText.textContent = evaluation.ratingText;
            metricAcc.textContent = `${evaluation.accuracy}%`;
            metricComp.textContent = `${evaluation.completeness}%`;

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

            scoreCard.hidden = false;
        }
    }

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
    // 6. User Account & 60-day Free Trial Manager
    // -------------------------------------------------------------------------
    const userTokenKey = 'frenchStudio.userToken';
    let currentAuthTab = 'register';
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
        if (tab === 'register') {
            if (tabRegisterBtn) tabRegisterBtn.classList.add('active');
            if (tabLoginBtn) tabLoginBtn.classList.remove('active');
            if (authTabNotice) {
                authTabNotice.innerHTML = '🎉 <strong>新用户专属福利</strong>：注册即送 <strong>60 天（2个月）全功能免费试用</strong>，免配置 API Key 畅享高保真发音、Grok 4.6 深度语法精析与 Anki 记忆卡系统！';
            }
            if (authSubmitLabel) authSubmitLabel.textContent = '立即注册并领取 60 天免费试用';
        } else {
            if (tabRegisterBtn) tabRegisterBtn.classList.remove('active');
            if (tabLoginBtn) tabLoginBtn.classList.add('active');
            if (authTabNotice) {
                authTabNotice.innerHTML = '✨ 欢迎回来！登录您的账号以同步使用免费试用额度与高级功能。';
            }
            if (authSubmitLabel) authSubmitLabel.textContent = '登录账号';
        }
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
                userTrialBadge.textContent = user.plan === 'pro' ? 'VIP 会员' : `试用剩 ${user.days_left} 天`;
                userTrialBadge.hidden = false;
            }
            if (profileEmail) profileEmail.textContent = user.email;
            if (profileBadge) profileBadge.textContent = user.plan === 'pro' ? 'VIP 终身会员' : `60天试用期中`;
            if (profileDaysLeft) profileDaysLeft.textContent = user.plan === 'pro' ? '永久有效' : `${user.days_left} 天`;
            if (profileExpiresAt) {
                const dateStr = user.trial_expires_at ? user.trial_expires_at.split('T')[0] : '--';
                profileExpiresAt.textContent = dateStr;
            }
        } else {
            currentAuthUser = null;
            if (userAuthStatusText) userAuthStatusText.textContent = '登录 / 注册';
            if (userTrialBadge) {
                userTrialBadge.textContent = '赠60天';
                userTrialBadge.hidden = false;
            }
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

        const endpoint = currentAuthTab === 'register' ? '/api/auth/register' : '/api/auth/login';

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
            statusMessage.className = 'status-message status-success';
            statusMessage.textContent = currentAuthTab === 'register'
                ? '恭喜注册成功！已为您开通 60 天全功能免费试用，无需配置 API Key 即可使用！'
                : '登录成功！欢迎回来。';
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
        if (!popoverStarBtn || !currentPopoverCard || !deckManager) return;
        const exists = deckManager.hasCard(currentPopoverCard.token);
        if (exists) {
            popoverStarBtn.classList.add('active');
            popoverStarBtn.title = '已存生词卡 (点击移出)';
            if (popoverStarText) popoverStarText.textContent = '已存生词卡';
        } else {
            popoverStarBtn.classList.remove('active');
            popoverStarBtn.title = '存入 Anki 生词卡';
            if (popoverStarText) popoverStarText.textContent = '加入生词卡';
        }
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

            statusMessage.className = 'status-message status-success';
            statusMessage.textContent = '拆解完成！您可以查阅释义、点击 ⭐ 存入 Anki 生词卡、点击 🔊 即时发音，或进行跟读打分。';
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
    });

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
    if (tabRegisterBtn) tabRegisterBtn.addEventListener('click', () => switchAuthTab('register'));
    if (tabLoginBtn) tabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
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

    // Flashcard Deck Modal Open/Close
    if (openDeckBtn) {
        openDeckBtn.addEventListener('click', () => openDeckModal('due'));
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeDeckModal);
    }

    if (flashcardModal) {
        flashcardModal.addEventListener('click', (e) => {
            if (e.target === flashcardModal) {
                closeDeckModal();
            }
        });
    }

    // Card Stage Flip & Speak
    if (cardStage) {
        cardStage.addEventListener('click', () => {
            flipCurrentCard();
        });
    }

    if (cardSpeakBtn) {
        cardSpeakBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (reviewQueue.length > 0 && currentQueueIndex < reviewQueue.length) {
                const cur = reviewQueue[currentQueueIndex];
                if (cur && cur.token) playFrenchSpeech(cur.token);
            }
        });
    }

    if (cardBackSpeakBtn) {
        cardBackSpeakBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (reviewQueue.length > 0 && currentQueueIndex < reviewQueue.length) {
                const cur = reviewQueue[currentQueueIndex];
                if (cur && cur.token) playFrenchSpeech(cur.token);
            }
        });
    }

    if (cardSentenceSpeakBtn) {
        cardSentenceSpeakBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (reviewQueue.length > 0 && currentQueueIndex < reviewQueue.length) {
                const cur = reviewQueue[currentQueueIndex];
                if (cur && cur.sentence) playFrenchSpeech(cur.sentence);
            }
        });
    }

    // Flashcard SM-2 Grade Buttons
    gradeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const grade = parseInt(btn.dataset.grade, 10);
            if (grade >= 1 && grade <= 4) {
                rateCurrentCard(grade);
            }
        });
    });

    // Study all cards button from completion screen
    if (studyAllCardsBtn) {
        studyAllCardsBtn.addEventListener('click', () => {
            openDeckModal('all');
        });
    }

    // Anki TSV Export
    function handleExportDeck() {
        if (!deckManager) return;
        try {
            deckManager.downloadAnkiFile('FrenchStudio_AnkiDeck.tsv');
        } catch (err) {
            alert(err.message);
        }
    }

    if (exportDeckBtn) exportDeckBtn.addEventListener('click', handleExportDeck);
    if (exportDeckBtn2) exportDeckBtn2.addEventListener('click', handleExportDeck);

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
        popoverStarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!currentPopoverCard || !deckManager) return;
            if (deckManager.hasCard(currentPopoverCard.token)) {
                deckManager.removeCard(currentPopoverCard.token);
            } else {
                deckManager.addCard({
                    token: currentPopoverCard.token,
                    lemma: currentPopoverCard.lemma,
                    pos: currentPopoverCard.pos,
                    phonetic: currentPopoverCard.phonetic,
                    explanation_cn: currentPopoverCard.explanation_cn,
                    explanation_en: currentPopoverCard.explanation_en,
                    sentence: currentPopoverCard.sentence || '',
                    sentence_cn: currentPopoverCard.sentence_cn || '',
                });
            }
            updatePopoverStarState();
            updateDeckBadge();
            updateTableStarStates();
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

    // Global Keyboard listener for Flashcard review & Popover
    document.addEventListener('keydown', (e) => {
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

        if (!flashcardModal || flashcardModal.hidden) return;

        if (e.key === 'Escape') {
            closeDeckModal();
            return;
        }

        // 'R' or 'r' key to replay audio in flashcard
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            if (reviewQueue.length > 0 && currentQueueIndex < reviewQueue.length) {
                const cur = reviewQueue[currentQueueIndex];
                if (cur && cur.token) playFrenchSpeech(cur.token);
            }
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            if (!isCardFlipped) {
                flipCurrentCard();
            }
            return;
        }

        // When card is flipped, keys 1, 2, 3, 4 trigger rating
        if (isCardFlipped && ['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            rateCurrentCard(parseInt(e.key, 10));
        }
    });

    // Check prefilled URL query param `?text=...`
    const urlParams = new URLSearchParams(window.location.search);
    const prefillText = urlParams.get('text');
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

