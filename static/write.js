/* ==========================================================================
   French Audio Studio - Writing practice (/write)
   TCF Canada Expression Écrite (EE) with two-round guided feedback.
   ========================================================================== */

(function () {
    'use strict';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const I18N = window.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const TOKEN_KEY = 'frenchStudio.userToken';
    const POLL_MS = 3000;

    const TEXT = {
        en: {
            pageTitle: 'Writing Practice - 1000H French',
            heading: 'Writing practice',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navWrite: 'Write', navSpeak: 'Speak', navReview: 'Review', navListen: 'Listen',
            loginTitle: 'Please log in first',
            loginDesc: 'Writing practice requires saving your history and generating personalized feedback. Please log in.',
            loginBtn: 'Log in',
            taskSelectTitle: 'Task and Subject',
            levelBadge: (lvl) => `Fits ${lvl}`,
            btnNextSubject: 'Another subject',
            btnAiSubject: 'AI new subject',
            wordCount: 'Words: ',
            underMin: (n, min) => `${n} words · ${min - n} under min (${min}–${maxWords()})`,
            inRange: (n) => `${n} words · in target range (${minWords()}–${maxWords()})`,
            overMax: (n, max) => `${n} words · ${n - max} over max (${minWords()}–${max})`,
            writePlaceholder: 'Write your French text here…',
            btnSubmitR1: 'Submit Round 1 feedback',
            btnSubmitR2: 'Submit Round 2 revision',
            r1Title: 'Round 1: Checklist & Error hints',
            r1Badge: 'Round 1',
            praiseTitle: 'One thing done well',
            checklistTitle: 'Task requirements checklist',
            errorsTitle: 'Key error hints (edit above)',
            hintNote: 'Round 1 only marks the error and hints at the rule without giving answers. Revise your text above, then submit Round 2.',
            r2Title: 'Round 2: Revision check & Structures',
            r2Badge: 'Round 2',
            fixedTitle: 'Fixes verified',
            correctedTitle: 'Sentence corrections (save to cards)',
            structuresTitle: 'Reusable structures (learn patterns, not texts)',
            saveCard: 'Save card',
            savedCard: 'Card saved',
            pastTitle: 'Past writing attempts',
            noPast: 'No past writing attempts yet.',
            generatingR1: 'Generating Round 1 feedback… (analyzing task & errors)',
            generatingR2: 'Generating Round 2 check… (verifying fixes & structures)',
            aiGeneratingSubject: 'Generating fresh subject with AI…',
            subjectGenFailed: 'Could not generate subject: ',
            submitFailed: 'Failed to submit: ',
            cardSaveFailed: 'Failed to save card: ',
        },
        zh: {
            pageTitle: '写作练习 - 1000H French',
            heading: '写作练习',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navWrite: '写作', navSpeak: '口语', navReview: '今日复习', navListen: '开车听',
            loginTitle: '请先登录',
            loginDesc: '写作练习需要保存记录和提供个性化反馈，请先登录账号。',
            loginBtn: '去登录',
            taskSelectTitle: '选择任务与题目',
            levelBadge: (lvl) => `适合 ${lvl}`,
            btnNextSubject: '换一题',
            btnAiSubject: 'AI 出新题',
            wordCount: '字数：',
            underMin: (n, min) => `${n} 词 · 少于最低 ${min} 词 (${min}–${maxWords()})`,
            inRange: (n) => `${n} 词 · 在达标区间内 (${minWords()}–${maxWords()})`,
            overMax: (n, max) => `${n} 词 · 超出最高 ${max} 词 (${minWords()}–${max})`,
            writePlaceholder: '在此用法语作答……',
            btnSubmitR1: '提交第一轮批改 (Round 1)',
            btnSubmitR2: '提交第二轮订正 (Round 2)',
            r1Title: '第一轮：自查清单与修改提示',
            r1Badge: 'Round 1',
            praiseTitle: '做得好的一点',
            checklistTitle: '任务要求自查 (Checklist)',
            errorsTitle: '重点修改提示（请在上方输入框自行修改）',
            hintNote: '第一轮只指出错误位置和语法线索，不直接给答案。请根据提示在上方修改后，提交第二轮。',
            r2Title: '第二轮：订正结果与精选结构',
            r2Badge: 'Round 2',
            fixedTitle: '修改核对',
            correctedTitle: '逐句最小修正（可加入生词卡）',
            structuresTitle: '可复用句式（学结构，不背范文）',
            saveCard: '加入卡片',
            savedCard: '已存入卡片',
            pastTitle: '历史写作练习',
            noPast: '暂无历史练习记录。',
            generatingR1: '正在生成第一轮自查与提示…（通常 30–50 秒）',
            generatingR2: '正在核对修改并生成精选结构…',
            aiGeneratingSubject: 'AI 正在生成适合当前阶段的新题…',
            subjectGenFailed: '生成题目失败：',
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
    const DRAFT_KEY = 'frenchStudio.draft.write';
    function saveDraft() {
        try {
            const text = $('write-input')?.value || '';
            localStorage.setItem(DRAFT_KEY + '.' + currentTask, JSON.stringify({ text, subject: currentSubject, level: $('exam-level')?.value }));
            localStorage.setItem(DRAFT_KEY + '.stage', currentTask);
        } catch (_) {}
    }
    function restoreDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem(DRAFT_KEY + '.' + currentTask) || 'null');
            if (draft && draft.text) {
                $('write-input').value = draft.text;
                if (draft.subject) { currentSubject = draft.subject; renderSubject(true); }
                if (draft.level) $('exam-level').value = draft.level;
            } else if (currentTask === 'T1') {
                $('write-input').value = localStorage.getItem(DRAFT_KEY) || '';
            }
            updateWordCount();
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
    let currentTask = 'P0';
    let currentSubjectIndex = 0;
    let currentSubject = null;
    let currentAttempt = null;
    let pollTimer = null;
    let timerInterval = null;
    let timerSecondsLeft = 600;
    let timerRunning = false;
    let elapsedSeconds = 0;
    let elapsedTimer = null;

    function minWords() {
        return tasksData?.tasks?.[currentTask]?.min_words || 60;
    }

    function maxWords() {
        return tasksData?.tasks?.[currentTask]?.max_words || 120;
    }

    function calcWords(text) {
        const cleaned = (text || '').replace(/['’]/g, ' ');
        const tokens = cleaned.match(/[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*/g);
        return tokens ? tokens.length : 0;
    }

    function updateWordCount() {
        const text = $('write-input').value;
        const count = calcWords(text);
        const min = minWords();
        const max = maxWords();

        $('word-count-val').textContent = count;
        $('word-count-range').textContent = `/ ${min}–${max}`;

        const statusEl = $('word-count-status');
        if (count < min) {
            statusEl.textContent = T.underMin(count, min);
            statusEl.className = 'badge';
        } else if (count > max) {
            statusEl.textContent = T.overMax(count, max);
            statusEl.className = 'badge is-todo';
        } else {
            statusEl.textContent = T.inRange(count);
            statusEl.className = 'badge is-done';
        }
    }

    // Timer functions
    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function resetTimer() {
        pauseTimer();
        const def = tasksData?.tasks?.[currentTask]?.timer_seconds || 600;
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
                if (timerSecondsLeft <= 120) {
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
        elapsedTimer = setInterval(() => { if (!document.hidden && document.hasFocus()) elapsedSeconds++; }, 1000);
    }

    // Subject Rendering
    function renderSubject(preserve = false) {
        const subjects = tasksData?.subjects?.[currentTask] || [];
        if (!preserve) {
            if (!subjects.length) return;
            currentSubject = subjects[currentSubjectIndex % subjects.length];
        }
        syncStage();

        $('subject-title').textContent = (EN ? currentSubject.title_en || currentSubject.title : currentSubject.title) || '';
        $('subject-prompt').textContent = (EN ? currentSubject.prompt_en || currentSubject.prompt : currentSubject.prompt) || '';

        const reqUl = $('subject-requirements');
        reqUl.innerHTML = '';
        (EN ? currentSubject.requirements_en || currentSubject.requirements || [] : currentSubject.requirements || []).forEach(req => {
            const li = document.createElement('li');
            li.textContent = req;
            reqUl.appendChild(li);
        });

        // T3 documents
        const t3Docs = $('t3-documents');
        if (currentTask === 'T3' && (currentSubject.doc1 || currentSubject.doc2)) {
            t3Docs.hidden = false;
            $('t3-doc1').textContent = currentSubject.doc1 || '';
            $('t3-doc2').textContent = currentSubject.doc2 || '';
        } else {
            t3Docs.hidden = true;
        }

        const stems = currentSubject.stems || [];
        $('writing-scaffold').hidden = !currentTask.startsWith('P');
        $('writing-scaffold').open = currentTask === 'P0';
        $('writing-scaffold-content').innerHTML = `<p>${(currentSubject.words || []).map(esc).join(' · ')}</p>${stems.map(x => `<p lang="fr">${esc(x)}</p>`).join('')}`;
        resetTimer();
        updateWordCount();
    }

    function syncStage() {
        const practice = currentTask.startsWith('P');
        $('write-mode').value = practice ? 'practice' : 'exam';
        $('practice-stage-label').hidden = !practice;
        $('exam-task-row').hidden = practice;
        $('exam-level-label').hidden = practice;
        if (practice) $('practice-stage').value = currentTask;
        document.querySelectorAll('input[name="task"]').forEach(r => { r.checked = r.value === currentTask; });
        $('btn-timer-toggle').hidden = practice;
        $('btn-timer-reset').hidden = practice;
        $('timer-display').hidden = practice;
        $('level-badge').textContent = tasksData?.tasks?.[currentTask]?.[EN ? 'name_en' : 'name'] || currentTask;
        $('practice-note').textContent = practice
            ? (EN ? 'Practice targets, not exam requirements. Try your own ideas; focus on a few useful corrections.' : '这是练习目标，不是考试字数要求。写自己的意思，每次重点改少量问题。')
            : (EN ? 'Official task lengths. The level changes feedback guidance, not exam requirements.' : '使用正式考试任务字数。水平只调整批改提示，不降低考试要求。');
    }

    function selectTask(task) {
        saveDraft();
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        currentTask = task;
        currentSubjectIndex = 0;
        currentAttempt = null;
        $('write-input').value = '';
        $('feedback-panel').hidden = true;
        $('r1-container').hidden = true;
        $('r2-container').hidden = true;
        $('btn-submit-r1').hidden = false;
        $('btn-submit-r2').hidden = true;
        renderSubject();
        restoreDraft();
    }

    // Feedback Rendering
    function renderRound1Feedback(fb) {
        $('feedback-panel').hidden = false;
        $('feedback-loading').hidden = true;
        $('r1-container').hidden = false;
        $('r2-container').hidden = true;

        // Praise
        $('r1-praise-text').textContent = fb.praise || 'Bon travail !';

        // Checklist
        const checkUl = $('r1-checklist');
        checkUl.innerHTML = '';

        // Word count item
        const wcLi = document.createElement('li');
        const wcDone = fb.word_count?.in_range;
        wcLi.innerHTML = `<span class="check-icon ${esc(wcDone ? 'is-done' : 'is-todo')}">${esc(wcDone ? '✓' : '⚠')}</span><span>${esc(fb.word_count?.note || '')}</span>`;
        checkUl.appendChild(wcLi);

        // Checklist items
        (fb.checklist || []).forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(item.covered ? 'is-done' : 'is-todo')}">${esc(item.covered ? '✓' : '⚠')}</span><span><strong>${esc(item.point)}</strong>: ${esc(item.note)}</span>`;
            checkUl.appendChild(li);
        });

        // Register
        if (fb.register) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(fb.register.fits ? 'is-done' : 'is-todo')}">${esc(fb.register.fits ? '✓' : '⚠')}</span><span><strong>Register (${esc(fb.register.choice)})</strong>: ${esc(fb.register.note)}</span>`;
            checkUl.appendChild(li);
        }

        // T3 comparison
        if (fb.t3_comparison) {
            const compDone = fb.t3_comparison.compared && fb.t3_comparison.position_clear;
            const li = document.createElement('li');
            li.innerHTML = `<span class="check-icon ${esc(compDone ? 'is-done' : 'is-todo')}">${esc(compDone ? '✓' : '⚠')}</span><span>${esc(fb.t3_comparison.note || 'Comparison and position')}</span>`;
            checkUl.appendChild(li);
        }

        // Errors & hints
        const errorsDiv = $('r1-errors');
        errorsDiv.innerHTML = '';
        const errors = fb.errors || [];
        if (!errors.length) {
            errorsDiv.innerHTML = '<p class="muted">Aucune erreur majeure détectée ! Superbe maîtrise.</p>';
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
                const att = await api('GET', `/api/write/attempts/${attemptId}`);
                currentAttempt = att;
                if (isRound2) {
                    if (att.status === 'ready' && att.feedback_2 && Object.keys(att.feedback_2).length > 0) {
                        clearInterval(pollTimer);
                        pollTimer = null;
                        renderRound2Feedback(att.feedback_2);
                        loadPastAttempts();
                        if (window.FrenchGame) window.FrenchGame.refresh();
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
                        if (window.FrenchGame) window.FrenchGame.refresh();
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
        const text = $('write-input').value.trim();
        if (!text) {
            alert('Veuillez écrire votre texte avant de soumettre.');
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
            const attempt = await api('POST', '/api/write/attempts', {
                task: currentTask,
                subject: currentSubject,
                level: tasksData?.tasks?.[currentTask]?.level || $('exam-level').value,
                text,
                seconds: elapsedSeconds,
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
        const text = $('write-input').value.trim();
        if (!text || !currentAttempt) return;

        $('btn-submit-r2').disabled = true;
        $('feedback-loading').hidden = false;
        hideFeedbackError();
        $('loading-msg').textContent = T.generatingR2;
        $('r2-container').hidden = true;

        try {
            const updated = await api('POST', `/api/write/attempts/${currentAttempt.id}/round2`, {
                text,
                seconds: elapsedSeconds,
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
                    <div class="past-item-meta">${esc(dateStr)} · ${esc(calcWords(att.text_1))} 词</div>
                </div>
                <span class="badge">${esc(att.status)}</span>
            `;
            item.addEventListener('click', () => {
                currentAttempt = att;
                currentTask = att.task;
                currentSubject = att.subject;
                $('write-input').value = att.text_2 || att.text_1 || '';
                renderSubject(true);
                updateWordCount();
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
            const data = await api('GET', '/api/write/attempts');
            renderPastAttempts(data.attempts || []);
        } catch (_) {}
    }

    // Init
    async function init() {
        $('write-input')?.addEventListener('input', () => { clearTimeout(init._draftTimer); init._draftTimer = setTimeout(saveDraft, 500); });
        I18N.apply(TEXT);
        I18N.mountToggle($('lang-toggle'));
        refreshIcons();

        if (!getToken()) {
            $('login-required').hidden = false;
            return;
        }
        $('write-workspace').hidden = false;
        startElapsedTracker();

        try {
            tasksData = await api('GET', '/api/write/tasks');
            const query = new URLSearchParams(location.search);
            const wanted = query.get('task') || localStorage.getItem(DRAFT_KEY + '.stage') || tasksData.practice_default || 'P0';
            currentTask = tasksData.tasks[wanted] ? wanted : 'P0';
            const theme = query.get('theme');
            if (theme) currentSubjectIndex = Math.max(0, (tasksData.subjects[currentTask] || []).findIndex(x => x.theme === theme));
            renderSubject();
            renderPastAttempts(tasksData.attempts || []);
        } catch (err) {
            console.error('Failed to load tasks:', err);
        }
        restoreDraft();

        $('write-mode').addEventListener('change', e => selectTask(e.target.value === 'practice' ? $('practice-stage').value : 'T1'));
        $('practice-stage').addEventListener('change', e => selectTask(e.target.value));
        // Event listeners
        document.querySelectorAll('input[name="task"]').forEach(r => {
            r.addEventListener('change', (e) => selectTask(e.target.value));
        });

        $('btn-next-subject').addEventListener('click', () => {
            saveDraft();
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            currentAttempt = null;
            $('feedback-panel').hidden = true;
            $('btn-submit-r1').hidden = false;
            $('btn-submit-r1').disabled = false;
            $('btn-submit-r2').hidden = true;
            $('write-input').value = '';
            currentSubjectIndex++;
            renderSubject();
        });

        $('btn-new-ai-subject').addEventListener('click', async () => {
            const btn = $('btn-new-ai-subject');
            btn.disabled = true;
            const origText = btn.textContent;
            btn.textContent = T.aiGeneratingSubject;
            try {
                const newSub = await api('POST', '/api/write/subject', {
                    task: currentTask,
                    level: tasksData?.tasks?.[currentTask]?.level || $('exam-level').value,
                });
                tasksData.subjects[currentTask].unshift(newSub);
                currentSubjectIndex = 0;
                renderSubject();
            } catch (err) {
                alert(T.subjectGenFailed + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = origText;
            }
        });

        $('write-input').addEventListener('input', updateWordCount);
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
