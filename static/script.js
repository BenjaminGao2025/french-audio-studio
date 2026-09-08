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

    const localKeyName = 'frenchStudio.perplexityApiKey';
    const sessionKeyName = 'frenchStudio.sessionApiKey';
    const modelKeyName = 'frenchStudio.perplexityModel';
    const taskModeKeyName = 'frenchStudio.taskMode';
    const busyButtons = [transformButton, transformSpeechButton, speechButton];
    const taskModes = {
        auto: {
            label: '智能判断',
            heading: '输入内容',
            placeholder: '输入需求、待翻译文本、口述想法或已有法语...',
            action: '智能生成法语',
            speechAction: '智能生成并制作音频',
            working: '正在判断处理方式并生成法语...',
        },
        generate: {
            label: '按要求生成',
            heading: '创作要求',
            placeholder: '描述主题、长度、场景、人物或希望生成的内容...',
            action: '生成法语',
            speechAction: '生成法语并制作音频',
            working: '正在按要求生成法语...',
        },
        translate: {
            label: '忠实翻译',
            heading: '待翻译文本',
            placeholder: '粘贴需要忠实翻译成法语的文本...',
            action: '翻译成法语',
            speechAction: '翻译并制作音频',
            working: '正在忠实翻译成法语...',
        },
        express: {
            label: '自然表达',
            heading: '想表达的内容',
            placeholder: '写下口述、零散想法或中英混合内容...',
            action: '表达成法语',
            speechAction: '表达成法语并制作音频',
            working: '正在整理意思并表达成自然法语...',
        },
        polish: {
            label: '润色法语',
            heading: '法语原文',
            placeholder: '粘贴需要修改或润色的法语文本...',
            action: '润色法语',
            speechAction: '润色并制作音频',
            working: '正在润色法语...',
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
        return option ? option.textContent.replace(/\s*·\s*(推荐|备用)$/, '') : modelId;
    }

    function setConnectionState(state, title, detail) {
        const summaryLabels = {
            idle: '待验证',
            testing: '测试中',
            connected: '已连接',
            error: '失败',
        };
        connectionSummaryState.dataset.state = state;
        connectionSummaryText.textContent = summaryLabels[state] || '未验证';
        connectionSummaryState.title = `${title}：${detail}`;
        connectionResult.dataset.state = state;
        connectionResultTitle.textContent = title;
        connectionResultDetail.textContent = detail;
    }

    function setModelQuality(state, label = modelLabel(), proofreadLabel = '') {
        modelUsed.dataset.quality = state;
        const suffix = {
            pending: '待生成',
            passed: '纯法语通过',
            proofread: '已校对',
            failed: '检查失败',
        }[state] || '待生成';
        const shortProofreader = proofreadLabel.replace(/^Claude\s+/i, '');
        const modelPath = state === 'proofread' && shortProofreader
            ? `${label} → ${shortProofreader}`
            : label;
        modelUsed.textContent = `${modelPath} · ${suffix}`;
        modelUsed.title = state === 'proofread' && proofreadLabel
            ? `${label} 生成，${proofreadLabel} 对照原文校对完成`
            : modelUsed.textContent;
    }

    function setTaskResult(state = 'pending', resolvedMode = null, requestedMode = selectedTaskMode()) {
        const requested = taskModes[requestedMode] || taskModes.auto;
        const resolved = resolvedMode ? taskModes[resolvedMode] : null;
        taskUsed.dataset.state = state;
        if (state === 'failed') {
            taskUsed.textContent = `${requested.label} · 失败`;
            taskUsed.title = `${requested.label}处理失败`;
            return;
        }
        if (resolved) {
            taskUsed.textContent = requestedMode === 'auto'
                ? `智能 → ${resolved.label}`
                : resolved.label;
            taskUsed.title = requestedMode === 'auto'
                ? `智能判断结果：${resolved.label}`
                : `处理方式：${resolved.label}`;
            return;
        }
        taskUsed.textContent = requested.label;
        taskUsed.title = requestedMode === 'auto'
            ? '生成后显示智能判断结果'
            : `处理方式：${requested.label}`;
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
            ? '忠实翻译保持原意，不应用表达风格改写'
            : '';
        levelControl.title = faithfulTranslation
            ? '忠实翻译保持原意，不调整语言难度'
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

    function requireApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            connectionSettings.open = true;
            apiKeyInput.focus();
            throw new Error('请先在连接设置中填写 web2api API Key。');
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
        return code ? `${message}（${code}）` : message;
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
                ? '模型暂时失败或输出没有通过质量检查，请重试。'
                : `请求失败（HTTP ${response.status}）`;
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
        setConnectionState('testing', `正在测试 ${label}`, '正在验证 Key、模型权限和纯法语输出');
        setStatus(`正在测试 ${label} 连接...`, 'working');

        try {
            const result = await postJson(
                '/api/connection/test',
                { model: modelSelect.value },
                { Authorization: `Bearer ${apiKey}` },
            );
            const actualLabel = result.label || modelLabel(result.model);
            setConnectionState(
                'connected',
                `${actualLabel} 已连接`,
                `测试译文：${result.sample}`,
            );
            setModelQuality(
                result.quality_check || 'passed',
                actualLabel,
                result.proofread_label || '',
            );
            const reviewer = result.proofread_label ? `，${result.proofread_label} 校对通过` : '';
            setStatus(`${actualLabel} 连接成功${reviewer}。`, 'success');
        } catch (error) {
            setConnectionState('error', `${label} 测试失败`, error.message || '连接失败');
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
            throw new Error('请先生成或填写法语文本。');
        }

        if (manageBusy) {
            setBusy(true, activeButton);
            setStatus('正在生成法语音频...', 'working');
        }

        try {
            const result = await postJson('/api/speech', {
                text,
                voice: voiceSelect.value,
            });
            const cacheKey = Date.now();
            audioPlayer.src = `${result.audio_url}?v=${cacheKey}`;
            downloadMp3.href = `${result.audio_url}?download=true`;
            downloadMp3.download = result.audio_filename;
            downloadSrt.href = `${result.srt_url}?download=true`;
            downloadSrt.download = result.srt_filename;
            audioPanel.hidden = false;
            setStatus('音频和字幕已生成。', 'success');
            audioPlayer.play().catch(() => {});
            audioPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            throw new Error('请输入需要转换的对话。');
        }
        const apiKey = requireApiKey();
        const requestedTaskMode = selectedTaskMode();
        const taskConfiguration = taskModes[requestedTaskMode];
        const activeButton = withSpeech ? transformSpeechButton : transformButton;
        setBusy(true, activeButton);
        setTaskResult('pending', null, requestedTaskMode);
        setStatus(
            withSpeech ? `${taskConfiguration.working.replace(/\.\.\.$/, '')}，随后制作音频...` : taskConfiguration.working,
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
            const resolvedTaskLabel = result.task_label
                || (taskModes[resolvedTaskMode] && taskModes[resolvedTaskMode].label)
                || resolvedTaskMode;
            const qualityCheck = result.quality_check || 'passed';
            const qualityDetail = qualityCheck === 'proofread'
                ? '已完成法语校对'
                : '已通过纯法语检查';
            setModelQuality(qualityCheck, actualLabel, result.proofread_label || '');
            setTaskResult('resolved', resolvedTaskMode, requestedTaskMode);
            setConnectionState(
                'connected',
                `${actualLabel} 已连接`,
                `最近一次“${resolvedTaskLabel}”${qualityDetail}${
                    result.proofread_label ? `（${result.proofread_label}）` : ''
                }`,
            );
            updateCount(outputText, outputCount);
            setStatus(
                requestedTaskMode === 'auto'
                    ? `智能判断为“${resolvedTaskLabel}”，法语文本已生成并完成校对。`
                    : `已按“${resolvedTaskLabel}”处理，${qualityDetail}。`,
                'success',
            );

            if (withSpeech) {
                await generateSpeech({ manageBusy: false, activeButton });
            }
        } catch (error) {
            const label = modelLabel();
            setConnectionState('error', `${label} 请求失败`, error.message || '连接失败');
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
            setStatus(error.message || '操作失败，请稍后重试。', 'error');
        }
    }

    sourceText.addEventListener('input', () => updateCount(sourceText, sourceCount));
    outputText.addEventListener('input', () => updateCount(outputText, outputCount));
    apiKeyInput.addEventListener('input', () => {
        setConnectionState('idle', 'Key 已修改', '请重新测试连接');
        setModelQuality('pending');
    });
    apiKeyInput.addEventListener('change', saveApiKey);
    rememberKey.addEventListener('change', saveApiKey);
    modelSelect.addEventListener('change', () => {
        saveApiKey();
        setConnectionState('idle', `${modelLabel()} 待验证`, '模型已切换，请测试连接');
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

    copyOutputButton.addEventListener('click', async () => {
        if (!outputText.value.trim()) {
            setStatus('当前没有可复制的法语文本。', 'error');
            return;
        }
        try {
            await navigator.clipboard.writeText(outputText.value);
            setStatus('法语文本已复制。', 'success');
        } catch (_) {
            outputText.select();
            document.execCommand('copy');
            setStatus('法语文本已复制。', 'success');
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
        setConnectionState('idle', 'Key 已保存', `点击测试 ${modelLabel()} 实际连接`);
    } else {
        setConnectionState('idle', '尚未填写 Key', '填写后测试实际连接');
    }
});
