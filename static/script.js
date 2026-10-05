document.addEventListener('DOMContentLoaded', () => {
    const sourceText = document.getElementById('source-text');
    const outputText = document.getElementById('output-text');
    const sourceCount = document.getElementById('source-count');
    const outputCount = document.getElementById('output-count');
    const levelSelect = document.getElementById('level-select');
    const levelControl = levelSelect.closest('.control-group');
    const styleControl = document.querySelector('.style-control');
    const styleInputs = Array.from(document.querySelectorAll('input[name="style"]'));
    const localeSelect = document.getElementById('locale-select');
    const voiceSelect = document.getElementById('voice-select');
    const modelSelect = document.getElementById('model-select');
    const sourceHeading = document.getElementById('source-heading');
    const taskUsed = document.getElementById('task-used');
    const apiKeyInput = document.getElementById('api-key');
    const rememberKey = document.getElementById('remember-key');
    const connectionSettings = document.querySelector('.connection-settings');
    const connectionForm = document.querySelector('.connection-popover');
    const connectionSummaryState = document.getElementById('connection-summary-state');
    const connectionSummaryText = connectionSummaryState.querySelector('.connection-summary-text');
    const connectionResult = document.getElementById('connection-result');
    const connectionResultTitle = document.getElementById('connection-result-title');
    const connectionResultDetail = document.getElementById('connection-result-detail');
    const testConnectionButton = document.getElementById('test-connection');
    const toggleKeyButton = document.getElementById('toggle-key');
    const clearSourceButton = document.getElementById('clear-source');
    const copyOutputButton = document.getElementById('copy-output');
    const transformButton = document.getElementById('transform-btn');
    const transformSpeechButton = document.getElementById('transform-speech-btn');
    const transformButtonLabel = document.getElementById('transform-btn-label');
    const transformSpeechButtonLabel = document.getElementById('transform-speech-btn-label');
    const speechButton = document.getElementById('speech-btn');
    const statusMessage = document.getElementById('status-message');
    const modelUsed = document.getElementById('model-used');
    const audioPanel = document.getElementById('audio-panel');
    const audioPlayer = document.getElementById('audio-player');
    const downloadMp3 = document.getElementById('download-mp3');
    const downloadSrt = document.getElementById('download-srt');

    const TEXT = {
        en: {
            pageTitle: 'French Audio Studio',
            heading: 'French Audio Studio',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navReview: 'Review', navListen: 'Listen',
            history: 'History', historyBtnTitle: 'View and restore past history',
            connectionSettings: 'Connection', connectionSummaryTitle: 'Connection not verified yet',
            notVerified: 'Not verified', toggleKey: 'Show or hide the API key',
            modelLabel: 'Model',
            modelGeminiOption: 'Gemini 3.8 Flash (AGY) · fastest',
            recommendedSuffix: ' · recommended', modelSuffixPattern: /\s*·\s*(recommended|backup)$/,
            rememberKey: 'Remember on this device',
            notTested: 'Not tested yet', notTestedDetail: 'Enter a key, then test the real connection',
            testConnection: 'Test connection',
            taskModeLegend: 'Task',
            taskAuto: 'Auto', taskAutoTitle: 'Automatically decide whether to generate, translate, express or polish',
            taskGenerate: 'Generate', taskGenerateTitle: 'Treat the input as instructions and write the French it asks for',
            taskTranslate: 'Translate', taskTranslateTitle: 'Translate the original faithfully, without adding anything',
            taskExpress: 'Express', taskExpressTitle: 'Turn spoken notes or scattered ideas into natural French',
            taskPolish: 'Polish French', taskPolishTitle: 'Correct existing French while keeping its meaning',
            editorAria: 'French text conversion',
            sourceHeading: 'Input', clearSource: 'Clear the input',
            sourcePlaceholder: 'Paste Chinese, English or existing French text...',
            outputHeading: 'French result', taskPending: 'Pending', modelUsedDefault: 'Grok 4.6 · pending',
            sendToStudy: 'Send to Study', copyOutput: 'Copy the French text',
            outputPlaceholder: 'The French result appears here, and you can keep editing it...',
            controlsAria: 'Conversion settings',
            styleLegend: 'Style', styleSpoken: 'Spoken', styleNeutral: 'Standard', styleFormal: 'Formal', stylePolished: 'Polished writing',
            levelLabel: 'Level', levelA: 'A1-A2 Beginner', levelB: 'B1-B2 Intermediate', levelC: 'C1-C2 Advanced',
            localeLabel: 'Region', localeFR: 'French (France)', localeCA: 'French (Canada)',
            voiceLabel: 'Voice',
            voiceDenise: 'Denise · female', voiceHenri: 'Henri · male', voiceVivienne: 'Vivienne · female', voiceRemy: 'Remy · male',
            voiceSylvie: 'Sylvie · female', voiceJean: 'Jean · male', voiceAntoine: 'Antoine · male',
            actionAria: 'Actions',
            speechBtn: 'Read the French aloud', transformBtn: 'Generate French', transformSpeechBtn: 'Generate French and make audio',
            audioHeading: 'Audio & subtitles',
            historyTotalZero: '0 items', clearHistoryTitle: 'Clear the history in this tab', clearHistory: 'Clear history',
            closeModal: 'Close (Esc)', histTabAll: 'All', histTabTts: '🎧 Audio', histTabStudy: '📖 Breakdowns',
            historyEmptyTitle: 'No history yet',
            historyEmptyDesc: 'Every audio you generate and every breakdown is saved here automatically, ready to replay or restore in one click.',
            modeAutoHeading: 'Input', modeAutoPlaceholder: 'Enter a request, text to translate, spoken ideas or existing French...',
            modeAutoAction: 'Generate French', modeAutoSpeechAction: 'Generate French and make audio',
            modeAutoWorking: 'Choosing how to handle it and generating French...',
            modeGenerateHeading: 'Request', modeGeneratePlaceholder: 'Describe the topic, length, setting, characters or what you want written...',
            modeGenerateAction: 'Generate French', modeGenerateSpeechAction: 'Generate French and make audio',
            modeGenerateWorking: 'Generating French from your request...',
            modeTranslateHeading: 'Text to translate', modeTranslatePlaceholder: 'Paste the text to translate faithfully into French...',
            modeTranslateAction: 'Translate into French', modeTranslateSpeechAction: 'Translate and make audio',
            modeTranslateWorking: 'Translating faithfully into French...',
            modeExpressHeading: 'What you want to say', modeExpressPlaceholder: 'Write spoken notes, scattered ideas or mixed Chinese and English...',
            modeExpressAction: 'Say it in French', modeExpressSpeechAction: 'Say it in French and make audio',
            modeExpressWorking: 'Working out the meaning and putting it into natural French...',
            modePolishHeading: 'Original French', modePolishPlaceholder: 'Paste the French text you want corrected or polished...',
            modePolishAction: 'Polish French', modePolishSpeechAction: 'Polish and make audio',
            modePolishWorking: 'Polishing the French...',
            summaryIdle: 'Not verified', summaryTesting: 'Testing', summaryConnected: 'Connected', summaryError: 'Failed',
            titleDetail: (title, detail) => `${title}: ${detail}`,
            qualityPending: 'pending', qualityPassed: 'French check passed', qualityProofread: 'proofread', qualityFailed: 'check failed',
            proofreadTitle: (label, proofreader) => `Generated by ${label}, proofread against the source by ${proofreader}`,
            taskFailed: (label) => `${label} · failed`, taskFailedTitle: (label) => `${label} failed`,
            autoResolved: (label) => `Auto → ${label}`, autoResolvedTitle: (label) => `Auto-detected: ${label}`,
            taskModeTitle: (label) => `Mode: ${label}`, autoPendingTitle: 'The detected mode appears after generating',
            translateNoStyle: 'Faithful translation keeps the original meaning, so no style rewrite is applied',
            translateNoLevel: 'Faithful translation keeps the original meaning, so the level is not adjusted',
            needApiKey: 'Enter your web2api API key in Connection first.',
            withCode: (message, code) => `${message} (${code})`,
            modelFailed: 'The model failed, or its output did not pass the quality check. Please try again.',
            requestFailed: (status) => `Request failed (HTTP ${status})`,
            testingTitle: (label) => `Testing ${label}`, testingDetail: 'Checking the key, model access and French-only output',
            testingStatus: (label) => `Testing the ${label} connection...`,
            connectedTitle: (label) => `${label} connected`, testSample: (sample) => `Test translation: ${sample}`,
            reviewerPassed: (label) => `, proofread by ${label}`,
            connectedStatus: (label, reviewer) => `${label} connected${reviewer}.`,
            testFailedTitle: (label) => `${label} test failed`, connectionFailed: 'Connection failed',
            needFrenchText: 'Generate or enter some French text first.',
            generatingAudio: 'Generating French audio...',
            loginForAudio: 'Log in to generate full audio (top right of the Study page).',
            audioReady: 'Audio and subtitles are ready.',
            needSourceText: 'Enter the text to convert.',
            workingThenAudio: (working) => `${working.replace(/\.\.\.$/, '')}, then making the audio...`,
            detailProofread: 'was proofread in French', detailPassed: 'passed the French-only check',
            lastRun: (label, detail, proofreader) => `Last run ("${label}") ${detail}${proofreader ? ` (${proofreader})` : ''}`,
            autoDone: (label) => `Detected "${label}". The French text is ready and proofread.`,
            modeDone: (label, detail) => `Done as "${label}": the text ${detail}.`,
            requestFailedTitle: (label) => `${label} request failed`,
            actionFailed: 'Something went wrong. Please try again later.',
            keyChanged: 'Key changed', retestConnection: 'Please test the connection again',
            modelUnverified: (label) => `${label} not verified`, modelSwitched: 'Model changed. Please test the connection.',
            needStudyText: 'Generate or enter the French text you want to study first.',
            nothingToCopy: 'There is no French text to copy.', copied: 'French text copied.',
            keySaved: 'Key saved', clickToTest: (label) => `Click to test the real ${label} connection`,
            noKey: 'No key yet', enterKeyToTest: 'Enter one, then test the real connection',
            importedFromStudy: 'Imported the French text from Study. Make the audio right away or edit it first.',
            restoredFromHistory: 'Text and audio restored from history.',
        },
        zh: {
            pageTitle: '法语音频工作台',
            heading: '法语音频工作台',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navReview: '今日复习', navListen: '开车听',
            history: '历史记录', historyBtnTitle: '查看并恢复过往历史记录',
            connectionSettings: '连接设置', connectionSummaryTitle: '连接尚未验证',
            notVerified: '未验证', toggleKey: '显示或隐藏 API Key',
            modelLabel: '转换模型',
            modelGeminiOption: 'Gemini 3.8 Flash (AGY) · 极速',
            recommendedSuffix: ' · 推荐', modelSuffixPattern: /\s*·\s*(推荐|备用)$/,
            rememberKey: '记住在此设备',
            notTested: '尚未测试', notTestedDetail: '填写 Key 后测试实际连接',
            testConnection: '测试连接',
            taskModeLegend: '处理方式',
            taskAuto: '智能判断', taskAutoTitle: '自动判断是生成、翻译、自然表达还是润色',
            taskGenerate: '按要求生成', taskGenerateTitle: '把输入当作要求，直接创作所需法语内容',
            taskTranslate: '忠实翻译', taskTranslateTitle: '忠实翻译原文，不扩写内容',
            taskExpress: '自然表达', taskExpressTitle: '整理口述或零散想法，表达成自然法语',
            taskPolish: '润色法语', taskPolishTitle: '修正已有法语，同时保留原意',
            editorAria: '法语文本转换',
            sourceHeading: '输入内容', clearSource: '清空原文',
            sourcePlaceholder: '粘贴中文、英文或已有法语文本...',
            outputHeading: '法语结果', taskPending: '待判断', modelUsedDefault: 'Grok 4.6 · 待生成',
            sendToStudy: '发送到拆解与复述学习', copyOutput: '复制法语文本',
            outputPlaceholder: '转换后的法语会显示在这里，可继续编辑...',
            controlsAria: '转换参数',
            styleLegend: '表达风格', styleSpoken: '口语化', styleNeutral: '标准', styleFormal: '书面化', stylePolished: '写作润色',
            levelLabel: '语言难度', levelA: 'A1-A2 基础', levelB: 'B1-B2 中级', levelC: 'C1-C2 高级',
            localeLabel: '法语地区', localeFR: '法国法语', localeCA: '加拿大法语',
            voiceLabel: '朗读声音',
            voiceDenise: 'Denise · 女声', voiceHenri: 'Henri · 男声', voiceVivienne: 'Vivienne · 女声', voiceRemy: 'Remy · 男声',
            voiceSylvie: 'Sylvie · 女声', voiceJean: 'Jean · 男声', voiceAntoine: 'Antoine · 男声',
            actionAria: '生成操作',
            speechBtn: '朗读当前法语', transformBtn: '智能生成法语', transformSpeechBtn: '智能生成并制作音频',
            audioHeading: '音频与字幕',
            historyTotalZero: '共 0 条', clearHistoryTitle: '清空当前分类历史', clearHistory: '清空历史',
            closeModal: '关闭 (Esc)', histTabAll: '全部', histTabTts: '🎧 音频制作', histTabStudy: '📖 拆解精析',
            historyEmptyTitle: '暂无历史记录',
            historyEmptyDesc: '您每次生成的音频与拆解精析结果都会自动保存在这里，随时可以一键试听或恢复。',
            modeAutoHeading: '输入内容', modeAutoPlaceholder: '输入需求、待翻译文本、口述想法或已有法语...',
            modeAutoAction: '智能生成法语', modeAutoSpeechAction: '智能生成并制作音频',
            modeAutoWorking: '正在判断处理方式并生成法语...',
            modeGenerateHeading: '创作要求', modeGeneratePlaceholder: '描述主题、长度、场景、人物或希望生成的内容...',
            modeGenerateAction: '生成法语', modeGenerateSpeechAction: '生成法语并制作音频',
            modeGenerateWorking: '正在按要求生成法语...',
            modeTranslateHeading: '待翻译文本', modeTranslatePlaceholder: '粘贴需要忠实翻译成法语的文本...',
            modeTranslateAction: '翻译成法语', modeTranslateSpeechAction: '翻译并制作音频',
            modeTranslateWorking: '正在忠实翻译成法语...',
            modeExpressHeading: '想表达的内容', modeExpressPlaceholder: '写下口述、零散想法或中英混合内容...',
            modeExpressAction: '表达成法语', modeExpressSpeechAction: '表达成法语并制作音频',
            modeExpressWorking: '正在整理意思并表达成自然法语...',
            modePolishHeading: '法语原文', modePolishPlaceholder: '粘贴需要修改或润色的法语文本...',
            modePolishAction: '润色法语', modePolishSpeechAction: '润色并制作音频',
            modePolishWorking: '正在润色法语...',
            summaryIdle: '待验证', summaryTesting: '测试中', summaryConnected: '已连接', summaryError: '失败',
            titleDetail: (title, detail) => `${title}：${detail}`,
            qualityPending: '待生成', qualityPassed: '纯法语通过', qualityProofread: '已校对', qualityFailed: '检查失败',
            proofreadTitle: (label, proofreader) => `${label} 生成，${proofreader} 对照原文校对完成`,
            taskFailed: (label) => `${label} · 失败`, taskFailedTitle: (label) => `${label}处理失败`,
            autoResolved: (label) => `智能 → ${label}`, autoResolvedTitle: (label) => `智能判断结果：${label}`,
            taskModeTitle: (label) => `处理方式：${label}`, autoPendingTitle: '生成后显示智能判断结果',
            translateNoStyle: '忠实翻译保持原意，不应用表达风格改写',
            translateNoLevel: '忠实翻译保持原意，不调整语言难度',
            needApiKey: '请先在连接设置中填写 web2api API Key。',
            withCode: (message, code) => `${message}（${code}）`,
            modelFailed: '模型暂时失败或输出没有通过质量检查，请重试。',
            requestFailed: (status) => `请求失败（HTTP ${status}）`,
            testingTitle: (label) => `正在测试 ${label}`, testingDetail: '正在验证 Key、模型权限和纯法语输出',
            testingStatus: (label) => `正在测试 ${label} 连接...`,
            connectedTitle: (label) => `${label} 已连接`, testSample: (sample) => `测试译文：${sample}`,
            reviewerPassed: (label) => `，${label} 校对通过`,
            connectedStatus: (label, reviewer) => `${label} 连接成功${reviewer}。`,
            testFailedTitle: (label) => `${label} 测试失败`, connectionFailed: '连接失败',
            needFrenchText: '请先生成或填写法语文本。',
            generatingAudio: '正在生成法语音频...',
            loginForAudio: '生成整段音频需要先登录（在「拆解与复述」页右上角登录）。',
            audioReady: '音频和字幕已生成。',
            needSourceText: '请输入需要转换的对话。',
            workingThenAudio: (working) => `${working.replace(/\.\.\.$/, '')}，随后制作音频...`,
            detailProofread: '已完成法语校对', detailPassed: '已通过纯法语检查',
            lastRun: (label, detail, proofreader) => `最近一次“${label}”${detail}${proofreader ? `（${proofreader}）` : ''}`,
            autoDone: (label) => `智能判断为“${label}”，法语文本已生成并完成校对。`,
            modeDone: (label, detail) => `已按“${label}”处理，${detail}。`,
            requestFailedTitle: (label) => `${label} 请求失败`,
            actionFailed: '操作失败，请稍后重试。',
            keyChanged: 'Key 已修改', retestConnection: '请重新测试连接',
            modelUnverified: (label) => `${label} 待验证`, modelSwitched: '模型已切换，请测试连接',
            needStudyText: '请先生成或输入需要拆解复述的法语文本。',
            nothingToCopy: '当前没有可复制的法语文本。', copied: '法语文本已复制。',
            keySaved: 'Key 已保存', clickToTest: (label) => `点击测试 ${label} 实际连接`,
            noKey: '尚未填写 Key', enterKeyToTest: '填写后测试实际连接',
            importedFromStudy: '已从拆解学习台导入法语文本，可直接点击“制作音频”或进行调整。',
            restoredFromHistory: '已从历史记录恢复文本与音频。',
        },
    };
    const T = TEXT[FrenchI18n.lang() === 'en' ? 'en' : 'zh'];

    // Fill the static labels first; the task-mode and connection code below then overwrites the dynamic ones.
    FrenchI18n.apply(TEXT);
    document.querySelectorAll('[data-i18n-label]').forEach((group) => {
        group.label = T[group.getAttribute('data-i18n-label')] || group.label;
    });
    FrenchI18n.mountToggle(document.getElementById('lang-toggle'));

    const localKeyName = 'frenchStudio.perplexityApiKey';
    const sessionKeyName = 'frenchStudio.sessionApiKey';
    const modelKeyName = 'frenchStudio.perplexityModel';
    const taskModeKeyName = 'frenchStudio.taskMode';
    const busyButtons = [transformButton, transformSpeechButton, speechButton];
    const taskModes = {
        auto: {
            label: T.taskAuto,
            heading: T.modeAutoHeading,
            placeholder: T.modeAutoPlaceholder,
            action: T.modeAutoAction,
            speechAction: T.modeAutoSpeechAction,
            working: T.modeAutoWorking,
        },
        generate: {
            label: T.taskGenerate,
            heading: T.modeGenerateHeading,
            placeholder: T.modeGeneratePlaceholder,
            action: T.modeGenerateAction,
            speechAction: T.modeGenerateSpeechAction,
            working: T.modeGenerateWorking,
        },
        translate: {
            label: T.taskTranslate,
            heading: T.modeTranslateHeading,
            placeholder: T.modeTranslatePlaceholder,
            action: T.modeTranslateAction,
            speechAction: T.modeTranslateSpeechAction,
            working: T.modeTranslateWorking,
        },
        express: {
            label: T.taskExpress,
            heading: T.modeExpressHeading,
            placeholder: T.modeExpressPlaceholder,
            action: T.modeExpressAction,
            speechAction: T.modeExpressSpeechAction,
            working: T.modeExpressWorking,
        },
        polish: {
            label: T.taskPolish,
            heading: T.modePolishHeading,
            placeholder: T.modePolishPlaceholder,
            action: T.modePolishAction,
            speechAction: T.modePolishSpeechAction,
            working: T.modePolishWorking,
        },
    };

    const savedLocalKey = localStorage.getItem(localKeyName);
    const savedSessionKey = sessionStorage.getItem(sessionKeyName);
    if (savedLocalKey) {
        apiKeyInput.value = savedLocalKey;
        rememberKey.checked = true;
    } else if (savedSessionKey) {
        apiKeyInput.value = savedSessionKey;
    }
    const savedModel = localStorage.getItem(modelKeyName);
    if (savedModel && Array.from(modelSelect.options).some((option) => option.value === savedModel)) {
        modelSelect.value = savedModel;
    }

    async function syncModelsFromBackend() {
        if (!modelSelect) return;
        try {
            const resp = await fetch('/api/models');
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && Array.isArray(data.models) && data.models.length > 0) {
                modelSelect.innerHTML = '';
                data.models.forEach((m) => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.label + (m.recommended ? T.recommendedSuffix : '');
                    modelSelect.appendChild(opt);
                });
                const saved = localStorage.getItem(modelKeyName);
                if (saved && Array.from(modelSelect.options).some((opt) => opt.value === saved)) {
                    modelSelect.value = saved;
                } else if (data.default && Array.from(modelSelect.options).some((opt) => opt.value === data.default)) {
                    modelSelect.value = data.default;
                } else if (modelSelect.options.length > 0) {
                    modelSelect.selectedIndex = 0;
                }
            }
        } catch (err) {
            console.warn('Failed to sync models from backend', err);
        }
    }
    syncModelsFromBackend();
    const savedTaskMode = localStorage.getItem(taskModeKeyName);
    if (savedTaskMode && taskModes[savedTaskMode]) {
        const savedTaskInput = document.querySelector(`input[name="task-mode"][value="${savedTaskMode}"]`);
        if (savedTaskInput) {
            savedTaskInput.checked = true;
        }
    }

    if (window.lucide) {
        window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
    }

    function updateCount(textarea, target) {
        target.textContent = `${textarea.value.length} / 15000`;
    }

    function selectedStyle() {
        return document.querySelector('input[name="style"]:checked').value;
    }

    function selectedTaskMode() {
        return document.querySelector('input[name="task-mode"]:checked').value;
    }

    function modelLabel(modelId = modelSelect.value) {
        const option = Array.from(modelSelect.options).find((item) => item.value === modelId);
        return option ? option.textContent.replace(T.modelSuffixPattern, '') : modelId;
    }

    function setConnectionState(state, title, detail) {
        const summaryLabels = {
            idle: T.summaryIdle,
            testing: T.summaryTesting,
            connected: T.summaryConnected,
            error: T.summaryError,
        };
        connectionSummaryState.dataset.state = state;
        connectionSummaryText.textContent = summaryLabels[state] || T.notVerified;
        connectionSummaryState.title = T.titleDetail(title, detail);
        connectionResult.dataset.state = state;
        connectionResultTitle.textContent = title;
        connectionResultDetail.textContent = detail;
    }

    function setModelQuality(state, label = modelLabel(), proofreadLabel = '') {
        modelUsed.dataset.quality = state;
        const suffix = {
            pending: T.qualityPending,
            passed: T.qualityPassed,
            proofread: T.qualityProofread,
            failed: T.qualityFailed,
        }[state] || T.qualityPending;
        const shortProofreader = proofreadLabel.replace(/^Claude\s+/i, '');
        const modelPath = state === 'proofread' && shortProofreader
            ? `${label} → ${shortProofreader}`
            : label;
        modelUsed.textContent = `${modelPath} · ${suffix}`;
        modelUsed.title = state === 'proofread' && proofreadLabel
            ? T.proofreadTitle(label, proofreadLabel)
            : modelUsed.textContent;
    }

    function setTaskResult(state = 'pending', resolvedMode = null, requestedMode = selectedTaskMode()) {
        const requested = taskModes[requestedMode] || taskModes.auto;
        const resolved = resolvedMode ? taskModes[resolvedMode] : null;
        taskUsed.dataset.state = state;
        if (state === 'failed') {
            taskUsed.textContent = T.taskFailed(requested.label);
            taskUsed.title = T.taskFailedTitle(requested.label);
            return;
        }
        if (resolved) {
            taskUsed.textContent = requestedMode === 'auto'
                ? T.autoResolved(resolved.label)
                : resolved.label;
            taskUsed.title = requestedMode === 'auto'
                ? T.autoResolvedTitle(resolved.label)
                : T.taskModeTitle(resolved.label);
            return;
        }
        taskUsed.textContent = requested.label;
        taskUsed.title = requestedMode === 'auto'
            ? T.autoPendingTitle
            : T.taskModeTitle(requested.label);
    }

    function updateTaskModeUi() {
        const mode = selectedTaskMode();
        const configuration = taskModes[mode];
        const faithfulTranslation = mode === 'translate';
        sourceHeading.textContent = configuration.heading;
        sourceText.placeholder = configuration.placeholder;
        transformButtonLabel.textContent = configuration.action;
        transformSpeechButtonLabel.textContent = configuration.speechAction;
        styleInputs.forEach((input) => {
            input.disabled = faithfulTranslation;
        });
        levelSelect.disabled = faithfulTranslation;
        styleControl.classList.toggle('is-disabled', faithfulTranslation);
        levelControl.classList.toggle('is-disabled', faithfulTranslation);
        styleControl.title = faithfulTranslation
            ? T.translateNoStyle
            : '';
        levelControl.title = faithfulTranslation
            ? T.translateNoLevel
            : '';
        localStorage.setItem(taskModeKeyName, mode);
        setTaskResult('pending', null, mode);
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

    // A logged-in account wins (the server supplies the upstream key); the manual key is for guests
    function requireApiKey() {
        let userToken = '';
        try { userToken = localStorage.getItem('frenchStudio.userToken') || ''; } catch (_) {}
        if (userToken) return userToken;
        const key = apiKeyInput.value.trim();
        if (!key) {
            connectionSettings.open = true;
            apiKeyInput.focus();
            throw new Error(T.needApiKey);
        }
        saveApiKey();
        return key;
    }

    function setBusy(isBusy, activeButton = null) {
        busyButtons.forEach((button) => {
            button.disabled = isBusy;
            button.classList.toggle('is-loading', isBusy && button === activeButton);
        });
    }

    function setStatus(message = '', type = '') {
        statusMessage.textContent = message;
        statusMessage.className = 'status-message';
        if (type) {
            statusMessage.classList.add(`status-${type}`);
        }
    }

    function errorMessage(payload, fallback) {
        const detail = payload && payload.detail;
        let message = fallback;
        let code = '';
        if (detail && typeof detail === 'object' && detail.message) {
            message = detail.message;
            code = detail.code || '';
        } else if (typeof detail === 'string') {
            message = detail;
        } else if (payload && payload.error && typeof payload.error === 'object') {
            message = payload.error.message || fallback;
            code = payload.error.code || '';
        }
        return code ? T.withCode(message, code) : message;
    }

    async function postJson(url, body, headers = {}) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const fallback = response.status === 502
                ? T.modelFailed
                : T.requestFailed(response.status);
            const error = new Error(errorMessage(payload, fallback));
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    async function testConnection() {
        const apiKey = requireApiKey();
        const label = modelLabel();
        testConnectionButton.disabled = true;
        testConnectionButton.classList.add('is-loading');
        setConnectionState('testing', T.testingTitle(label), T.testingDetail);
        setStatus(T.testingStatus(label), 'working');

        try {
            const result = await postJson(
                '/api/connection/test',
                { model: modelSelect.value },
                { Authorization: `Bearer ${apiKey}` },
            );
            const actualLabel = result.label || modelLabel(result.model);
            setConnectionState(
                'connected',
                T.connectedTitle(actualLabel),
                T.testSample(result.sample),
            );
            setModelQuality(
                result.quality_check || 'passed',
                actualLabel,
                result.proofread_label || '',
            );
            const reviewer = result.proofread_label ? T.reviewerPassed(result.proofread_label) : '';
            setStatus(T.connectedStatus(actualLabel, reviewer), 'success');
        } catch (error) {
            setConnectionState('error', T.testFailedTitle(label), error.message || T.connectionFailed);
            setModelQuality('failed', label);
            throw error;
        } finally {
            testConnectionButton.disabled = false;
            testConnectionButton.classList.remove('is-loading');
        }
    }

    async function generateSpeech({ manageBusy = true, activeButton = speechButton } = {}) {
        const text = outputText.value.trim();
        if (!text) {
            throw new Error(T.needFrenchText);
        }

        if (manageBusy) {
            setBusy(true, activeButton);
            setStatus(T.generatingAudio, 'working');
        }

        try {
            const userToken = localStorage.getItem('frenchStudio.userToken');
            if (!userToken) {
                throw new Error(T.loginForAudio);
            }
            const result = await postJson('/api/speech', {
                text,
                voice: voiceSelect.value,
            }, { Authorization: `Bearer ${userToken}` });
            const cacheKey = Date.now();
            audioPlayer.src = `${result.audio_url}?v=${cacheKey}`;
            downloadMp3.href = `${result.audio_url}?download=true`;
            downloadMp3.download = result.audio_filename;
            downloadSrt.href = `${result.srt_url}?download=true`;
            downloadSrt.download = result.srt_filename;
            audioPanel.hidden = false;
            setStatus(T.audioReady, 'success');
            audioPlayer.play().catch(() => {});
            audioPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Record into unified history
            if (window.FrenchHistory) {
                window.FrenchHistory.saveTtsRecord({
                    text,
                    sourceText: sourceText.value,
                    taskMode: selectedTaskMode(),
                    taskLabel: taskModes[selectedTaskMode()] ? taskModes[selectedTaskMode()].label : '',
                    voice: voiceSelect.value,
                    audioUrl: result.audio_url,
                    audioFilename: result.audio_filename,
                    srtUrl: result.srt_url,
                    srtFilename: result.srt_filename,
                    model: modelSelect.value,
                });
            }
            return result;
        } finally {
            if (manageBusy) {
                setBusy(false);
            }
        }
    }

    async function transformToFrench(withSpeech) {
        const text = sourceText.value.trim();
        if (!text) {
            throw new Error(T.needSourceText);
        }
        const apiKey = requireApiKey();
        const requestedTaskMode = selectedTaskMode();
        const taskConfiguration = taskModes[requestedTaskMode];
        const activeButton = withSpeech ? transformSpeechButton : transformButton;
        setBusy(true, activeButton);
        setTaskResult('pending', null, requestedTaskMode);
        setStatus(
            withSpeech ? T.workingThenAudio(taskConfiguration.working) : taskConfiguration.working,
            'working',
        );

        try {
            const result = await postJson(
                '/api/transform',
                {
                    text,
                    style: selectedStyle(),
                    level: levelSelect.value,
                    locale: localeSelect.value,
                    model: modelSelect.value,
                    task_mode: requestedTaskMode,
                },
                { Authorization: `Bearer ${apiKey}` },
            );
            outputText.value = result.text;
            const actualLabel = modelLabel(result.model || modelSelect.value);
            const resolvedTaskMode = result.task_mode || requestedTaskMode;
            const resolvedTaskLabel = (taskModes[resolvedTaskMode] && taskModes[resolvedTaskMode].label)
                || result.task_label
                || resolvedTaskMode;
            const qualityCheck = result.quality_check || 'passed';
            const qualityDetail = qualityCheck === 'proofread'
                ? T.detailProofread
                : T.detailPassed;
            setModelQuality(qualityCheck, actualLabel, result.proofread_label || '');
            setTaskResult('resolved', resolvedTaskMode, requestedTaskMode);
            setConnectionState(
                'connected',
                T.connectedTitle(actualLabel),
                T.lastRun(resolvedTaskLabel, qualityDetail, result.proofread_label),
            );
            updateCount(outputText, outputCount);
            setStatus(
                requestedTaskMode === 'auto'
                    ? T.autoDone(resolvedTaskLabel)
                    : T.modeDone(resolvedTaskLabel, qualityDetail),
                'success',
            );

            if (withSpeech) {
                await generateSpeech({ manageBusy: false, activeButton });
            }
        } catch (error) {
            const label = modelLabel();
            setConnectionState('error', T.requestFailedTitle(label), error.message || T.connectionFailed);
            setModelQuality('failed', label);
            setTaskResult('failed', null, requestedTaskMode);
            throw error;
        } finally {
            setBusy(false);
        }
    }

    async function runAction(action) {
        try {
            setStatus();
            await action();
        } catch (error) {
            setBusy(false);
            setStatus(error.message || T.actionFailed, 'error');
        }
    }

    sourceText.addEventListener('input', () => updateCount(sourceText, sourceCount));
    outputText.addEventListener('input', () => updateCount(outputText, outputCount));
    apiKeyInput.addEventListener('input', () => {
        setConnectionState('idle', T.keyChanged, T.retestConnection);
        setModelQuality('pending');
    });
    apiKeyInput.addEventListener('change', saveApiKey);
    rememberKey.addEventListener('change', saveApiKey);
    modelSelect.addEventListener('change', () => {
        saveApiKey();
        setConnectionState('idle', T.modelUnverified(modelLabel()), T.modelSwitched);
        setModelQuality('pending');
    });
    document.querySelectorAll('input[name="task-mode"]').forEach((input) => {
        input.addEventListener('change', () => {
            updateTaskModeUi();
            setStatus();
        });
    });
    connectionForm.addEventListener('submit', (event) => event.preventDefault());

    toggleKeyButton.addEventListener('click', () => {
        const showKey = apiKeyInput.type === 'password';
        apiKeyInput.type = showKey ? 'text' : 'password';
        toggleKeyButton.innerHTML = `<i data-lucide="${showKey ? 'eye-off' : 'eye'}"></i>`;
        if (window.lucide) {
            window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
        }
        apiKeyInput.focus();
    });

    clearSourceButton.addEventListener('click', () => {
        sourceText.value = '';
        updateCount(sourceText, sourceCount);
        setTaskResult();
        sourceText.focus();
    });

    const sendToStudyButton = document.getElementById('send-to-study-btn');
    if (sendToStudyButton) {
        sendToStudyButton.addEventListener('click', () => {
            const textToStudy = outputText.value.trim() || sourceText.value.trim();
            if (!textToStudy) {
                setStatus(T.needStudyText, 'error');
                return;
            }
            window.location.href = `/study?text=${encodeURIComponent(textToStudy)}`;
        });
    }

    copyOutputButton.addEventListener('click', async () => {
        if (!outputText.value.trim()) {
            setStatus(T.nothingToCopy, 'error');
            return;
        }
        try {
            await navigator.clipboard.writeText(outputText.value);
            setStatus(T.copied, 'success');
        } catch (_) {
            outputText.select();
            document.execCommand('copy');
            setStatus(T.copied, 'success');
        }
    });

    localeSelect.addEventListener('change', () => {
        const isCanadian = localeSelect.value === 'fr-CA';
        const voiceMatches = voiceSelect.value.startsWith(localeSelect.value);
        if (!voiceMatches) {
            voiceSelect.value = isCanadian
                ? 'fr-CA-SylvieNeural'
                : 'fr-FR-DeniseNeural';
        }
    });

    transformButton.addEventListener('click', () => runAction(() => transformToFrench(false)));
    transformSpeechButton.addEventListener('click', () => runAction(() => transformToFrench(true)));
    speechButton.addEventListener('click', () => runAction(() => generateSpeech()));
    testConnectionButton.addEventListener('click', () => runAction(() => testConnection()));

    updateCount(sourceText, sourceCount);
    updateCount(outputText, outputCount);
    updateTaskModeUi();
    setModelQuality('pending');
    if (apiKeyInput.value.trim()) {
        setConnectionState('idle', T.keySaved, T.clickToTest(modelLabel()));
    } else {
        setConnectionState('idle', T.noKey, T.enterKeyToTest);
    }

    // Support query param ?text= passed from study or elsewhere
    const urlParams = new URLSearchParams(window.location.search);
    const queryText = urlParams.get('text');
    if (queryText) {
        outputText.value = queryText;
        updateCount(outputText, outputCount);
        setStatus(T.importedFromStudy, 'success');
    }

    // Initialize Unified History
    if (window.FrenchHistory) {
        window.FrenchHistory.init({
            currentPage: 'workbench',
            onRestoreTts: (item) => {
                if (item.text) {
                    outputText.value = item.text;
                    updateCount(outputText, outputCount);
                }
                if (item.sourceText) {
                    sourceText.value = item.sourceText;
                    updateCount(sourceText, sourceCount);
                }
                if (item.voice && Array.from(voiceSelect.options).some(o => o.value === item.voice)) {
                    voiceSelect.value = item.voice;
                }
                if (item.audioUrl) {
                    audioPlayer.src = item.audioUrl;
                    downloadMp3.href = `${item.audioUrl}?download=true`;
                    downloadMp3.download = item.audioFilename || 'french_audio.mp3';
                    if (item.srtUrl) {
                        downloadSrt.href = `${item.srtUrl}?download=true`;
                        downloadSrt.download = item.srtFilename || 'french_subtitles.srt';
                    }
                    audioPanel.hidden = false;
                    audioPlayer.play().catch(() => {});
                }
                setStatus(T.restoredFromHistory, 'success');
            },
        });
    }
});
