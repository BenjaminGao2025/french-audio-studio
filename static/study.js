/* ==========================================================================
   French Audio Studio - Study & Shadowing Workbench Script
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
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

    // DOM Elements - Output Deck
    const studyDeckSection = document.getElementById('study-deck-section');
    const sentenceCountBadge = document.getElementById('sentence-count-badge');
    const sentencesContainer = document.getElementById('sentences-container');

    // Speech Recognition API Detection
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

    // Audio Caches & Player State
    const activeAudios = new Map();

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    // Initialize icons immediately and on full window load
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

        // Use cached audio object or create a new one
        const audioUrl = `/tts?text=${encodeURIComponent(cleanText)}&voice=fr-FR-DeniseNeural`;
        const audio = new Audio(audioUrl);

        audio.addEventListener('ended', () => {
            if (onEndCallback) onEndCallback();
        });

        audio.addEventListener('error', () => {
            // Fallback to browser Web Speech API if Edge-TTS backend is temporarily unreachable
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
            console.warn('Audio play interrupted or failed, attempting Web Speech API:', e);
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
        // Extract words from target sentence
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

        // Extract words from user speech transcript
        const rawSpokenWords = (spokenTranscript || '').match(/[\w'’\-À-ÿ]+/g) || [];
        const spokenCleanWords = rawSpokenWords.map(w => cleanFrenchToken(w)).filter(w => w.length > 0);

        const wordResults = [];
        let totalScoreSum = 0;
        let matchedWordCount = 0;
        const usedSpokenIndices = new Set();

        targetWords.forEach(target => {
            let bestSim = 0;
            let bestIndex = -1;

            for (let j = 0; j < spokenCleanWords.length; j++) {
                if (usedSpokenIndices.has(j)) continue;
                const sim = calculateLevenshteinSimilarity(target.clean, spokenCleanWords[j]);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIndex = j;
                }
            }

            let wordScore = 0;
            let status = 'missed';

            if (bestSim >= 0.85) {
                wordScore = 100;
                status = 'correct';
                matchedWordCount++;
                if (bestIndex !== -1) usedSpokenIndices.add(bestIndex);
            } else if (bestSim >= 0.60) {
                wordScore = Math.round(bestSim * 100);
                status = 'acceptable';
                matchedWordCount++;
                if (bestIndex !== -1) usedSpokenIndices.add(bestIndex);
            } else {
                wordScore = 0;
                status = 'missed';
            }

            totalScoreSum += wordScore;
            wordResults.push({
                word: target.raw,
                score: wordScore,
                status,
            });
        });

        const accuracy = Math.round(totalScoreSum / targetWords.length);
        const completeness = Math.min(100, Math.round((matchedWordCount / targetWords.length) * 100));
        const overallScore = Math.min(100, Math.max(0, Math.round(accuracy * 0.75 + completeness * 0.25)));

        let ratingText = '需加强 (À répéter)';
        let ratingClass = 'needs-work';

        if (overallScore >= 90) {
            ratingText = '🌟 卓越 (Excellent !)';
            ratingClass = 'excellent';
        } else if (overallScore >= 75) {
            ratingText = '👍 良好 (Bien joué !)';
            ratingClass = 'good';
        } else if (overallScore >= 60) {
            ratingText = '💪 及格 (Pas mal)';
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
    // 4. Render Sentence Cards with 3-Column Table and Shadowing
    // -------------------------------------------------------------------------
    function renderStudyDeck(sentences) {
        sentencesContainer.innerHTML = '';
        if (!sentences || sentences.length === 0) {
            studyDeckSection.hidden = true;
            return;
        }

        sentenceCountBadge.textContent = `共 ${sentences.length} 句`;
        studyDeckSection.hidden = false;

        sentences.forEach((sentenceData, index) => {
            const card = document.createElement('article');
            card.className = 'sentence-card';
            card.dataset.sentenceIndex = index;

            const sentenceIndexStr = String(index + 1).padStart(2, '0');
            const originalText = sentenceData.original || '';
            const transEn = sentenceData.translation_en || '';
            const transCn = sentenceData.translation_cn || '';
            const tokens = sentenceData.tokens || [];

            // 1. Hero / Header
            const heroHtml = `
                <div class="sentence-hero">
                    <div class="sentence-meta-row">
                        <span class="sentence-index-pill">Phrase ${sentenceIndexStr}</span>
                    </div>
                    <div class="sentence-text-row">
                        <p class="sentence-french-text">${escapeHtml(originalText)}</p>
                        <button class="btn-speak-round" type="button" title="朗读整句" aria-label="朗读整句">
                            <i data-lucide="volume-2"></i>
                        </button>
                    </div>
                    <div class="sentence-translations">
                        ${transEn ? `<div class="translation-en"><strong>EN:</strong> ${escapeHtml(transEn)}</div>` : ''}
                        ${transCn ? `<div class="translation-cn"><strong>CN:</strong> ${escapeHtml(transCn)}</div>` : ''}
                    </div>
                </div>
            `;

            // 2. Shadowing / 跟读打分模块
            const shadowingHtml = `
                <div class="shadowing-panel">
                    <div class="shadowing-header">
                        <div class="shadowing-title">
                            <i data-lucide="mic"></i>
                            <span>跟读打分 (Shadowing & Évaluation)</span>
                        </div>
                        <span class="shadowing-guide">点击录音清晰朗读此句，系统将自动评分与反馈</span>
                    </div>
                    <div class="shadowing-body">
                        <button class="btn-record" type="button">
                            <i data-lucide="mic"></i>
                            <span class="record-btn-text">点击开始跟读</span>
                        </button>
                    </div>
                    <div class="score-result-card" hidden>
                        <div class="score-summary-bar">
                            <div class="score-badge-group">
                                <span class="score-number-pill excellent">--</span>
                                <span class="score-rating-text">准备跟读</span>
                            </div>
                            <div class="score-metrics">
                                <span>准确度: <strong class="metric-acc">--</strong></span>
                                <span>完整度: <strong class="metric-comp">--</strong></span>
                            </div>
                        </div>
                        <div class="diff-result-box">
                            <!-- 逐词变色反馈 -->
                        </div>
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

            // 3. Three-Column Table
            let rowsHtml = '';
            tokens.forEach(tok => {
                const tokenText = tok.token || '';
                const lemma = tok.lemma && tok.lemma !== tokenText ? tok.lemma : '';
                const pos = tok.pos || '';
                const phonetic = tok.phonetic || '';
                const expEn = tok.explanation_en || '';
                const expCn = tok.explanation_cn || '';

                rowsHtml += `
                    <tr>
                        <td>
                            <div class="token-cell">
                                <div class="token-main-row">
                                    <span class="token-word">${escapeHtml(tokenText)}</span>
                                    <button class="btn-token-speak" type="button" title="发音" data-speech="${escapeHtml(tokenText)}">
                                        <i data-lucide="volume-2"></i>
                                    </button>
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
                                <th>① 词汇 / 短语 (Forme & Audio)</th>
                                <th>② 英文简明解释 (Anglais)</th>
                                <th>③ 中文释义与语法 (Chinois)</th>
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

            // Wire Card Events
            attachSentenceCardEvents(card, originalText);
        });

        // Initialize Lucide Icons for newly injected elements
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
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

        // 3. Shadowing Recording & Scoring Logic
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
                // Stop recording
                stopRecording();
            } else {
                // Start recording
                await startRecording();
            }
        });

        async function startRecording() {
            try {
                audioChunks = [];
                recognitionTranscript = '';

                // Request mic stream for MediaRecorder
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

                // Setup Speech Recognition if available
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

            // Evaluate after short delay to ensure final recognition results arrived
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

            // Render word diff
            diffBox.innerHTML = '';
            if (evaluation.wordResults.length > 0) {
                evaluation.wordResults.forEach(item => {
                    const wordSpan = document.createElement('span');
                    wordSpan.className = `diff-word ${item.status}`;
                    wordSpan.textContent = item.word;
                    wordSpan.title = `得分: ${item.score} / 100`;
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
    // 5. Text Analysis Request
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
            statusMessage.textContent = '正在调用 LLM 进行全句切分与词汇/短语深度三列解析，请稍候...';

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
            statusMessage.textContent = '拆解完成！您可以逐词查阅释义、点击 🔊 即时发音，或进行跟读打分复述。';
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
    // 6. Event Bindings
    // -------------------------------------------------------------------------
    initSettings();

    // Textarea counter
    frenchInput.addEventListener('input', () => {
        charCounter.textContent = `${frenchInput.value.length} / 15000`;
    });

    // Fill Example
    fillExampleButton.addEventListener('click', () => {
        frenchInput.value = "Je vais faire du vélo au bord du lac de temps en temps, parce que cela me détend énormément.";
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

    // Check prefilled URL query param `?text=...`
    const urlParams = new URLSearchParams(window.location.search);
    const prefillText = urlParams.get('text');
    if (prefillText) {
        frenchInput.value = decodeURIComponent(prefillText);
        charCounter.textContent = `${frenchInput.value.length} / 15000`;
        // Auto-run if text provided
        setTimeout(() => {
            if (apiKeyInput.value.trim()) {
                startAnalysis();
            }
        }, 300);
    }
});
