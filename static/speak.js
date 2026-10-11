/* ==========================================================================
   French Audio Studio - Speaking practice (/speak)
   TCF Canada Expression Orale (EO) with authentic simulation & two-round feedback.
   ========================================================================== */

(function () {
    'use strict';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const I18N = window.FrenchI18n;
    const TOKEN_KEY = 'frenchStudio.userToken';
    const POLL_MS = 3000;

    const TEXT = {
        en: {
            pageTitle: 'Speaking Practice - 1000H French',
            heading: 'Speaking practice',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navWrite: 'Write', navSpeak: 'Speak', navReview: 'Review', navListen: 'Listen',
            loginTitle: 'Please log in first',
            loginDesc: 'Speaking practice requires saving your history and generating personalized feedback. Please log in.',
            loginBtn: 'Log in',
            taskSelectTitle: 'Speaking Task',
            levelBadge: (lvl) => `Fits ${lvl}`,
            btnNextSubject: 'Another subject',
            t1QuestionsTitle: 'Examiner questions (click to listen):',
            t2TargetsTitle: 'Information points to ask about:',
            t3ShortTimer: 'Beginner mode (shorter timer 1.5–2 min)',
            t3StructureTitle: 'Recommended speech structure:',
            readyToRecord: 'Ready to record',
            recordingNow: 'Recording… Tap to stop and transcribe',
            transcribingAudio: 'Transcribing speech to French…',
            startRecording: 'Tap to start recording',
            stopRecording: 'Stop & transcribe',
            transcriptLabel: 'French speech recognition transcript',
            asrNotice: 'Machine-generated transcript via speech recognition. Obvious recognizer artifacts are not counted against you.',
            transcriptPlaceholder: 'After recording, speech recognition will generate French transcript here. You can also adjust it…',
            btnSubmitR1: 'Submit Round 1 feedback',
            btnSubmitR2: 'Say it again & check (Round 2)',
            r1Title: 'Round 1: Checklist & Spoken error hints',
            r1Badge: 'Round 1',
            statPace: 'Speaking pace & fluency',
            praiseTitle: 'One thing done well',
            checklistTitle: 'Speaking task checklist',
            errorsTitle: 'Key speech hints (check transcript or say it again)',
            hintNote: 'Round 1 only points out the error and rule hint without giving answers. Correct yourself in Round 2.',
            r2Title: 'Round 2: Revision check & Spoken structures',
            r2Badge: 'Round 2',
            fixedTitle: 'Speech corrections verified',
            correctedTitle: 'Sentence corrections (save to cards to review)',
            structuresTitle: 'Reusable spoken structures (learn patterns, not scripts)',
            saveCard: 'Save card',
            savedCard: 'Card saved',
            pastTitle: 'Past speaking attempts',
            noPast: 'No past speaking attempts yet.',
            generatingR1: 'Generating Round 1 speaking feedback… (analyzing grammar & fluency)',
            generatingR2: 'Verifying revision & generating spoken structures…',
            micAccessError: 'Could not access microphone: ',
            transcribeFailed: 'Transcription failed: ',
            submitFailed: 'Failed to submit: ',
            cardSaveFailed: 'Failed to save card: ',
        },
        zh: {
            pageTitle: '口语练习 - 1000H French',
            heading: '口语练习',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navWrite: '写作', navSpeak: '口语', navReview: '今日复习', navListen: '开车听',
            loginTitle: '请先登录',
            loginDesc: '口语练习需要保存记录和提供个性化反馈，请先登录账号。',
            loginBtn: '去登录',
            taskSelectTitle: '选择口语任务',
            levelBadge: (lvl) => `适合 ${lvl}`,
            btnNextSubject: '换一题',
            t1QuestionsTitle: '考官提问清单（点击可听发音）：',
            t2TargetsTitle: '需由你主动提问获取的信息点：',
            t3ShortTimer: '基础模式 (短计时 1.5–2 min)',
            t3StructureTitle: '发言框架推荐：',
            readyToRecord: '准备录音',
            recordingNow: '正在录音… 点击停止并识别',
            transcribingAudio: '正在将语音识别为法语文字…',
            startRecording: '按此开始录音',
            stopRecording: '停止并识别',
            transcriptLabel: '法语语音识别文稿',
            asrNotice: '由语音识别自动生成；明显转写误差不计为语法错误。',
            transcriptPlaceholder: '录音后此处将自动生成法语文字转写，您也可以微调……',
            btnSubmitR1: '提交第一轮口语批改 (Round 1)',
            btnSubmitR2: '再讲一遍并核对 (Round 2)',
            r1Title: '第一轮：自查清单与发音线索',
            r1Badge: 'Round 1',
            statPace: '语速与流利度',
            praiseTitle: '做得好的一点',
            checklistTitle: '口语任务清单 (Checklist)',
            errorsTitle: '表达重点提示（请在上方文稿核对或点击“再讲一遍”）',
            hintNote: '第一轮只指出错误位置和语法线索，不直接给答案。请根据提示自行纠正。',
            r2Title: '第二轮：纠错核对与可复用口语句式',
            r2Badge: 'Round 2',
            fixedTitle: '纠正核对',
            correctedTitle: '逐句最小修正（可加入生词卡跟读复习）',
            structuresTitle: '高频口语句式（学结构，不背范文）',
            saveCard: '加入卡片',
            savedCard: '已存入卡片',
            pastTitle: '历史口语练习',
            noPast: '暂无历史口语练习记录。',
            generatingR1: '正在生成第一轮口语自查与提示…（通常 30–50 秒）',
            generatingR2: '正在核对修改并生成精选口语句式…',
            micAccessError: '无法使用麦克风：',
            transcribeFailed: '语音识别失败：',
            submitFailed: '提交失败：',
            cardSaveFailed: '加入卡片失败：',
        },
    };

    const T = TEXT[I18N.lang() === 'en' ? 'en' : 'zh'];
    const $ = (id) => document.getElementById(id);
    const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };

    async function api(method, path, body) {
        const token = getToken();
        const res = await fetch(path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: token ? `Bearer ${token}` : '',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            saveDraft();
            location.href = `/study?login=1&next=${encodeURIComponent(location.pathname)}`;
            const error = new Error(data.detail?.message || '请先登录账号。');
            error.status = 401;
            throw error;
        }
        if (!res.ok) {
            const msg = typeof data.detail === 'string' ? data.detail : (data.detail?.message || `HTTP ${res.status}`);
            const error = new Error(msg);
            error.status = res.status;
            throw error;
        }
        return data;
    }

    // Draft survives a re-login or reload (localStorage, this device only)
    const DRAFT_KEY = 'frenchStudio.draft.speak';
    function saveDraft() {
        try {
            const value = $('transcript-input')?.value || '';
            if (value.trim()) localStorage.setItem(DRAFT_KEY, value);
        } catch (_) {}
    }
    function restoreDraft() {
        try {
            const input = $('transcript-input');
            const value = localStorage.getItem(DRAFT_KEY) || '';
            if (input && value && !input.value.trim()) {
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch (_) {}
    }

    // Failed / timed-out feedback: a clear message plus a retry button (no alert, no raw errors)
    function showFeedbackError(message, retry) {
        $('feedback-loading').hidden = true;
        let box = $('feedback-error');
        if (!box) {
            box = document.createElement('div');
            box.id = 'feedback-error';
            box.className = 'status-message status-error';
            box.setAttribute('role', 'alert');
            $('feedback-loading').insertAdjacentElement('afterend', box);
        }
        box.replaceChildren();
        const text = document.createElement('span');
        text.textContent = message + ' ';
        box.appendChild(text);
        if (retry) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary btn-sm';
            button.textContent = '重试';
            button.addEventListener('click', () => { hideFeedbackError(); retry(); });
            box.appendChild(button);
        }
        box.hidden = false;
    }
    function hideFeedbackError() {
        const box = $('feedback-error');
        if (box) box.hidden = true;
    }

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    // State
    let tasksData = null;
    let currentTask = 'T1';
    let currentSubjectIndex = 0;
    let currentSubject = null;
    let currentAttempt = null;
    let pollTimer = null;

    // Timer
    let timerInterval = null;
    let timerSecondsLeft = 120;
    let timerRunning = false;
    let elapsedSeconds = 0;
    let elapsedTimer = null;

    // Audio recording
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordedAudioBlob = null;
    let recordedAudioDuration = 0.0;
    let recordStartTime = 0;

    // T2 Dialogue state
    let dialogueHistory = [];

    function calcWords(text) {
        const cleaned = (text || '').replace(/['’]/g, ' ');
        const tokens = cleaned.match(/[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*/g);
        return tokens ? tokens.length : 0;
    }

    function calcWpm(words, sec) {
        if (!sec || sec <= 0) return 0;
        return Math.round((words / (sec / 60)) * 10) / 10;
    }

    function updateStatsBadge() {
        const text = $('transcript-input').value;
        const words = calcWords(text);
        const wpm = calcWpm(words, recordedAudioDuration || elapsedSeconds);
        const badge = $('speak-stats-badge');
        if (words > 0) {
            badge.textContent = `${words} mots · ~${wpm} WPM · ${Math.round(recordedAudioDuration || elapsedSeconds)}s`;
        } else {
            badge.textContent = '';
        }
    }

    // Timer
    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function resetTimer() {
        pauseTimer();
        let def = 120;
        if (currentTask === 'T1') def = 120;
        else if (currentTask === 'T2') def = 210;
        else if (currentTask === 'T3') {
            def = $('t3-short-timer')?.checked ? 120 : 270;
        }
        timerSecondsLeft = def;
        $('timer-display').textContent = formatTime(timerSecondsLeft);
        $('btn-timer-toggle').classList.remove('is-running', 'is-warning');
    }

    function toggleTimer() {
        if (timerRunning) pauseTimer();
        else startTimer();
    }

    function startTimer() {
        timerRunning = true;
        $('btn-timer-toggle').classList.add('is-running');
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (timerSecondsLeft > 0) {
                timerSecondsLeft--;
                $('timer-display').textContent = formatTime(timerSecondsLeft);
                if (timerSecondsLeft <= 30) {
                    $('btn-timer-toggle').classList.add('is-warning');
                }
            } else {
                pauseTimer();
            }
        }, 1000);
    }

    function pauseTimer() {
        timerRunning = false;
        $('btn-timer-toggle').classList.remove('is-running');
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function startElapsedTracker() {
        if (elapsedTimer) clearInterval(elapsedTimer);
        elapsedTimer = setInterval(() => { elapsedSeconds++; }, 1000);
    }

    // Play TTS
    function playTTS(text, voice = 'fr-CA-JeanNeural') {
        const audio = new Audio(`/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`);
        audio.play().catch(e => console.warn('TTS playback error:', e));
    }

    // Subject Rendering
    function renderSubject() {
        const subjects = tasksData?.subjects?.[currentTask] || [];
        if (!subjects.length) return;
        currentSubject = subjects[currentSubjectIndex % subjects.length];

        $('subject-title').textContent = currentSubject.title || '';
        $('subject-prompt').textContent = currentSubject.prompt || '';

        const t1Box = $('t1-questions-box');
        const t2Box = $('t2-info-box');
        const t3Box = $('t3-structure-box');
        const t2Dialogue = $('t2-dialogue-area');

        t1Box.hidden = true;
        t2Box.hidden = true;
        t3Box.hidden = true;
        t2Dialogue.hidden = true;

        if (currentTask === 'T1') {
            t1Box.hidden = false;
            const qList = $('t1-questions-list');
            qList.innerHTML = '';
            (currentSubject.questions || []).forEach(q => {
                const pill = document.createElement('div');
                pill.className = 'question-pill';
                pill.innerHTML = `
                    <span>${esc(q)}</span>
                    <button class="btn-tts" type="button" title="Écouter la question"><i data-lucide="volume-2"></i></button>
                `;
                pill.querySelector('.btn-tts').addEventListener('click', () => playTTS(q));
                qList.appendChild(pill);
            });
        } else if (currentTask === 'T2') {
            t2Box.hidden = false;
            t2Dialogue.hidden = false;
            $('t2-role-text').textContent = currentSubject.role_examiner || '';
            const tgList = $('t2-targets-list');
            tgList.innerHTML = '';
            (currentSubject.target_points || []).forEach(pt => {
                const li = document.createElement('li');
                li.textContent = pt;
                tgList.appendChild(li);
            });
            dialogueHistory = [];
            $('dialogue-turns').innerHTML = '';
        } else if (currentTask === 'T3') {
            t3Box.hidden = false;
            const guide = $('t3-structure-guide');
            guide.innerHTML = '';
            const steps = [
                { title: '1. Introduction', desc: 'Présenter le sujet et donner votre position nette.' },
                { title: '2. Argument 1', desc: 'Premier argument solide avec explication.' },
                { title: '3. Argument 2', desc: 'Deuxième argument ou nuance importante.' },
                { title: '4. Exemple concret', desc: 'Illustrer par un exemple de votre expérience.' },
                { title: '5. Conclusion', desc: 'Résumer et ouvrir la réflexion.' },
            ];
            steps.forEach(s => {
                const div = document.createElement('div');
                div.className = 'guide-step';
                div.innerHTML = `<strong>${esc(s.title)}</strong><span>${esc(s.desc)}</span>`;
                guide.appendChild(div);
            });
        }

        resetTimer();
        updateStatsBadge();
        refreshIcons();
    }

    function selectTask(task) {
        currentTask = task;
        currentSubjectIndex = 0;
        currentAttempt = null;
        $('transcript-input').value = '';
        $('recording-audio-preview').hidden = true;
        $('feedback-panel').hidden = true;
        $('r1-container').hidden = true;
        $('r2-container').hidden = true;
        $('btn-submit-r1').hidden = false;
        $('btn-submit-r2').hidden = true;
        renderSubject();
    }

    // Audio recording & Transcribe
    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                recordedAudioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                recordedAudioDuration = Math.round(((Date.now() - recordStartTime) / 1000) * 10) / 10;

                const url = URL.createObjectURL(recordedAudioBlob);
                const audioEl = $('learner-audio');
                audioEl.src = url;
                $('recording-audio-preview').hidden = false;

                await handleTranscription(recordedAudioBlob);
            };

            recordStartTime = Date.now();
            mediaRecorder.start();
            isRecording = true;
            $('recording-status-dot').classList.add('is-recording');
            $('recording-status-text').textContent = T.recordingNow;
            $('btn-record').classList.add('is-recording');
            $('record-btn-label').textContent = T.stopRecording;
            startTimer();
        } catch (err) {
            alert(T.micAccessError + err.message);
        }
    }

    function stopRecording() {
        if (!mediaRecorder || !isRecording) return;
        isRecording = false;
        mediaRecorder.stop();
        $('recording-status-dot').classList.remove('is-recording');
        $('recording-status-text').textContent = T.transcribingAudio;
        $('btn-record').classList.remove('is-recording');
        $('record-btn-label').textContent = T.startRecording;
    }

    async function handleTranscription(blob) {
        try {
            const token = getToken();
            const res = await fetch('/api/transcribe?language=fr', {
                method: 'POST',
                headers: {
                    'Content-Type': blob.type || 'audio/webm',
                    Authorization: `Bearer ${token}`,
                },
                body: blob,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail?.message || `HTTP ${res.status}`);

            const text = (data.text || '').trim();
            const current = $('transcript-input').value.trim();

            if (currentTask === 'T2') {
                // In T2 role-play: append turn to dialogue and get examiner reply
                if (text) {
                    appendDialogueTurn('candidate', text);
                    $('transcript-input').value = current ? `${current}\n${text}` : text;
                    await triggerExaminerReply(text);
                }
            } else {
                $('transcript-input').value = current ? `${current} ${text}` : text;
            }

            $('recording-status-text').textContent = T.readyToRecord;
            updateStatsBadge();
        } catch (err) {
            $('recording-status-text').textContent = T.readyToRecord;
            alert(T.transcribeFailed + err.message);
        }
    }

    function appendDialogueTurn(role, text) {
        dialogueHistory.push({ role: role === 'candidate' ? 'user' : 'assistant', content: text });
        const turnsDiv = $('dialogue-turns');
        const bubble = document.createElement('div');
        bubble.className = `turn-bubble turn-${role}`;
        if (role === 'examiner') {
            bubble.innerHTML = `
                <span><strong>Examinateur :</strong> ${esc(text)}</span>
                <button class="btn-tts" type="button" title="Écouter"><i data-lucide="volume-2"></i></button>
            `;
            bubble.querySelector('.btn-tts').addEventListener('click', () => playTTS(text));
        } else {
            bubble.innerHTML = `<span><strong>Vous :</strong> ${esc(text)}</span>`;
        }
        turnsDiv.appendChild(bubble);
        turnsDiv.scrollTop = turnsDiv.scrollHeight;
        refreshIcons();
    }

    async function triggerExaminerReply(userTurn) {
        try {
            const data = await api('POST', '/api/speak/roleplay/reply', {
                scenario: currentSubject,
                history: dialogueHistory,
                user_utterance: userTurn,
            });
            const reply = (data.reply || '').trim();
            if (reply) {
                appendDialogueTurn('examiner', reply);
                playTTS(reply);
            }
        } catch (err) {
            console.warn('Examiner reply failed:', err);
        }
    }

    // Feedback Rendering
    function renderRound1Feedback(fb) {
        $('feedback-panel').hidden = false;
        $('feedback-loading').hidden = true;
        $('r1-container').hidden = false;
        $('r2-container').hidden = true;

        // Stats & Praise
        $('r1-pace-text').textContent = fb.stats?.pace_note || `${fb.stats?.wpm || 0} WPM`;
        $('r1-praise-text').textContent = fb.praise || 'Bonne prise de parole !';

        // Checklist
        const checkUl = $('r1-checklist');
        checkUl.innerHTML = '';

        // T2 or T3 specific checks
        if (currentTask === 'T2' && fb.t2_questions) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(fb.t2_questions.forms_ok ? 'is-done' : 'is-todo')}">${esc(fb.t2_questions.forms_ok ? '✓' : '⚠')}</span><span><strong>Questions posées (${esc(fb.t2_questions.count)})</strong> : ${esc(fb.t2_questions.note)}</span>`;
            checkUl.appendChild(li);
        }
        if (currentTask === 'T3' && fb.t3_structure) {
            const s = fb.t3_structure;
            const ok = s.opinion && s.arguments && s.conclusion;
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(ok ? 'is-done' : 'is-todo')}">${esc(ok ? '✓' : '⚠')}</span><span><strong>Structure du monologue</strong> : ${esc(s.note || 'Opinion, arguments, conclusion')}</span>`;
            checkUl.appendChild(li);
        }

        (fb.checklist || []).forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(item.covered ? 'is-done' : 'is-todo')}">${esc(item.covered ? '✓' : '⚠')}</span><span><strong>${esc(item.point)}</strong>: ${esc(item.note)}</span>`;
            checkUl.appendChild(li);
        });

        // Errors & hints
        const errorsDiv = $('r1-errors');
        errorsDiv.innerHTML = '';
        const errors = fb.errors || [];
        if (!errors.length) {
            errorsDiv.innerHTML = '<p class="muted">Aucune faute majeure relevée ! Élocution très claire.</p>';
        } else {
            errors.forEach(err => {
                const card = document.createElement('div');
                card.className = 'error-card';
                card.innerHTML = `
                    <div class="error-card-header">
                        <span class="badge">${esc(err.type)}</span>
                        <span class="error-span">${esc(err.span)}</span>
                    </div>
                    <p class="error-hint">💡 ${esc(err.hint)}</p>
                `;
                errorsDiv.appendChild(card);
            });
        }

        // Prepare for Round 2
        $('btn-submit-r1').hidden = true;
        $('btn-submit-r2').hidden = false;
        $('btn-submit-r2').disabled = false;
        refreshIcons();
    }

    function renderRound2Feedback(fb) {
        $('feedback-panel').hidden = false;
        $('feedback-loading').hidden = true;
        $('r2-container').hidden = false;

        // Fixed checklist
        const fixedUl = $('r2-fixed-list');
        fixedUl.innerHTML = '';
        (fb.fixed_errors || []).forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(item.fixed ? 'is-done' : 'is-todo')}">${esc(item.fixed ? '✓' : '⚠')}</span><span><strong>"${esc(item.span)}"</strong>: ${esc(item.comment)}</span>`;
            fixedUl.appendChild(li);
        });

        // Sentences with Save Card button
        const sentencesDiv = $('r2-sentences');
        sentencesDiv.innerHTML = '';
        (fb.sentences || []).forEach(s => {
            const card = document.createElement('div');
            card.className = 'sentence-correction-card';
            card.innerHTML = `
                ${s.original !== s.corrected ? `<div class="sc-original">${esc(s.original)}</div>` : ''}
                <div class="sc-corrected">${esc(s.corrected)}</div>
                <div class="sc-explanation">${esc(s.explanation)}</div>
                <div class="sc-actions">
                    <button class="btn btn-secondary btn-sm btn-save-card" type="button" data-chunk="${esc(encodeURIComponent(s.chunk || s.corrected))}" data-sentence="${esc(encodeURIComponent(s.corrected))}" data-explanation="${esc(encodeURIComponent(s.explanation))}">
                        <i data-lucide="bookmark-plus"></i>
                        <span>${T.saveCard}</span>
                    </button>
                </div>
            `;
            sentencesDiv.appendChild(card);
        });

        // Structures
        const structDiv = $('r2-structures');
        structDiv.innerHTML = '';
        (fb.structures || []).forEach(st => {
            const item = document.createElement('div');
            item.className = 'structure-item';
            item.innerHTML = `
                <div class="structure-fr">${esc(st.french)}</div>
                <div class="structure-en">${esc(st.english)}</div>
                <div class="structure-usage">${esc(st.usage)}</div>
            `;
            structDiv.appendChild(item);
        });

        // Play callout
        if (window.FrenchGame?.callout) {
            window.FrenchGame.callout('Wave cleared');
        } else if (window.FrenchGame?.announce) {
            window.FrenchGame.announce('Wave cleared');
        }

        refreshIcons();
    }

    // Polling attempt
    const MAX_POLLS = 100; // ~5 minutes at POLL_MS
    function pollAttempt(attemptId, isRound2 = false) {
        if (pollTimer) clearInterval(pollTimer);
        hideFeedbackError();
        let polls = 0;
        pollTimer = setInterval(async () => {
            polls += 1;
            if (polls > MAX_POLLS) {
                clearInterval(pollTimer);
                pollTimer = null;
                $(isRound2 ? 'btn-submit-r2' : 'btn-submit-r1').disabled = false;
                // The job may still finish: retry resumes checking the same attempt (no duplicate submit)
                showFeedbackError('批改时间比平时长，可能已中断。', () => {
                    $('feedback-loading').hidden = false;
                    pollAttempt(attemptId, isRound2);
                });
                return;
            }
            try {
                const att = await api('GET', `/api/speak/attempts/${attemptId}`);
                currentAttempt = att;
                if (isRound2) {
                    if (att.status === 'ready' && att.feedback_2 && Object.keys(att.feedback_2).length > 0) {
                        clearInterval(pollTimer);
                        pollTimer = null;
                        renderRound2Feedback(att.feedback_2);
                        loadPastAttempts();
                    } else if (att.status === 'failed') {
                        clearInterval(pollTimer);
                        pollTimer = null;
                        $('btn-submit-r2').disabled = false;
                        showFeedbackError(att.error || 'AI 批改暂时失败。', submitRound2);
                    }
                } else {
                    if (att.status === 'ready' && att.feedback_1 && Object.keys(att.feedback_1).length > 0) {
                        clearInterval(pollTimer);
                        pollTimer = null;
                        renderRound1Feedback(att.feedback_1);
                        loadPastAttempts();
                    } else if (att.status === 'failed') {
                        clearInterval(pollTimer);
                        pollTimer = null;
                        $('btn-submit-r1').disabled = false;
                        showFeedbackError(att.error || 'AI 批改暂时失败。', submitRound1);
                    }
                }
            } catch (err) {
                console.warn('Poll error:', err);
                if (err.status === 401 || err.status === 404) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                    $(isRound2 ? 'btn-submit-r2' : 'btn-submit-r1').disabled = false;
                    if (err.status === 404) showFeedbackError(err.message, null);
                }
            }
        }, POLL_MS);
    }

    // Submit actions
    async function submitRound1() {
        const transcript = $('transcript-input').value.trim();
        if (!transcript) {
            alert('Veuillez enregistrer ou saisir votre prise de parole.');
            return;
        }
        $('btn-submit-r1').disabled = true;
        $('feedback-panel').hidden = false;
        $('feedback-loading').hidden = false;
        hideFeedbackError();
        $('loading-msg').textContent = T.generatingR1;
        $('r1-container').hidden = true;
        $('r2-container').hidden = true;

        try {
            const attempt = await api('POST', '/api/speak/attempts', {
                task: currentTask,
                subject: currentSubject,
                level: tasksData?.recommended_level || 'A1',
                transcript,
                seconds: elapsedSeconds,
                audio_duration: recordedAudioDuration,
            });
            currentAttempt = attempt;
            elapsedSeconds = 0;
            pollAttempt(attempt.id, false);
        } catch (err) {
            $('btn-submit-r1').disabled = false;
            showFeedbackError(T.submitFailed + err.message, submitRound1);
        }
    }

    async function submitRound2() {
        const transcript = $('transcript-input').value.trim();
        if (!transcript || !currentAttempt) return;

        $('btn-submit-r2').disabled = true;
        $('feedback-loading').hidden = false;
        hideFeedbackError();
        $('loading-msg').textContent = T.generatingR2;
        $('r2-container').hidden = true;

        try {
            const updated = await api('POST', `/api/speak/attempts/${currentAttempt.id}/round2`, {
                transcript,
                seconds: elapsedSeconds,
                audio_duration: recordedAudioDuration,
            });
            currentAttempt = updated;
            elapsedSeconds = 0;
            pollAttempt(updated.id, true);
        } catch (err) {
            $('btn-submit-r2').disabled = false;
            showFeedbackError(T.submitFailed + err.message, submitRound2);
        }
    }

    // Card saving
    async function saveSentenceCard(btn) {
        const sentence = decodeURIComponent(btn.dataset.sentence || '');
        const chunk = decodeURIComponent(btn.dataset.chunk || '');
        const explanation = decodeURIComponent(btn.dataset.explanation || '');
        if (!sentence) return;

        btn.disabled = true;
        try {
            await api('POST', '/api/srs/notes', {
                sentence,
                translation_en: explanation,
                translation_zh: '',
                extra: {},
                modes: ['listen', 'speak'],
                targets: [
                    {
                        text: chunk,
                        mode: 'cloze',
                        importance: 3,
                        meta: { hint: explanation },
                    },
                ],
            });
            btn.innerHTML = `<i data-lucide="check"></i> <span>${T.savedCard}</span>`;
            btn.classList.add('is-done');
            refreshIcons();
        } catch (err) {
            btn.disabled = false;
            alert(T.cardSaveFailed + err.message);
        }
    }

    // Past attempts
    function renderPastAttempts(attempts) {
        const listEl = $('past-attempts-list');
        $('past-count').textContent = attempts.length;
        if (!attempts.length) {
            listEl.innerHTML = `<p class="muted">${T.noPast}</p>`;
            return;
        }

        listEl.innerHTML = '';
        attempts.forEach(att => {
            const item = document.createElement('div');
            item.className = 'past-item';
            const dateStr = att.created_at ? new Date(att.created_at).toLocaleDateString() : '';
            item.innerHTML = `
                <div>
                    <div class="past-item-title">${esc(att.task)}: ${esc(att.subject?.title || 'Sujet')}</div>
                    <div class="past-item-meta">${esc(dateStr)} · ${att.wpm ? `${esc(att.wpm)} WPM` : ''} · ${esc(Math.round(att.audio_duration || att.seconds))}s</div>
                </div>
                <span class="badge">${esc(att.status)}</span>
            `;
            item.addEventListener('click', () => {
                currentAttempt = att;
                currentTask = att.task;
                currentSubject = att.subject;
                $('transcript-input').value = att.transcript_2 || att.transcript_1 || '';
                updateStatsBadge();
                if (att.feedback_2 && Object.keys(att.feedback_2).length > 0) {
                    renderRound2Feedback(att.feedback_2);
                } else if (att.feedback_1 && Object.keys(att.feedback_1).length > 0) {
                    renderRound1Feedback(att.feedback_1);
                }
            });
            listEl.appendChild(item);
        });
    }

    async function loadPastAttempts() {
        try {
            const data = await api('GET', '/api/speak/attempts');
            renderPastAttempts(data.attempts || []);
        } catch (_) {}
    }

    // Init
    async function init() {
        $('transcript-input')?.addEventListener('input', () => { clearTimeout(init._draftTimer); init._draftTimer = setTimeout(saveDraft, 500); });
        I18N.apply(TEXT);
        I18N.mountToggle($('lang-toggle'));
        refreshIcons();

        if (!getToken()) {
            $('login-required').hidden = false;
            return;
        }
        $('speak-workspace').hidden = false;
        startElapsedTracker();

        try {
            tasksData = await api('GET', '/api/speak/tasks');
            if (tasksData.recommended_task) {
                currentTask = tasksData.recommended_task;
                const radio = document.querySelector(`input[name="task"][value="${currentTask}"]`);
                if (radio) radio.checked = true;
            }
            if (tasksData.recommended_level) {
                $('level-badge').textContent = T.levelBadge(tasksData.recommended_level);
            }
            renderSubject();
            renderPastAttempts(tasksData.attempts || []);
        } catch (err) {
            console.error('Failed to load speaking tasks:', err);
        }
        restoreDraft();

        // Event listeners
        document.querySelectorAll('input[name="task"]').forEach(r => {
            r.addEventListener('change', (e) => selectTask(e.target.value));
        });

        $('btn-next-subject').addEventListener('click', () => {
            currentSubjectIndex++;
            renderSubject();
        });

        $('t3-short-timer')?.addEventListener('change', resetTimer);

        $('btn-record').addEventListener('click', () => {
            if (isRecording) stopRecording();
            else startRecording();
        });

        $('transcript-input').addEventListener('input', updateStatsBadge);
        $('btn-timer-toggle').addEventListener('click', toggleTimer);
        $('btn-timer-reset').addEventListener('click', resetTimer);

        $('btn-submit-r1').addEventListener('click', submitRound1);
        $('btn-submit-r2').addEventListener('click', submitRound2);

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-save-card');
            if (btn) saveSentenceCard(btn);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
