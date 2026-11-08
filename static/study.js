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

window.escapeHtml = escapeHtml;
window.cleanFrenchToken = cleanFrenchToken;
window.frenchPhoneticNormalize = frenchPhoneticNormalize;
window.calculateLevenshteinSimilarity = calculateLevenshteinSimilarity;
window.evaluateFrenchPronunciation = evaluateFrenchPronunciation;

function initStudyWorkbench() {
    const I18N = window.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const pick = I18N.pick;

    const TEXT = {
        en: {
            pageTitle: 'French Breakdown & Shadowing - 1000H French',
            heading: 'Study & speaking practice',
            navAria: 'Pages', navAudio: 'Audio Studio', navStudy: 'Study', navWrite: 'Write', navSpeak: 'Speak', navReview: 'Review', navListen: 'Listen', navGrammar: 'Grammar map',
            account: 'Account', login: 'Log in', trialBadgeTitle: 'Account validity',
            reviewBtn: 'Review', reviewBtnTitle: "Today's review (listen · speak · fill in)", dueBadgeTitle: 'Cards due today',
            connectionSettings: 'Connection', connectionNotVerified: 'Connection not verified yet', notVerified: 'Not verified',
            analysisModel: 'Analysis model',
            modelGemini: 'Gemini 3.8 Flash (AGY) · fastest',
            recommendedSuffix: ' · recommended',
            notTested: 'Not tested yet', notTestedDetail: 'Click Test connection to check the real connection',
            testConnection: 'Test connection',
            todayReviewTitle: 'You have cards to review today', startReview: 'Start review',
            inputAria: 'French text input', inputHeading: 'Enter the French text to break down and shadow',
            historyBtn: 'History', historyBtnTitle: 'View and restore past queries',
            exampleBtn: 'Example', exampleBtnTitle: 'Fill in a classic French example',
            photoBtn: '📷 Photo/upload', photoBtnTitle: 'Take or choose a photo of a textbook page and study its French item by item',
            clear: 'Clear', clearTitle: 'Clear the input',
            inputPlaceholder: 'Paste French text or a screenshot, or tap 📷 to upload',
            actionAria: 'Breakdown actions', analyze: 'Break down & analyse',
            parsed: 'Analysed', expandInput: 'Edit / enter a new text', expandInputTitle: 'Open the input to edit it or enter a new text',
            deckAria: 'Analysis and shadowing cards', deckHeading: 'Sentence analysis & pronunciation practice',
            sentenceCountEmpty: '0 sentences',
            playAll: 'Play all', repeat: 'Repeat',
            historyTitle: 'History', historyTotalEmpty: '0 items',
            clearHistory: 'Clear history', clearHistoryTitle: 'Clear the history in this category', closeEsc: 'Close (Esc)',
            histAll: 'All', histStudy: '📖 Breakdowns', histTts: '🎧 Audio',
            historyEmptyTitle: 'No history yet',
            historyEmptyDesc: 'Every French text you break down is saved here with its cards. Restore it in one click, without spending API calls again.',
            authTitle: 'Log in',
            authNotice: 'Once you log in, the server calls the AI models for you, review cards sync between your phone and computer, and your history is saved in the cloud.',
            email: 'Email', password: 'Password', passwordPlaceholder: 'Password (at least 6 characters)', logout: 'Log out',
            registerTitle: 'Sign up with an invite', register: 'Sign up', inviteCode: 'Invite code', invitePlaceholder: 'Enter your invite code',
            registerNotice: 'New accounts get a free 60-day trial. Sign-up is by invite only for now.',
            haveInvite: 'Have an invite code? Sign up', haveAccount: 'Already have an account? Log in',
            needInvite: 'Please enter your invite code.', registerSuccess: 'Account created. Your 60-day free trial has started.',
            membership: 'Membership',
            studyTimeTitle: 'Study time', studyToday: 'Today', studyWeek: 'This week', studyTotal: 'Total',
            goalDetail: (left, avg, date) => `${left} h to go · ${avg} h/week lately${date ? ` · on pace to finish ${date}` : ''}`,
            goalNoPace: (left) => `${left} h to go · no study in the last 4 weeks, so no finish date yet`, goalDone: 'You reached 1000 hours.',
            devicesTitle: 'Signed-in devices (up to 3)', thisDevice: 'This device', signOutDevice: 'Sign out',
            lastActive: (when) => `Last active ${when}`,
            signedOutElsewhere: 'This device was signed out: an account can be signed in on up to 3 devices. Please log in again.',
            needLogin: 'Please log in first.',
            connected: 'Connected', failed: 'Failed',
            testing: 'Testing', testingDetail: 'Checking account access and the model connection...',
            connectionTestFailed: 'Connection test failed', connectionOk: 'Connection OK',
            connectionOkDetail: (label) => `${label} connected and responded normally`, connectionFailed: 'Connection failed',
            serverError: (status) => `Server error (HTTP ${status}). Please try again.`,
            srsLoginRequired: 'Review cards are saved on the server. Please log in first.',
            requestFailed: (status) => `Request failed (HTTP ${status})`,
            generatingExercise: 'Creating an exercise…',
            todayDue: (n) => `${n} cards to review today`,
            dueReview: (n) => `Review ${n}`, dueNew: (n) => `New ${n}`,
            dueDetail: (parts, minutes, done) => `${parts} · about ${minutes} min${done ? ` · ${done} reviews done today` : ''}. Review first, then learn new sentences.`,
            starSaved: 'In review (click to remove this fill-in card)', starAdd: 'Add to review: blank out this word in its sentence',
            grammarSaved: 'In review (click to remove this grammar card)', grammarAdd: 'Add to review: the AI writes a new sentence with this rule for you to fill in',
            sentenceInReview: 'In review ✓', sentenceRemove: 'Click to remove', sentenceAdd: 'Add to review: creates a “listen” card and a “speak” card',
            inReview: 'In review', addToReview: 'Add to review',
            clickToListen: 'Listen: ', listenTo: (text) => `Listen to “${text}”`, listenStandard: 'Listen to the standard pronunciation',
            modelReading: 'Model', modelReadingFull: 'Model reading', listen: 'Listen',
            falseFriendTitle: 'False friend: looks like an English word but means something else', englishLinkTitle: 'Related English word',
            clickForMeaning: 'Click for the meaning', clickToPronounce: 'Click to pronounce', baseForm: 'base form: ',
            sentenceCount: (n) => `${n} sentence${n === 1 ? '' : 's'}`,
            shadowingTitle: 'Shadowing & Scoring',
            shadowingGuide: 'Click the microphone and read the sentence aloud. You are scored on completeness, similarity and missed words.',
            startRecording: 'Click to start recording', evaluating: 'Scoring...', accuracy: 'Accuracy: ', completeness: 'Completeness: ',
            legendCorrect: 'Accurate', legendClose: 'Close / slight difference', legendMissed: 'Missed or needs fixing',
            myRecording: 'My recording', retryShadowing: 'Try again',
            feynmanSub: 'In your own words (Chinese or English): what does this sentence say, and why is it built this way? The AI only points out what you missed.',
            variationLabel: 'Also make a sentence of your own (optional)', askLabel: 'Ask a question',
            askSave: 'Save as a card', askSaveTitle: 'Turn this answer into a grammar card: a new sentence to fill in, using the same rule', askSaving: 'Making a practice card…', askSaved: '✓ Added to review',
            feynmanPlaceholder: 'e.g. This sentence says…; aucune is already negative, so there is no pas… (Enter to check, Shift+Enter for a new line)',
            variationPlaceholder: '(Optional) Change a word and make a new French sentence of your own',
            dictateTitle: 'Say it instead (Chinese mixed with French, or English). The server transcribes it into the box above, and you can still edit it.',
            dictate: 'Speak instead', feynmanCheck: 'Let the AI find gaps',
            askPlaceholder: "Ask anything, or answer the AI's follow-up question (Chinese or English). e.g. What about de + la?",
            askMicTitle: 'Ask by speaking', askMic: 'Speak', ask: 'Ask',
            listenSentence: 'Listen to the whole sentence', readSentenceAria: 'Read the sentence aloud',
            selectWordsTitle: 'Select words: tap the first and the last word, then read them or see their meaning', selectWordsAria: 'Select words in this sentence',
            pronounceTitle: 'Listen to the model pronunciation', pronounce: 'Listen',
            buildupRecordTitle: 'Say this step yourself and get a score', shadowScore: 'Say it',
            playMyRecordingTitle: 'Play back my recording', retryTitle: 'Record again', retryShort: 'Retry',
            modeSwitchAria: 'Study mode',
            modeNormal: 'Show all', modeNormalTitle: 'Show the full French of every step',
            modeBlind: 'Test me', modeBlindTitle: 'Hide the new words of each step, so you say them from memory',
            modeWrite: 'Recall', modeWriteTitle: 'See only the English and write the French from memory',
            modeListen: 'Dictation', modeListenTitle: 'Listen to the sentence and write down the French',
            noGrammar: 'No grammar notes for this sentence.', noPron: 'No pronunciation notes for this sentence.',
            buildupHint: 'Tap any French word to hear it. Listen to each step, then say it yourself.',
            blindTipStrong: 'Feynman challenge', blindTipText: ': the new words of each step are hidden. Look at the meaning and say the French from memory!',
            revealAll: 'Reveal all', hideAgain: 'Hide again',
            fwBadge: 'Function words',
            expandDetails: 'Show details', collapseDetails: 'Hide details',
            showBreakdown: 'Show the breakdown', hideBreakdown: 'Hide the breakdown',
            memoryHook: 'Memory hook:',
            tabBuildup: 'Steps', tabWords: 'Words', tabGrammar: 'Grammar', tabPron: 'Sounds', tabExplain: 'Explain it', glossLabel: 'Word by word',
            structureAria: 'Sentence structure: tap a part to see its role', structureBlock: { N: 'Noun group', V: 'Verb', S: 'Sentence building' }, grammarMapLink: 'Grammar map',
            thWord: '① Word / phrase (Forme & Audio)', thEnglish: '② English explanation (Anglais)', thChinese: '③ Chinese meaning & usage (Chinois)',
            transcribing: 'Transcribing…', dictationLogin: 'Speech recognition requires logging in first.',
            transcribeFailed: (status) => `Transcription failed (HTTP ${status})`, notHeard: "Didn't catch that. Please try again.",
            fixingWords: 'Fixing French words…', fixingStatus: 'Transcript added. Fixing misheard French words (about 5–10 s)…',
            fixedStatus: 'Fixed. You can edit anything that is still wrong.', micError: 'Cannot use the microphone: ', doneSpeaking: 'Tap when done',
            verdictSolid: 'You explained it clearly', verdictPartial: 'You got part of it', verdictMissing: "You haven't got the key point yet",
            variationOk: (note) => `✓ Your sentence is correct${note ? ': ' + note : ''}`, variationFix: '✗ Your sentence could be: ',
            followUp: 'Follow-up: ', followUpHint: ' (answer in the question box below)',
            requestFailedGeneric: 'Request failed',
            feynmanEmpty: 'First write (or say) your own understanding, even if it is just one sentence.',
            feynmanLoading: 'The AI is checking your explanation for gaps…',
            stop: 'Stop', stopAndScoreShort: '⏹ Tap to score', stopAndScore: '⏹ Done reading, tap to score',
            micUnavailable: 'Cannot access the microphone: ', shadowAgain: '🎙 Try again',
            diffWordTitle: (score) => `Similarity: ${score} / 100 · click for the meaning and pronunciation`,
            noClearSpeech: 'No clear speech detected. Please try again.',
            scoreTranscribing: 'Checking…', scoreNotScored: 'Not scored', scoreFailed: 'Could not score this recording: ',
            scoreNoAudio: 'No sound was recorded. Check that the microphone is allowed, then try again.',
            daysLeftShort: (n) => `${n} days left`, planPro: 'No expiry', daysLeft: (n) => `Valid for ${n} more days`,
            operationFailed: 'Something went wrong', loginSuccess: 'Logged in. Welcome back!', loggedOut: 'Logged out.',
            wordTitleSuffix: ' · click for the meaning and pronunciation',
            emptyInput: 'Please enter the French text you want to break down first.',
            analyzing: 'Analysing...',
            cancelAnalysis: 'Cancel', cancelAnalysisTitle: 'Stop the analysis and keep editing (Esc)',
            analysisCancelled: 'Analysis cancelled. Your text is still here; edit it and press Enter when ready.',
            analyzingStatus: 'The AI is splitting the text into sentences, chunks and collocations and analysing them. Please wait...',
            cleaningStatus: 'Checking your text for French sentences to study...',
            cleanedInput: (n) => `Extracted ${n} French sentences from your text.`,
            accentFixedNote: (original) => `Source reads “${original}”, corrected`,
            photoStatusAria: 'Photo reading progress',
            photoSteps: { compress: 'Compress photo', upload: 'Upload', read: 'Read French', found: 'Items found', analyze: 'Analyse' },
            photoCompressing: 'Compressing photo…',
            photoUploading: (percent) => `Uploading ${percent}%`,
            photoUploaded: 'Uploaded',
            photoReading: (seconds) => `Uploaded, reading French… (${seconds}s)`,
            photoFound: (n) => `Found ${n} item${n === 1 ? '' : 's'}`,
            photoAnalyzing: (part, total) => `Analysing part ${part} of ${total}`,
            photoAllDone: (n) => `All done: ${n} sentence${n === 1 ? '' : 's'} ready to study.`,
            photoStepFailed: (step, message) => `Failed at “${step}”: ${message}`,
            photoCancelled: 'Photo reading cancelled.',
            photoUnreadable: 'This file could not be opened as a photo. Please try another one.',
            photoFailed: 'The photo could not be read. Please try again.',
            photoNetworkError: 'The connection dropped. Please check your network and try again.',
            analyzeSkipped: (failed, total) => `${failed} of ${total} parts could not be analysed and were skipped.`,
            analyzeFailed: 'Analysis request failed',
            analyzingProgress: (done, total) => `The AI is analysing your text: ${done} of ${total} parts done…`,
            analyzeDone: 'Done! First try explaining the sentence yourself (Feynman self-test), then read the explanation. Tap “Add to review” for sentences you want to learn and ⭐ for words; tap 🔊 to hear them, or try shadowing with scores.',
            analyzeError: 'Breakdown failed: ',
            restored: (n) => `Restored from history (${n} sentences), no tokens used.`,
            restoredText: 'The text from your audio history is filled in. Click “Break down & analyse” to create the grammar and word cards.',
        },
        zh: {
            pageTitle: '法语拆解与跟读复述 - 1000H French',
            heading: '学习与开口练习',
            navAria: '页面切换', navAudio: '音频工作台', navStudy: '拆解与复述', navWrite: '写作', navSpeak: '口语', navReview: '今日复习', navListen: '开车听', navGrammar: '语法地图',
            account: '账号', login: '登录', trialBadgeTitle: '账号有效期',
            reviewBtn: '复习', reviewBtnTitle: '今日复习（听 · 说 · 填）', dueBadgeTitle: '今天待复习卡片数',
            connectionSettings: '连接设置', connectionNotVerified: '连接尚未验证', notVerified: '未验证',
            analysisModel: '分析模型',
            modelGemini: 'Gemini 3.8 Flash (AGY) · 极速',
            recommendedSuffix: ' · 推荐',
            notTested: '尚未测试', notTestedDetail: '点击测试实际连接',
            testConnection: '测试连接',
            todayReviewTitle: '今天有卡片要复习', startReview: '开始复习',
            inputAria: '输入法语文本', inputHeading: '输入待拆解与复述的法语文本',
            historyBtn: '查询历史', historyBtnTitle: '查看并恢复过往查询历史',
            exampleBtn: '填入示例', exampleBtnTitle: '填入经典法语示例',
            photoBtn: '📷 拍照/上传', photoBtnTitle: '拍摄或选择一张课本照片，提取法语后逐条学习',
            clear: '清空', clearTitle: '清空输入框',
            inputPlaceholder: '粘贴法语文字或截图，或点 📷 上传',
            actionAria: '拆解操作', analyze: '开始拆解与精析',
            parsed: '已解析', expandInput: '重新编辑 / 输入新文本', expandInputTitle: '展开输入框以修改或输入新内容',
            deckAria: '解析与跟读卡片', deckHeading: '句子精析与发音复述',
            sentenceCountEmpty: '共 0 句',
            playAll: '全部播放', repeat: '循环',
            historyTitle: '历史记录', historyTotalEmpty: '共 0 条',
            clearHistory: '清空历史', clearHistoryTitle: '清空当前分类历史', closeEsc: '关闭 (Esc)',
            histAll: '全部', histStudy: '📖 拆解精析', histTts: '🎧 音频制作',
            historyEmptyTitle: '暂无查询历史',
            historyEmptyDesc: '您每次拆解分析的法语文本和精析卡片都会自动保存在这里，随时可以一键恢复，无需重复耗费 API 资源。',
            authTitle: '登录账号',
            authNotice: '登录后：由服务器调用大模型、复习卡片在手机和电脑之间同步、历史记录云端保存。',
            email: '电子邮箱', password: '密码', passwordPlaceholder: '请输入密码（至少 6 位）', logout: '退出当前账号',
            registerTitle: '邀请码注册', register: '注册', inviteCode: '邀请码', invitePlaceholder: '请输入邀请码',
            registerNotice: '新账号免费试用 60 天。目前凭邀请码注册。',
            haveInvite: '有邀请码？注册', haveAccount: '已有账号？登录',
            needInvite: '请填写邀请码。', registerSuccess: '注册成功！60 天免费试用已开始。',
            membership: '会员',
            studyTimeTitle: '学习时间', studyToday: '今天', studyWeek: '本周', studyTotal: '累计',
            goalDetail: (left, avg, date) => `还差 ${left} 小时 · 近 4 周平均每周 ${avg} 小时${date ? ` · 按此进度预计 ${date} 完成` : ''}`,
            goalNoPace: (left) => `还差 ${left} 小时 · 近 4 周没有学习记录，暂无法估算完成日期`, goalDone: '已达成 1000 小时。',
            devicesTitle: '已登录设备（最多 3 台）', thisDevice: '当前设备', signOutDevice: '退出',
            lastActive: (when) => `最近使用 ${when}`,
            signedOutElsewhere: '这台设备已退出登录：账号最多同时登录 3 台设备。请重新登录。',
            needLogin: '请先登录账号。',
            connected: '已连接', failed: '失败',
            testing: '正在测试', testingDetail: '正在验证账号权益与模型连通性...',
            connectionTestFailed: '连接测试失败', connectionOk: '连接正常',
            connectionOkDetail: (label) => `${label} 连接成功并正常响应`, connectionFailed: '连接失败',
            serverError: (status) => `服务器暂时出错（HTTP ${status}），请再试一次。`,
            srsLoginRequired: '复习卡片保存在服务器上，请先登录。',
            requestFailed: (status) => `请求失败（HTTP ${status}）`,
            generatingExercise: '生成练习中…',
            todayDue: (n) => `今天有 ${n} 张卡片要复习`,
            dueReview: (n) => `复习 ${n}`, dueNew: (n) => `新卡 ${n}`,
            dueDetail: (parts, minutes, done) => `${parts} · 约 ${minutes} 分钟${done ? ` · 今天已复习 ${done} 次` : ''}。先复习，再学新句子。`,
            starSaved: '已加入复习（点击移除这张挖空卡）', starAdd: '加入复习：在句子里挖空这个词',
            grammarSaved: '已加入复习（点击移除这张语法卡）', grammarAdd: '加入复习：AI 用这条规则造一个新例句让你填空',
            sentenceInReview: '已加入复习 ✓', sentenceRemove: '点击移除', sentenceAdd: '加入复习：生成「听」和「说」两张卡片',
            inReview: '已加入复习', addToReview: '加入复习',
            clickToListen: '点击试听: ', listenTo: (text) => `收听「${text}」标准发音`, listenStandard: '收听标准发音',
            modelReading: '范读', modelReadingFull: '官方范读', listen: '收听',
            falseFriendTitle: '假朋友警示：与英文形似但含义不同', englishLinkTitle: '英文联想借词',
            clickForMeaning: '点击查看释义', clickToPronounce: '点击发音', baseForm: '原形: ',
            sentenceCount: (n) => `共 ${n} 句`,
            shadowingTitle: '即时跟读打分 (Shadowing & Scoring)',
            shadowingGuide: '点击麦克风朗读该句，AI 将从发音完整度、相似度与漏读进行智能评测',
            startRecording: '点击开始录音跟读', evaluating: '评测中...', accuracy: '准确度: ', completeness: '完整度: ',
            legendCorrect: '发音准确', legendClose: '接近/轻微差异', legendMissed: '漏读或需纠正',
            myRecording: '我的录音', retryShadowing: '重新跟读',
            feynmanSub: '用自己的话讲（中文或英语都行）：这句话在说什么，为什么这样说？AI 只指出你漏掉的地方。',
            variationLabel: '再用它造一个自己的句子（可选）', askLabel: '有问题就问',
            askSave: '存成卡片', askSaveTitle: '把这条回答变成语法卡：用同一条规则造一个新句子来填空', askSaving: '正在生成练习卡…', askSaved: '✓ 已加入复习',
            feynmanPlaceholder: '例：这句是说……；aucune 本身就是否定，所以没有 pas……（回车让 AI 找漏洞，Shift+回车换行）',
            variationPlaceholder: '（可选）换一个词，自己造一个新的法语句子',
            dictateTitle: '用说的（中文夹法语、英语都可以），服务器识别后填进上面的框，可以再改',
            dictate: '用说的', feynmanCheck: '让 AI 找漏洞',
            askPlaceholder: '有问题随时问，或回答 AI 的追问（中文或英语都行）例：那 de + la 呢？',
            askMicTitle: '用说的提问', askMic: '说', ask: '问',
            listenSentence: '收听整句标准发音', readSentenceAria: '朗读句子',
            selectWordsTitle: '选词：点第一个和最后一个词，然后朗读或查看释义', selectWordsAria: '在这句里选词',
            pronounceTitle: '点击听范读发音', pronounce: '发音',
            buildupRecordTitle: '自己说一遍这一步，并给你打分', shadowScore: '跟读打分',
            playMyRecordingTitle: '回听我的录音', retryTitle: '重新录音跟读', retryShort: '重练',
            modeSwitchAria: '学习模式切换',
            modeNormal: '全部显示', modeNormalTitle: '显示每一步完整的法语',
            modeBlind: '考考我', modeBlindTitle: '遮住每一步新加的词，凭记忆说出来',
            modeWrite: '默写', modeWriteTitle: '只看英文，凭记忆写出法语',
            modeListen: '听写', modeListenTitle: '听句子，写下法语',
            noGrammar: '这句没有需要特别讲的语法点。', noPron: '这句没有需要特别注意的发音点。',
            buildupHint: '点任意法语单词可以听发音。每一步先听，再自己说一遍。',
            blindTipStrong: '费曼认知挑战', blindTipText: '：递进关键词已遮挡。看着释义，凭借脑内记忆说出这句法语！',
            revealAll: '一键揭晓', hideAgain: '重新遮挡',
            fwBadge: '基础虚词',
            expandDetails: '展开解析', collapseDetails: '收起解析',
            showBreakdown: '展开这句的解析', hideBreakdown: '收起这句的解析',
            memoryHook: '记忆钩子：',
            tabBuildup: '一步步搭', tabWords: '逐词剖析', tabGrammar: '语法考点', tabPron: '发音重点', tabExplain: '自己讲', glossLabel: '逐词对照',
            structureAria: '句子结构：点一块看它的作用', structureBlock: { N: '名词组', V: '动词', S: '句子怎么组织' }, grammarMapLink: '语法地图',
            thWord: '① 词汇 / 词组短语 (Forme & Audio)', thEnglish: '② 英文简明解释 (Anglais)', thChinese: '③ 中文释义与语法搭配 (Chinois)',
            transcribing: '识别中…', dictationLogin: '语音识别需要先登录。',
            transcribeFailed: (status) => `识别失败（HTTP ${status}）`, notHeard: '没听清，再说一次试试。',
            fixingWords: '校正法语词…', fixingStatus: '已填入识别结果，正在校正听错的法语词（约 5–10 秒）…',
            fixedStatus: '已校正。不对的地方可以直接改。', micError: '无法使用麦克风：', doneSpeaking: '说完点这里',
            verdictSolid: '讲清楚了', verdictPartial: '讲到了一部分', verdictMissing: '还没抓住要点',
            variationOk: (note) => `✓ 你造的句子没问题${note ? '：' + note : ''}`, variationFix: '✗ 你造的句子可以改成：',
            followUp: '追问：', followUpHint: '（直接在下面的提问框里回答）',
            requestFailedGeneric: '请求失败',
            feynmanEmpty: '先写（或说）几句你自己的理解，哪怕只有一句。',
            feynmanLoading: 'AI 正在对照你的讲解找漏洞…',
            stop: '停止', stopAndScoreShort: '⏹ 点击评测', stopAndScore: '⏹ 朗读完成，点击评测',
            micUnavailable: '无法调用麦克风：', shadowAgain: '🎙 再次跟读',
            diffWordTitle: (score) => `相似度得分: ${score} / 100 · 点击查看释义与单读发音`,
            noClearSpeech: '未检测到清晰发音，请重试。',
            scoreTranscribing: '识别中…', scoreNotScored: '未评分', scoreFailed: '这次录音没法打分：',
            scoreNoAudio: '没有录到声音，请确认已允许使用麦克风，再试一次。',
            daysLeftShort: (n) => `剩 ${n} 天`, planPro: '长期有效', daysLeft: (n) => `有效期剩 ${n} 天`,
            operationFailed: '操作失败', loginSuccess: '登录成功！欢迎回来。', loggedOut: '已退出登录。',
            wordTitleSuffix: ' · 点击查看释义与单读发音',
            emptyInput: '请先输入需要拆解或学习的法语文本。',
            analyzing: '正在智能拆解与精析...',
            cancelAnalysis: '取消', cancelAnalysisTitle: '停止分析，继续编辑 (Esc)',
            analysisCancelled: '已取消分析，文本仍保留，可继续编辑，改好后按 Enter 重新开始。',
            analyzingStatus: '正在调用 LLM 进行全句切分与意群搭配深度三列解析，请稍候...',
            cleaningStatus: '正在检查文本中的法语句子…',
            cleanedInput: (n) => `已从你的文本中提取 ${n} 句法语`,
            accentFixedNote: (original) => `原文写作 ${original}，已更正`,
            photoStatusAria: '照片识别进度',
            photoSteps: { compress: '压缩图片', upload: '上传', read: '识别法语', found: '识别结果', analyze: '分析' },
            photoCompressing: '压缩图片…',
            photoUploading: (percent) => `上传中 ${percent}%`,
            photoUploaded: '上传成功',
            photoReading: (seconds) => `上传成功，正在识别法语（已等 ${seconds} 秒）`,
            photoFound: (n) => `识别出 ${n} 条`,
            photoAnalyzing: (part, total) => `正在分析第 ${part}/${total} 段`,
            photoAllDone: (n) => `全部完成：共 ${n} 句，可以开始学习了。`,
            photoStepFailed: (step, message) => `「${step}」这一步失败：${message}`,
            photoCancelled: '已取消识别照片。',
            photoUnreadable: '这个文件打不开，请换一张照片。',
            photoFailed: '照片识别失败，请稍后再试。',
            photoNetworkError: '网络连接中断，请检查网络后重试。',
            analyzeSkipped: (failed, total) => `其中 ${failed} / ${total} 段解析失败，已跳过。`,
            analyzeFailed: '分析请求失败',
            analyzingProgress: (done, total) => `AI 正在逐段解析：已完成 ${done} / ${total} 段…`,
            analyzeDone: '拆解完成！先试着自己讲讲这句话（费曼自测），再看讲解；想背的句子点「加入复习」，想背的词点 ⭐、点击 🔊 即时发音，或进行跟读打分。',
            analyzeError: '拆解失败: ',
            restored: (n) => `已成功从历史记录恢复（共 ${n} 句），无需重新消耗 Token。`,
            restoredText: '已填入历史音频文本，点击“开始拆解与精析”即可生成语法词汇卡片。',
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];

    I18N.apply(TEXT);
    I18N.mountToggle(document.getElementById('lang-toggle'));

    // DOM Elements - Connection
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
    const photoButton = document.getElementById('photo-upload-btn');
    const photoInput = document.getElementById('photo-input');
    const photoStatus = document.getElementById('photo-status');
    const photoStatusResult = document.getElementById('photo-status-result');
    const analyzeButton = document.getElementById('analyze-btn');
    const analyzeButtonLabel = document.getElementById('analyze-btn-label');
    const statusMessage = document.getElementById('study-status-message');
    let photoStep = null;
    const studyInputPanel = document.querySelector('.study-input-panel');
    const actionRow = document.querySelector('.action-row');
    const inputCollapsedBar = document.getElementById('input-collapsed-bar');
    const collapsedBarText = document.getElementById('collapsed-bar-text');
    const btnExpandInput = document.getElementById('btn-expand-input');

    // The box grows with its text up to half the window, then scrolls inside. A hidden box
    // cannot be measured: it is fitted again when it is shown.
    function fitFrenchInput() {
        if (!frenchInput.offsetWidth) return;
        const { scrollTop } = frenchInput;
        const style = getComputedStyle(frenchInput);
        const padding = parseFloat(style.paddingTop);
        const lineHeight = parseFloat(style.lineHeight);
        // Padding scrolls with the text: one padding plus whole lines puts a line edge at the
        // top and bottom of the box at both scroll ends, so neither end cuts a line
        const maxHeight = padding + Math.floor((window.innerHeight / 2 - padding) / lineHeight) * lineHeight;
        // Measured without a scrollbar, whose width would wrap the text differently; the panel
        // holds its height meanwhile or the page would jump when scrolled down
        studyInputPanel.style.height = `${studyInputPanel.offsetHeight}px`;
        frenchInput.style.overflowY = 'hidden';
        frenchInput.style.height = 'auto';
        const contentHeight = frenchInput.scrollHeight;
        const scrolls = contentHeight > maxHeight;
        frenchInput.style.height = `${scrolls ? maxHeight : contentHeight}px`;
        frenchInput.style.overflowY = scrolls ? 'auto' : 'hidden';
        studyInputPanel.style.height = '';
        frenchInput.scrollTop = scrolls ? scrollTop : 0;
    }

    function updateFrenchInput() {
        charCounter.textContent = `${frenchInput.value.length} / 15000`;
        fitFrenchInput();
    }

    // Every programmatic fill goes through here and opens the text at its first line
    function setFrenchText(text) {
        frenchInput.value = text;
        frenchInput.scrollTop = 0;
        updateFrenchInput();
    }

    // focus() scrolls to the caret: a long text would open at its end
    function focusFrenchInput() {
        frenchInput.focus();
        frenchInput.scrollTop = 0;
    }

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
        hidePhotoStatus();
        studyInputPanel.hidden = false;
        if (actionRow) actionRow.hidden = false;
        inputCollapsedBar.hidden = true;
        if (frenchInput) {
            fitFrenchInput();
            focusFrenchInput();
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
    const authModalTitle = document.getElementById('auth-modal-title');
    const authInviteField = document.getElementById('auth-invite-field');
    const authInviteInput = document.getElementById('auth-invite');
    const authSwitchBtn = document.getElementById('auth-switch-btn');
    const profileEmail = document.getElementById('profile-email');
    const profileBadge = document.getElementById('profile-badge');
    const logoutBtn = document.getElementById('logout-btn');
    const profileDeviceList = document.getElementById('profile-device-list');

    // DOM Elements - Query History
    const historyToggleBtn = document.getElementById('history-toggle-btn');
    const historyCountBadge = document.getElementById('history-count-badge');
    const historyModal = document.getElementById('history-modal');
    const historyTotalBadge = document.getElementById('history-total-badge');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');

    // Word popover: shared with the review page (static/word-popover.js). This page adds
    // its sentence analysis, fixed expressions and the word book (add to review, importance).
    // The word book (saved words, importance) is shared with the review page too
    const wordBook = window.FrenchWordPopover.createWordBook({
        getToken: () => getUserToken(),
        notePayload: (sentence) => sentenceNotePayload(sentence),
        findLocal: (sentence, token) => findTargetCard(sentence, token),
        resolveChunk(sentence, token) {
            // The star of an open word card knows where the word was tapped ('' = not in an expression)
            const chunk = chunkForToggle !== null ? chunkForToggle : phraseTextFor(sentence, token);
            const words = (chunk || '').trim().split(/\s+/);
            return chunk && words.length >= 2 && words.length <= 4 ? chunk.trim() : null;
        },
        onSaved: (note) => rememberNote(note),
        onRemoved: (sentence, cardId) => forgetCard(sentence, cardId),
        onChange: () => updateTableStarStates(),
        onError: (err) => showSrsError(err),
    });

    // Also tapped like a title word: the word-by-word gloss, and a highlighted step chunk
    // (outside blind mode, where a tap on it reveals it instead)
    const GLOSS_TAP_SELECTOR = '.gloss-fr, .buildup-steps-list:not(.is-blind-mode) .buildup-new-token';

    function sentenceContextFor(element) {
        const practice = dictation && dictation.contextFor(element);
        if (practice) return practice;
        const card = element && element.closest('.sentence-card');
        if (!card) return {};
        return {
            sentence: card.querySelector('.sentence-french-text')?.textContent || '',
            sentence_cn: card.querySelector('.translation-cn')?.textContent || '',
        };
    }

    const wordContextClient = window.FrenchWordContext
        ? window.FrenchWordContext.createClient({ getToken: () => getEffectiveAuthToken() }) : null;

    const wordPopover = window.FrenchWordPopover.create({
        speak: (text) => playFrenchSpeech(text, null, { once: true }),
        getAuthToken: () => getEffectiveAuthToken(),
        wordSelector: `.interactive-word, .diff-word, .token-word, ${GLOSS_TAP_SELECTOR}`,
        // The popover must not cover the other lines of the sentence it was opened from
        blockFor: (element) => (element && element.closest ? element.closest('.sentence-french-text, .buildup-fr-text') : null),
        // Selecting text shows the read bar below (Read selection / Meaning), not the popover
        selectionPopover: false,
        contextFor: sentenceContextFor,
        // No localLookup: the word table holds each word's meaning in its own sentence, which is the
        // card's 语境 (wordContext below), never its 词典 (built-in dictionary, then /api/lookup)
        remember(lower, item) {
            if (!window.activeTokensMap) window.activeTokensMap = new Map();
            window.activeTokensMap.set(lower, item);
        },
        // A word of a fixed expression of this sentence shows the whole expression (static/phrase-context.js)
        phraseLookup: (word, element, context) => phraseLookup(word, element, context),
        // 语境: the tapped occurrence in its sentence (static/word-context.js, POST /api/word-context)
        wordContext: wordContextClient ? {
            target: (word, element, context) => wordContextTarget(word, element, context),
            explain: (target, hints) => wordContextClient.explain(target, hints),
        } : null,
        saving: {
            ...wordBook.popoverSaving,
            async toggle(item, snapshot) {
                // Saving a word of an expression saves the expression, with its meaning here
                const tap = phraseTap && phraseTap.element === wordPopover.activeElement() ? phraseTap : null;
                chunkForToggle = item.phrase ? item.phrase.text : (tap ? '' : null);
                const p = item.phrase;
                // A word saves its meaning in this sentence (语境) when the card has it, as before
                const here = p ? null : wordPopover.contextMeaning();
                try {
                    await wordBook.popoverSaving.toggle(p ? Object.assign({}, item, {
                        explanation_cn: p.meaning_zh || item.explanation_cn,
                        explanation_en: p.meaning_en || item.explanation_en,
                        lemma: p.phrase || item.lemma,
                    }) : here ? Object.assign({}, item, {
                        explanation_cn: here.meaning_zh || item.explanation_cn,
                        explanation_en: here.meaning_en || item.explanation_en,
                    }) : item, p ? Object.assign({}, snapshot, {
                        ctx_zh: p.meaning_zh || '', ctx_en: p.meaning_en || '', why_zh: p.literal_zh || '',
                    }) : snapshot);
                } finally {
                    chunkForToggle = null;
                }
                refreshDueBadge();
            },
        },
    });

    function showPopoverForElement(word, element, context = {}) {
        wordPopover.show(word, element, context);
    }

    // ---- Fixed expressions (static/phrase-context.js) ------------------------------------------
    // Each interactive word of a line with its [start, end) in line.textContent
    function wordSpans(line) {
        const spans = [];
        let offset = 0;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const el = node.parentElement && node.parentElement.closest('.interactive-word');
            const end = offset + node.textContent.length;
            if (el && line.contains(el)) {
                const last = spans[spans.length - 1];
                if (last && last.el === el) last.end = end;
                else spans.push({ el, start: offset, end });
            }
            offset = end;
        }
        return spans;
    }

    function phraseCard(occurrence, text) {
        const p = occurrence.phrase;
        return {
            text: occurrence.surface, phrase: p.phrase, meaning_zh: p.meaning_zh, meaning_en: p.meaning_en,
            literal_zh: p.literal_zh, notes: occurrence.notes, source: p.source,
            snippet: window.FrenchPhraseContext.snippet(text, occurrence.start, occurrence.end),
        };
    }

    // The expression a star on a table word (no tap position) saves: the old behaviour
    function phraseTextFor(sentence, token) {
        const PC = window.FrenchPhraseContext;
        const info = PC && phraseIndex.get(srsSentenceKey(sentence));
        const own = PC ? PC.fold((token || '').trim()) : '';
        const p = info && own ? info.phrases.find(q => PC.atoms(q.text).some(a => a.norm === own)) : null;
        return p ? p.text : null;
    }

    function mergeServerPhrases(info, list) {
        if (info.merged) return;
        info.merged = true;
        info.structured = true;  // answered (cached on the server): never asked again
        const PC = window.FrenchPhraseContext;
        PC.fromAnalysis({ sentence: info.sentence, phrases: list || [] }).phrases.forEach(p => {
            const spans = PC.find(p.text, info.sentence);
            const same = info.phrases.find(q => PC.fold(q.phrase) === PC.fold(p.phrase)
                || PC.find(q.text, info.sentence).some(h => spans.some(g => g.start < h.end && h.start < g.end)));
            if (!same) { info.phrases.push(Object.assign(p, { source: 'ai' })); return; }
            for (const field of ['meaning_zh', 'meaning_en', 'literal_zh']) if (!same[field]) same[field] = p[field];
        });
    }

    // One request per sentence and page: taps on the same sentence, at once or later, share it.
    // The server caches the answer per user (an empty list too). A failure may be retried after 30s.
    function requestPhrases(key, info) {
        if (!phraseRequests.has(key)) {
            const token = getEffectiveAuthToken();
            const request = fetch('/api/phrase-context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ sentence: info.sentence.slice(0, 600), translation_zh: (info.translation_zh || '').slice(0, 600) }),
            })
                .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
                .then(data => (Array.isArray(data.phrases) ? data.phrases : []))
                .catch(() => { setTimeout(() => phraseRequests.delete(key), 30000); return null; });
            phraseRequests.set(key, request);
        }
        return phraseRequests.get(key).then(list => {
            if (list) mergeServerPhrases(info, list);
            return list;
        });
    }

    // Only sentences analysed before the analysis listed its expressions, and whose word table
    // shows no sign of them, are asked about (once). A known expression without any meaning too.
    function needsServerPhrases(info, found) {
        if (info.structured || !getEffectiveAuthToken()) return false;
        if (found) return !(found.phrase.meaning_zh || found.phrase.meaning_en);
        return !info.aware && info.words >= 2;
    }

    function phraseLookup(word, element, context) {
        const PC = window.FrenchPhraseContext;
        phraseTap = null;
        if (!PC || !context || !context.sentence) return null;
        const key = srsSentenceKey(context.sentence);
        const info = phraseIndex.get(key);
        if (!info) return null;
        const line = element && element.closest && element.classList && element.classList.contains('interactive-word')
            ? element.closest('.sentence-french-text, .buildup-fr-text') : null;
        if (!line) {
            const target = wordContextTarget(word, element, context);
            const targetOccurrence = target && PC.occurrences(info.phrases, info.sentence).find(o => o.start < target.end && target.start < o.end);
            if (targetOccurrence) return { phrase: phraseCard(targetOccurrence, info.sentence), highlight: [] };
            // A chunk from the word table or the gloss, or a selection: only the expression itself
            const own = PC.fold(word).replace(/\s+/g, ' ').trim();
            const p = info.phrases.find(q => PC.fold(q.text) === own || PC.fold(q.phrase) === own);
            const occurrence = p && PC.occurrences([p], info.sentence)[0];
            return occurrence ? { phrase: phraseCard(occurrence, info.sentence), highlight: [] } : null;
        }
        const locate = () => {
            const text = line.textContent;
            const spans = wordSpans(line);
            const own = spans.find(sp => sp.el === element);
            const occurrence = own && PC.occurrences(info.phrases, text).find(o => o.start < own.end && own.start < o.end);
            if (!occurrence) return null;
            return {
                phrase: phraseCard(occurrence, text),
                highlight: spans.filter(sp => sp.start < occurrence.end && occurrence.start < sp.end).map(sp => sp.el),
            };
        };
        const found = locate();
        const tap = { element, text: found ? found.phrase.text : '' };
        phraseTap = tap;
        const pending = needsServerPhrases(info, found)
            ? requestPhrases(key, info).then(() => {
                const next = locate();
                if (next) tap.text = next.phrase.text;
                return next;
            })
            : null;
        return found || pending ? { phrase: found ? found.phrase : null, highlight: found ? found.highlight : [], pending } : null;
    }

    // ---- 语境 of a word card (static/word-context.js) ---------------------------------------------
    // Which occurrence of the sentence a tap means: the tapped word's own place on the sentence line;
    // for the word table, its k-th row of that word (the table lists the sentence in order) when the
    // table has a row for each occurrence; anywhere else only a word the sentence has once.
    // null (no 语境) for what is not one word of a sentence on this page.
    function wordContextTarget(word, element, context) {
        const WC = window.FrenchWordContext;
        const sentence = context && context.sentence ? context.sentence : '';
        const clean = WC ? WC.cleanWord(word) : '';
        if (!clean || !sentence || !element) return null;
        const spans = WC.spans(clean, sentence);
        if (!spans.length) return null;
        const key = srsSentenceKey(sentence);
        const norm = text => (text || '').normalize('NFC').replace(/’/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
        const table = wordTables.get(key) || [];
        const rows = table.filter(w => norm(w.fr || w.token) === norm(clean));
        const rowPerOccurrence = rows.length === spans.length;
        let occurrence = -1;
        const range = element.sourceRange;
        const line = element.classList && element.classList.contains('interactive-word') ? element.closest('.sentence-french-text') : null;
        const source = range ? (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) : element;
        const practiceWord = source?.closest?.('.dictation-result .interactive-word');
        if (context.practice) {
            if (!practiceWord || practiceWord.dataset.contextUnavailable) return null;
            if (range && (!practiceWord.contains(range.endContainer) || norm(range.toString()) !== norm(clean))) return null;
            const start = Number(practiceWord.dataset.contextStart);
            const end = Number(practiceWord.dataset.contextEnd);
            occurrence = spans.findIndex(sp => sp.start === start && sp.end === end);
        } else if (range) {
            // Meaning has a virtual positioning anchor. Resolve its actual selected occurrence from
            // the cloned source range, without changing getBoundingClientRect or coversRange.
            const source = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            const sourceLine = source && source.closest('.sentence-french-text');
            if (!sentenceContextByKey.has(key) || !sourceLine || !sourceLine.isConnected || sourceLine.textContent !== sentence
                || !sourceLine.contains(range.endContainer)) return null;
            try {
                const prefix = document.createRange();
                prefix.selectNodeContents(sourceLine);
                prefix.setEnd(range.startContainer, range.startOffset);
                const start = prefix.toString().normalize('NFC').length;
                prefix.setEnd(range.endContainer, range.endOffset);
                const end = prefix.toString().normalize('NFC').length;
                const selected = range.toString().trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, '').trim();
                if (norm(selected) !== norm(clean)) return null;
                occurrence = spans.findIndex(sp => sp.start >= start && sp.end <= end);
            } catch (_) { return null; }
        } else if (!element.closest) {
            // Older virtual anchors carry no source. A unique match is safe; repeats are ambiguous.
            if (!sentenceContextByKey.has(key) || spans.length !== 1) return null;
            occurrence = 0;
        } else if (line && line.textContent === sentence) {
            const own = wordSpans(line).find(sp => sp.el === element);
            if (own) occurrence = spans.findIndex(sp => sp.start < own.end && own.start < sp.end);
        } else if (element.dataset && element.dataset.wordIndex !== undefined) {
            const k = rows.indexOf(table[Number(element.dataset.wordIndex)]);
            if (k !== -1 && (rowPerOccurrence || spans.length === 1)) occurrence = spans.length === 1 ? 0 : k;
        } else if (spans.length === 1) {
            occurrence = 0;
        }
        if (occurrence < 0) return null;
        const row = rowPerOccurrence ? rows[occurrence] : null;
        const info = sentenceContextByKey.get(key) || {};
        return {
            sentence, word: clean, occurrence, start: spans[occurrence].start, end: spans[occurrence].end,
            translation_zh: info.translation_zh || context.sentence_cn || '',
            entry: row ? {
                meaning_zh: row.meaning_zh || row.explanation_cn || '',
                meaning_en: row.meaning || row.explanation_en || '',
                why_en: row.why || '',
                lemma: row.lemma || '',
                phonetic: row.ipa || row.phonetic || '',
                pos: row.type || row.pos || '',
            } : null,
        };
    }

    // Select French text (drag, long press, or the sentence's Select mode): a bar below offers
    // Read selection and Meaning. The click on Read starts the audio, as iOS requires.
    window.FrenchReadSelection.create({
        wordSelector: '.interactive-word',
        // A selection opens its meaning card directly (the card's speaker plays the audio).
        meaningOnSelect: true,
        rangeLineFor: (toggle) => {
            const card = toggle.closest('.sentence-card');
            return card ? card.querySelector('.sentence-french-text') : null;
        },
        speak: (text, onEnd) => playFrenchSpeech(text, onEnd),
        meaning: (text, anchor, context) => wordPopover.show(text, anchor, context, { silent: true }),
        contextFor: sentenceContextFor,
        openWord: () => wordPopover.activeElement(),
    });

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
    // 1. Settings & Auth Token
    // -------------------------------------------------------------------------
    function initSettings() {
        syncModelsFromBackend();

        setConnectionState('idle', T.notTested, T.notTestedDetail);

        updateHistoryBadges();
        checkCurrentUser();
        refreshDueBadge();
        loadSavedWords();
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
                    opt.textContent = m.label + (m.recommended ? T.recommendedSuffix : '');
                    modelSelect.appendChild(opt);
                });
                if (data.default && Array.from(modelSelect.options).some(opt => opt.value === data.default)) {
                    modelSelect.value = data.default;
                } else if (modelSelect.options.length > 0) {
                    modelSelect.selectedIndex = 0;
                }
            }
        } catch (err) {
            console.warn('Failed to sync models from backend', err);
        }
    }

    // The session token of the logged-in account; the server then uses its own upstream key.
    function getEffectiveAuthToken() {
        return localStorage.getItem(userTokenKey) || null;
    }

    function requireAuthToken() {
        const token = getEffectiveAuthToken();
        if (!token) {
            openAuthModal();
            throw new Error(T.needLogin);
        }
        return token;
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
                connectionSummaryText.textContent = state === 'success' ? T.connected : (state === 'error' ? T.failed : title);
            }
        }
    }

    async function testConnection() {
        try {
            const token = requireAuthToken();
            const model = modelSelect.value;
            setConnectionState('testing', T.testing, T.testingDetail);
            testConnectionButton.disabled = true;

            const res = await fetch('/api/connection/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ model }),
            });

            const data = await readJsonSafely(res);
            if (!res.ok) {
                throw new Error(data.detail?.message || data.detail || T.connectionTestFailed);
            }
            setConnectionState('success', T.connectionOk, T.connectionOkDetail(data.label));
        } catch (err) {
            setConnectionState('error', T.connectionFailed, err.message);
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

    // Canadian French voices: the same text always gets the same voice (FNV-1a hash of the
    // trimmed text), so replays, slow replays and the prefetch share one cached clip
    const CA_VOICES = ['fr-CA-SylvieNeural', 'fr-CA-JeanNeural', 'fr-CA-AntoineNeural'];
    function frenchVoiceFor(text) {
        const key = String(text || '').trim();
        let h = 0x811c9dc5;
        for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
        return CA_VOICES[h % CA_VOICES.length];
    }

    // One clip, Edge TTS with Web Speech as the fallback; onDone runs when it finishes by itself
    // options.voice keeps one voice for a whole sentence (dictation steps); options.rate slows it down
    function playClip(cleanText, onDone, onInterrupt, owner, options = {}) {
        const voice = options.voice || frenchVoiceFor(cleanText);
        const rate = options.rate && options.rate !== 1 ? `&rate=${options.rate}` : '';
        const audio = new Audio(`/tts?text=${encodeURIComponent(cleanText)}&voice=${voice}${rate}`);
        currentActiveAudio = audio;
        let done = false;
        window.FrenchAudio.bind(audio, () => { done = true; onInterrupt(); }, owner);
        const finish = () => {
            if (done) return;
            done = true;
            if (currentActiveAudio === audio) currentActiveAudio = null;
            onDone();
        };
        const speakFallback = () => {
            if (done || currentActiveAudio !== audio) return;
            if (!('speechSynthesis' in window)) { finish(); return; }
            try { window.speechSynthesis.cancel(); } catch (e) {}
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'fr-FR';
            utterance.rate = 0.95;
            utterance.onend = finish;
            utterance.onerror = finish;
            window.FrenchAudio.bind(utterance, onInterrupt, owner);
            window.speechSynthesis.speak(utterance);
        };
        audio.addEventListener('ended', finish);
        audio.addEventListener('error', () => {
            console.warn('Audio error, falling back to Web Speech');
            speakFallback();
        });
        audio.play().catch(e => {
            console.warn('Audio play interrupted, falling back to Web Speech:', e);
            speakFallback();
        });
    }

    let playbackLoopTimer = null;

    // Plays French. { all: true } goes on through the page's sentences from this one; with
    // Repeat on (playback.js) a single text plays again and again, and "all" starts over at
    // the end. Word lookups pass { once: true }. onEndCallback runs when playback ends or stops.
    function playFrenchSpeech(text, onEndCallback = null, options = {}) {
        if (!text || !text.trim()) return;
        stopAllAudio();
        const repeat = !options.once && Boolean(window.FrenchPlayback && window.FrenchPlayback.repeat());
        const mode = options.all ? 'all' : repeat ? 'loop' : 'once';
        const sentences = mode === 'all'
            ? Array.from(document.querySelectorAll('.sentence-french-text')).map(el => el.textContent.trim()).filter(Boolean)
            : [];
        const keys = sentences.map(srsSentenceKey);
        let current = text.trim();
        let ended = false;
        const markReading = (index) => {
            document.querySelectorAll('.sentence-french-text.is-reading').forEach(el => el.classList.remove('is-reading'));
            const el = index >= 0 ? document.querySelectorAll('.sentence-french-text')[index] : null;
            if (el) el.classList.add('is-reading');
        };
        const endAll = () => {
            if (ended) return;
            ended = true;
            markReading(-1);
            clearTimeout(playbackLoopTimer);
            playbackLoopTimer = null;
            if (mode !== 'once' && window.FrenchPlayback) window.FrenchPlayback.setActive(false);
            if (onEndCallback) onEndCallback();
        };
        currentAudioCleanup = endAll;  // stopAllAudio ends the whole loop
        if (mode !== 'once' && window.FrenchPlayback) window.FrenchPlayback.setActive(true, stopAllAudio);

        const step = () => {
            if (mode === 'all') markReading(keys.indexOf(srsSentenceKey(current)));
            playClip(current, () => {
                if (ended) return;
                // Repeat may have been switched off meanwhile: a single text stops, "all" finishes the pass
                const repeatNow = Boolean(window.FrenchPlayback && window.FrenchPlayback.repeat());
                if (mode === 'once' || (mode === 'loop' && !repeatNow)) {
                    if (currentAudioCleanup === endAll) currentAudioCleanup = null;
                    endAll();
                    return;
                }
                const index = keys.indexOf(srsSentenceKey(current));
                if (mode === 'all' && index !== -1) {
                    // The last sentence: start over with Repeat on, otherwise the read-through is done
                    if (index === sentences.length - 1 && !repeatNow) {
                        if (currentAudioCleanup === endAll) currentAudioCleanup = null;
                        endAll();
                        return;
                    }
                    current = sentences[(index + 1) % sentences.length];
                }
                playbackLoopTimer = setTimeout(() => { if (!ended) step(); }, 800);
            }, () => {
                if (currentAudioCleanup === endAll) stopAllAudio();
                else endAll();
            }, endAll);
        };
        step();
    }

    // -------------------------------------------------------------------------
    // 4. Spaced Repetition — server-side FSRS deck (reviewed on /review)
    // -------------------------------------------------------------------------
    const srsNotesByKey = new Map();       // sentence key -> saved note with its cards
    const phraseIndex = new Map();         // sentence key -> fixed expressions (FrenchPhraseContext.fromAnalysis)
    const phraseRequests = new Map();      // sentence key -> pending / finished /api/phrase-context answer
    const wordTables = new Map();          // sentence key -> the analysis's word table, in its order (语境)
    let phraseTap = null;                  // {element, text}: where the open word card was tapped
    let chunkForToggle = null;             // while the popover star saves: the expression to save, '' for none
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

    // Cloudflare turns upstream 502/504 into an HTML page: never let that surface as a JSON parse error
    async function readJsonSafely(res) {
        try {
            return await res.json();
        } catch (_) {
            return { detail: { message: T.serverError(res.status) } };
        }
    }

    async function srsApi(method, path, body) {
        const token = getUserToken();
        if (!token) {
            openAuthModal();
            throw new Error(T.srsLoginRequired);
        }
        const res = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await readJsonSafely(res);
        if (!res.ok) {
            throw new Error(data.detail?.message || T.requestFailed(res.status));
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
        const exact = note.cards.find(c => (c.mode === 'cloze' || c.mode === 'recognize') && c.target.toLowerCase() === clean);
        if (exact) return exact;
        const chunk = note.cards.find(c => {
            if (c.mode !== 'cloze') return false;
            const target = c.target.toLowerCase();
            const re = new RegExp(`(^|[\\s'’])${clean}([\\s'’]|$)`, 'i');
            return re.test(target);
        });
        return chunk || null;
    }

    function isWordSaved(sentence, token) {
        return wordBook.isSaved(sentence, token);
    }

    function loadSavedWords() {
        return wordBook.load();
    }

    function findGrammarCard(sentence, title) {
        const note = srsNotesByKey.get(srsSentenceKey(sentence));
        return note ? note.cards.find(c => c.mode === 'grammar' && c.target === title) || null : null;
    }

    async function toggleGrammarCard(btn) {
        const { sentence, title } = btn.dataset;
        const existing = findGrammarCard(sentence, title);
        const label = btn.querySelector('.grammar-card-label');
        btn.disabled = true;
        btn.classList.add('is-busy');
        try {
            if (existing) {
                await srsApi('DELETE', `/api/srs/cards/${encodeURIComponent(existing.id)}`);
                forgetCard(sentence, existing.id);
            } else {
                if (label) label.textContent = T.generatingExercise;
                const payload = sentenceNotePayload(sentence);
                rememberNote(await srsApi('POST', '/api/srs/grammar', {
                    sentence,
                    translation_zh: payload.translation_zh,
                    translation_en: payload.translation_en,
                    grammar: { title, explanation: btn.dataset.exp || '', hook: btn.dataset.hook || '' },
                    model: modelSelect.value,
                }));
            }
        } catch (err) {
            showSrsError(err);
        } finally {
            btn.disabled = false;
            btn.classList.remove('is-busy');
        }
        updateTableStarStates();
        refreshDueBadge();
    }

    // "Add to review" creates exactly these sentence-level cards. Word and grammar cards
    // (cloze, recognize, grammar) never count here, so the button state tracks only the
    // sentence-level deck its own click created.
    const SENTENCE_CARD_MODES = new Set(['listen', 'speak']);

    function sentenceCards(sentence) {
        const note = srsNotesByKey.get(srsSentenceKey(sentence));
        return note ? note.cards.filter(c => SENTENCE_CARD_MODES.has(c.mode)) : [];
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
                if (todayReviewTitle) todayReviewTitle.textContent = T.todayDue(total);
                if (todayReviewDetail) {
                    const minutes = Math.max(1, Math.round(total * 20 / 60));
                    const parts = [];
                    if (review + learning) parts.push(T.dueReview(review + learning));
                    if (fresh) parts.push(T.dueNew(fresh));
                    todayReviewDetail.textContent = T.dueDetail(parts.join(' · '), minutes, done);
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
            const saved = isWordSaved(btn.dataset.sentence, btn.dataset.token);
            btn.classList.toggle('active', saved);
            btn.title = saved ? T.starSaved : T.starAdd;
        });
        document.querySelectorAll('.btn-grammar-card').forEach(btn => {
            if (btn.classList.contains('is-busy')) return;
            const saved = Boolean(findGrammarCard(btn.dataset.sentence, btn.dataset.title));
            btn.classList.toggle('active', saved);
            btn.title = saved ? T.grammarSaved : T.grammarAdd;
            const label = btn.querySelector('.grammar-card-label');
            if (label) label.textContent = saved ? T.inReview : T.addToReview;
        });
        document.querySelectorAll('.btn-sentence-save').forEach(btn => {
            const saved = sentenceCards(btn.dataset.sentence).length > 0;
            btn.classList.toggle('active', saved);
            btn.title = saved ? T.sentenceRemove : T.sentenceAdd;
            const label = btn.querySelector('.sentence-save-label');
            if (label) label.textContent = saved ? T.sentenceInReview : T.addToReview;
        });
        wordPopover.refreshSaved();
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

    async function toggleTargetCard(word) {
        await wordBook.toggle(word);
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

        // Unknown words in explanations stay plain text; length is not language evidence.
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
                return `<button class="chip-tip-audio" type="button" data-speech="${escapeHtml(speechText)}" title="${T.clickToListen}${escapeHtml(cleanWord)}"><span>${escapeHtml(cleanWord)}</span><i data-lucide="volume-2"></i></button>`;
            }
            return `‘${escapeHtml(cleanWord)}’`;
        });

        // Also turn parentheses with active French vocabulary into clickable chips, e.g. (diplômes)
        explanationHtml = explanationHtml.replace(/\(([A-Za-zÀ-ÿœæŒÆ-]{1,25})\)/g, (match, word) => {
            const cleanWord = word.trim();
            if (isFrenchPronunciationFragment(cleanWord, sentenceText)) {
                const speechText = cleanWord.replace(/^-+|-+$/g, '') || cleanWord;
                return `(<button class="chip-tip-audio" type="button" data-speech="${escapeHtml(speechText)}" title="${T.clickToListen}${escapeHtml(cleanWord)}"><span>${escapeHtml(cleanWord)}</span><i data-lucide="volume-2"></i></button>)`;
            }
            return match;
        });

        const buttonHtml = hasTarget
            ? `<button class="btn-tip-audio" type="button" data-speech="${escapeHtml(audioText)}" title="${T.listenTo(escapeHtml(audioText))}">
                <i data-lucide="volume-2"></i>
                <span class="tip-target-text">${escapeHtml(parsed.target)}</span>
                <span class="tip-badge-listen">${T.modelReading}</span>
               </button>`
            : `<button class="btn-tip-audio icon-only" type="button" data-speech="${escapeHtml(audioText)}" title="${T.listenStandard}">
                <i data-lucide="volume-2"></i>
                <span class="tip-badge-listen">${T.listen}</span>
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
        if (!prevFr) return renderInteractiveWordsHtml(currentFr);

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
            return renderInteractiveWordsHtml(currentFr);
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
            result += renderInteractiveWordsHtml(piece);
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

    function isFunctionWordPos(pos) {
        return getPosCategory(pos) === 'function';
    }

    function renderWordBreakdownCard(w, sentenceText = '', transZh = '', index = -1) {
        const tokenText = w.fr || w.token || '';
        const sameText = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
        const lemma = w.lemma && !sameText(w.lemma, tokenText) ? w.lemma : '';
        const pos = w.type || w.pos || '';
        const ipa = w.ipa || w.phonetic || '';
        const meaning = w.meaning || w.explanation_en || '';
        const why = w.why || '';
        const engLink = w.english_link && !sameText(w.english_link, tokenText) ? w.english_link : '';
        const falseFriend = Boolean(w.false_friend);
        const isSaved = isWordSaved(sentenceText, tokenText);
        const fullExpEn = `${meaning}${why ? ' (' + why + ')' : ''}`;

        let linkHtml = '';
        if (falseFriend) {
            linkHtml = `
                <p class="word-link is-false-friend" title="${T.falseFriendTitle}">
                    <i data-lucide="alert-triangle"></i>
                    <span>False friend: ${escapeHtml(w.english_link || why || 'different meaning')}</span>
                </p>
            `;
        } else if (engLink) {
            linkHtml = `
                <p class="word-link" title="${T.englishLinkTitle}">
                    <i data-lucide="link"></i>
                    <span>${escapeHtml(engLink)}</span>
                </p>
            `;
        }

        return `
            <div class="word-item">
                <div class="word-item-head">
                    <span class="word-item-title">
                        <span class="token-word" lang="fr"${index >= 0 ? ` data-word-index="${index}"` : ''} title="${T.clickForMeaning}">${escapeHtml(tokenText)}</span>
                        ${ipa ? `<span class="word-ipa">${escapeHtml(formatFriendlyPhonetic(ipa))}</span>` : ''}
                        ${pos || lemma ? `<span class="word-meta">${[pos, lemma ? T.baseForm + lemma : ''].filter(Boolean).map(escapeHtml).join(' · ')}</span>` : ''}
                    </span>
                    <span class="word-item-actions">
                        <button class="btn-token-speak" type="button" title="${T.clickToPronounce}" data-speech="${escapeHtml(tokenText)}">
                            <i data-lucide="volume-2"></i>
                        </button>
                        <button class="btn-token-star ${isSaved ? 'active' : ''}" type="button"
                            title="${isSaved ? T.starSaved : T.starAdd}"
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
                    </span>
                </div>
                <p class="word-meaning">${escapeHtml(EN ? pick(w.meaning_zh || w.explanation_cn, meaning) : meaning)}</p>
                ${!EN && w.meaning_zh ? `<p class="word-meaning-zh">${escapeHtml(w.meaning_zh)}</p>` : ''}
                ${why ? `<p class="word-why">${escapeHtml(why)}</p>` : ''}
                ${linkHtml}
            </div>
        `;
    }

    // Extraction restores accents before the analysis, which then has nothing to report: the
    // wording it replaced comes from here. A fix and its original have the same length.
    function withAccentNotes(sentences, fixes) {
        return sentences.map(s => {
            const text = s.sentence || s.original || '';
            if (s.accent_fixed_from || !text) return s;
            for (const fix of fixes) {
                const at = fix.fr.indexOf(text);
                const original = at === -1 ? text : fix.accent_fixed_from.slice(at, at + text.length);
                if (original !== text) return { ...s, accent_fixed_from: original };
            }
            return s;
        });
    }

    function accentNoteHtml(original, sentenceText) {
        if (!original || original === sentenceText) return '';
        return `<p class="sentence-accent-note">${T.accentFixedNote(escapeHtml(original))}</p>`;
    }

    // The header is the same whether the sentence is open or closed: one line of French
    // (the largest text on the page), its translation, and the sentence actions.
    function sentenceHeadHtml({ sentenceText, transEn, transZh, idx, total, open, label = '', accentFixedFrom = '' }) {
        const isMulti = total > 1;
        const primary = EN ? pick(transZh, transEn) : transEn;
        const secondary = !EN && transZh ? transZh : '';
        return `
            <header class="sentence-head">
                ${isMulti ? `
                    <button class="sentence-toggle" type="button" aria-expanded="${open}" aria-controls="sentence-body-${idx}"
                        title="${open ? T.hideBreakdown : T.showBreakdown}" aria-label="${open ? T.hideBreakdown : T.showBreakdown}">
                        <i data-lucide="chevron-right"></i>
                    </button>
                ` : ''}
                <div class="sentence-head-text">
                    ${label ? `<span class="sentence-label">${escapeHtml(label)}</span>` : ''}
                    <p class="sentence-french-text" lang="fr">${renderInteractiveWordsHtml(sentenceText)}</p>
                    ${accentNoteHtml(accentFixedFrom, sentenceText)}
                    ${primary ? `<p class="sentence-translation">${escapeHtml(primary)}</p>` : ''}
                    ${secondary ? `<p class="sentence-translation translation-cn">${escapeHtml(secondary)}</p>` : ''}
                </div>
                <div class="sentence-head-actions">
                    ${isMulti ? `<span class="sentence-position">${idx + 1} / ${total}</span>` : ''}
                    <button class="btn-speak-round" type="button" title="${T.listenSentence}" aria-label="${T.readSentenceAria}">
                        <i data-lucide="volume-2"></i>
                    </button>
                    ${window.FrenchPlayback ? window.FrenchPlayback.toggleHtml('btn-step-repeat btn-head-repeat') : ''}
                    <button class="btn-range-select" type="button" data-range-toggle aria-pressed="false" title="${T.selectWordsTitle}" aria-label="${T.selectWordsAria}">
                        <i data-lucide="text-select"></i>
                    </button>
                    <button class="btn-sentence-save" type="button" data-sentence="${escapeHtml(sentenceText)}" title="${T.sentenceAdd}">
                        <i data-lucide="bookmark-plus"></i>
                        <span class="sentence-save-label">${T.addToReview}</span>
                    </button>
                </div>
            </header>
        `;
    }

    // Sentence structure bar: the sentence in N (noun group) / V (verb) / S (sentence building)
    // chunks; a tap shows the chunk's role and its grammar point, linked to the grammar map
    const STRUCTURE_BLOCKS = ['N', 'V', 'S'];
    function structureSpans(structure) {
        return (Array.isArray(structure) ? structure : [])
            .filter(span => span && typeof span.text === 'string' && span.text.trim() && STRUCTURE_BLOCKS.includes(span.block));
    }

    function structureBarHtml(structure) {
        const spans = structureSpans(structure);
        if (!spans.length) return '';
        return `
            <div class="structure-bar" role="group" aria-label="${T.structureAria}">
                <div class="structure-track" lang="fr">
                    ${spans.map((span, i) => `<button class="structure-span" type="button" data-block="${span.block}" data-span="${i}" aria-expanded="false"
                        aria-label="${escapeHtml(`${span.text} · ${T.structureBlock[span.block]}${span.role ? ` · ${span.role}` : ''}`)}">${escapeHtml(span.text)}</button>`).join('')}
                </div>
                <div class="structure-legend">
                    ${STRUCTURE_BLOCKS.map(b => `<span class="structure-key" data-block="${b}">${T.structureBlock[b]}</span>`).join('')}
                    <a class="structure-map-link" href="/grammar">${T.grammarMapLink}</a>
                </div>
                <div class="structure-detail" hidden></div>
            </div>
        `;
    }

    function structureDetailHtml(span) {
        const name = span.gid ? pick(span.gid_zh, span.gid_en) : '';
        return `
            <span class="structure-detail-block" data-block="${span.block}">${T.structureBlock[span.block]}</span>
            ${span.role ? `<strong class="structure-detail-role">${escapeHtml(span.role)}</strong>` : ''}
            ${span.detail ? `<span class="structure-detail-text" lang="fr">${escapeHtml(span.detail)}</span>` : ''}
            ${name ? `<a class="structure-gid-chip" data-block="${escapeHtml((span.gid || '').charAt(0))}" href="/grammar#${encodeURIComponent(span.gid)}">${escapeHtml(name)}</a>` : ''}
        `;
    }

    function bindStructureBar(card, structure) {
        const bar = card.querySelector('.structure-bar');
        if (!bar) return;
        const spans = structureSpans(structure);
        const detail = bar.querySelector('.structure-detail');
        bar.querySelectorAll('.structure-span').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = btn.getAttribute('aria-expanded') === 'true';
                bar.querySelectorAll('.structure-span').forEach(other => {
                    other.setAttribute('aria-expanded', 'false');
                    other.classList.remove('is-active');
                });
                const span = spans[Number(btn.dataset.span)];
                if (wasOpen || !span) {
                    detail.hidden = true;
                    detail.innerHTML = '';
                    return;
                }
                btn.setAttribute('aria-expanded', 'true');
                btn.classList.add('is-active');
                detail.innerHTML = structureDetailHtml(span);
                detail.hidden = false;
            });
        });
    }

    // Answer options ("A.", "B.") are labels: older analyses kept them as sentences of their own
    const OPTION_LABEL = /^\(?([A-Ha-h]|\d{1,2})[.)]\)?$/;
    function attachOptionLabels(list) {
        const out = [];
        let pending = '';
        (list || []).forEach(s => {
            const match = (s.sentence || s.original || '').trim().match(OPTION_LABEL);
            if (match) { pending = match[1]; return; }
            out.push(pending && !s.label ? { ...s, label: pending } : s);
            pending = '';
        });
        return out;
    }

    function renderStudyDeck(sentences) {
        window.renderStudyDeck = renderStudyDeck;
        sentences = attachOptionLabels(sentences);
        sentencesContainer.innerHTML = '';
        if (!window.activeTokensMap) {
            window.activeTokensMap = new Map();
        }
        window.activeTokensMap.clear();
        phraseIndex.clear();
        wordTables.clear();

        if (!sentences || sentences.length === 0) {
            studyDeckSection.hidden = true;
            return;
        }

        studyDeckSection.hidden = false;
        sentenceCountBadge.textContent = T.sentenceCount(sentences.length);

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
            wordTables.set(srsSentenceKey(sentenceText), wordsList);
            if (window.FrenchPhraseContext) {
                phraseIndex.set(srsSentenceKey(sentenceText), Object.assign(window.FrenchPhraseContext.fromAnalysis(s), { translation_zh: transZh }));
            }

            const open = sentences.length === 1 || idx === 0;
            const card = document.createElement('article');
            card.className = open ? 'sentence-card is-open' : 'sentence-card';
            card.dataset.index = idx;
            const headHtml = sentenceHeadHtml({ sentenceText, transEn, transZh, idx, total: sentences.length, open, label: s.label, accentFixedFrom: s.accent_fixed_from });

            // Shared Shadowing & Scoring HTML
            const shadowingHtml = `
                <div class="shadowing-panel">
                    <div class="shadowing-header">
                        <div class="shadowing-title">
                            <i data-lucide="mic"></i>
                            <span>${T.shadowingTitle}</span>
                        </div>
                        <span class="shadowing-guide">${T.shadowingGuide}</span>
                    </div>
                    <div class="shadowing-body">
                        <button class="btn-record" type="button">
                            <i data-lucide="mic"></i>
                            <span class="record-btn-text">${T.startRecording}</span>
                        </button>
                    </div>
                    <div class="score-result-card" hidden>
                        <div class="score-summary-bar">
                            <div class="score-badge-group">
                                <span class="score-number-pill excellent">--</span>
                                <span class="score-rating-text">${T.evaluating}</span>
                            </div>
                            <div class="score-metrics">
                                <span>${T.accuracy}<strong class="metric-acc">--%</strong></span>
                                <span>${T.completeness}<strong class="metric-comp">--%</strong></span>
                            </div>
                        </div>
                        <div class="diff-result-box"></div>
                        <div class="diff-legend">
                            <span class="diff-legend-item"><span class="diff-dot dot-green"></span> ${T.legendCorrect}</span>
                            <span class="diff-legend-item"><span class="diff-dot dot-yellow"></span> ${T.legendClose}</span>
                            <span class="diff-legend-item"><span class="diff-dot dot-red"></span> ${T.legendMissed}</span>
                        </div>
                        <div class="shadow-audio-controls">
                            <button class="btn-audio-pill btn-play-model" type="button">
                                <i data-lucide="volume-2"></i>
                                <span>${T.modelReadingFull}</span>
                            </button>
                            <button class="btn-audio-pill btn-play-user" type="button" disabled>
                                <i data-lucide="play"></i>
                                <span>${T.myRecording}</span>
                            </button>
                            <button class="btn-audio-pill btn-retry" type="button">
                                <i data-lucide="rotate-ccw"></i>
                                <span>${T.retryShadowing}</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // 1b. Feynman self-test: the learner explains first, the AI only points out gaps
            const feynmanSelfTestHtml = `
                <div class="feynman-selftest">
                    <p class="panel-hint">${T.feynmanSub}</p>
                    <textarea class="feynman-input" rows="3" maxlength="2000" placeholder="${T.feynmanPlaceholder}"></textarea>
                    <details class="feynman-variation-box">
                        <summary>${T.variationLabel}</summary>
                        <input class="feynman-variation" type="text" maxlength="500" autocomplete="off" spellcheck="false" placeholder="${T.variationPlaceholder}">
                    </details>
                    <div class="feynman-actions">
                        <span class="dictation-status" aria-live="polite"></span>
                        ${canRecordAudio ? `
                            <button class="btn-feynman-mic" type="button" title="${T.dictateTitle}">
                                <i data-lucide="mic"></i><span class="dictation-label">${T.dictate}</span>
                            </button>
                        ` : ''}
                        <button class="btn-feynman-check" type="button">
                            <i data-lucide="search-check"></i><span>${T.feynmanCheck}</span>
                        </button>
                    </div>
                    <div class="feynman-feedback" hidden></div>
                    <div class="feynman-ask">
                        <p class="feynman-ask-label">${T.askLabel}</p>
                        <div class="ask-thread" aria-live="polite"></div>
                        <form class="ask-row" autocomplete="off">
                            <input class="ask-input" type="text" maxlength="1000" placeholder="${T.askPlaceholder}">
                            ${canRecordAudio ? `
                                <button class="btn-ask btn-ask-mic" type="button" title="${T.askMicTitle}"><i data-lucide="mic"></i><span class="dictation-label">${T.askMic}</span></button>
                            ` : ''}
                            <button class="btn-ask" type="submit"><i data-lucide="send"></i><span>${T.ask}</span></button>
                        </form>
                    </div>
                </div>
            `;

            // Every card has the same tabs in the same order (V1 and V2, short or long); Steps is added
            // in front only where a build-up exists. Recall / Dictation open the exercise (dictation.js).
            let hasValidBuildup = false;
            let buildupHtml = '';
            let wordsPanelHtml = '';
            if (isV2) {
                // ==================== SCHEMA V2 RENDERING ====================
                const wordCount = sentenceText.trim().split(/\s+/).filter(Boolean).length;
                const isShortSentence = wordCount <= 5;
                hasValidBuildup = Boolean(s.build_up && s.build_up.length > 1 && !isShortSentence);

                // 1. Sentence Hero: French text + Interlinear Gloss + Translations
                const interlinearHtml = (s.alignment && s.alignment.length > 0) ? `
                    <div class="interlinear-gloss">
                        <p class="gloss-label">${T.glossLabel}</p>
                        <div class="gloss-track">
                            ${s.alignment.map(a => `
                                <div class="gloss-pair">
                                    <span class="gloss-fr" lang="fr">${escapeHtml(cleanAlignmentToken(a.fr))}</span>
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

                // 2. Sentence Build-up (一层一层搭句子 - 5词及以内短句/标题无需生硬拆解)
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
                                        <span class="buildup-fr-text" lang="fr">${highlightedFr}</span>
                                        <div class="buildup-action-group">
                                            <button class="btn-buildup-speak" type="button" title="${T.pronounceTitle}" data-speech="${escapeHtml(step.fr)}">
                                                <i data-lucide="volume-2"></i>
                                                <span>${T.pronounce}</span>
                                            </button>
                                            ${window.FrenchPlayback ? window.FrenchPlayback.toggleHtml('btn-step-repeat') : ''}
                                            <button class="btn-buildup-record" type="button" title="${T.buildupRecordTitle}" data-sentence="${escapeHtml(step.fr)}">
                                                <i data-lucide="mic"></i>
                                                <span class="record-btn-text">${T.shadowScore}</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="buildup-en-text">${escapeHtml(step.en)}</div>
                                    ${step.new ? `
                                        <div class="buildup-new-note">
                                            ${escapeHtml(step.new)}
                                        </div>
                                    ` : ''}
                                    <div class="buildup-score-card" hidden>
                                        <div class="buildup-score-bar">
                                            <div class="buildup-score-left">
                                                <span class="score-number-pill sm excellent">--</span>
                                                <span class="score-rating-text sm">${T.evaluating}</span>
                                                <span class="buildup-score-metrics">${T.accuracy}<strong class="metric-acc">--%</strong> | ${T.completeness}<strong class="metric-comp">--%</strong></span>
                                            </div>
                                            <div class="buildup-audio-controls">
                                                <button class="btn-mini-audio btn-play-model" type="button" title="${T.modelReadingFull}" data-label="${T.modelReading}">
                                                    <i data-lucide="volume-2"></i>
                                                    <span>${T.modelReading}</span>
                                                </button>
                                                <button class="btn-mini-audio btn-play-user" type="button" title="${T.playMyRecordingTitle}" disabled>
                                                    <i data-lucide="play"></i>
                                                    <span>${T.myRecording}</span>
                                                </button>
                                                <button class="btn-mini-audio btn-retry" type="button" title="${T.retryTitle}">
                                                    <i data-lucide="rotate-ccw"></i>
                                                    <span>${T.retryShort}</span>
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
                                <p class="panel-hint">${T.buildupHint}</p>
                                <div class="feynman-mode-switch" role="group" aria-label="${T.modeSwitchAria}">
                                    <button class="btn-feynman-toggle active" data-mode="normal" type="button" title="${T.modeNormalTitle}">
                                        <i data-lucide="eye"></i>
                                        <span>${T.modeNormal}</span>
                                    </button>
                                    <button class="btn-feynman-toggle" data-mode="blind" type="button" title="${T.modeBlindTitle}">
                                        <i data-lucide="brain"></i>
                                        <span>${T.modeBlind}</span>
                                    </button>
                                    ${window.FrenchDictation ? `
                                        <button class="btn-feynman-toggle" data-dictation-mode="write" type="button" title="${T.modeWriteTitle}">${T.modeWrite}</button>
                                        <button class="btn-feynman-toggle" data-dictation-mode="listen" type="button" title="${T.modeListenTitle}">${T.modeListen}</button>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="feynman-tip-banner" hidden>
                                <span>🧠 <strong>${T.blindTipStrong}</strong>${T.blindTipText}</span>
                                <button class="btn-reveal-all" type="button">${T.revealAll}</button>
                            </div>
                            <div class="buildup-steps-list">
                                ${stepsHtml}
                            </div>
                        </div>
                    `;
                }

                // 4. Words: content words first, function words behind one toggle
                const contentWords = [];
                const functionWords = [];
                wordsList.forEach(w => {
                    (isFunctionWordPos(w.type || w.pos || '') ? functionWords : contentWords).push(w);
                });
                const shownWords = contentWords.length ? contentWords : wordsList;
                const hiddenWords = contentWords.length ? functionWords : [];
                const renderWords = list => list.map(w => renderWordBreakdownCard(w, sentenceText, transZh, wordsList.indexOf(w))).join('');

                wordsPanelHtml = interlinearHtml + `
                    <div class="word-list">${renderWords(shownWords)}</div>
                    ${hiddenWords.length ? `
                        <div class="small-words">
                            <button class="small-words-toggle" type="button" aria-expanded="false">
                                <span class="small-words-label">${T.fwBadge}</span>
                                <span class="small-words-preview" lang="fr">${hiddenWords.map(w => escapeHtml(w.fr || w.token || '')).join(' · ')}</span>
                                <span class="small-words-action">${T.expandDetails}</span>
                                <i data-lucide="chevron-down"></i>
                            </button>
                            <div class="word-list" hidden>${renderWords(hiddenWords)}</div>
                        </div>
                    ` : ''}
                `;

            } else {
                // ==================== LEGACY V1 RENDERING ====================
                let rowsHtml = '';
                wordsList.forEach((tok, tokIndex) => {
                    const tokenText = tok.token || tok.fr || '';
                    const lemma = tok.lemma && tok.lemma !== tokenText ? tok.lemma : '';
                    const pos = tok.pos || tok.type || '';
                    const phonetic = tok.phonetic || tok.ipa || '';
                    const expEn = tok.explanation_en || tok.meaning || '';
                    const expCn = tok.explanation_cn || '';
                    const isSaved = isWordSaved(sentenceText, tokenText);

                    rowsHtml += `
                        <tr>
                            <td>
                                <div class="token-cell">
                                    <div class="token-main-row">
                                        <span class="token-word" lang="fr" data-word-index="${tokIndex}">${escapeHtml(tokenText)}</span>
                                        <div class="token-actions">
                                            <button class="btn-token-speak" type="button" title="${T.clickToPronounce}" data-speech="${escapeHtml(tokenText)}">
                                                <i data-lucide="volume-2"></i>
                                            </button>
                                            <button class="btn-token-star ${isSaved ? 'active' : ''}" type="button"
                                                title="${isSaved ? T.starSaved : T.starAdd}"
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
                                        ${lemma ? `<span class="lemma-tag">${T.baseForm}${escapeHtml(lemma)}</span>` : ''}
                                    </div>
                                </div>
                            </td>
                            <td class="explanation-en-cell">${escapeHtml(EN ? pick(expCn, expEn) : expEn)}</td>
                            ${EN ? '' : `<td class="explanation-cn-cell">${escapeHtml(expCn)}</td>`}
                        </tr>
                    `;
                });

                const tableHtml = `
                    <div class="table-wrapper">
                        <table class="breakdown-table">
                            <thead>
                                <tr>
                                    <th>${T.thWord}</th>
                                    <th>${T.thEnglish}</th>
                                    ${EN ? '' : `<th>${T.thChinese}</th>`}
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                `;

                wordsPanelHtml = tableHtml;
            }

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
                                <button class="btn-grammar-star btn-grammar-card" type="button"
                                    title="${T.grammarAdd}"
                                    data-sentence="${escapeHtml(sentenceText)}"
                                    data-title="${escapeHtml(g.title)}"
                                    data-exp="${escapeHtml(g.explanation || '')}"
                                    data-hook="${escapeHtml(g.hook || '')}">
                                    <i data-lucide="star"></i>
                                    <span class="grammar-card-label">${T.addToReview}</span>
                                </button>
                            </div>
                            <div class="grammar-point-body">
                                <p class="grammar-point-exp">${escapeHtml(g.explanation)}</p>
                                ${g.hook ? `
                                    <div class="grammar-hook-inline feynman-hook-pill">
                                        <span class="hook-icon">🧠</span>
                                        <span class="hook-text"><strong>${T.memoryHook}</strong> ${escapeHtml(g.hook)}</span>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('');

                grammarHtml = `
                    <div class="study-card-section grammar-section">
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
                        <ul class="pronunciation-tips-list">
                            ${tipsHtml}
                        </ul>
                    </div>
                `;
            }

            const emptyPanel = text => `<p class="panel-hint card-tab-empty">${text}</p>`;
            const tabs = [
                hasValidBuildup && { id: 'buildup', label: T.tabBuildup, html: buildupHtml },
                { id: 'words', label: T.tabWords, html: wordsPanelHtml },
                { id: 'grammar', label: T.tabGrammar, html: structureBarHtml(s.structure) + (grammarHtml || emptyPanel(T.noGrammar)) },
                { id: 'pron', label: T.tabPron, html: pronTipsHtml || emptyPanel(T.noPron) },
                { id: 'shadowing', label: T.shadowScore, html: shadowingHtml },
                window.FrenchDictation && { id: 'recall', label: T.modeWrite, title: T.modeWriteTitle, dictation: 'write' },
                window.FrenchDictation && { id: 'dictation', label: T.modeListen, title: T.modeListenTitle, dictation: 'listen' },
                { id: 'explain', label: T.tabExplain, html: feynmanSelfTestHtml },
            ].filter(Boolean);
            // Recall / Dictation have no panel: their tab opens the exercise in place of the card
            const panels = tabs.filter(t => !t.dictation);
            const bodyHtml = `
                <div class="card-tabs-bar" role="tablist">
                    ${tabs.map((t, i) => `
                        <button class="card-tab-btn ${i === 0 ? 'active' : ''}" data-tab="${t.id}" type="button" role="tab" aria-selected="${i === 0}"${t.dictation ? ` data-dictation-mode="${t.dictation}" title="${escapeHtml(t.title)}"` : ` aria-controls="card-panel-${idx}-${t.id}"`}>${t.label}</button>
                    `).join('')}
                </div>
                ${panels.map((t, i) => `
                    <div class="card-tab-panel ${i === 0 ? 'active' : ''}" id="card-panel-${idx}-${t.id}" data-panel="${t.id}" role="tabpanel" ${i === 0 ? '' : 'hidden'}>${t.html}</div>
                `).join('')}
            `;
            card.innerHTML = headHtml + `<div class="sentence-body" id="sentence-body-${idx}" ${open ? '' : 'hidden'}>${bodyHtml}</div>`;
            if (window.FrenchDictation) {
                dictationDataByCard.set(card, {
                    sentence: sentenceText,
                    translationEn: transEn,
                    translationZh: transZh,
                    // Steps only where the Steps tab shows them
                    steps: hasValidBuildup ? s.build_up : [],
                    voice: frenchVoiceFor(sentenceText),
                    index: idx,
                    total: sentences.length,
                    tabs: tabs.map(t => ({ id: t.id, label: t.label, mode: t.dictation || '' })),
                });
            }

            sentencesContainer.appendChild(card);
            attachSentenceCardEvents(card, sentenceText, transZh, transEn);
            bindDictationEntry(card);
            bindStructureBar(card, s.structure);
        });

        refreshIcons();
        refreshSrsStates(sentences);
        prefetchSentenceAudio(sentences);
    }

    // Pre-generate sentence and build-up audio so the first click plays immediately
    let audioPrefetchRun = 0;
    async function prefetchSentenceAudio(sentences) {
        const run = ++audioPrefetchRun;
        const texts = [];
        sentences.forEach(s => {
            [s.sentence || s.original, ...((s.build_up || []).map(step => step.fr))].forEach(t => {
                const clean = (t || '').trim();
                if (clean && clean.length <= 600 && !texts.includes(clean)) texts.push(clean);
            });
        });
        const worker = async () => {
            while (texts.length && run === audioPrefetchRun) {
                const text = texts.shift();
                try {
                    await fetch(`/tts?text=${encodeURIComponent(text)}&voice=${frenchVoiceFor(text)}`);
                } catch (_) { /* best effort */ }
            }
        };
        await Promise.all([worker(), worker()]);
    }

    const canRecordAudio = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    // Record speech, transcribe it on the server (Whisper), show it right away, then
    // swap in the version where an LLM fixed only the mis-heard French words.
    function attachServerDictation(button, field, sentence, statusEl) {
        const label = button.querySelector('.dictation-label');
        const idleText = label ? label.textContent : '';
        let recorder = null;
        let stopTimer = null;
        const setLabel = (text) => { if (label) label.textContent = text; };
        const setStatus = (text, isError = false) => {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.classList.toggle('is-error', isError);
        };

        // The whole analysed passage (other sentences first, this one excluded) as extra reference
        function passageContext() {
            const others = Array.from(document.querySelectorAll('.btn-sentence-save'))
                .map(btn => btn.dataset.sentence)
                .filter(text => text && text !== sentence);
            return others.join(' ').slice(-1800);
        }

        async function transcribe(blob) {
            button.disabled = true;
            setLabel(T.transcribing);
            setStatus('');
            try {
                const token = localStorage.getItem(userTokenKey);
                if (!token) {
                    openAuthModal();
                    throw new Error(T.dictationLogin);
                }
                const context = passageContext();
                const res = await fetch(`/api/transcribe?sentence=${encodeURIComponent(sentence)}&context=${encodeURIComponent(context)}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
                    body: blob,
                });
                const data = await readJsonSafely(res);
                if (!res.ok) throw new Error(data.detail?.message || T.transcribeFailed(res.status));
                const heard = (data.text || '').trim();
                if (!heard) {
                    setStatus(T.notHeard, true);
                    return;
                }
                const before = field.value.trim();
                field.value = before ? `${before} ${heard}` : heard;
                setLabel(T.fixingWords);
                setStatus(T.fixingStatus);
                const fixRes = await fetch('/api/transcribe/fix', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${requireAuthToken()}` },
                    body: JSON.stringify({ sentence, context, text: heard, model: modelSelect.value }),
                });
                const fixed = fixRes.ok ? ((await readJsonSafely(fixRes)).text || '').trim() : '';
                if (fixed && fixed !== heard && field.value.includes(heard)) {
                    field.value = field.value.replace(heard, fixed);
                    setStatus(T.fixedStatus);
                } else {
                    setStatus('');
                }
            } catch (err) {
                setStatus(err.message, true);
            } finally {
                button.disabled = false;
                setLabel(idleText);
            }
        }

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (recorder) {
                recorder.stop();
                return;
            }
            stopAllAudio();
            stopAnyOngoingRecording();
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (window.FrenchGame) window.FrenchGame.setLane('speaking');
            } catch (err) {
                setStatus(`${T.micError}${err.message}`, true);
                return;
            }
            const chunks = [];
            const rec = new MediaRecorder(stream);
            rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
            rec.onstop = () => {
                clearTimeout(stopTimer);
                stream.getTracks().forEach(track => track.stop());
                recorder = null;
                button.classList.remove('recording');
                transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
            };
            rec.start();
            recorder = rec;
            button.classList.add('recording');
            setLabel(T.doneSpeaking);
            setStatus('');
            stopTimer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 120000);
        });
    }

    function renderFeynmanFeedback(fb) {
        const verdictText = { solid: T.verdictSolid, partial: T.verdictPartial, missing: T.verdictMissing }[fb.verdict] || '';
        const list = (items, cls, mark) => items && items.length
            ? `<ul class="${cls}">${items.map(t => `<li><span class="fb-mark">${mark}</span>${escapeHtml(t)}</li>`).join('')}</ul>`
            : '';
        let variationHtml = '';
        if (fb.variation) {
            variationHtml = fb.variation.ok
                ? `<p class="fb-variation ok">${T.variationOk(fb.variation.note ? escapeHtml(fb.variation.note) : '')}</p>`
                : `<p class="fb-variation fix">${T.variationFix}<strong>${escapeHtml(fb.variation.corrected)}</strong>${fb.variation.note ? '<br>' + escapeHtml(fb.variation.note) : ''}</p>`;
        }
        return `
            <p class="fb-verdict verdict-${escapeHtml(fb.verdict)}">${verdictText}</p>
            ${list(fb.got_right, 'fb-right', '✓')}
            ${list(fb.gaps, 'fb-gaps', '△')}
            ${variationHtml}
            ${fb.follow_up ? `<p class="fb-followup"><strong>${T.followUp}</strong>${escapeHtml(fb.follow_up)}<span class="fb-followup-hint">${T.followUpHint}</span></p>` : ''}
        `;
    }

    function isPlainEnter(e) {
        return e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229;
    }

    function bindFeynmanSelfTest(root, sentence) {
        const input = root.querySelector('.feynman-input');
        const variationInput = root.querySelector('.feynman-variation');
        const checkBtn = root.querySelector('.btn-feynman-check');
        const micBtn = root.querySelector('.btn-feynman-mic');
        const feedback = root.querySelector('.feynman-feedback');
        const askForm = root.querySelector('.ask-row');
        const askInput = root.querySelector('.ask-input');
        const askThread = root.querySelector('.ask-thread');
        const askHistory = []; // [{role: 'learner' | 'tutor', content}]
        [input, variationInput, askInput].forEach(el => el.addEventListener('click', e => e.stopPropagation()));
        [input, variationInput].forEach(el => el.addEventListener('keydown', (e) => {
            if (isPlainEnter(e)) {
                e.preventDefault();
                if (!checkBtn.disabled) checkBtn.click();
            }
        }));

        function contextPayload() {
            const ctx = sentenceContextByKey.get(srsSentenceKey(sentence)) || {};
            return {
                sentence,
                translation_zh: ctx.translation_zh || '',
                grammar_points: (ctx.grammar || []).map(g => ({ title: g.title, explanation: g.explanation })),
                model: modelSelect.value,
            };
        }

        function apiError(data) {
            const detail = Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('；') : (data.detail?.message || data.detail);
            return new Error(detail || T.requestFailedGeneric);
        }

        function addBubble(role, text) {
            const bubble = document.createElement('div');
            bubble.className = `ask-bubble ask-${role}`;
            bubble.textContent = text;
            askThread.appendChild(bubble);
            return bubble;
        }

        // A tutor answer worth keeping becomes a grammar card (the same kind as in the Grammar tab)
        function askSaveButton(question, answer) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ask-save';
            btn.title = T.askSaveTitle;
            btn.textContent = T.askSave;
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                btn.disabled = true;
                btn.textContent = T.askSaving;
                const ctx = sentenceContextByKey.get(srsSentenceKey(sentence)) || {};
                try {
                    rememberNote(await srsApi('POST', '/api/ask/card', {
                        sentence,
                        translation_zh: ctx.translation_zh || '',
                        translation_en: ctx.translation_en || '',
                        question,
                        answer,
                        model: modelSelect.value,
                    }));
                    btn.textContent = T.askSaved;
                    btn.classList.add('is-saved');
                    refreshDueBadge();
                } catch (err) {
                    btn.disabled = false;
                    btn.textContent = T.askSave;
                    showSrsError(err);
                }
            });
            return btn;
        }

        askForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const question = askInput.value.trim();
            if (!question) return;
            askInput.value = '';
            addBubble('learner', question);
            const pending = addBubble('tutor', '…');
            pending.classList.add('is-pending');
            const askButton = askForm.querySelector('button[type="submit"]');
            askButton.disabled = true;
            try {
                const res = await fetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${requireAuthToken()}` },
                    body: JSON.stringify({ ...contextPayload(), history: askHistory.slice(-12), question }),
                });
                const data = await readJsonSafely(res);
                if (!res.ok) throw apiError(data);
                pending.textContent = data.answer;
                askHistory.push({ role: 'learner', content: question }, { role: 'tutor', content: data.answer });
                pending.after(askSaveButton(question, data.answer));
            } catch (err) {
                pending.textContent = err.message;
                pending.classList.add('is-error');
            } finally {
                pending.classList.remove('is-pending');
                askButton.disabled = false;
                askInput.focus();
            }
        });

        const dictationStatus = root.querySelector('.dictation-status');
        if (micBtn) attachServerDictation(micBtn, input, sentence, dictationStatus);
        const askMicBtn = root.querySelector('.btn-ask-mic');
        if (askMicBtn) attachServerDictation(askMicBtn, askInput, sentence, dictationStatus);

        checkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const explanation = input.value.trim();
            if (!explanation) {
                input.focus();
                input.placeholder = T.feynmanEmpty;
                return;
            }
            checkBtn.disabled = true;
            feedback.hidden = false;
            feedback.innerHTML = `<p class="fb-loading">${T.feynmanLoading}</p>`;
            try {
                const res = await fetch('/api/feynman', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${requireAuthToken()}` },
                    body: JSON.stringify({
                        ...contextPayload(),
                        explanation,
                        variation: variationInput.value.trim(),
                    }),
                });
                const data = await readJsonSafely(res);
                if (!res.ok) throw apiError(data);
                feedback.innerHTML = renderFeynmanFeedback(data);
                // Let the ask box know what the tutor asked, so the learner can answer it there.
                askHistory.push({ role: 'learner', content: `My explanation: ${explanation}` });
                askHistory.push({ role: 'tutor', content: [
                    ...(data.gaps || []).map(g => `Gap: ${g}`),
                    data.follow_up ? `Question for you: ${data.follow_up}` : '',
                ].filter(Boolean).join('\n') || 'Feedback given.' });
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
                if (btn.dataset.dictationMode) return;  // Recall / Dictation: bindDictationEntry opens the exercise
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

        // Open / close a sentence: the whole header toggles it (buttons and, when open,
        // the French words keep their own actions; a text selection is not a click)
        const head = card.querySelector('.sentence-head');
        const toggle = card.querySelector('.sentence-toggle');
        const body = card.querySelector('.sentence-body');
        if (head && toggle && body) {
            const setOpen = (open) => {
                card.classList.toggle('is-open', open);
                body.hidden = !open;
                toggle.setAttribute('aria-expanded', String(open));
                toggle.title = open ? T.hideBreakdown : T.showBreakdown;
                toggle.setAttribute('aria-label', toggle.title);
                if (open) refreshIcons();
            };
            head.addEventListener('click', (e) => {
                if (e.target.closest('button:not(.sentence-toggle), a')) return;
                // On a phone the buttons have their own row under the sentence (study.css): a
                // near miss between them must not close the card
                if (e.target.closest('.sentence-head-actions') && window.matchMedia?.('(max-width: 640px)').matches) return;
                if (wordAtTap(e)) return;
                // The end of a drag or a selection is not a click on the row
                if (!window.FrenchReadSelection.isTap(e)) return;
                setOpen(!card.classList.contains('is-open'));
            });
        }

        // 0. Interactive Word & Token Click Delegation
        card.addEventListener('click', (e) => {
            const interactiveWord = wordAtTap(e);
            if (interactiveWord) {
                e.stopPropagation();
                const word = interactiveWord.dataset.word || interactiveWord.dataset.token || interactiveWord.textContent.trim();
                showPopoverForElement(word, interactiveWord, {
                    ...sentenceContextFor(interactiveWord),
                    sentence: sentenceContextFor(interactiveWord).sentence || targetSentence,
                    sentence_cn: transCn
                });
                return;
            }
            const tokenWord = e.target.closest('.token-word');
            if (tokenWord && window.FrenchReadSelection.isTap(e)) {
                e.stopPropagation();
                const word = tokenWord.textContent.trim();
                showPopoverForElement(word, tokenWord, {
                    sentence: targetSentence,
                    sentence_cn: transCn
                });
                return;
            }
            const glossWord = e.target.closest(GLOSS_TAP_SELECTOR);
            if (glossWord) {
                if (!window.FrenchReadSelection.isTap(e)) return;
                e.stopPropagation();
                const word = glossWord.matches('.buildup-new-token') ? chunkSpeechText(glossWord.textContent) : glossWord.textContent.trim();
                // The popover takes up to 40 characters; a longer chunk is just read aloud
                if (word.length > 40) { playFrenchSpeech(word, null, { once: true }); return; }
                showPopoverForElement(word, glossWord, {
                    sentence: targetSentence,
                    sentence_cn: transCn
                });
            }
        });

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const interactiveWord = e.target.closest('.interactive-word');
                if (interactiveWord) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (interactiveWord.closest('.buildup-steps-list.is-blind-mode')) { interactiveWord.click(); return; }
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

        // 1b. Sentence Repeat: switching it on loops this sentence right away (off stops the loop)
        const headRepeatBtn = card.querySelector('.btn-head-repeat');
        if (headRepeatBtn) headRepeatBtn.addEventListener('click', () => {
            setTimeout(() => {
                if (window.FrenchPlayback && window.FrenchPlayback.repeat()) playFrenchSpeech(targetSentence);
            }, 0);
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

        card.querySelectorAll('.btn-grammar-card').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleGrammarCard(btn);
            });
        });

        // 3c. Function words stay behind one toggle under the word list
        card.querySelectorAll('.small-words-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const list = btn.nextElementSibling;
                const open = list.hidden;
                list.hidden = !open;
                btn.setAttribute('aria-expanded', String(open));
                btn.querySelector('.small-words-action').textContent = open ? T.collapseDetails : T.expandDetails;
            });
        });

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
            let stopResolve = null;  // resolves with the recorded blob once the recorder has stopped

            let isModelPlaying = false;
            let isUserPlaying = false;

            const modelLabel = (playModelBtn && playModelBtn.dataset.label) || (isCompact ? T.modelReading : T.modelReadingFull);

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
                    playUserBtn.innerHTML = `<i data-lucide="play"></i><span>${T.myRecording}</span>`;
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
                    playModelBtn.innerHTML = `<i data-lucide="square"></i><span>${T.stop}</span>`;
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
                    playUserBtn.innerHTML = `<i data-lucide="square"></i><span>${T.stop}</span>`;
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
                    window.FrenchAudio.bind(userAudio, handleUserAudioEnd);

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
                    if (window.FrenchGame) window.FrenchGame.setLane('speaking');
                    mediaRecorder = new MediaRecorder(stream);
                    mediaRecorder.ondataavailable = (e) => {
                        if (e.data.size > 0) audioChunks.push(e.data);
                    };
                    const recorderForStop = mediaRecorder;
                    mediaRecorder.onstop = () => {
                        // Safari records audio/mp4, Chrome audio/webm: keep the real type
                        const audioBlob = new Blob(audioChunks, { type: recorderForStop.mimeType || 'audio/webm' });
                        if (stopResolve) { stopResolve(audioBlob); stopResolve = null; }
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
                        recordBtnText.textContent = isCompact ? T.stopAndScoreShort : T.stopAndScore;
                    }
                } catch (err) {
                    alert(T.micUnavailable + err.message);
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
                    recordBtnText.textContent = T.shadowAgain;
                }

                const stopped = new Promise(resolve => { stopResolve = resolve; });
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                } else if (stopResolve) {
                    stopResolve(null);
                    stopResolve = null;
                }

                if (recognition) {
                    try {
                        recognition.stop();
                    } catch (e) {}
                }

                finishAndScore(stopped);
            }

            // The browser's speech recognition gives nothing on iPhone Safari (it cannot share the
            // microphone with the recorder): then the recording itself is transcribed on the server.
            // Without a transcript there is no score, only a clear message (never a fake 0).
            async function finishAndScore(stopped) {
                const blob = await Promise.race([stopped, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
                await new Promise(resolve => setTimeout(resolve, 500));  // late recognition results
                let transcript = recognitionTranscript.trim();
                if (!transcript) {
                    if (!blob || blob.size < 1000) {
                        showScoreError(T.scoreNoAudio);
                        return;
                    }
                    recordBtn.disabled = true;
                    if (recordBtnText) recordBtnText.textContent = T.scoreTranscribing;
                    try {
                        const token = getEffectiveAuthToken();
                        if (!token) {
                            openAuthModal();
                            throw new Error(T.dictationLogin);
                        }
                        const res = await fetch('/api/transcribe?language=fr', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'application/octet-stream' },
                            body: blob,
                        });
                        const data = await readJsonSafely(res);
                        if (!res.ok) throw new Error(data.detail?.message || T.transcribeFailed(res.status));
                        transcript = (data.text || '').trim();
                    } catch (err) {
                        showScoreError(`${T.scoreFailed}${err.message}`);
                        return;
                    } finally {
                        recordBtn.disabled = false;
                        if (recordBtnText) recordBtnText.textContent = T.shadowAgain;
                    }
                    if (!transcript) {
                        showScoreError(T.noClearSpeech);
                        return;
                    }
                }
                evaluateAndDisplay(transcript);
            }

            function showScoreError(message) {
                if (scorePill) {
                    scorePill.textContent = '—';
                    scorePill.className = `score-number-pill ${isCompact ? 'sm' : ''}`;
                }
                if (scoreRatingText) scoreRatingText.textContent = T.scoreNotScored;
                if (metricAcc) metricAcc.textContent = '--%';
                if (metricComp) metricComp.textContent = '--%';
                if (diffBox) {
                    diffBox.innerHTML = '';
                    diffBox.textContent = message;
                }
                scoreCard.hidden = false;
                refreshIcons();
            }

            function evaluateAndDisplay(transcript) {
                const evaluation = evaluateFrenchPronunciation(sentenceText, transcript);

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
                            wordSpan.title = T.diffWordTitle(item.score);
                            diffBox.appendChild(wordSpan);
                            diffBox.appendChild(document.createTextNode(' '));
                        });
                    } else {
                        diffBox.textContent = transcript || T.noClearSpeech;
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
            const feynmanToggles = buildupSection.querySelectorAll('.btn-feynman-toggle[data-mode]');
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
                            revealAllBtn.textContent = T.revealAll;
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
                        revealAllBtn.textContent = T.revealAll;
                    } else {
                        allTokens.forEach(t => t.classList.add('revealed'));
                        allStepRows.forEach(r => r.classList.add('step-revealed'));
                        revealAllBtn.dataset.revealed = 'true';
                        revealAllBtn.textContent = T.hideAgain;
                    }
                });
            }

            // Click individual cloze token to reveal/re-mask (outside blind mode a chunk opens
            // the word popover instead, via the card click delegation)
            if (stepsList) {
                stepsList.addEventListener('click', (e) => {
                    if (!stepsList.classList.contains('is-blind-mode')) return;

                    const token = e.target.closest('.buildup-new-token');
                    if (token) {
                        e.stopPropagation();
                        token.classList.toggle('revealed');
                        return;
                    }

                    const firstRowText = e.target.closest('.buildup-step-row:first-child .buildup-fr-text');
                    if (firstRowText) {
                        e.stopPropagation();
                        const firstRow = firstRowText.closest('.buildup-step-row');
                        if (firstRow) firstRow.classList.toggle('step-revealed');
                    }
                });
            }
        }
    }
    window.renderStudyDeck = renderStudyDeck;

    // Dictation exercises (static/dictation.js). The card's French is detached while one is open.
    const dictationDataByCard = new WeakMap();
    const dictationAudioOwner = {};
    const dictation = window.FrenchDictation ? window.FrenchDictation.create({
        escapeHtml,
        getToken: () => getEffectiveAuthToken() || '',
        refreshIcons,
        stopAudio: stopAllAudio,
        play(text, options) {
            stopAllAudio();
            playClip(text, () => {}, () => {}, dictationAudioOwner, options);
        },
        // Left with another tab of the exercise's tab row: show that tab; "Back" keeps the tab it left from
        onExit(card, tabId) {
            const tabs = Array.from(card.querySelectorAll('.card-tab-btn'));
            const tab = tabs.find(b => b.dataset.tab === tabId && !b.dataset.dictationMode);
            if (tab) tab.click();
            const active = tab || tabs.find(b => b.classList.contains('active'));
            if (!active) return;
            active.focus({ preventScroll: true });
            window.FrenchDictation.revealTab(active);
        },
    }) : null;

    function bindDictationEntry(card) {
        const data = dictationDataByCard.get(card);
        if (!dictation || !data) return;
        card.querySelectorAll('[data-dictation-mode]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                dictation.open(card, data, btn.dataset.dictationMode);
            });
        });
    }


    // What a highlighted chunk should sound like: its words, without the punctuation around it
    function chunkSpeechText(text) {
        return (text || '').replace(/\s+/g, ' ').replace(/^[\s«"“(]+|[\s.,;:!?…»"”)]+$/g, '').trim();
    }
    window.chunkSpeechText = chunkSpeechText;

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
    // 6. User Account (login; sign-up needs an invite code while registration is closed)
    // -------------------------------------------------------------------------
    const userTokenKey = 'frenchStudio.userToken';
    let currentAuthTab = 'login';
    let currentAuthUser = null;

    function openAuthModal() {
        if (authErrorMsg) authErrorMsg.hidden = true;
        if (currentAuthUser) {
            if (authFormContainer) authFormContainer.hidden = true;
            if (authUserProfile) authUserProfile.hidden = false;
            loadDevices();
            loadStudyTime();
        } else {
            if (authFormContainer) authFormContainer.hidden = false;
            if (authUserProfile) authUserProfile.hidden = true;
            switchAuthTab(currentAuthTab);
        }
        if (authModal) authModal.hidden = false;
        refreshIcons();
    }

    // Study time under the email: today / this week (Monday, America/Vancouver) / all time
    function formatStudyTime(seconds) {
        const minutes = Math.floor((Number(seconds) || 0) / 60);
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    }

    // Progress toward 1000 hours: total, what is left, and the finish date at the last 4 weeks' pace
    function renderGoal(data) {
        const box = document.getElementById('profile-goal');
        if (!box || typeof data.goal_hours !== 'number') return;
        const hours = (seconds) => Math.round((Number(seconds) || 0) / 360) / 10;
        const total = hours(data.total_seconds);
        document.getElementById('goal-hours').textContent = `${total} / ${data.goal_hours} h`;
        document.getElementById('goal-percent').textContent = `${Math.round(data.progress * 1000) / 10}%`;
        const bar = document.getElementById('goal-bar');
        bar.style.width = `${Math.max(data.progress > 0 ? 1 : 0, data.progress * 100)}%`;
        bar.parentElement.setAttribute('aria-valuenow', String(total));
        const left = hours(data.remaining_seconds);
        const avg = hours(data.average_week_seconds);
        document.getElementById('goal-detail').textContent = !data.remaining_seconds ? T.goalDone
            : data.projected_finish ? T.goalDetail(left, avg, data.projected_finish) : T.goalNoPace(left);
        box.hidden = false;
    }

    async function loadStudyTime() {
        const token = localStorage.getItem(userTokenKey);
        const panel = document.getElementById('profile-study');
        if (!panel || !token) return;
        try {
            const res = await fetch('/api/game/study-time', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;
            const data = await res.json();
            document.getElementById('study-today').textContent = formatStudyTime(data.today_seconds);
            document.getElementById('study-week').textContent = formatStudyTime(data.week_seconds);
            document.getElementById('study-total').textContent = formatStudyTime(data.total_seconds);
            panel.hidden = false;
            renderGoal(data);
        } catch (e) {
            console.warn('Load study time failed:', e);
        }
    }

    // Signed-in devices: the account allows a few; any other one can be signed out from here
    async function loadDevices() {
        const token = localStorage.getItem(userTokenKey);
        if (!profileDeviceList || !token) return;
        try {
            const res = await fetch('/api/auth/devices', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return;
            const data = await res.json();
            profileDeviceList.innerHTML = '';
            data.devices.forEach((device) => {
                const item = document.createElement('li');
                const label = document.createElement('div');
                const name = document.createElement('span');
                name.textContent = device.device;
                const meta = document.createElement('span');
                meta.className = 'device-meta';
                meta.textContent = device.current
                    ? T.thisDevice
                    : T.lastActive(new Date(device.last_seen_at + 'Z').toLocaleString());
                label.append(name, meta);
                item.appendChild(label);
                if (!device.current) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'btn btn-secondary';
                    button.textContent = T.signOutDevice;
                    button.addEventListener('click', async () => {
                        button.disabled = true;
                        await fetch(`/api/auth/devices/${encodeURIComponent(device.id)}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` },
                        }).catch(() => {});
                        loadDevices();
                    });
                    item.appendChild(button);
                }
                profileDeviceList.appendChild(item);
            });
        } catch (e) {
            console.warn('Load devices failed:', e);
        }
    }

    function closeAuthModal() {
        if (authModal) authModal.hidden = true;
    }

    function switchAuthTab(tab) {
        currentAuthTab = tab;
        const registering = tab === 'register';
        if (authErrorMsg) authErrorMsg.hidden = true;
        if (authSubmitLabel) authSubmitLabel.textContent = registering ? T.register : T.login;
        if (authModalTitle) authModalTitle.textContent = registering ? T.registerTitle : T.authTitle;
        if (authTabNotice) authTabNotice.textContent = registering ? T.registerNotice : T.authNotice;
        if (authInviteField) authInviteField.hidden = !registering;
        if (authSwitchBtn) authSwitchBtn.textContent = registering ? T.haveAccount : T.haveInvite;
        if (authPasswordInput) authPasswordInput.autocomplete = registering ? 'new-password' : 'current-password';
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
                const data = await readJsonSafely(res);
                localStorage.removeItem(userTokenKey);
                updateAuthUI(null);
                if (data.detail?.code === 'session_revoked') {
                    statusMessage.className = 'status-message status-error';
                    statusMessage.textContent = T.signedOutElsewhere;
                }
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
            if (userAuthBtn) {
                userAuthBtn.classList.add('is-signed-in');
                userAuthBtn.title = user.email;
            }
            if (userTrialBadge) {
                userTrialBadge.textContent = T.daysLeftShort(user.days_left);
                userTrialBadge.hidden = user.plan === 'pro';
            }
            if (profileEmail) profileEmail.textContent = user.email;
            if (profileBadge) profileBadge.textContent = user.plan === 'pro' ? T.planPro : T.daysLeft(user.days_left);
        } else {
            currentAuthUser = null;
            if (userAuthStatusText) userAuthStatusText.textContent = T.login;
            if (userAuthBtn) {
                userAuthBtn.classList.remove('is-signed-in');
                userAuthBtn.title = T.account;
            }
            if (userTrialBadge) userTrialBadge.hidden = true;
        }
        refreshIcons();
    }

    async function handleAuthSubmit(e) {
        e.preventDefault();
        const email = authEmailInput ? authEmailInput.value.trim() : '';
        const password = authPasswordInput ? authPasswordInput.value.trim() : '';
        if (!email || !password) return;
        const registering = currentAuthTab === 'register';
        const inviteCode = authInviteInput ? authInviteInput.value.trim() : '';
        if (registering && !inviteCode) {
            if (authErrorMsg) {
                authErrorMsg.textContent = T.needInvite;
                authErrorMsg.hidden = false;
            }
            return;
        }

        if (authErrorMsg) authErrorMsg.hidden = true;
        if (authSubmitBtn) authSubmitBtn.disabled = true;

        const endpoint = registering ? '/api/auth/register' : '/api/auth/login';
        const payload = registering ? { email, password, invite_code: inviteCode } : { email, password };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await readJsonSafely(res);
            if (!res.ok) {
                throw new Error(data.detail?.message || data.detail || T.operationFailed);
            }

            localStorage.setItem(userTokenKey, data.token);
            updateAuthUI(data.user);
            closeAuthModal();
            refreshDueBadge();
            loadSavedWords();
            const renderedSentences = Array.from(document.querySelectorAll('.btn-sentence-save'))
                .map(btn => ({ sentence: btn.dataset.sentence }));
            refreshSrsStates(renderedSentences);
            statusMessage.className = 'status-message status-success';
            statusMessage.textContent = registering ? T.registerSuccess : T.loginSuccess;
            if (registering) switchAuthTab('login');
            // Sent here from /write or /speak after a 401: go back (same-origin paths only)
            const nextPath = new URLSearchParams(window.location.search).get('next');
            if (nextPath && /^\/[A-Za-z]/.test(nextPath)) window.location.href = nextPath;
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
        fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        srsNotesByKey.clear();
        wordBook.clear();
        updateTableStarStates();
        refreshDueBadge();
        updateAuthUI(null);
        closeAuthModal();
        statusMessage.className = 'status-message status-info';
        statusMessage.textContent = T.loggedOut;
    }

    // -------------------------------------------------------------------------
    // 7. Query History Manager (Unified via FrenchHistory)
    // -------------------------------------------------------------------------
    function saveHistoryItem(text, sentences) {
        if (!text || !sentences || sentences.length === 0) return;
        if (window.FrenchHistory) {
            window.FrenchHistory.saveStudyRecord(text, sentences, modelSelect ? modelSelect.value : '');
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
    const formatFriendlyPhonetic = window.SpeechEval.formatFriendlyPhonetic;


    function renderInteractiveWordsHtml(text) {
        if (!text) return '';
        // Match French words including internal apostrophes (e.g. n'autorisent, d'accord, l'homme, c'est)
        // Numbers, ordinals and times (2026, 1er, 3e, 15h30, 3,5) are clickable too
        const regex = /(aujourd['’]hui|[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)?['’]?|\d+(?:[.,:]\d+)*(?:h\d{0,2})?(?:ère|ere|er|re|ème|eme|e)?|[^\sA-Za-zÀ-ÖØ-öø-ÿŒœ\d]+|\s+)/gi;
        const tokens = text.match(regex) || [text];
        return tokens.map((token, i) => {
            if (/^[A-Za-zÀ-ÖØ-öø-ÿŒœ\d]/i.test(token)) {
                const clean = token.replace(/['’]$/, '').trim() || token.trim();
                // Punctuation stuck to the word ("enfants,") is part of its tap target
                const next = tokens[i + 1];
                const tail = next && !/^[\sA-Za-zÀ-ÖØ-öø-ÿŒœ\d]/i.test(next) ? next : '';
                return `<span class="interactive-word" lang="fr" role="button" tabindex="0" data-word="${escapeHtml(clean)}" data-token="${escapeHtml(token.trim())}" title="${escapeHtml(clean)}${T.wordTitleSuffix}">${escapeHtml(token + tail)}</span>`;
            }
            // Already inside the span of the word before it
            if (i > 0 && !/^[\sA-Za-zÀ-ÖØ-öø-ÿŒœ\d]/i.test(token) && /^[A-Za-zÀ-ÖØ-öø-ÿŒœ\d]/i.test(tokens[i - 1])) return '';
            return escapeHtml(token);
        }).join('');
    }
    window.renderInteractiveWordsHtml = renderInteractiveWordsHtml;

    // The word a click means. A tap that lands on the French line but not on a word (between two
    // words, on a comma, a few pixels off the glyphs) still belongs to the nearest word on that
    // line, so it can never fall through to the open/close handler of the sentence row. Taps far
    // from every word (the empty end of a line) and clicks without a position (a keyboard
    // Enter on a button) are left alone. So is blind mode: there a nearby tap must not read out
    // a word that is still hidden.
    const WORD_TAP_SLOP = 22;  // half of the 44px minimum touch size
    function wordAtTap(e) {
        // A drag is not a tap. A painted selection used to make isTap false and block every word
        // lookup while the Read/Meaning bar was up — a direct hit on another word must still open it.
        if (window.FrenchReadSelection.isDrag && window.FrenchReadSelection.isDrag(e)) return null;
        const direct = e.target.closest('.interactive-word');
        if (direct) {
            if (window.FrenchReadSelection.dismiss) window.FrenchReadSelection.dismiss();
            return direct;
        }
        if (!window.FrenchReadSelection.isTap(e)) return null;
        const line = e.target.closest('.sentence-french-text, .buildup-fr-text');
        if (!line || e.detail === 0 || line.closest('.is-blind-mode') || e.target.closest('button, a')) return null;
        return window.FrenchWordPopover.nearestElement(line.querySelectorAll('.interactive-word'), e.clientX, e.clientY, WORD_TAP_SLOP);
    }


    // -------------------------------------------------------------------------
    // 9. Text Analysis Request
    // -------------------------------------------------------------------------
    // Sentences (or lines), with very short ones kept together, up to ~90 characters a part
    function splitForAnalysis(text) {
        // Never split inside « … » (French puts a space before the closing mark)
        const sentences = text.split(/(?<=[.!?…]["»”)]?)\s+(?![»”])|\n+/).map(s => s.trim()).filter(Boolean)
            .reduce((list, s) => {
                // "A." on its own line labels the answer after it
                const last = list[list.length - 1];
                if (last && OPTION_LABEL.test(last)) list[list.length - 1] = `${last} ${s}`;
                else list.push(s);
                return list;
            }, []);
        const parts = [];
        sentences.forEach(sentence => {
            const last = parts[parts.length - 1];
            // A line break keeps a title from running into the next sentence
            if (last && last.length + sentence.length < 90) parts[parts.length - 1] = `${last}\n${sentence}`;
            else parts.push(sentence);
        });
        return parts.length ? parts : [text];
    }

    async function analyzePartOnce(text, token, model, signal) {
        const res = await fetch('/api/analyze', {
            signal,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ text, model }),
        });
        const data = await readJsonSafely(res);
        if (!res.ok) {
            const err = new Error(data.detail?.message || data.detail || T.analyzeFailed);
            err.status = res.status;
            throw err;
        }
        return data.sentences || [];
    }

    // A pasted lesson is often Chinese markdown with French examples in it. The server pulls
    // out the French lines; a pure French paste comes back unchanged with no AI call. Any
    // failure here is not fatal: the original text is analysed as before.
    async function cleanInputForAnalysis(text, token, signal) {
        try {
            const res = await fetch('/api/clean-input', {
                signal,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ text }),
            });
            if (!res.ok) return null;
            const data = await readJsonSafely(res);
            if (!data || !data.changed || typeof data.cleaned !== 'string' || !data.cleaned.trim()) return null;
            return { cleaned: data.cleaned, count: Number(data.count) || 0, accentFixes: data.accent_fixes || [] };
        } catch (_) {
            return null;
        }
    }

    // The tunnel sometimes turns one upstream stall into a 502/504. Retry those parts, but
    // never a 4xx (a bad request stays bad) and never after Cancel.
    const ANALYZE_RETRY_DELAYS = [1500, 4000];
    function retryableAnalyzeError(err, signal) {
        if (signal && signal.aborted) return false;
        if (!err || err.name === 'AbortError') return false;
        // No status means fetch itself failed: network error or timeout
        return err.status ? err.status >= 500 : true;
    }

    function waitForRetry(ms, signal) {
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('cancelled', 'AbortError'));
            };
            const timer = setTimeout(() => {
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    async function analyzePart(text, token, model, signal) {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await analyzePartOnce(text, token, model, signal);
            } catch (err) {
                const delayMs = ANALYZE_RETRY_DELAYS[attempt];
                if (delayMs === undefined || !retryableAnalyzeError(err, signal)) throw err;
                await waitForRetry(delayMs, signal);
            }
        }
    }

    // Enter can start an analysis by accident: a Cancel button (and Esc) stops it.
    let analysisController = null;
    let cancelAnalysisButton = null;
    function showCancelButton(show) {
        if (!cancelAnalysisButton) {
            cancelAnalysisButton = document.createElement('button');
            cancelAnalysisButton.id = 'cancel-analysis-btn';
            cancelAnalysisButton.type = 'button';
            cancelAnalysisButton.className = 'btn btn-secondary';
            cancelAnalysisButton.textContent = T.cancelAnalysis;
            cancelAnalysisButton.title = T.cancelAnalysisTitle;
            cancelAnalysisButton.addEventListener('click', cancelAnalysis);
        }
        // During a photo it sits in the step panel: on a phone the action row is off screen
        if (show && photoStep) photoStatus.append(cancelAnalysisButton);
        else if (show) analyzeButton.before(cancelAnalysisButton);
        cancelAnalysisButton.hidden = !show;
    }
    function cancelAnalysis() {
        if (analysisController) analysisController.abort();
    }

    async function startAnalysis() {
        if (analysisController) return;
        const text = frenchInput.value.trim();
        if (!text) {
            statusMessage.textContent = T.emptyInput;
            statusMessage.className = 'status-message status-error';
            frenchInput.focus();
            return;
        }

        const fromPhoto = photoStep !== null;
        try {
            hidePhotoStatus();
            const token = requireAuthToken();
            const model = modelSelect.value;

            analyzeButton.classList.add('is-loading');
            analyzeButton.disabled = true;
            photoButton.disabled = true;
            analyzeButtonLabel.textContent = T.analyzing;
            analysisController = new AbortController();
            const { signal } = analysisController;
            showCancelButton(true);
            statusMessage.className = 'status-message status-working';
            statusMessage.textContent = T.cleaningStatus;
            if (fromPhoto) setPhotoStep('analyze', T.cleaningStatus);

            // Markdown lessons with Chinese explanations are reduced to their French lines first
            const cleaned = await cleanInputForAnalysis(text, token, signal);
            if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
            const analysisText = cleaned ? cleaned.cleaned : text;
            const cleanNote = cleaned ? T.cleanedInput(cleaned.count) : '';
            const accentFixes = [...(fromPhoto ? photoAccentFixes : []), ...(cleaned ? cleaned.accentFixes : [])];

            // Short parts, two at a time: thinking models need ~30 s per sentence, and a
            // single request for a long text would hit the 100 s limit of the tunnel.
            const parts = splitForAnalysis(analysisText);
            const results = new Array(parts.length);
            const failedParts = [];
            let next = 0;
            let done = 0;
            const showProgress = () => {
                const progress = parts.length > 1 ? T.analyzingProgress(done, parts.length) : T.analyzingStatus;
                statusMessage.textContent = cleanNote ? `${cleanNote} ${progress}` : progress;
                if (fromPhoto) setPhotoStep('analyze', T.photoAnalyzing(Math.min(done + 1, parts.length), parts.length));
            };
            showProgress();
            const worker = async () => {
                while (next < parts.length && !signal.aborted) {
                    const index = next++;
                    try {
                        results[index] = await analyzePart(parts[index], token, model, signal);
                    } catch (err) {
                        // Cancel still stops everything; a part that failed twice is skipped so
                        // the rest of the text is still analysed and the progress keeps moving.
                        if (signal.aborted || err.name === 'AbortError') throw err;
                        failedParts.push(err);
                        results[index] = [];
                    }
                    done += 1;
                    showProgress();
                }
            };
            await Promise.all([worker(), worker()]);
            if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
            // Every part failing is a real failure, not a partial result
            if (failedParts.length === parts.length) throw failedParts[0];
            const sentences = withAccentNotes(results.flat(), accentFixes);

            renderStudyDeck(sentences);
            saveHistoryItem(analysisText, sentences);
            collapseInputPanel(analysisText);

            statusMessage.className = 'status-message status-success';
            const skipped = failedParts.length ? ` ${T.analyzeSkipped(failedParts.length, parts.length)}` : '';
            statusMessage.textContent = `${cleanNote ? cleanNote + ' ' : ''}${T.analyzeDone}${skipped}`;
            if (fromPhoto) finishPhotoStatus('success', `${T.photoAllDone(sentences.length)}${skipped}`);
        } catch (err) {
            if (analysisController && analysisController.signal.aborted) {
                // Nothing partial is rendered or saved; the text stays as typed
                statusMessage.className = 'status-message';
                statusMessage.textContent = T.analysisCancelled;
                focusFrenchInput();
                if (fromPhoto) finishPhotoStatus('cancelled', T.analysisCancelled);
            } else {
                statusMessage.className = 'status-message status-error';
                statusMessage.textContent = `${T.analyzeError}${err.message}`;
                if (fromPhoto) finishPhotoStatus('failed', T.photoStepFailed(T.photoSteps[photoStep], err.message));
            }
        } finally {
            analysisController = null;
            showCancelButton(false);
            analyzeButton.classList.remove('is-loading');
            analyzeButton.disabled = false;
            photoButton.disabled = false;
            analyzeButtonLabel.textContent = T.analyze;
        }
    }

    // Downscaled here first: a phone photo is far over the upload limit, and 1600 px keeps print legible
    const PHOTO_MAX_SIDE = 1600;
    async function photoToDataUrl(file, signal) {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error(T.photoUnreadable));
                signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
                img.src = url;
            });
            const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff';  // JPEG has no alpha: transparency would turn black
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.8);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // XMLHttpRequest because fetch cannot report upload progress. Resolves with the parts of
    // a fetch Response that readJsonSafely and the caller use.
    function uploadPhoto(image, token, signal, onProgress, onUploaded) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/photo-extract');
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.upload.onload = onUploaded;
            xhr.onload = () => resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                json: async () => JSON.parse(xhr.responseText),
            });
            xhr.onerror = () => reject(new Error(T.photoNetworkError));
            xhr.onabort = () => reject(new DOMException('cancelled', 'AbortError'));
            signal.addEventListener('abort', () => xhr.abort(), { once: true });
            xhr.send(JSON.stringify({ image }));
        });
    }

    // Step panel of the photo flow. photoStep is the running step, or null when no photo is
    // being processed. Steps are is-pending, is-current, is-done, is-failed or is-cancelled;
    // the panel is is-working, is-success, is-failed or is-cancelled.
    const PHOTO_STEPS = ['compress', 'upload', 'read', 'found', 'analyze'];
    let photoReadTimer = null;
    let photoAccentFixes = [];

    function photoStepItem(step) {
        return photoStatus.querySelector(`[data-step="${step}"]`);
    }

    // doneText replaces the label of the step being left
    function setPhotoStep(step, text, doneText) {
        clearInterval(photoReadTimer);
        if (doneText) photoStepItem(photoStep).textContent = doneText;
        photoStep = step;
        const current = PHOTO_STEPS.indexOf(step);
        PHOTO_STEPS.forEach((name, index) => {
            const state = index < current ? 'done' : index === current ? 'current' : 'pending';
            photoStepItem(name).className = `photo-step is-${state}`;
        });
        photoStepItem(step).textContent = text;
    }

    function startPhotoStatus() {
        PHOTO_STEPS.forEach((name) => {
            photoStepItem(name).textContent = T.photoSteps[name];
        });
        photoStatus.className = 'photo-status is-working';
        photoStatusResult.textContent = '';
        photoStatus.hidden = false;
        setPhotoStep('compress', T.photoCompressing);
    }

    function startPhotoReading() {
        const startedAt = Date.now();
        setPhotoStep('read', T.photoReading(0), T.photoUploaded);
        const item = photoStepItem('read');
        photoReadTimer = setInterval(() => {
            item.textContent = T.photoReading(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
    }

    function finishPhotoStatus(state, message) {
        clearInterval(photoReadTimer);
        const item = photoStepItem(photoStep);
        item.className = `photo-step is-${state === 'success' ? 'done' : state}`;
        item.textContent = T.photoSteps[photoStep];
        photoStep = null;
        photoStatus.className = `photo-status is-${state}`;
        photoStatusResult.textContent = message;
        // The panel carries the outcome: the status line below it would only repeat it
        statusMessage.className = 'status-message';
        statusMessage.textContent = '';
        photoStatus.scrollIntoView({ block: 'nearest' });
    }

    function hidePhotoStatus() {
        if (photoStep === null) photoStatus.hidden = true;
    }

    // The French lines from the photo then go through the same flow as pasted text
    async function startPhotoExtract(file) {
        if (analysisController) return;
        let extracted = false;
        try {
            const token = requireAuthToken();
            analysisController = new AbortController();
            const { signal } = analysisController;
            analyzeButton.disabled = true;
            photoButton.disabled = true;
            startPhotoStatus();
            showCancelButton(true);
            photoStatus.scrollIntoView({ block: 'nearest' });

            const image = await photoToDataUrl(file, signal);
            setPhotoStep('upload', T.photoUploading(0), T.photoSteps.compress);
            const res = await uploadPhoto(
                image, token, signal,
                (percent) => setPhotoStep('upload', T.photoUploading(percent)),
                startPhotoReading,
            );
            const data = await readJsonSafely(res);
            if (!res.ok) throw new Error(data.detail?.message || data.detail || T.photoFailed);
            setPhotoStep('found', T.photoFound(data.count), T.photoSteps.read);
            photoAccentFixes = (data.items || []).filter(item => item.accent_fixed_from);
            frenchInput.value = data.text;
            frenchInput.scrollTop = 0;
            updateFrenchInput();
            extracted = true;
        } catch (err) {
            if (analysisController && analysisController.signal.aborted) {
                finishPhotoStatus('cancelled', T.photoCancelled);
            } else if (photoStep) {
                finishPhotoStatus('failed', T.photoStepFailed(T.photoSteps[photoStep], err.message));
            } else {
                // Not signed in: no step has started and the login dialog is open
                statusMessage.className = 'status-message status-error';
                statusMessage.textContent = err.message;
            }
        } finally {
            analysisController = null;
            showCancelButton(false);
            analyzeButton.disabled = false;
            photoButton.disabled = false;
        }
        if (extracted) startAnalysis();
    }

    // -------------------------------------------------------------------------
    // 9. Event Bindings
    // -------------------------------------------------------------------------
    initSettings();

    // Enter starts the analysis; Shift+Enter adds a new line
    frenchInput.addEventListener('keydown', (e) => {
        if (isPlainEnter(e)) {
            e.preventDefault();
            if (!analyzeButton.disabled) startAnalysis();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && analysisController) {
            e.preventDefault();
            cancelAnalysis();
        }
    });

    // Textarea counter and height
    frenchInput.addEventListener('input', () => {
        updateFrenchInput();
        // The caret scroll stops short of the bottom padding, which leaves the top line cut
        if (frenchInput.selectionEnd === frenchInput.value.length) frenchInput.scrollTop = frenchInput.scrollHeight;
    });
    window.addEventListener('resize', fitFrenchInput);
    document.addEventListener('study:modechange', fitFrenchInput);
    fitFrenchInput();

    // Fill Example
    fillExampleButton.addEventListener('click', () => {
        setFrenchText("Elle comprend 40 questions portant sur des documents de la vie quotidienne et ayant des objectifs différents.");
        startAnalysis();
    });

    // Photo: no capture attribute, so iPhone offers both the camera and the library
    photoButton.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        const file = photoInput.files[0];
        photoInput.value = '';  // picking the same photo again must fire change
        if (file) startPhotoExtract(file);
    });

    // A pasted or dropped image takes the same path as the photo button
    const isImageItem = (item) => item.kind === 'file' && item.type.startsWith('image/');
    function imageFrom(transfer) {
        const file = [...transfer.files].find((f) => f.type.startsWith('image/'));
        if (file) return file;
        const item = [...transfer.items].find(isImageItem);
        return item ? item.getAsFile() : null;
    }

    frenchInput.addEventListener('paste', (e) => {
        if (e.clipboardData.getData('text/plain').trim()) return;
        const image = imageFrom(e.clipboardData);
        if (!image) return;
        e.preventDefault();
        startPhotoExtract(image);
    });

    // Only items are readable during a drag; files stay empty until the drop
    frenchInput.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.items].some(isImageItem)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        frenchInput.classList.add('is-drop-target');
    });
    frenchInput.addEventListener('dragleave', () => frenchInput.classList.remove('is-drop-target'));
    frenchInput.addEventListener('drop', (e) => {
        frenchInput.classList.remove('is-drop-target');
        const image = imageFrom(e.dataTransfer);
        if (!image) return;
        e.preventDefault();
        startPhotoExtract(image);
    });

    // Clear
    clearInputButton.addEventListener('click', () => {
        setFrenchText('');
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

    testConnectionButton.addEventListener('click', testConnection);

    // Auth Modal Bindings
    if (userAuthBtn) userAuthBtn.addEventListener('click', openAuthModal);
    if (closeAuthModalBtn) closeAuthModalBtn.addEventListener('click', closeAuthModal);
    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) closeAuthModal();
        });
    }
    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
    if (authSwitchBtn) {
        authSwitchBtn.addEventListener('click', () => switchAuthTab(currentAuthTab === 'register' ? 'login' : 'register'));
    }
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Initialize Unified History
    if (window.FrenchHistory) {
        window.FrenchHistory.init({
            currentPage: 'study',
            onRestoreStudy: (item) => {
                // 1. Stop any currently playing audio
                stopAllAudio();
                hidePhotoStatus();

                // 2. Clean URL params so page reload won't re-trigger analysis
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, '', window.location.pathname);
                }

                if (item.text) setFrenchText(item.text);
                if (item.sentences && item.sentences.length > 0) {
                    renderStudyDeck(item.sentences);
                    statusMessage.className = 'status-message status-success';
                    statusMessage.textContent = T.restored(item.sentenceCount || item.sentences.length);
                    window.scrollTo({ top: studyDeckSection.offsetTop - 80, behavior: 'smooth' });
                } else if (item.text) {
                    statusMessage.className = 'status-message status-info';
                    statusMessage.textContent = T.restoredText;
                }
            },
            onReanalyzeStudy: (item) => {
                stopAllAudio();
                if (item.text) {
                    setFrenchText(item.text);
                    startAnalysis();
                }
            },
        });
    }

    // Play all: reads every sentence in order (and starts over with Repeat on)
    const playAllBtn = document.getElementById('play-all-btn');
    if (playAllBtn) {
        const setPlayAllLabel = (playing) => {
            playAllBtn.classList.toggle('is-playing', playing);
            playAllBtn.innerHTML = `<i data-lucide="${playing ? 'square' : 'play'}" aria-hidden="true"></i><span>${playing ? T.stop : T.playAll}</span>`;
            refreshIcons();
        };
        playAllBtn.addEventListener('click', () => {
            if (playAllBtn.classList.contains('is-playing')) {
                stopAllAudio();
                return;
            }
            const first = document.querySelector('.sentence-french-text');
            if (!first) return;
            setPlayAllLabel(true);
            playFrenchSpeech(first.textContent.trim(), () => setPlayAllLabel(false), { all: true });
        });
    }

    // Tap a word in the analysis to see it in the popover
    document.addEventListener('click', (e) => {
        const wordEl = e.target.closest('.interactive-word, .diff-word, .token-word');
        if (wordEl && window.FrenchReadSelection.isTap(e)) {
            e.stopPropagation();
            const card = wordEl.closest('.sentence-card');
            const targetSentence = sentenceContextFor(wordEl).sentence || '';
            const transCn = card ? (card.querySelector('.translation-cn')?.textContent || '') : '';
            const word = wordEl.dataset.word || wordEl.dataset.token || wordEl.textContent.trim();
            showPopoverForElement(word, wordEl, {
                ...sentenceContextFor(wordEl), sentence: targetSentence,
                sentence_cn: transCn
            });
        }
    });

    // Personal expression can use the existing analysis without leaving this page.
    window.FrenchStudy = { studyText(text) {
        stopAllAudio();
        setFrenchText(text);
        return startAnalysis();
    } };

    // Check prefilled URL query param `?text=...`
    window.renderStudyDeck = renderStudyDeck;
    const urlParams = new URLSearchParams(window.location.search);
    const prefillText = urlParams.get('text');
    // Opened from the Audio Studio history: show the saved breakdown, no new analysis
    const restoreId = urlParams.get('restore');
    const findRestore = () => window.FrenchHistory.getRecords('study').find(r => r.id === restoreId);
    if (restoreId && window.FrenchHistory) {
        const restoreItem = findRestore();
        if (restoreItem) window.FrenchHistory.onRestoreStudy(restoreItem);
        // Saved on another device: it arrives with the server's history
        else window.FrenchHistory.pull().then(() => { const item = findRestore(); if (item) window.FrenchHistory.onRestoreStudy(item); });
    }
    // Invite link (/study?invite=CODE): open sign-up with the code filled in, unless already signed in
    const inviteParam = (urlParams.get('invite') || '').trim();
    if (inviteParam) {
        if (authInviteInput) authInviteInput.value = inviteParam;
        currentAuthTab = 'register';
        checkCurrentUser().then(() => {
            if (!localStorage.getItem(userTokenKey)) openAuthModal();
        });
    } else if (urlParams.get('login') === '1') {
        checkCurrentUser().then(() => {
            if (!localStorage.getItem(userTokenKey)) openAuthModal();
        });
    }
    if (prefillText) {
        setFrenchText(decodeURIComponent(prefillText));
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
