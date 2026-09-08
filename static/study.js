/* ==========================================================================
   French Audio Studio - Study & Shadowing Workbench Script
   Includes Spaced-Repetition Flashcard (Anki SM-2) Deck Manager
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
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

        if (apiKeyInput.value.trim()) {
            setConnectionState('idle', 'Key 已加载', '点击测试实际连接');
        } else {
            setConnectionState('idle', '未填写 Key', '在右上角连接设置填写 Key');
        }

        updateDeckBadge();
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

    function requireApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            const details = document.querySelector('.connection-settings');
            if (details) details.open = true;
            apiKeyInput.focus();
            throw new Error('请先在顶部【连接设置】中填写 web2api API Key。');
        }
        saveApiKey();
        return key;
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
            const apiKey = requireApiKey();
            const model = modelSelect.value;
            setConnectionState('testing', '正在测试', '正在验证 API Key 与模型连通性...');
            testConnectionButton.disabled = true;

            const res = await fetch('/api/connection/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
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
    function playFrenchSpeech(text, onEndCallback = null) {
        if (!text || !text.trim()) return;
        const cleanText = text.trim();

        const audioUrl = `/tts?text=${encodeURIComponent(cleanText)}&voice=fr-FR-DeniseNeural`;
        const audio = new Audio(audioUrl);

        audio.addEventListener('ended', () => {
            if (onEndCallback) onEndCallback();
        });

        audio.addEventListener('error', () => {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(cleanText);
                utterance.lang = 'fr-FR';
                utterance.rate = 0.95;
                if (onEndCallback) {
                    utterance.onend = onEndCallback;
                    utterance.onerror = onEndCallback;
                }
                window.speechSynthesis.speak(utterance);
            } else if (onEndCallback) {
                onEndCallback();
            }
        });

        audio.play().catch(e => {
            console.warn('Audio play interrupted, falling back to Web Speech:', e);
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(cleanText);
                utterance.lang = 'fr-FR';
                if (onEndCallback) utterance.onend = onEndCallback;
                window.speechSynthesis.speak(utterance);
            } else if (onEndCallback) {
                onEndCallback();
            }
        });
    }

    // -------------------------------------------------------------------------
    // 3. Pronunciation & Shadowing Scoring Algorithm
    // -------------------------------------------------------------------------
    function cleanFrenchToken(str) {
        return (str || '')
            .toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»[\]]/g, '')
            .trim();
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
        const rawTargetWords = targetSentence.match(/[\w'’\-À-ÿ]+|[^\s\w]/g) || [];
        const targetWords = rawTargetWords
            .map(w => ({ raw: w, clean: cleanFrenchToken(w) }))
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

        const spokenWords = (spokenTranscript || '')
            .split(/\s+/)
            .map(cleanFrenchToken)
            .filter(w => w.length > 0);

        const wordResults = [];
        let totalScoreSum = 0;
        let matchedCount = 0;

        targetWords.forEach(target => {
            let bestSim = 0;
            spokenWords.forEach(spoken => {
                const sim = calculateLevenshteinSimilarity(target.clean, spoken);
                if (sim > bestSim) bestSim = sim;
            });

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
        cardFrontPhonetic.textContent = currentCard.phonetic || '';

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

        if (!sentences || sentences.length === 0) {
            studyDeckSection.hidden = true;
            return;
        }

        studyDeckSection.hidden = false;
        sentenceCountBadge.textContent = `共 ${sentences.length} 句`;

        sentences.forEach((s, idx) => {
            const originalText = s.original || '';
            const transEn = s.translation_en || '';
            const transCn = s.translation_cn || '';
            const tokens = s.tokens || [];

            const card = document.createElement('article');
            card.className = 'sentence-card';
            card.dataset.index = idx;

            // 1. Hero / Header
            const heroHtml = `
                <div class="sentence-hero">
                    <div class="sentence-meta-row">
                        <span class="sentence-index-pill">Phrase ${idx + 1}</span>
                        <div class="sentence-hero-actions">
                            <!-- reserved -->
                        </div>
                    </div>
                    <div class="sentence-text-row">
                        <p class="sentence-french-text">${escapeHtml(originalText)}</p>
                        <button class="btn-speak-round" type="button" title="收听整句标准发音" aria-label="朗读句子">
                            <i data-lucide="volume-2"></i>
                        </button>
                    </div>
                    <div class="sentence-translations">
                        <div class="translation-cn">${escapeHtml(transCn)}</div>
                        <div class="translation-en">${escapeHtml(transEn)}</div>
                    </div>
                </div>
            `;

            // 2. Shadowing & Scoring Panel
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

            // 3. Three-Column Table with Star (Anki) and Speaker buttons
            let rowsHtml = '';
            tokens.forEach(tok => {
                const tokenText = tok.token || '';
                const lemma = tok.lemma && tok.lemma !== tokenText ? tok.lemma : '';
                const pos = tok.pos || '';
                const phonetic = tok.phonetic || '';
                const expEn = tok.explanation_en || '';
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
                                            data-sentence="${escapeHtml(originalText)}"
                                            data-sentence-cn="${escapeHtml(transCn)}">
                                            <i data-lucide="star"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="token-details">
                                    ${pos ? `<span class="pos-tag">${escapeHtml(pos)}</span>` : ''}
                                    ${phonetic ? `<span class="phonetic-tag">${escapeHtml(phonetic)}</span>` : ''}
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
            sentencesContainer.appendChild(card);

            attachSentenceCardEvents(card, originalText);
        });

        refreshIcons();
    }

    function attachSentenceCardEvents(card, targetSentence) {
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

        playModelBtn.addEventListener('click', () => {
            playFrenchSpeech(targetSentence);
        });

        playUserBtn.addEventListener('click', () => {
            if (userAudioUrl) {
                const userAudio = new Audio(userAudioUrl);
                userAudio.play();
            }
        });

        retryBtn.addEventListener('click', () => {
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
                    wordSpan.title = `相似度得分: ${item.score} / 100`;
                    diffBox.appendChild(wordSpan);
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
    // 6. Text Analysis Request
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
            const apiKey = requireApiKey();
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
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({ text, model }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail?.message || data.detail || '分析请求失败');
            }

            renderStudyDeck(data.sentences || []);
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
    // 7. Event Bindings
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

    // Global Keyboard listener for Flashcard review
    document.addEventListener('keydown', (e) => {
        if (!flashcardModal || flashcardModal.hidden) return;

        if (e.key === 'Escape') {
            closeDeckModal();
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
            if (apiKeyInput.value.trim()) {
                startAnalysis();
            }
        }, 300);
    }
});
