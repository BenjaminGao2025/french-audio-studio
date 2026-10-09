/* ==========================================================================
   French Audio Studio - Unified History Architecture
   Shared between TTS Audio Workbench (/) and Study Workbench (/study)
   Local-First with optional cloud sync to /api/history
   ========================================================================== */

(function (window) {
    'use strict';

    const UNIFIED_STORAGE_KEY = 'frenchStudio.unifiedHistory';
    const LEGACY_STUDY_STORAGE_KEY = 'frenchStudio.queryHistory';
    const TOKEN_KEY = 'frenchStudio.userToken';

    // i18n.js is loaded before this file; fall back to Chinese if it is missing.
    const I18N = window.FrenchI18n;
    const TEXT = {
        en: {
            totalCount: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
            play: 'Play', pause: 'Pause',
            emptyTts: 'No audio history yet. After you generate audio in Audio Studio, the recording and subtitle files are saved here automatically.',
            emptyStudy: 'No breakdown history yet. Sentences you analyse on the Study page keep their word cards here for good, ready to restore instantly.',
            emptyAll: 'No history yet. Audio you make in Audio Studio and French you analyse in Study are collected here automatically.',
            badgeTts: 'Audio', badgeStudy: 'Breakdown',
            tagV2: 'V2 English analysis', tagV1: 'Legacy Chinese analysis',
            sentenceCount: (n) => `${n} ${n === 1 ? 'sentence' : 'sentences'}`,
            tokenCount: (n) => `${n} ${n === 1 ? 'word' : 'words'}`,
            taskLabels: { auto: 'Auto', generate: 'Generate', translate: 'Translate', express: 'Express', polish: 'Polish French' },
            playTitle: 'Play preview', downloadMp3: 'Download MP3 audio', downloadSrt: 'Download SRT subtitles',
            restoreTtsTitle: 'Restore the text and audio to Audio Studio', restoreTts: 'Restore',
            loadTtsTitle: 'Put this text into Audio Studio to record it', loadTts: 'Use for audio',
            sendStudyTitle: 'Send to Study', sendStudy: 'Break it down',
            restoreStudyTitle: 'Restore all word cards instantly, without using tokens', restoreStudy: 'Restore and study',
            reanalyzeTitle: 'Re-analyse this text with the new English analysis, word-order comparison and sentence building',
            reanalyze: 'Re-analyse (new version)',
            importStudyTitle: 'Import this audio text and break it down', importStudy: 'Import and break down',
            openWorkbenchTitle: 'Make full read-aloud audio in Audio Studio', openWorkbench: 'Record in Audio Studio',
            deleteTitle: 'Delete this entry', delete: 'Delete',
            clearNameTts: 'audio', clearNameStudy: 'breakdown', clearNameAll: 'entire',
            confirmClear: (name) => `Clear the ${name} history?`,
        },
        zh: {
            totalCount: (n) => `共 ${n} 条`,
            play: '试听', pause: '暂停',
            emptyTts: '暂无音频生成历史。在音频工作台中生成语音或翻译后，录音与字幕文件将自动保存于此。',
            emptyStudy: '暂无法语拆解历史。在拆解与跟读页面分析句子后，三列词汇卡片将永久保存在此，随时 0ms 恢复。',
            emptyAll: '暂无任何历史记录。在音频工作台制作音频或在拆解台解析法语，均会自动沉淀至此。',
            badgeTts: '音频制作', badgeStudy: '拆解精析',
            tagV2: 'V2 英文精析', tagV1: '旧版中文精析',
            sentenceCount: (n) => `${n} 句子`,
            tokenCount: (n) => `${n} 词汇`,
            taskLabels: { auto: '智能判断', generate: '按要求生成', translate: '忠实翻译', express: '自然表达', polish: '润色法语' },
            playTitle: '在线试听', downloadMp3: '下载 MP3 音频', downloadSrt: '下载 SRT 字幕',
            restoreTtsTitle: '恢复文本与音频至工作台', restoreTts: '恢复到工作台',
            loadTtsTitle: '将此段拆解文本填入工作台制作录音', loadTts: '填入制作录音',
            sendStudyTitle: '发送至拆解学习台', sendStudy: '送去拆解精析',
            restoreStudyTitle: '免消耗 Token 立即恢复全套词汇卡片', restoreStudy: '恢复并学习',
            reanalyzeTitle: '使用新版英文精析、词序对照与搭句子重新分析此文本',
            reanalyze: '用新版重新精析',
            importStudyTitle: '导入此段音频文本并拆解', importStudy: '导入并拆解',
            openWorkbenchTitle: '在音频工作台制作完整朗读音频', openWorkbench: '去音频台录制',
            deleteTitle: '删除此条记录', delete: '删除',
            clearNameTts: '音频生成', clearNameStudy: '拆解精析', clearNameAll: '全部',
            confirmClear: (name) => `确定要清空 ${name} 历史记录吗？`,
        },
    };
    const T = TEXT[I18N && I18N.lang() === 'en' ? 'en' : 'zh'];

    function getAuthToken() {
        return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatTime(dateObj) {
        const d = dateObj || new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${day} ${h}:${min}`;
    }

    // -------------------------------------------------------------------------
    // Storage & Deduplication Engine
    // -------------------------------------------------------------------------
    function normalizeHistoryText(str) {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»[\]\s\n\r\t]/g, '')
            .trim();
    }

    function calculateStringSimilarity(s1, s2) {
        if (!s1 && !s2) return 1.0;
        if (!s1 || !s2) return 0.0;
        if (s1 === s2) return 1.0;
        const m = s1.length;
        const n = s2.length;
        if (Math.abs(m - n) > Math.max(m, n) * 0.3) return 0.0;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (s1[i - 1] === s2[j - 1]) dp[i][j] = dp[i - 1][j - 1];
                else dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1);
            }
        }
        return Math.max(0, 1 - dp[m][n] / Math.max(m, n));
    }

    function getRecordSentencesKey(item) {
        if (!item || !item.sentences || !Array.isArray(item.sentences) || item.sentences.length === 0) {
            return '';
        }
        return item.sentences.map(s => normalizeHistoryText(s.original || '')).filter(Boolean).join(':::');
    }

    function areStudyRecordsDuplicate(itemA, itemB) {
        if (!itemA || !itemB) return false;
        if (itemA.type !== 'study' || itemB.type !== 'study') return false;

        // 1. Exact text match (trimmed)
        if (itemA.text && itemB.text && itemA.text.trim() === itemB.text.trim()) {
            return true;
        }

        // 2. Parsed sentences match (same sentence breakdown structure)
        const sentKeyA = getRecordSentencesKey(itemA);
        const sentKeyB = getRecordSentencesKey(itemB);
        if (sentKeyA && sentKeyB && sentKeyA === sentKeyB) {
            return true;
        }

        // 3. Normalized text similarity (fuzzy match)
        const normA = normalizeHistoryText(itemA.text);
        const normB = normalizeHistoryText(itemB.text);
        if (normA && normB) {
            if (normA === normB) return true;
            const minLen = Math.min(normA.length, normB.length);
            const maxLen = Math.max(normA.length, normB.length);
            if (minLen >= 10) {
                // If one contains the other and length difference is minor (<= 4 chars)
                if ((normA.includes(normB) || normB.includes(normA)) && (maxLen - minLen <= 4)) {
                    return true;
                }
                // High similarity check
                if (maxLen - minLen <= 6 && calculateStringSimilarity(normA, normB) >= 0.88) {
                    return true;
                }
            }
        }

        return false;
    }

    function areTtsRecordsDuplicate(itemA, itemB) {
        if (!itemA || !itemB) return false;
        if (itemA.type !== 'tts' || itemB.type !== 'tts') return false;
        const normA = normalizeHistoryText(itemA.text);
        const normB = normalizeHistoryText(itemB.text);
        if (normA && normB && normA === normB) {
            if ((itemA.voice || '') === (itemB.voice || '')) {
                return true;
            }
        }
        return false;
    }

    function deduplicateHistoryList(list) {
        if (!Array.isArray(list) || list.length <= 1) return list || [];
        const result = [];

        for (const item of list) {
            if (!item || !item.type) continue;
            let isDuplicate = false;

            for (let i = 0; i < result.length; i++) {
                const existing = result[i];
                if (item.type === 'study' && areStudyRecordsDuplicate(item, existing)) {
                    isDuplicate = true;
                    // Prefer record with valid sentences and longer text
                    const itemSentencesCount = (item.sentences && Array.isArray(item.sentences)) ? item.sentences.length : 0;
                    const existingSentencesCount = (existing.sentences && Array.isArray(existing.sentences)) ? existing.sentences.length : 0;
                    if (existingSentencesCount === 0 && itemSentencesCount > 0) {
                        result[i] = item;
                    } else if (itemSentencesCount >= existingSentencesCount && (item.text || '').length > (existing.text || '').length) {
                        result[i] = item;
                    }
                    break;
                } else if (item.type === 'tts' && areTtsRecordsDuplicate(item, existing)) {
                    isDuplicate = true;
                    if (!existing.audioUrl && item.audioUrl) {
                        result[i] = item;
                    }
                    break;
                }
            }

            if (!isDuplicate) {
                result.push(item);
            }
        }

        return result;
    }

    function loadRawHistory() {
        let rawList = [];
        try {
            const raw = localStorage.getItem(UNIFIED_STORAGE_KEY);
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) rawList = list;
            }
        } catch (_) {}

        if (rawList.length === 0) {
            // Migrate legacy study history if unified storage does not exist yet
            try {
                const legacyRaw = localStorage.getItem(LEGACY_STUDY_STORAGE_KEY);
                if (legacyRaw) {
                    const legacyList = JSON.parse(legacyRaw);
                    if (Array.isArray(legacyList) && legacyList.length > 0) {
                        rawList = legacyList.map(item => ({
                            id: item.id || ('hist_study_' + (item.timestamp || Date.now())),
                            type: 'study',
                            timestamp: item.timestamp || Date.now(),
                            timeFormatted: item.timeFormatted || formatTime(new Date(item.timestamp || Date.now())),
                            text: item.text || '',
                            sentences: item.sentences || [],
                            sentenceCount: item.sentenceCount || (item.sentences ? item.sentences.length : 1),
                            tokenCount: item.tokenCount || 0,
                            model: item.model || '',
                        }));
                    }
                }
            } catch (_) {}
        }

        const cleaned = deduplicateHistoryList(rawList);
        if (cleaned.length !== rawList.length) {
            saveRawHistory(cleaned);
        }
        return cleaned;
    }

    function saveRawHistory(list) {
        try {
            if (list.length > 100) list = list.slice(0, 100);
            localStorage.setItem(UNIFIED_STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            console.error('Failed to save unified history to localStorage', e);
        }
    }

    // Background sync to backend SQLite
    async function syncToBackend(record) {
        const token = getAuthToken();
        if (!token) return;
        try {
            const headers = { 'Content-Type': 'application/json' };
            headers['Authorization'] = `Bearer ${token}`;
            await fetch('/api/history', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    id: record.id,
                    type: record.type,
                    text: record.text,
                    payload: record,
                }),
            });
        } catch (_) {
            // Non-blocking background sync failure is safe to ignore
        }
    }

    async function syncDeleteToBackend(recordId) {
        const token = getAuthToken();
        if (!token) return;
        try {
            const headers = {};
            headers['Authorization'] = `Bearer ${token}`;
            await fetch(`/api/history/${encodeURIComponent(recordId)}`, {
                method: 'DELETE',
                headers,
            });
        } catch (_) {}
    }

    // Another device (or a cleared browser) only has what the server kept: merge it in,
    // and send up records that so far exist only in this browser.
    let pullPromise = null;
    function pullFromBackend() {
        const token = getAuthToken();
        if (!token) return Promise.resolve(false);
        if (pullPromise) return pullPromise;
        pullPromise = (async () => {
            try {
                const res = await fetch('/api/history?limit=200', { headers: { 'Authorization': `Bearer ${token}` } });
                if (!res.ok) return false;
                const data = await res.json();
                const local = loadRawHistory();
                const known = new Set(local.map(item => item.id));
                const remote = (data.records || []).map(record => {
                    const { user_id, created_at, ...item } = record;
                    if (!item.timestamp) item.timestamp = Date.parse(created_at) || Date.now();
                    if (!item.timeFormatted) item.timeFormatted = formatTime(new Date(item.timestamp));
                    return item;
                });
                const added = remote.filter(item => item.id && !known.has(item.id));
                const serverIds = new Set(remote.map(item => item.id));
                local.filter(item => !serverIds.has(item.id)).slice(0, 50).forEach(syncToBackend);
                if (!added.length) return false;
                const merged = deduplicateHistoryList([...local, ...added]
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
                saveRawHistory(merged);
                return true;
            } catch (_) {
                return false;
            } finally {
                pullPromise = null;
            }
        })();
        return pullPromise;
    }

    async function syncClearToBackend(recordType) {
        const token = getAuthToken();
        if (!token) return;
        try {
            const headers = {};
            headers['Authorization'] = `Bearer ${token}`;
            const url = recordType ? `/api/history?type=${encodeURIComponent(recordType)}` : '/api/history';
            await fetch(url, {
                method: 'DELETE',
                headers,
            });
        } catch (_) {}
    }

    // -------------------------------------------------------------------------
    // FrenchHistory Manager
    // -------------------------------------------------------------------------
    const FrenchHistory = {
        currentPage: 'workbench', // 'workbench' | 'study'
        activeTab: 'all',        // 'all' | 'tts' | 'study'
        currentAudio: null,      // Currently playing preview audio element
        onRestoreTts: null,
        onRestoreStudy: null,

        getRecords(filterType) {
            const list = loadRawHistory();
            if (!filterType || filterType === 'all') return list;
            return list.filter(item => item.type === filterType);
        },

        getCounts() {
            const list = loadRawHistory();
            const ttsCount = list.filter(x => x.type === 'tts').length;
            const studyCount = list.filter(x => x.type === 'study').length;
            return {
                all: list.length,
                tts: ttsCount,
                study: studyCount,
            };
        },

        saveTtsRecord(data) {
            if (!data || !data.text) return null;
            const list = loadRawHistory();
            const now = new Date();
            const id = 'hist_tts_' + Date.now();
            const record = {
                id,
                type: 'tts',
                timestamp: Date.now(),
                timeFormatted: formatTime(now),
                text: data.text.trim(),
                sourceText: data.sourceText ? data.sourceText.trim() : '',
                taskMode: data.taskMode || 'auto',
                taskLabel: data.taskLabel || '',
                voice: data.voice || 'fr-FR-DeniseNeural',
                audioUrl: data.audioUrl || '',
                audioFilename: data.audioFilename || '',
                srtUrl: data.srtUrl || '',
                srtFilename: data.srtFilename || '',
                model: data.model || '',
            };

            // Deduplicate same text + voice
            const filtered = list.filter(item => !areTtsRecordsDuplicate(item, record));
            filtered.unshift(record);
            saveRawHistory(filtered);
            this.updateBadges();
            syncToBackend(record);
            return record;
        },

        saveStudyRecord(text, sentences, model) {
            if (!text || !sentences || sentences.length === 0) return null;
            const list = loadRawHistory();
            const now = new Date();
            const id = 'hist_study_' + Date.now();
            const totalTokens = sentences.reduce((acc, s) => acc + (s.tokens ? s.tokens.length : 0), 0);
            const isV2 = Boolean(sentences[0] && (sentences[0].schemaVersion === 2 || sentences[0].words));
            const record = {
                id,
                type: 'study',
                schemaVersion: isV2 ? 2 : 1,
                timestamp: Date.now(),
                timeFormatted: formatTime(now),
                text: text.trim(),
                sentences,
                sentenceCount: sentences.length,
                tokenCount: totalTokens,
                model: model || '',
            };

            // Deduplicate same or near-identical text / sentence breakdown
            const filtered = list.filter(item => !areStudyRecordsDuplicate(item, record));
            filtered.unshift(record);
            saveRawHistory(filtered);
            this.updateBadges();
            syncToBackend(record);
            return record;
        },

        deleteRecord(id) {
            let list = loadRawHistory();
            list = list.filter(item => item.id !== id);
            saveRawHistory(list);
            this.updateBadges();
            syncDeleteToBackend(id);
        },

        clearAll(filterType) {
            if (!filterType || filterType === 'all') {
                saveRawHistory([]);
                syncClearToBackend();
            } else {
                let list = loadRawHistory();
                list = list.filter(item => item.type !== filterType);
                saveRawHistory(list);
                syncClearToBackend(filterType);
            }
            this.updateBadges();
        },

        updateBadges() {
            const counts = this.getCounts();
            const badges = document.querySelectorAll('.history-count-badge, #history-count-badge');
            badges.forEach(b => {
                b.textContent = `${counts.all}`;
                b.hidden = counts.all === 0;
            });

            const totalBadges = document.querySelectorAll('#history-total-badge');
            totalBadges.forEach(b => {
                b.textContent = T.totalCount(counts.all);
            });

            // Update Tab counts if modal is open
            const tabAllCount = document.getElementById('hist-tab-count-all');
            const tabTtsCount = document.getElementById('hist-tab-count-tts');
            const tabStudyCount = document.getElementById('hist-tab-count-study');
            if (tabAllCount) tabAllCount.textContent = `${counts.all}`;
            if (tabTtsCount) tabTtsCount.textContent = `${counts.tts}`;
            if (tabStudyCount) tabStudyCount.textContent = `${counts.study}`;
        },

        stopPreviewAudio() {
            if (this.currentAudio) {
                try {
                    this.currentAudio.pause();
                    this.currentAudio.currentTime = 0;
                } catch (_) {}
                this.currentAudio = null;
            }
            document.querySelectorAll('.btn-hist-play.is-playing').forEach(btn => {
                btn.classList.remove('is-playing');
                btn.innerHTML = `<i data-lucide="play"></i><span>${T.play}</span>`;
            });
            if (window.lucide) window.lucide.createIcons();
        },

        openModal(initialTab) {
            if (initialTab) this.activeTab = initialTab;
            const modal = document.getElementById('history-modal');
            if (!modal) return;
            this.renderList();
            modal.hidden = false;
            this.updateBadges();
            if (window.lucide) window.lucide.createIcons();
            this.pull();
        },

        // Bring in records saved from other devices; redraw if anything new arrived
        async pull() {
            const changed = await pullFromBackend();
            if (!changed) return false;
            this.updateBadges();
            const modal = document.getElementById('history-modal');
            if (modal && !modal.hidden) this.renderList();
            if (window.lucide) window.lucide.createIcons();
            return true;
        },

        closeModal() {
            this.stopPreviewAudio();
            const modal = document.getElementById('history-modal');
            if (modal) modal.hidden = true;
        },

        renderList() {
            const listContainer = document.getElementById('history-list');
            const emptyContainer = document.getElementById('history-empty');
            if (!listContainer || !emptyContainer) return;

            const records = this.getRecords(this.activeTab);
            this.stopPreviewAudio();

            if (records.length === 0) {
                listContainer.innerHTML = '';
                emptyContainer.hidden = false;
                const emptyDesc = emptyContainer.querySelector('p');
                if (emptyDesc) {
                    if (this.activeTab === 'tts') {
                        emptyDesc.textContent = T.emptyTts;
                    } else if (this.activeTab === 'study') {
                        emptyDesc.textContent = T.emptyStudy;
                    } else {
                        emptyDesc.textContent = T.emptyAll;
                    }
                }
                return;
            }

            emptyContainer.hidden = true;
            listContainer.innerHTML = records.map(item => this.renderRecordItem(item)).join('');
            this.wireRecordEvents(listContainer);
            if (window.lucide) window.lucide.createIcons();
        },

        renderRecordItem(item) {
            const isTts = item.type === 'tts';
            const typeBadge = isTts
                ? `<span class="badge history-type-badge tts-badge"><i data-lucide="headphones" style="width: 12px; height: 12px;"></i> ${T.badgeTts}</span>`
                : `<span class="badge history-type-badge study-badge"><i data-lucide="book-open" style="width: 12px; height: 12px;"></i> ${T.badgeStudy}</span>`;

            let metaTags = '';
            if (isTts) {
                if (item.voice) metaTags += `<span class="history-stat-tag voice-tag">${escapeHtml(item.voice.replace('Neural', ''))}</span>`;
                const taskLabel = T.taskLabels[item.taskMode] || item.taskLabel;
                if (taskLabel) metaTags += `<span class="history-stat-tag">${escapeHtml(taskLabel)}</span>`;
                if (item.model) metaTags += `<span class="history-stat-tag model-tag">${escapeHtml(item.model)}</span>`;
            } else {
                const isV2 = item.schemaVersion === 2 || Boolean(item.sentences && item.sentences[0] && (item.sentences[0].schemaVersion === 2 || item.sentences[0].words));
                metaTags += `<span class="history-stat-tag ${isV2 ? 'model-tag' : ''}">${isV2 ? T.tagV2 : T.tagV1}</span>`;
                metaTags += `<span class="history-stat-tag">${T.sentenceCount(item.sentenceCount || 1)}</span>`;
                metaTags += `<span class="history-stat-tag">${T.tokenCount(item.tokenCount || 0)}</span>`;
            }

            let audioSection = '';
            if (isTts && item.audioUrl) {
                audioSection = `
                    <div class="history-audio-bar">
                        <button class="btn btn-secondary btn-sm btn-hist-play" data-url="${escapeHtml(item.audioUrl)}" type="button" title="${T.playTitle}">
                            <i data-lucide="play"></i>
                            <span>${T.play}</span>
                        </button>
                        <div class="history-audio-links">
                            <a href="${escapeHtml(item.audioUrl)}?download=true" download="${escapeHtml(item.audioFilename || 'french_audio.mp3')}" class="btn btn-secondary btn-sm" title="${T.downloadMp3}">
                                <i data-lucide="download"></i>
                                <span>MP3</span>
                            </a>
                            ${item.srtUrl ? `
                            <a href="${escapeHtml(item.srtUrl)}?download=true" download="${escapeHtml(item.srtFilename || 'french_subtitles.srt')}" class="btn btn-secondary btn-sm" title="${T.downloadSrt}">
                                <i data-lucide="file-text"></i>
                                <span>SRT</span>
                            </a>` : ''}
                        </div>
                    </div>
                `;
            }

            // Action buttons depend on current page
            let actionButtons = '';
            if (this.currentPage === 'workbench') {
                if (isTts) {
                    actionButtons += `
                        <button class="btn btn-secondary btn-sm btn-restore-item" data-id="${escapeHtml(item.id)}" type="button" title="${T.restoreTtsTitle}">
                            <i data-lucide="rotate-ccw"></i>
                            <span>${T.restoreTts}</span>
                        </button>
                    `;
                } else {
                    actionButtons += `
                        <button class="btn btn-secondary btn-sm btn-load-tts-text" data-id="${escapeHtml(item.id)}" type="button" title="${T.loadTtsTitle}">
                            <i data-lucide="mic"></i>
                            <span>${T.loadTts}</span>
                        </button>
                    `;
                }
                actionButtons += `
                    <button class="btn btn-secondary btn-sm btn-send-to-study" data-id="${escapeHtml(item.id)}" type="button" title="${T.sendStudyTitle}">
                        <i data-lucide="sparkles"></i>
                        <span>${T.sendStudy}</span>
                    </button>
                `;
            } else {
                // Study page
                if (!isTts) {
                    const isV2 = item.schemaVersion === 2 || Boolean(item.sentences && item.sentences[0] && (item.sentences[0].schemaVersion === 2 || item.sentences[0].words));
                    actionButtons += `
                        <button class="btn btn-primary btn-sm btn-restore-item" data-id="${escapeHtml(item.id)}" type="button" title="${T.restoreStudyTitle}">
                            <i data-lucide="rotate-ccw"></i>
                            <span>${T.restoreStudy}</span>
                        </button>
                    `;
                    if (!isV2) {
                        actionButtons += `
                            <button class="btn btn-secondary btn-sm btn-reanalyze-v2" data-id="${escapeHtml(item.id)}" type="button" title="${T.reanalyzeTitle}">
                                <i data-lucide="sparkles"></i>
                                <span>${T.reanalyze}</span>
                            </button>
                        `;
                    }
                } else {
                    actionButtons += `
                        <button class="btn btn-primary btn-sm btn-import-study" data-id="${escapeHtml(item.id)}" type="button" title="${T.importStudyTitle}">
                            <i data-lucide="sparkles"></i>
                            <span>${T.importStudy}</span>
                        </button>
                    `;
                }
                actionButtons += `
                    <button class="btn btn-secondary btn-sm btn-open-in-workbench" data-id="${escapeHtml(item.id)}" type="button" title="${T.openWorkbenchTitle}">
                        <i data-lucide="headphones"></i>
                        <span>${T.openWorkbench}</span>
                    </button>
                `;
            }

            actionButtons += `
                <button class="btn btn-secondary btn-sm btn-delete-item" data-id="${escapeHtml(item.id)}" type="button" title="${T.deleteTitle}">
                    <i data-lucide="trash-2"></i>
                    <span>${T.delete}</span>
                </button>
            `;

            return `
                <div class="history-item ${isTts ? 'is-tts' : 'is-study'}" data-id="${escapeHtml(item.id)}">
                    <div class="history-item-header">
                        <div class="history-type-group">
                            ${typeBadge}
                            <div class="history-time-group">
                                <i data-lucide="clock" style="width: 13px; height: 13px;"></i>
                                <span>${escapeHtml(item.timeFormatted)}</span>
                            </div>
                        </div>
                        <div class="history-stats-group">
                            ${metaTags}
                        </div>
                    </div>
                    <div class="history-snippet">${escapeHtml(item.text)}</div>
                    ${audioSection}
                    <div class="history-item-actions">
                        ${actionButtons}
                    </div>
                </div>
            `;
        },

        wireRecordEvents(container) {
            // Clicking the text opens the record, like its main button
            container.querySelectorAll('.history-snippet').forEach(snippet => {
                snippet.addEventListener('click', () => {
                    const item = snippet.closest('.history-item');
                    const main = item && item.querySelector('.btn-restore-item, .btn-send-to-study, .btn-import-study');
                    if (main) main.click();
                });
            });

            // Audio Play/Pause
            container.querySelectorAll('.btn-hist-play').forEach(btn => {
                btn.addEventListener('click', () => {
                    const url = btn.dataset.url;
                    if (!url) return;

                    if (this.currentAudio && this.currentAudio.src.includes(url) && !this.currentAudio.paused) {
                        this.stopPreviewAudio();
                        return;
                    }

                    this.stopPreviewAudio();
                    const audio = new Audio(url);
                    this.currentAudio = audio;
                    btn.classList.add('is-playing');
                    btn.innerHTML = `<i data-lucide="pause"></i><span>${T.pause}</span>`;
                    if (window.lucide) window.lucide.createIcons();

                    audio.play().catch(e => {
                        console.error('Audio playback error', e);
                        this.stopPreviewAudio();
                    });

                    audio.addEventListener('ended', () => {
                        this.stopPreviewAudio();
                    });
                });
            });

            // Delete single record
            container.querySelectorAll('.btn-delete-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    if (!id) return;
                    this.deleteRecord(id);
                    this.renderList();
                });
            });

            // Restore item
            container.querySelectorAll('.btn-restore-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = loadRawHistory().find(x => x.id === id);
                    if (!item) return;

                    this.closeModal();
                    if (item.type === 'tts' && typeof this.onRestoreTts === 'function') {
                        this.onRestoreTts(item);
                    } else if (item.type === 'study' && typeof this.onRestoreStudy === 'function') {
                        this.onRestoreStudy(item);
                    }
                });
            });

            // Reanalyze study record with V2
            container.querySelectorAll('.btn-reanalyze-v2').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = loadRawHistory().find(x => x.id === id);
                    if (!item) return;

                    this.closeModal();
                    if (typeof this.onReanalyzeStudy === 'function') {
                        this.onReanalyzeStudy(item);
                    } else if (typeof this.onRestoreStudy === 'function') {
                        this.onRestoreStudy({ text: item.text, forceReanalyze: true });
                    }
                });
            });

            // Load TTS Text in Workbench
            container.querySelectorAll('.btn-load-tts-text').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = loadRawHistory().find(x => x.id === id);
                    if (!item) return;
                    this.closeModal();
                    if (typeof this.onRestoreTts === 'function') {
                        this.onRestoreTts({ text: item.text });
                    }
                });
            });

            // Send to Study from Workbench
            container.querySelectorAll('.btn-send-to-study').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = loadRawHistory().find(x => x.id === id);
                    if (!item) return;
                    this.closeModal();
                    // A saved breakdown opens as it is (no new analysis); plain text gets analysed
                    const saved = item.type === 'study' && item.sentences && item.sentences.length;
                    window.location.href = saved
                        ? `/study?restore=${encodeURIComponent(item.id)}`
                        : `/study?text=${encodeURIComponent(item.text)}`;
                });
            });

            // Import to Study from TTS item in Study page
            container.querySelectorAll('.btn-import-study').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = loadRawHistory().find(x => x.id === id);
                    if (!item) return;
                    this.closeModal();
                    if (typeof this.onRestoreStudy === 'function') {
                        this.onRestoreStudy({ text: item.text, sentences: null });
                    }
                });
            });

            // Open in Workbench from Study page
            container.querySelectorAll('.btn-open-in-workbench').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = loadRawHistory().find(x => x.id === id);
                    if (!item) return;
                    this.closeModal();
                    window.location.href = `/?text=${encodeURIComponent(item.text)}`;
                });
            });
        },

        init(config) {
            config = config || {};
            this.currentPage = config.currentPage || 'workbench';
            this.onRestoreTts = config.onRestoreTts || null;
            this.onRestoreStudy = config.onRestoreStudy || null;

            // Trigger legacy migration and badge update, then fetch other devices' records
            this.updateBadges();
            this.pull();

            // Wire Toggle Button
            const toggleBtns = document.querySelectorAll('#history-toggle-btn, .btn-open-history');
            toggleBtns.forEach(btn => {
                btn.addEventListener('click', () => this.openModal());
            });

            // Wire Modal Close & Backdrop
            const modal = document.getElementById('history-modal');
            const closeBtn = document.getElementById('close-history-modal-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeModal());
            }
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) this.closeModal();
                });
            }

            // Wire Escape key
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal && !modal.hidden) {
                    this.closeModal();
                }
            });

            // Wire Filter Tabs
            const tabAll = document.getElementById('hist-tab-all');
            const tabTts = document.getElementById('hist-tab-tts');
            const tabStudy = document.getElementById('hist-tab-study');

            const setTab = (tab) => {
                this.activeTab = tab;
                [tabAll, tabTts, tabStudy].forEach(t => {
                    if (t) {
                        const isMatch = t.dataset.tab === tab;
                        t.classList.toggle('active', isMatch);
                        t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
                    }
                });
                this.renderList();
            };

            if (tabAll) tabAll.addEventListener('click', () => setTab('all'));
            if (tabTts) tabTts.addEventListener('click', () => setTab('tts'));
            if (tabStudy) tabStudy.addEventListener('click', () => setTab('study'));

            // Wire Clear All Button
            const clearBtn = document.getElementById('clear-history-btn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    const tabName = this.activeTab === 'tts' ? T.clearNameTts : this.activeTab === 'study' ? T.clearNameStudy : T.clearNameAll;
                    if (confirm(T.confirmClear(tabName))) {
                        this.clearAll(this.activeTab);
                        this.renderList();
                    }
                });
            }
        },
    };

    window.FrenchHistory = FrenchHistory;

})(window);
