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
    literal_zh: 'The whole phrase means starting from; des = de + les.',
};
const row = (fr, meaning_zh, meaning, extra = {}) => Object.assign({ fr, lemma: fr, ipa: '', type: 'naming word', meaning, meaning_zh, why: '' }, extra);
const SENTENCES = {
    cake: {sentence: 'Le gâteau au chocolat est délicieux.', translation_zh: '巧克力蛋糕很好吃。', phrases: [], words: [row('gâteau', '蛋糕', 'cake'), row('chocolat', '巧克力', 'chocolate')]},
    cakes: {sentence: 'Le gâteau coûte cher, mais ce gâteau est délicieux.', translation_zh: '蛋糕很贵，但这个蛋糕很好吃。', phrases: [], words: [row('gâteau', '蛋糕', 'cake'), row('gâteau', '这个蛋糕', 'this cake')]},
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
    'prends ton sac.|ton|0': { meaning_zh: '你的', meaning_en: 'your', why_zh: 'Use ton because sac is masculine and singular, not ta or tes.' },
    "c'est ton amie.|ton|0": { meaning_zh: '你的', meaning_en: 'your', why_zh: 'Amie starts with a vowel, so use ton.' },
};
let contextAnswer = body => ({ status: 200, data: { context: WHY[`${body.sentence.toLowerCase()}|${body.word.toLowerCase()}|${body.occurrence}`] || { meaning_zh: '', meaning_en: '', why_zh: `Occurrence ${body.occurrence + 1} of ${body.word}` }, state: 'ready' } });
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
    assert.equal(text('.popover-dict .popover-section-title'), 'Dictionary');
    assert.equal(text('.popover-pos'), 'possessive determiner', 'a real grammar label');
    assert.match(text('.popover-dict .popover-content'), /your \(masculine\)/);
    assert.doesNotMatch(pop.textContent, /small pointer word/, 'the analysis\'s vague word type never shows');
    assert.doesNotMatch(text('.popover-dict'), /sac/, 'the dictionary does not explain this sentence');
    assert.equal(visible('.popover-context'), true);
    assert.equal(text('.popover-context .popover-section-title'), 'In this sentence');
    assert.equal(mark(), 'ton');
    assert.equal(snippetBefore(), 'Prends ');
    assert.match(text('.popover-context-meaning'), /Here: your/);
    assert.match(text('.popover-context-why'), /sac is masculine and singular, not ta or tes/);
    // Why and the etymology start folded; the footer carries the lookup count
    assert.equal(pop.querySelector('.popover-why-detail').open, false, 'Why starts collapsed');
    assert.equal(pop.querySelector('.popover-etymology-text').hidden, true, 'etymology starts collapsed');
    assert.ok(pop.querySelector('.popover-footer .popover-lookup-count'), 'the count lives in the footer');
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
    assert.match(text('.popover-context-why'), /sac is masculine and singular/);

    // 3. ton in "C'est ton amie.": another answer, the same dictionary
    await tap('amie', 'ton');
    await settle();
    assert.equal(contextCalls().length, 2);
    assert.match(text('.popover-context-why'), /Amie starts with a vowel/);
    assert.match(text('.popover-dict .popover-content'), /your \(masculine\)/, 'the dictionary does not change with the sentence');
    // ...and a content word: its dictionary from /api/lookup, its meaning here from the table
    await tap('amie', 'amie');
    await settle();
    assert.equal(text('.popover-pos'), 'feminine noun');
    assert.match(text('.popover-dict .popover-content'), /friend \(female\)/);
    assert.match(text('.popover-context-meaning'), /Here: friend/);
    assert.equal($('.popover-lemma').textContent, 'base form: ami');

    // 4. A repeated word: the tapped occurrence only
    await tap('repeat', 'le', 0);
    await settle();
    assert.equal(contextCalls().at(-1).body.occurrence, 1, 'the second "le" of the line');
    assert.equal(snippetBefore(), 'Le chat voit ');
    assert.match(text('.popover-context-meaning'), /Here: the/, 'the table row of that occurrence');
    await tap('repeat', 'Le', 0);
    await settle();
    assert.equal(contextCalls().at(-1).body.occurrence, 0);
    assert.equal(snippetBefore(), '');
    assert.match(text('.popover-context-meaning'), /Here: the/);
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
    assert.match(text('.popover-context-status'), /No sentence context/);
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
    assert.match(text('.popover-phrase-meaning'), /starting from/);
    assert.match(text('.popover-phrase-literal'), /des = de \+ les/);
    assert.equal(visible('.popover-context-snippet'), false, 'one snippet: the expression\'s');
    assert.match(text('.popover-dict'), /to leave/);
    assert.equal(text('.popover-pos'), 'verb');
    assert.doesNotMatch(text('.popover-dict'), /starting from/);
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
    assert.match(text('.popover-context-why'), /Occurrence 2 of partir/);
    assert.match(text('.popover-dict'), /to leave/);

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

    // 7. No 语境 for what is not in the sentence: a number, a chunk it lacks (selection Meaning)
    const n = contextCalls().length;
    await tap('partir', '2026');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable');
    const chip = document.getElementById('outside');
    await popover.show('ton chat', { getBoundingClientRect: () => rect }, ctxOf('sac'), { silent: true });
    await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable', 'a chunk the sentence does not have');
    assert.equal(visible('.popover-dict'), true);
    assert.match(text('.popover-dict'), /looked up/);
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
    assert.match(text('.popover-context-status'), /Could not explain this use/);
    assert.equal(visible('.popover-context-retry'), true);
    assert.match(text('.popover-dict'), /to leave/, 'a failure never removes the dictionary');
    assert.equal(client.size(), kept, 'the failure is not kept');
    contextAnswer = body => ({ status: 200, data: { context: { meaning_zh: '出发', meaning_en: 'leave', why_zh: 'Use the infinitive partir after il faut.' }, state: 'ready' } });
    const failedCalls = contextCalls().length;
    $('.popover-context-retry').click();
    await settle();
    assert.equal(contextCalls().length, failedCalls + 1);
    assert.equal($('.popover-context').dataset.state, 'ready');
    assert.match(text('.popover-context-why'), /infinitive partir after il faut/);
    assert.equal(visible('.popover-context-retry'), false);
    // A failed lookup keeps the 语境 too
    const realFetch = window.fetch;
    window.fetch = async (url, init) => (url.startsWith('/api/lookup') ? { ok: false, status: 502, json: async () => ({ detail: { message: '查词服务忙' } }) } : realFetch(url, init));
    await tap('fail', 'matin');
    await settle();
    window.fetch = realFetch;
    assert.match(text('.popover-dict'), /Could not get the meaning/);
    assert.match(text('.popover-dict'), /Lookup failed/);
    assert.equal(visible('.popover-context'), true);
    assert.match(text('.popover-context-why'), /infinitive partir after il faut/);

    // 9. Stale replies: a late answer for a closed card never paints the open one
    let releaseLivre;
    gates.set('livre', new Promise(r => { releaseLivre = r; }));
    contextAnswer = body => ({ status: 200, data: { context: { meaning_zh: body.word, meaning_en: '', why_zh: `About ${body.word}` }, state: 'ready' } });
    const slow = tap('stale', 'livre');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'loading');
    assert.match(text('.popover-context-status'), /Working out/);
    await tap('stale', 'lisons');
    await settle();
    assert.match(text('.popover-context-why'), /About lisons/);
    releaseLivre();
    gates.delete('livre');
    await slow;
    await settle();
    assert.match(text('.popover-context-why'), /About lisons/, 'the earlier answer is ignored here');
    const k = contextCalls().length;
    await tap('stale', 'livre');
    await settle();
    assert.equal(contextCalls().length, k, 'but kept for its own card');
    assert.match(text('.popover-context-why'), /About livre/);

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
    assert.match(text('.popover-context-why'), /About Nous/);

    // 11. An empty answer is kept and said plainly; 422 means unavailable, kept too
    contextAnswer = () => ({ status: 200, data: { context: { meaning_zh: '', meaning_en: '', why_zh: '' }, state: 'empty' } });
    await tap('empty', 'beaucoup');
    await settle();
    assert.equal($('.popover-context').dataset.state, 'empty');
    assert.match(text('.popover-context-status'), /Nothing special/);
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
    contextAnswer = () => ({ status: 200, data: { context: { meaning_zh: '<img src=x onerror=alert(1)>吃', meaning_en: '<script>x()</script>', why_zh: '<b onclick=x>verb</b>form' }, state: 'ready' } });
    await tap('xss', 'mange');
    await settle();
    assert.equal(pop.querySelector('img, script, b'), null);
    assert.equal(pop.querySelectorAll('[onclick], [onerror]').length, 0, 'markup stays text, never attributes');
    assert.doesNotMatch(pop.innerHTML, /<img|<script/);
    assert.match(text('.popover-context-why'), /verb.*form/);
    await tap('xss', 'pomme');
    await settle();
    assert.equal(pop.querySelector('b'), null);
    assert.match(text('.popover-context-meaning'), /Here: apple/);

    // 14. The bounded request: no oversized field leaves the page
    const big = 'x'.repeat(5000);
    await client.explain({ sentence: 'Prends ton sac.', word: 'sac', occurrence: 0, translation_zh: big }, { note_en: big, meaning_zh: big });
    const last = contextCalls().at(-1).body;
    assert.ok(last.translation_zh.length <= 600 && last.hints.note_en.length <= 600 && last.hints.meaning_zh.length <= 200);

    // 15. Contractions: 词典 first, au = à + le in plain Chinese, never from the sentence or a model
    contextAnswer = body => ({ status: 200, data: { context: { meaning_zh: '一些', meaning_en: 'some', why_zh: `${body.word} is a partitive article here` }, state: 'ready' } });
    const before15 = { ctx: contextCalls().length, lookups: lookups() };
    await tap('secours', 'Au');
    await settle();
    const dict = $('.popover-dict');
    const context = $('.popover-context');
    assert.ok(dict.compareDocumentPosition(context) & window.Node.DOCUMENT_POSITION_FOLLOWING, '词典 comes before 语境');
    assert.equal(dict.parentElement.firstElementChild, dict, '词典 is the first part of the card');
    assert.equal(visible('.popover-dict'), true);
    assert.equal(text('.popover-pos'), 'contracted article');
    assert.equal(text('.popover-dict-formula'), 'au = à + le');
    assert.match(text('.popover-dict .popover-content'), /au = à \+ le: to \/ at \+ the/);
    assert.doesNotMatch(text('.popover-dict'), /救命|secours/, 'the expression never replaces what au means');
    assert.equal(visible('.popover-lemma'), false, 'no confusing "base form: à + le"');
    assert.equal(context.dataset.state, 'phrase');
    assert.equal(text('.popover-phrase-canonical'), 'au secours');
    assert.equal(text('.popover-phrase-mark'), 'Au secours');
    assert.match(text('.popover-phrase-meaning'), /Help!/);
    assert.match(text('.popover-phrase-literal'), /do not read it word by word/);
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
    const FORMS = { au: ['au = à + le', 'to / at + the (masculine singular)'], aux: ['aux = à + les', 'to / at + the (plural)'],
        du: ['du = de + le', 'of / from + the (masculine singular)'], des: ['des = de + les', 'of / from + the (plural)'] };
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
    assert.equal(text('.popover-pos'), 'contracted article / partitive article');
    assert.equal(pop.querySelectorAll('.popover-dict-use').length, 2);
    assert.match(text('.popover-dict'), /partitive article some, often not translated/);
    assert.match(text('.popover-dict-caution'), /not every du is a contraction/);
    await popover.show('des', chip, {}, {});
    await settle();
    assert.equal(text('.popover-pos'), 'contracted article / indefinite article');
    assert.match(text('.popover-dict'), /indefinite article \(plural\) some, the plural of un \/ une/);
    assert.match(text('.popover-dict-caution'), /not every des is a contraction/);
    await popover.show('aux', chip, {}, {});
    await settle();
    assert.equal(pop.querySelectorAll('.popover-dict-use').length, 1);
    assert.equal($('.popover-dict-caution'), null, 'au / aux need no caution');
    assert.equal(lookups(), before15.lookups, 'no lookup for any contraction');
    // In a sentence the 语境 says which use it is; the 词典 still lists both
    await tap('du', 'du');
    await settle();
    assert.match(text('.popover-context-why'), /du is a partitive article here/);
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

    // D’accord decomposes from cached/static constituents even when context would fail.
    const beforeAccord = {lookups: lookups(), calls: contextCalls().length};
    for (const token of ["D'accord", 'D’accord', "D'ACCORD"]) {
        await popover.show(token, document.getElementById('line-sac'), {sentence: token + '.'});
        await settle();
        assert.equal(visible('.popover-dict'), true);
        assert.match(text('.popover-dict'), /d’ = de \(elided before a vowel\)/);
        assert.match(text('.popover-dict'), /accord = agreement; accord \(masculine noun\)/);
        assert.match(text('.popover-context'), /OK \/ agreed/);
        assert.match(text('.popover-context'), /in agreement/);
        assert.match(pop.querySelector('.popover-dict .popover-en-text').textContent, /agreement/);
        assert.ok(pop.querySelector('.popover-dict').compareDocumentPosition(pop.querySelector('.popover-context')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    }
    assert.equal(lookups(), beforeAccord.lookups);
    assert.equal(contextCalls().length, beforeAccord.calls);

    // Review: selection Meaning carries its actual range independently of the virtual geometry.
    const selectedAnchor = (id, word, n = 0) => {
        const range = document.createRange();
        range.selectNodeContents(wordIn(id, word, n));
        return {getBoundingClientRect: () => rect, sourceRange: range.cloneRange(), coversRange: () => true};
    };
    const cakeAnchor = selectedAnchor('cake', 'gâteau');
    const tappedCake = api.wordContextTarget('gâteau', wordIn('cake', 'gâteau'), ctxOf('cake'));
    const pickedCake = api.wordContextTarget('gâteau', cakeAnchor, ctxOf('cake'));
    assert.deepEqual(pickedCake, tappedCake, 'same target and dictionary hints as the actual tap');
    assert.deepEqual(api.wordContextTarget('gâteau', {getBoundingClientRect: () => rect}, ctxOf('cake')), tappedCake, 'unique known token safe without source');
    assert.equal(api.wordContextTarget('gâteau', cakeAnchor, {}), null, 'no known sentence');
    assert.equal(api.wordContextTarget('gâteau', cakeAnchor, ctxOf('cakes')), null, 'source and sentence must agree');
    assert.equal(api.wordContextTarget('gâteau', {getBoundingClientRect: () => rect}, ctxOf('cakes')), null, 'unlocated repeated word is ambiguous');
    for (const occurrence of [0, 1]) {
        const anchor = selectedAnchor('cakes', 'gâteau', occurrence);
        const selected = api.wordContextTarget('gâteau', anchor, ctxOf('cakes'));
        assert.equal(selected.occurrence, occurrence);
        assert.deepEqual(selected, api.wordContextTarget('gâteau', wordIn('cakes', 'gâteau', occurrence), ctxOf('cakes')));
    }
    const multi = document.createRange(); multi.selectNodeContents(document.getElementById('line-cake'));
    assert.equal(api.wordContextTarget('gâteau au chocolat', {sourceRange: multi}, ctxOf('cake')), null);
    assert.equal(api.wordContextTarget('gâteau', {sourceRange: multi}, ctxOf('cake')), null, 'a multiword range cannot pretend to be one token');
    const detached = document.createElement('p'); detached.className = 'sentence-french-text'; detached.textContent = SENTENCES.cake.sentence;
    const deadRange = document.createRange(); deadRange.selectNodeContents(detached);
    assert.equal(api.wordContextTarget('gâteau', {sourceRange: deadRange}, ctxOf('cake')), null, 'detached source is not current sentence');
    contextAnswer = body => ({status: 200, data: {state: 'ready', context: {meaning_zh: '蛋糕', meaning_en: 'cake', why_zh: body.sentence === SENTENCES.cake.sentence ? 'Gâteau is a masculine singular noun. Au chocolat means chocolate flavour.' : `Occurrence ${body.occurrence + 1} of gâteau`}}});
    const beforeSelection = contextCalls().length;
    await popover.show('gâteau', cakeAnchor, ctxOf('cake'), {silent: true}); await settle();
    assert.equal(contextCalls().length, beforeSelection + 1);
    assert.match(text('.popover-context-why'), /masculine singular noun/);
    await tap('cake', 'gâteau'); await settle();
    await popover.show('gâteau', cakeAnchor, ctxOf('cake'), {silent: true}); await settle();
    assert.equal(contextCalls().length, beforeSelection + 1, 'selection, tap and reopening share one request');
    await popover.show('gâteau', cakeAnchor, ctxOf('cake'), {nested: true}); await settle();
    assert.equal($('.popover-context').dataset.state, 'unavailable', 'nested lookup never inherits source context');
    assert.equal(contextCalls().length, beforeSelection + 1);
    // A delayed selection reply must cache its own occurrence but never repaint the next card.
    let releaseSelection;
    gates.set('gâteau', new Promise(resolve => { releaseSelection = resolve; }));
    await popover.show('gâteau', selectedAnchor('cakes', 'gâteau', 1), ctxOf('cakes'), {silent: true}); await settle();
    assert.equal($('.popover-context').dataset.state, 'loading');
    await tap('cake', 'chocolat'); await settle();
    const nextCard = text('.popover-context');
    releaseSelection(); gates.delete('gâteau'); await settle();
    assert.equal(text('.popover-word'), 'chocolat');
    assert.equal(text('.popover-context'), nextCard, 'stale selection result did not repaint');
    const afterDelayed = contextCalls().length;
    await popover.show('gâteau', selectedAnchor('cakes', 'gâteau', 1), ctxOf('cakes'), {silent: true}); await settle();
    assert.equal(contextCalls().length, afterDelayed);
    assert.match(text('.popover-context-why'), /Occurrence 2 of gâteau/);

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
