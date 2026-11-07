// Run with: node tests/test_word_context.cjs
// The study word card's two parts (static/word-popover.js + static/word-context.js + the study.js wiring):
// 词典 is the word on its own and never takes the sentence's meaning; 语境 is the tapped occurrence in its
// sentence: its meaning here and a Chinese why, asked once per sentence/word/occurrence when the card opens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const WC = require('../static/word-context.js');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/word_context_cases.json'), 'utf8'));

// ---- Occurrences: same answers as word_context.py ---------------------------------------------
for (const c of FIXTURES.spans) {
    assert.deepEqual(WC.spans(c.word, c.sentence).map(s => [s.start, s.end]), c.spans, `spans(${c.word}) in ${c.sentence}`);
}
for (const c of FIXTURES.clean) assert.equal(WC.cleanWord(c.value), c.clean, `cleanWord(${c.value})`);

// ---- The page --------------------------------------------------------------------------------
const PARTIR = 'À partir des sessions de 2026, il faut partir tôt.';
const A_PARTIR = {
    text: 'À partir des', phrase: 'à partir de', meaning_zh: '从……起', meaning_en: 'starting from',
    literal_zh: 'partir 单独是“离开”，但 à partir de 是固定介词短语，表示起点；这里 des = de + les。',
};
const row = (fr, meaning_zh, meaning, extra = {}) => Object.assign({ fr, lemma: fr, ipa: '', type: 'naming word', meaning, meaning_zh, why: '' }, extra);
const SENTENCES = {
    sac: {
        sentence: 'Prends ton sac.', translation_zh: '拿上你的包。', phrases: [],
        words: [row('Prends', '拿', 'take', { lemma: 'prendre', type: 'action word form' }),
            row('ton', '你的', 'your', { type: 'small pointer word', why: 'Goes with sac, a masculine word.' }),
            row('sac', '包', 'bag')],
    },
    amie: {
        sentence: "C'est ton amie.", translation_zh: '这是你的朋友。', phrases: [],
        words: [row("C'est", '这是', 'it is', { type: 'action word form' }),
            row('ton', '你的', 'your', { type: 'small pointer word' }), row('amie', '朋友', 'friend')],
    },
    partir: {
        sentence: PARTIR, translation_zh: '从 2026 年的考试起，得早点出发。', phrases: [A_PARTIR],
        words: [row('sessions', '考试', 'sessions'), row('partir', '出发', 'leave', { type: 'action word', why: 'Infinitive after il faut.' })],
    },
    repeat: {
        sentence: 'Le chat voit le chien.', translation_zh: '猫看见了狗。', phrases: [],
        words: [row('Le', '这只', 'the', { lemma: 'le', type: 'small pointer word' }), row('chat', '猫', 'cat'),
            row('voit', '看见', 'sees', { type: 'action word form' }), row('le', '那只', 'the', { type: 'small pointer word' }),
            row('chien', '狗', 'dog')],
    },
    // The table has one "il" for three: only the line knows which one was tapped
    il: {
        sentence: 'Il mange et il dort, puis il part.', translation_zh: '他吃饭、睡觉，然后离开。', phrases: [],
        words: [row('il', '他', 'he', { type: 'small pointer word' }), row('mange', '吃', 'eats')],
    },
    fail: { sentence: 'Il faut partir demain matin.', translation_zh: '明天早上得出发。', phrases: [], words: [] },
    xss: { sentence: 'Elle mange une pomme.', translation_zh: '', phrases: [], words: [row('pomme', '<b>苹果</b>', 'apple')] },
    stale: { sentence: 'Nous lisons un livre.', translation_zh: '', phrases: [], words: [] },
    empty: { sentence: 'Il pleut beaucoup.', translation_zh: '', phrases: [], words: [] },
    // Contractions: 词典 says what they are made of, from the page alone
    secours: {
        sentence: 'Au secours !', translation_zh: '救命！', words: [row('secours', '救助', 'help')],
        phrases: [{ text: 'Au secours', phrase: 'au secours', meaning_zh: '救命！', meaning_en: 'Help!', literal_zh: '这是呼救的固定说法，整体就是“救命”，不能逐词理解成“到救助”。' }],
    },
    du: { sentence: 'Je mange du pain.', translation_zh: '我吃面包。', phrases: [], words: [] },
    des: { sentence: "J'ai des amis.", translation_zh: '我有一些朋友。', phrases: [], words: [] },
    aux: { sentence: 'Il parle aux enfants.', translation_zh: '他跟孩子们说话。', phrases: [], words: [] },
};

const dom = new JSDOM(`<body>${Object.keys(SENTENCES).map(id => `
    <div class="sentence-card" id="card-${id}">
        <p class="sentence-french-text" lang="fr" id="line-${id}"></p>
        <p class="translation-cn">${SENTENCES[id].translation_zh}</p>
        <div class="word-list" id="table-${id}"></div>
        <div class="gloss" id="gloss-${id}"></div>
    </div>`).join('')}
    <div id="outside">x</div></body>`, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;
window.requestAnimationFrame = fn => setTimeout(fn, 0);
const rect = { left: 10, top: 300, right: 110, bottom: 320, width: 100, height: 20 };
window.Element.prototype.getBoundingClientRect = () => rect;
window.Element.prototype.getClientRects = () => [rect];
window.localStorage.setItem('frenchStudio.uiLang', 'zh');

const study = read('study.js');
const slice = (from, to) => {
    const a = study.indexOf(from);
    const b = study.indexOf(to, a);
    assert.ok(a !== -1 && b !== -1, `study.js still has ${from}`);
    return study.slice(a, b);
};
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const renderWords = new Function('escapeHtml', 'T',
    `${slice('    function renderInteractiveWordsHtml(text) {', '    window.renderInteractiveWordsHtml =')}; return renderInteractiveWordsHtml;`,
)(escapeHtml, { wordTitleSuffix: '' });

window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('phrase-context.js'));
window.eval(read('word-context.js'));
window.eval(read('word-popover.js'));

// ---- A mocked server: /api/lookup (词典) and /api/word-context (语境) -------------------------------
const calls = [];
const DICT = {
    partir: { token: 'partir', lemma: 'partir', pos: 'v.', phonetic: '/paʁ.tiʁ/', explanation_cn: '离开；出发', explanation_en: 'to leave' },
    sac: { token: 'sac', lemma: 'sac', pos: 'n.m.', phonetic: '/sak/', explanation_cn: '包；袋子', explanation_en: 'bag' },
    amie: { token: 'amie', lemma: 'ami', pos: 'n.f.', phonetic: '/a.mi/', explanation_cn: '女性朋友', explanation_en: 'friend (female)' },
};
const WHY = {
    'prends ton sac.|ton|0': { meaning_zh: '你的', meaning_en: 'your', why_zh: 'ton 和后面的 sac 配合：sac 是阳性单数，所以用 ton，不用 ta 或 tes；配合看名词，不看物主是男是女。' },
    "c'est ton amie.|ton|0": { meaning_zh: '你的', meaning_en: 'your', why_zh: 'amie 是阴性单数，本该用 ta，但 amie 以元音开头，改用 ton。' },
};
let contextAnswer = body => ({ status: 200, data: { context: WHY[`${body.sentence.toLowerCase()}|${body.word.toLowerCase()}|${body.occurrence}`] || { meaning_zh: '', meaning_en: '', why_zh: `第 ${body.occurrence + 1} 个 ${body.word}` }, state: 'ready' } });
const gates = new Map();  // word -> promise the answer waits for
const fetchMock = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: (init.headers || {}).Authorization });
    if (url === '/api/word-context') {
        if (gates.has(body.word)) await gates.get(body.word);
        const { status, data } = contextAnswer(body);
        return { ok: status < 400, status, json: async () => data };
    }
    if (url.startsWith('/api/lookup')) {
        const word = decodeURIComponent(url.split('word=')[1]).toLowerCase();
        const entry = DICT[word] || { token: word, lemma: word, pos: '', phonetic: '', explanation_cn: '查到的词义', explanation_en: 'looked up' };
        return { ok: true, status: 200, json: async () => entry };
    }
    if (url === '/api/phrase-context') return { ok: true, status: 200, json: async () => ({ phrases: [] }) };
    throw new Error(`unexpected ${url}`);
};
window.fetch = fetchMock;
let token = 'test-token';

const phraseIndex = new Map();
const phraseRequests = new Map();
const wordTables = new Map();
const sentenceContextByKey = new Map();
const srsSentenceKey = new Function(`${slice('    function srsSentenceKey(sentence) {', '    function getUserToken()')}; return srsSentenceKey;`)();
const api = new Function(
    'window', 'document', 'NodeFilter', 'fetch', 'phraseIndex', 'phraseRequests', 'wordTables', 'sentenceContextByKey',
    'srsSentenceKey', 'getEffectiveAuthToken',
    `let phraseTap = null;
    ${slice('    // ---- Fixed expressions (static/phrase-context.js)', '    // Select French text (drag')}
    return { phraseLookup, wordContextTarget };`,
)(window, document, window.NodeFilter, fetchMock, phraseIndex, phraseRequests, wordTables, sentenceContextByKey, srsSentenceKey, () => token);

for (const [id, s] of Object.entries(SENTENCES)) {
    document.getElementById(`line-${id}`).innerHTML = renderWords(s.sentence);
    // The word table, as renderWordBreakdownCard writes it (data-word-index = the row in the analysis)
    document.getElementById(`table-${id}`).innerHTML = s.words.map((w, i) => `<span class="token-word" lang="fr" data-word-index="${i}">${escapeHtml(w.fr)}</span>`).join('');
    document.getElementById(`gloss-${id}`).innerHTML = s.words.map(w => `<span class="gloss-fr" lang="fr">${escapeHtml(w.fr)}</span>`).join('');
    const key = srsSentenceKey(s.sentence);
    wordTables.set(key, s.words);
    sentenceContextByKey.set(key, { translation_zh: s.translation_zh });
    phraseIndex.set(key, Object.assign(window.FrenchPhraseContext.fromAnalysis(s), { translation_zh: s.translation_zh }));
}

const client = window.FrenchWordContext.createClient({ getToken: () => token, fetch: fetchMock });
const saved = [];
const popover = window.FrenchWordPopover.create({
    speak: () => {},
    getAuthToken: () => token,
    wordSelector: '.interactive-word, .token-word, .gloss-fr',
    // As study.js: a selection anchor is a plain object, not an element
    blockFor: el => (el && el.closest ? el.closest('.sentence-french-text') : null),
    selectionPopover: false,
    contextFor: el => ({ sentence: el.closest('.sentence-card').querySelector('.sentence-french-text').textContent }),
    phraseLookup: (w, e, c) => api.phraseLookup(w, e, c),
    wordContext: { target: (w, e, c) => api.wordContextTarget(w, e, c), explain: (t, h) => client.explain(t, h) },
    saving: { isSaved: () => false, entries: () => [], toggle: async item => { saved.push(item); }, setImportance: async () => {} },
});
const pop = popover.element;
const $ = sel => pop.querySelector(sel);
const text = sel => $(sel).textContent;
const visible = sel => !$(sel).hidden && !$(sel).closest('[hidden]');
const ctxOf = id => ({ sentence: SENTENCES[id].sentence, sentence_cn: SENTENCES[id].translation_zh });
const wordIn = (id, word, n = 0) => [...document.querySelectorAll(`#line-${id} .interactive-word`)].filter(w => w.dataset.word === word)[n];
const tap = (id, word, n = 0) => { const el = wordIn(id, word, n); return popover.show(el.dataset.word, el, ctxOf(id)); };
const tapTable = (id, index) => { const el = document.querySelector(`#table-${id} [data-word-index="${index}"]`); return popover.show(el.textContent, el, ctxOf(id)); };
const tapGloss = (id, word) => { const el = [...document.querySelectorAll(`#gloss-${id} .gloss-fr`)].find(g => g.textContent === word); return popover.show(word, el, ctxOf(id)); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = () => wait(5);
const contextCalls = () => calls.filter(c => c.url === '/api/word-context');
const lookups = () => calls.filter(c => c.url.startsWith('/api/lookup')).length;
const mark = () => $('.popover-context-mark') && $('.popover-context-mark').textContent;
const snippetBefore = () => $('.popover-context-snippet').firstChild.textContent;

(async () => {
    // 1. ton in "Prends ton sac.": 词典 = the word on its own, 语境 = this ton, and why ton (not ta/tes)
    await tap('sac', 'ton');
    await settle();
    assert.equal(visible('.popover-dict'), true);
    assert.equal(text('.popover-dict .popover-section-title'), '词典');
    assert.equal(text('.popover-pos'), '主有限定词', 'a real grammar label');
    assert.match(text('.popover-dict .popover-content'), /你的 \(阳性单数\)/);
    assert.doesNotMatch(pop.textContent, /small pointer word/, 'the analysis\'s vague word type never shows');
    assert.doesNotMatch(text('.popover-dict'), /sac/, 'the dictionary does not explain this sentence');
    assert.equal(visible('.popover-context'), true);
    assert.equal(text('.popover-context .popover-section-title'), '语境');
    assert.equal(mark(), 'ton');
    assert.equal(snippetBefore(), 'Prends ');
    assert.match(text('.popover-context-meaning'), /这里的意思：你的 \/ your/);
    assert.match(text('.popover-context-why'), /sac 是阳性单数，所以用 ton，不用 ta 或 tes/);
    assert.equal(visible('.popover-context-status'), false);
    assert.equal(contextCalls().length, 1);
    const sent = contextCalls()[0];
    assert.equal(sent.auth, 'Bearer test-token');
    assert.deepEqual([sent.body.sentence, sent.body.word, sent.body.occurrence], ['Prends ton sac.', 'ton', 0]);
    assert.equal(sent.body.translation_zh, '拿上你的包。');
    assert.equal(sent.body.hints.meaning_zh, '你的');
    assert.equal(sent.body.hints.note_en, 'Goes with sac, a masculine word.');
    assert.equal(lookups(), 0, 'ton is in the built-in dictionary: no lookup');
    assert.deepEqual({ ...popover.contextMeaning() }, { meaning_zh: '你的', meaning_en: 'your' }, 'the star saves the meaning here');

    // 2. Reopening asks nothing (from the line, or the table row of the same occurrence)
    await tap('sac', 'ton');
    await tapTable('sac', 1);
    await settle();
    assert.equal(contextCalls().length, 1, 'reopen: cached on the page');
    assert.match(text('.popover-context-why'), /sac 是阳性单数/);

    // 3. ton in "C'est ton amie.": another answer, the same dictionary
    await tap('amie', 'ton');
    await settle();
    assert.equal(contextCalls().length, 2);
    assert.match(text('.popover-context-why'), /amie 以元音开头/);
    assert.match(text('.popover-dict .popover-content'), /你的 \(阳性单数\)/, 'the dictionary does not change with the sentence');
    // ...and a content word: its dictionary from /api/lookup, its meaning here from the table
    await tap('amie', 'amie');
    await settle();
    assert.equal(text('.popover-pos'), '阴性名词');
    assert.match(text('.popover-dict .popover-content'), /女性朋友/);
    assert.match(text('.popover-context-meaning'), /朋友 \/ friend/);
    assert.equal($('.popover-lemma').textContent, '原形: ami');

    // 4. A repeated word: the tapped occurrence only
    await tap('repeat', 'le', 0);
    await settle();
    assert.equal(contextCalls().at(-1).body.occurrence, 1, 'the second "le" of the line');
    assert.equal(snippetBefore(), 'Le chat voit ');
    assert.match(text('.popover-context-meaning'), /那只/, 'the table row of that occurrence');
    await tap('repeat', 'Le', 0);
    await settle();
    assert.equal(contextCalls().at(-1).body.occurrence, 0);
    assert.equal(snippetBefore(), '');
    assert.match(text('.popover-context-meaning'), /这只/);
    const before = contextCalls().length;
    await tapTable('repeat', 3);  // the table's second "le" row = the second occurrence (cached)
    await settle();
    assert.equal(contextCalls().length, before);
    assert.equal(snippetBefore(), 'Le chat voit ');
    // The gloss does not say which "le": no guess, no request
    await tapGloss('repeat', 'le');
    await settle();
    assert.equal(contextCalls().length, before);
    assert.equal($('.popover-context').dataset.state, 'unavailable');
    assert.match(text('.popover-context-status'), /没有可分析的句子语境/);
    assert.equal(visible('.popover-dict'), true, 'the dictionary still shows');
    // One table row for three "il": the line still knows its occurrence, but takes no row's meaning
    await tap('il', 'il', 1);
    await settle();
    assert.equal(contextCalls().at(-1).body.occurrence, 2);
    assert.equal(contextCalls().at(-1).body.hints.meaning_zh, '');
    assert.equal(snippetBefore(), 'Il mange et il dort, puis ');
    await tapTable('il', 0);
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable', 'which "il" the row means is unknown');

    // 5. partir inside "À partir des": the expression is its 语境; its own meaning stays the 词典
    const asked = contextCalls().length;
    await tap('partir', 'partir', 0);
    await settle();
    assert.equal(contextCalls().length, asked, 'a known expression needs no request');
    assert.equal($('.popover-context').dataset.state, 'phrase');
    assert.ok($('.popover-context').contains($('.popover-phrase')));
    assert.equal(pop.querySelectorAll('.popover-phrase').length, 1);
    assert.equal(text('.popover-phrase-mark'), 'À partir des');
    assert.match(text('.popover-phrase-meaning'), /从……起/);
    assert.match(text('.popover-phrase-literal'), /des = de \+ les/);
    assert.equal(visible('.popover-context-snippet'), false, 'one snippet: the expression\'s');
    assert.match(text('.popover-dict'), /离开；出发/);
    assert.equal(text('.popover-pos'), '动词');
    assert.doesNotMatch(text('.popover-dict'), /从……起/);
    assert.equal(popover.contextMeaning(), null);
    // The standalone partir of the same sentence: its own 语境, no expression
    await tap('partir', 'partir', 1);
    await settle();
    assert.equal(contextCalls().length, asked + 1);
    assert.equal(contextCalls().at(-1).body.occurrence, 1);
    assert.equal(visible('.popover-phrase'), false);
    assert.equal(mark(), 'partir');
    assert.match(snippetBefore(), /il faut $/);
    // One "partir" row for two occurrences: which one it means is unknown, so no row's meaning is used
    assert.equal(contextCalls().at(-1).body.hints.meaning_zh, '');
    assert.equal(visible('.popover-context-meaning'), false);
    assert.match(text('.popover-context-why'), /第 2 个 partir/);
    assert.match(text('.popover-dict'), /离开；出发/);

    // 6. A nested lookup has no sentence: no 语境, no request; Back brings the card back as it was
    await tap('partir', 'partir', 0);
    $('.popover-phrase-canonical [data-lookup-word="de"]').click();
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable');
    assert.equal(visible('.popover-phrase'), false);
    assert.equal(contextCalls().length, asked + 1);
    pop.querySelector('.popover-back').click();
    await settle();
    assert.equal($('.popover-context').dataset.state, 'phrase');
    assert.equal(text('.popover-phrase-mark'), 'À partir des');

    // 7. No 语境 for what is not one word of the sentence: a number, a chunk (selection Meaning)
    const n = contextCalls().length;
    await tap('partir', '2026');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable');
    const chip = document.getElementById('outside');
    await popover.show('ton sac', { getBoundingClientRect: () => rect }, ctxOf('sac'), { silent: true });
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable', 'no single-word grammar for a chunk');
    assert.equal(visible('.popover-dict'), true);
    assert.match(text('.popover-dict'), /查到的词义/);
    await popover.show('ton', chip, {}, {});
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable', 'no sentence: nothing to ask');
    assert.equal(contextCalls().length, n);

    // 8. Failure: the dictionary stays, 语境 says so, Retry asks again
    contextAnswer = () => ({ status: 502, data: { detail: { message: 'bad' } } });
    const kept = client.size();
    await tap('fail', 'partir');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'failed');
    assert.match(text('.popover-context-status'), /暂时无法获取语境说明/);
    assert.equal(visible('.popover-context-retry'), true);
    assert.match(text('.popover-dict'), /离开；出发/, 'a failure never removes the dictionary');
    assert.equal(client.size(), kept, 'the failure is not kept');
    contextAnswer = body => ({ status: 200, data: { context: { meaning_zh: '出发', meaning_en: 'leave', why_zh: 'il faut 后面用不定式 partir。' }, state: 'ready' } });
    const failedCalls = contextCalls().length;
    $('.popover-context-retry').click();
    await settle();
    assert.equal(contextCalls().length, failedCalls + 1);
    assert.equal($('.popover-context').dataset.state, 'ready');
    assert.match(text('.popover-context-why'), /il faut 后面用不定式/);
    assert.equal(visible('.popover-context-retry'), false);
    // A failed lookup keeps the 语境 too
    const realFetch = window.fetch;
    window.fetch = async (url, init) => (url.startsWith('/api/lookup') ? { ok: false, status: 502, json: async () => ({ detail: { message: '查词服务忙' } }) } : realFetch(url, init));
    await tap('fail', 'matin');
    await settle();
    window.fetch = realFetch;
    assert.match(text('.popover-dict'), /暂无法获取释义/);
    assert.match(text('.popover-dict'), /查词服务忙/);
    assert.equal(visible('.popover-context'), true);
    assert.match(text('.popover-context-why'), /il faut 后面用不定式/);

    // 9. Stale replies: a late answer for a closed card never paints the open one
    let releaseLivre;
    gates.set('livre', new Promise(r => { releaseLivre = r; }));
    contextAnswer = body => ({ status: 200, data: { context: { meaning_zh: body.word, meaning_en: '', why_zh: `关于 ${body.word} 的说明` }, state: 'ready' } });
    const slow = tap('stale', 'livre');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'loading');
    assert.match(text('.popover-context-status'), /正在分析/);
    await tap('stale', 'lisons');
    await settle();
    assert.match(text('.popover-context-why'), /关于 lisons 的说明/);
    releaseLivre();
    gates.delete('livre');
    await slow;
    await settle();
    assert.match(text('.popover-context-why'), /关于 lisons 的说明/, 'the earlier answer is ignored here');
    const k = contextCalls().length;
    await tap('stale', 'livre');
    await settle();
    assert.equal(contextCalls().length, k, 'but kept for its own card');
    assert.match(text('.popover-context-why'), /关于 livre 的说明/);

    // 10. Concurrent opens of the same word share one request
    let releaseNous;
    gates.set('Nous', new Promise(r => { releaseNous = r; }));
    const m = contextCalls().length;
    const a = tap('stale', 'Nous');
    const b = tap('stale', 'Nous');
    await settle();
    assert.equal(contextCalls().length, m + 1);
    releaseNous();
    gates.delete('Nous');
    await Promise.all([a, b]);
    await settle();
    assert.match(text('.popover-context-why'), /关于 Nous 的说明/);

    // 11. An empty answer is kept and said plainly; 422 means unavailable, kept too
    contextAnswer = () => ({ status: 200, data: { context: { meaning_zh: '', meaning_en: '', why_zh: '' }, state: 'empty' } });
    await tap('empty', 'beaucoup');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'empty');
    assert.match(text('.popover-context-status'), /没有需要特别说明/);
    await tap('empty', 'beaucoup');
    contextAnswer = () => ({ status: 422, data: { detail: { code: 'word_not_in_sentence' } } });
    await tap('empty', 'pleut');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable');
    const e = contextCalls().length;
    await tap('empty', 'pleut');
    await tap('empty', 'beaucoup');
    await settle();
    assert.equal(contextCalls().length, e, 'empty and unavailable answers are not asked again');

    // 12. Logged out: never asks; signing in later does
    token = '';
    await tap('empty', 'Il');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable');
    assert.equal(contextCalls().length, e);
    token = 'test-token';
    contextAnswer = () => ({ status: 200, data: { context: { meaning_zh: '它', meaning_en: 'it', why_zh: '无人称主语。' }, state: 'ready' } });
    await tap('empty', 'Il');
    await settle();
    assert.equal(contextCalls().length, e + 1);

    // 13. Model and page text only ever goes in as text
    contextAnswer = () => ({ status: 200, data: { context: { meaning_zh: '<img src=x onerror=alert(1)>吃', meaning_en: '<script>x()</script>', why_zh: '<b onclick=x>动词</b>变位' }, state: 'ready' } });
    await tap('xss', 'mange');
    await settle();
    assert.equal(pop.querySelector('img, script, b'), null);
    assert.equal(pop.querySelectorAll('[onclick], [onerror]').length, 0, 'markup stays text, never attributes');
    assert.doesNotMatch(pop.innerHTML, /<img|<script/);
    assert.match(text('.popover-context-why'), /动词.*变位/);
    await tap('xss', 'pomme');
    await settle();
    assert.equal(pop.querySelector('b'), null);
    assert.match(text('.popover-context-meaning'), /苹果/);

    // 14. The bounded request: no oversized field leaves the page
    const big = 'x'.repeat(5000);
    await client.explain({ sentence: 'Prends ton sac.', word: 'sac', occurrence: 0, translation_zh: big }, { note_en: big, meaning_zh: big });
    const last = contextCalls().at(-1).body;
    assert.ok(last.translation_zh.length <= 600 && last.hints.note_en.length <= 600 && last.hints.meaning_zh.length <= 200);

    // 15. Contractions: 词典 first, au = à + le in plain Chinese, never from the sentence or a model
    contextAnswer = body => ({ status: 200, data: { context: { meaning_zh: '一些', meaning_en: 'some', why_zh: `${body.word} 在这里是部分冠词` }, state: 'ready' } });
    const before15 = { ctx: contextCalls().length, lookups: lookups() };
    await tap('secours', 'Au');
    await settle();
    const dict = $('.popover-dict');
    const context = $('.popover-context');
    assert.ok(dict.compareDocumentPosition(context) & window.Node.DOCUMENT_POSITION_FOLLOWING, '词典 comes before 语境');
    assert.equal(dict.parentElement.firstElementChild, dict, '词典 is the first part of the card');
    assert.equal(visible('.popover-dict'), true);
    assert.equal(text('.popover-pos'), '缩合冠词');
    assert.equal(text('.popover-dict-formula'), 'au = à + le');
    assert.match(text('.popover-dict .popover-content'), /au = à \+ le（到\/在 \+ 阳性单数定冠词）/);
    assert.doesNotMatch(text('.popover-dict'), /救命|secours/, 'the expression never replaces what au means');
    assert.equal(visible('.popover-lemma'), false, 'no confusing "base form: à + le"');
    assert.equal(context.dataset.state, 'phrase');
    assert.equal(text('.popover-phrase-canonical'), 'au secours');
    assert.equal(text('.popover-phrase-mark'), 'Au secours');
    assert.match(text('.popover-phrase-meaning'), /救命！ \/ Help!/);
    assert.match(text('.popover-phrase-literal'), /不能逐词/);
    assert.equal(contextCalls().length, before15.ctx, 'a known expression: no model call');
    assert.equal(lookups(), before15.lookups, 'a contraction: no lookup');
    // The formula's words are nested lookups; Back brings au back as it was
    $('.popover-dict-formula [data-lookup-word="le"]').click();
    await settle();
    assert.equal(text('.popover-word'), 'le');
    assert.equal($('.popover-context').dataset.state, 'unavailable', 'a nested card has no 语境');
    pop.querySelector('.popover-back').click();
    await settle();
    assert.equal(text('.popover-dict-formula'), 'au = à + le');
    assert.equal($('.popover-context').dataset.state, 'phrase');

    // All four, in any case, with no sentence at all (nested / unknown cards): the expansion is always there
    const FORMS = { au: ['au = à + le', '到/在 + 阳性单数定冠词'], aux: ['aux = à + les', '到/在 + 复数定冠词'],
        du: ['du = de + le', '……的/从 + 阳性单数定冠词'], des: ['des = de + les', '……的/从 + 复数定冠词'] };
    for (const [word, [formula, zh]] of Object.entries(FORMS)) {
        for (const shown of [word, word.toUpperCase(), word[0].toUpperCase() + word.slice(1)]) {
            await popover.show(shown, chip, {}, {});
            await settle();
            assert.equal($('.popover-context').dataset.state, 'unavailable', `${shown}: no sentence`);
            assert.equal(text('.popover-dict-formula'), formula, shown);
            assert.ok(text('.popover-dict .popover-content').includes(zh), `${shown}: ${zh}`);
        }
    }
    // du / des are not always contractions: both uses, and a caution
    await popover.show('du', chip, {}, {});
    await settle();
    assert.equal(text('.popover-pos'), '缩合冠词 / 部分冠词');
    assert.equal(pop.querySelectorAll('.popover-dict-use').length, 2);
    assert.match(text('.popover-dict'), /部分冠词 一些 \/ 常不译/);
    assert.match(text('.popover-dict-caution'), /不是每个 du 都是缩合形式/);
    await popover.show('des', chip, {}, {});
    await settle();
    assert.equal(text('.popover-pos'), '缩合冠词 / 不定冠词');
    assert.match(text('.popover-dict'), /不定冠词（复数） 一些，un \/ une 的复数/);
    assert.match(text('.popover-dict-caution'), /不是每个 des 都是缩合形式/);
    await popover.show('aux', chip, {}, {});
    await settle();
    assert.equal(pop.querySelectorAll('.popover-dict-use').length, 1);
    assert.equal($('.popover-dict-caution'), null, 'au / aux need no caution');
    assert.equal(lookups(), before15.lookups, 'no lookup for any contraction');
    // In a sentence the 语境 says which use it is; the 词典 still lists both
    await tap('du', 'du');
    await settle();
    assert.match(text('.popover-context-why'), /du 在这里是部分冠词/);
    assert.equal(pop.querySelectorAll('.popover-dict-use').length, 2);
    // A 语境 failure never removes the expansion
    contextAnswer = () => ({ status: 502, data: { detail: { message: 'bad' } } });
    await tap('des', 'des');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'failed');
    assert.equal(text('.popover-dict-formula'), 'des = de + les');
    assert.equal(visible('.popover-dict'), true);
    // Logged out (no 语境 at all): still there
    token = '';
    await tap('aux', 'aux');
    await settle();
    assert.equal(text('.popover-dict-formula'), 'aux = à + les');
    token = 'test-token';
    // A poisoned page cache for "du" cannot put markup or another meaning into the expansion
    window.fetch = fetchMock;
    popover.show('du', chip, {}, {});
    await settle();
    assert.equal(pop.querySelectorAll('.popover-dict script, .popover-dict img, .popover-dict [onclick], .popover-dict [onerror]').length, 0);
    assert.deepEqual([...pop.querySelectorAll('.popover-dict-formula [data-lookup-word]')].map(b => b.dataset.lookupWord), ['de', 'le']);
    assert.doesNotMatch($('.popover-dict').innerHTML, /<script|<img/);

    // 16. Close clears the card; the 700ms settle still protects a fresh card
    await tap('sac', 'ton');
    document.getElementById('outside').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(popover.isOpen(), true);
    await wait(720);
    document.getElementById('outside').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    assert.equal(popover.isOpen(), false);
    assert.equal(popover.contextMeaning(), null);

    console.log('PASS: word card 词典 and 语境 (occurrence, cache, phrase, contractions, failure/retry, stale, no markup).');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
