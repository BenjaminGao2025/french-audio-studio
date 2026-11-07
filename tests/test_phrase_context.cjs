// Run with: node tests/test_phrase_context.cjs
// Fixed expressions on the study word card (static/phrase-context.js + the study.js wiring):
// a tap on "partir" in "À partir des sessions" shows "à partir de" with its meaning, highlights
// À / partir / des, and nothing for a standalone "partir". Older sentences ask the server once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const PC = require('../static/phrase-context.js');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/phrase_cases.json'), 'utf8'));

// ---- Matching: same answers as phrase_context.py ------------------------------------------
for (const c of FIXTURES.find) {
    const got = PC.find(c.pattern, c.sentence).map(h => c.sentence.slice(h.start, h.end));
    assert.deepEqual(got, c.matches, `find(${c.pattern}) in ${c.sentence}`);
}
for (const c of FIXTURES.notes) assert.deepEqual(PC.contractionNotes(c.surface, c.canonical), c.notes, c.surface);

// ---- What an analysis already holds -------------------------------------------------------
const SENTENCE = 'À partir des sessions de 2026, il faut partir tôt.';
const A_PARTIR = {
    text: 'À partir des', phrase: 'à partir de', meaning_zh: '从……起', meaning_en: 'starting from',
    literal_zh: 'partir 单独是“离开”，但 à partir de 是固定介词短语，表示起点；这里 des = de + les。',
};
{
    const structured = PC.fromAnalysis({ sentence: SENTENCE, phrases: [A_PARTIR, { text: 'en fait', meaning_zh: '其实' }] });
    assert.equal(structured.structured, true);
    assert.deepEqual(structured.phrases.map(p => p.phrase), ['à partir de'], 'an expression the sentence lacks is dropped');

    const none = PC.fromAnalysis({ sentence: 'Il faut partir.', phrases: [] });
    assert.equal(none.structured, true);
    assert.equal(none.phrases.length, 0);

    const fromWords = PC.fromAnalysis({
        sentence: SENTENCE,
        words: [{ fr: 'À partir des', lemma: 'à partir de', meaning: 'starting from', meaning_zh: '从……起' }, { fr: 'sessions' }],
    });
    assert.equal(fromWords.structured, false);
    assert.equal(fromWords.aware, true);
    assert.equal(fromWords.phrases[0].phrase, 'à partir de');
    assert.equal(fromWords.phrases[0].source, 'words');

    const fromNote = PC.fromAnalysis({
        sentence: SENTENCE,
        words: [{ fr: 'partir', meaning: 'to leave', why: 'Part of the phrase "à partir de" = starting from.' }],
    });
    assert.equal(fromNote.phrases[0].phrase, 'à partir de');
    assert.equal(fromNote.phrases[0].meaning_en, 'starting from');
    assert.equal(fromNote.phrases[0].source, 'note');

    // A note naming an expression the sentence does not have proves nothing
    const wrongNote = PC.fromAnalysis({
        sentence: 'Il faut partir tôt.', words: [{ fr: 'partir', why: 'Part of the phrase à partir de.' }],
    });
    assert.equal(wrongNote.phrases.length, 0);
    assert.equal(wrongNote.aware, false);

    const legacy = PC.fromAnalysis({ sentence: 'Grâce aux efforts de tous, nous avons réussi.', words: [{ fr: 'Grâce', meaning: 'thanks' }] });
    assert.deepEqual([legacy.structured, legacy.aware, legacy.phrases.length], [false, false, 0]);

    const snip = PC.snippet(SENTENCE, 0, 12);
    assert.deepEqual([snip.before, snip.match], ['', 'À partir des']);
    // Long sentences are cut at word boundaries inside the radius, keeping the words around the match
    const mid = PC.snippet(SENTENCE, 39, 45);
    assert.deepEqual([mid.before, mid.match, mid.after], ['… sessions de 2026, il faut ', 'partir', ' tôt.']);
}

// ---- The study page's word card -----------------------------------------------------------
const SENTENCES = {
    a: { sentence: SENTENCE, phrases: [A_PARTIR] },
    other: { sentence: 'Il faut partir demain matin.', phrases: [] },
    legacy: { sentence: 'Grâce aux efforts de tous, nous avons réussi.', words: [{ fr: 'efforts', meaning: 'efforts' }] },
    aware: { sentence: 'Il y a deux ans, il est parti.', words: [{ fr: 'Il y a', lemma: 'il y a', meaning: 'ago', meaning_zh: '……以前' }] },
    xss: {
        sentence: 'Au lieu de dormir, il travaille.',
        phrases: [{ text: 'Au lieu de', phrase: 'au lieu de', meaning_zh: '<img src=x onerror=alert(1)>而不是', literal_zh: '<script>x()</script>不要逐词' }],
    },
    elided: { sentence: "Le cours commence à partir d'une heure.", phrases: [A_PARTIR] },
};

const dom = new JSDOM(`<body>${Object.keys(SENTENCES).map(id => `
    <div class="sentence-card" id="card-${id}"><p class="sentence-french-text" lang="fr" id="line-${id}"></p><p class="translation-cn">译文</p></div>`).join('')}
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
window.eval(read('word-popover.js'));

const calls = [];
let phraseAnswer = () => ({ phrases: [] });
let release = null;  // when set, /api/phrase-context waits for it
const fetchMock = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: (init.headers || {}).Authorization });
    if (url === '/api/phrase-context') {
        if (release) await release;
        return { ok: true, status: 200, json: async () => phraseAnswer(JSON.parse(init.body)) };
    }
    return { ok: true, status: 200, json: async () => ({ token: 'x', lemma: 'x', explanation_cn: '查到的词义', explanation_en: 'looked up' }) };
};
window.fetch = fetchMock;
let token = 'test-token';

const phraseIndex = new Map();
const phraseRequests = new Map();
const srsSentenceKey = new Function(`${slice('    function srsSentenceKey(sentence) {', '    function getUserToken()')}; return srsSentenceKey;`)();
const api = new Function(
    'window', 'document', 'NodeFilter', 'fetch', 'phraseIndex', 'phraseRequests', 'srsSentenceKey', 'getEffectiveAuthToken',
    `let phraseTap = null;
    ${slice('    // ---- Fixed expressions (static/phrase-context.js)', '    // Select French text (drag')}
    return { phraseLookup, phraseTextFor, tap: () => phraseTap };`,
)(window, document, window.NodeFilter, fetchMock, phraseIndex, phraseRequests, srsSentenceKey, () => token);

for (const [id, s] of Object.entries(SENTENCES)) {
    document.getElementById(`line-${id}`).innerHTML = renderWords(s.sentence);
    phraseIndex.set(srsSentenceKey(s.sentence), Object.assign(window.FrenchPhraseContext.fromAnalysis(s), { translation_zh: '译文' }));
}

const OWN = { partir: { token: 'partir', lemma: 'partir', pos: 'v.', phonetic: '', explanation_cn: '离开；出发', explanation_en: 'to leave' } };
const popover = window.FrenchWordPopover.create({
    speak: () => {},
    getAuthToken: () => token,
    wordSelector: '.interactive-word',
    blockFor: el => el.closest('.sentence-french-text'),
    selectionPopover: false,
    contextFor: el => ({ sentence: el.closest('.sentence-card').querySelector('.sentence-french-text').textContent }),
    localLookup: lower => OWN[lower] || null,
    phraseLookup: (w, e, c) => api.phraseLookup(w, e, c),
});
const pop = popover.element;
const $ = sel => pop.querySelector(sel);
const wordsOf = id => [...document.querySelectorAll(`#line-${id} .interactive-word`)];
const wordIn = (id, text, n = 0) => wordsOf(id).filter(w => w.dataset.word === text)[n];
const tap = (id, text, n = 0) => {
    const el = wordIn(id, text, n);
    return popover.show(el.dataset.word, el, { sentence: SENTENCES[id].sentence, sentence_cn: '译文' });
};
const highlighted = () => [...document.querySelectorAll('.is-phrase-word')].map(w => w.textContent.trim());
const wait = ms => new Promise(r => setTimeout(r, ms));
const lookups = () => calls.filter(c => c.url.startsWith('/api/lookup')).length;
const phraseCalls = () => calls.filter(c => c.url === '/api/phrase-context').length;

(async () => {
    // 1. "partir" of "À partir des": the whole expression, its meaning, why not word by word
    await tap('a', 'partir', 0);
    assert.equal(popover.isOpen(), true);
    assert.equal($('.popover-phrase').hidden, false, 'the expression block shows');
    assert.equal($('.popover-phrase-canonical').textContent, 'à partir de');
    assert.equal($('.popover-phrase-mark').textContent, 'À partir des');
    assert.match($('.popover-phrase-meaning').textContent, /从……起 \/ starting from/);
    assert.match($('.popover-phrase-literal').textContent, /des = de \+ les/);
    assert.deepEqual(highlighted(), ['À', 'partir', 'des'], 'the span in the sentence is highlighted');
    assert.ok($('.popover-context').contains($('.popover-phrase')), 'the expression is the word\'s 语境');
    assert.equal($('.popover-context').hidden, false);
    assert.equal(pop.querySelectorAll('.popover-phrase').length, 1, 'no second expression block');
    assert.equal($('.popover-dict').hidden, false, 'its own meaning stays, as the 词典');
    assert.match($('.popover-dict').textContent, /离开；出发/);
    assert.doesNotMatch($('.popover-dict').textContent, /从……起/, 'the expression does not replace the dictionary');
    assert.equal(api.tap().text, 'À partir des', 'the star saves the expression');
    assert.equal(phraseCalls(), 0, 'structured analysis data: no request');

    // 2. The second, standalone "partir" of the same sentence: just the word
    await tap('a', 'partir', 1);
    assert.equal($('.popover-phrase').hidden, true, 'a standalone partir gets no expression');
    assert.deepEqual(highlighted(), []);
    assert.match(pop.textContent, /离开；出发/);
    assert.equal(api.tap().text, '');

    // 3. The same word in a sentence without the expression
    await tap('other', 'partir');
    assert.equal($('.popover-phrase').hidden, true);
    assert.deepEqual(highlighted(), []);

    // 4. "des" (built-in dictionary): the expression first, the word's own meaning below it
    const before = lookups();
    await tap('a', 'des');
    assert.equal(lookups(), before);
    assert.equal($('.popover-phrase').hidden, false);
    assert.equal($('.popover-content').hidden, false);

    // 5. A word outside any expression still looks itself up, as before
    await tap('a', 'sessions');
    assert.equal(lookups(), before + 1);
    assert.equal($('.popover-phrase').hidden, true);

    // 6. "lieu" has no entry of its own: its 词典 is looked up, the expression is its 语境.
    // Model text is only ever text.
    await tap('xss', 'lieu');
    assert.equal(lookups(), before + 2, 'a word of an expression still gets its own dictionary meaning');
    assert.match($('.popover-dict').textContent, /查到的词义/);
    assert.equal($('.popover-phrase').hidden, false);
    assert.equal(pop.querySelector('img, script'), null, 'no markup from the data');
    assert.match($('.popover-phrase-meaning').textContent, /img src=x onerror=alert\(1\)而不是/);
    assert.equal($('.popover-phrase-mark').textContent, 'Au lieu de');

    // 7. Elision: "d'une" belongs to "à partir d'"
    await tap('elided', 'partir');
    assert.equal($('.popover-phrase-mark').textContent, "à partir d'");
    assert.deepEqual(highlighted(), ['à', 'partir', "d'une"]);
    assert.match($('.popover-phrase-literal').textContent, /d' = de/);

    // 8. Aware legacy sentence (its table groups "Il y a"): a word outside it asks nothing
    await tap('aware', 'deux');
    await tap('aware', 'y');
    assert.equal($('.popover-phrase-mark').textContent, 'Il y a');
    assert.equal(phraseCalls(), 0, 'the word table already looked for expressions');

    // 9. Legacy sentence: one request for many taps, shared while pending and reused after
    let open;
    release = new Promise(r => { open = r; });
    phraseAnswer = () => ({ phrases: [{ text: 'Grâce aux', phrase: 'grâce à', meaning_zh: '多亏', meaning_en: 'thanks to' }] });
    const first = tap('legacy', 'aux');
    const second = tap('legacy', 'Grâce');
    await wait(5);
    assert.equal(phraseCalls(), 1, 'simultaneous taps share one request');
    const sent = calls.find(c => c.url === '/api/phrase-context');
    assert.equal(sent.body.sentence, SENTENCES.legacy.sentence);
    assert.equal(sent.auth, 'Bearer test-token');
    open();
    release = null;
    await Promise.all([first, second]);
    await wait(10);
    assert.equal($('.popover-phrase').hidden, false, 'the answer upgrades the open card');
    assert.equal($('.popover-phrase-mark').textContent, 'Grâce aux');
    assert.deepEqual(highlighted(), ['Grâce', 'aux']);
    await tap('legacy', 'efforts');
    await tap('legacy', 'aux');
    assert.equal(phraseCalls(), 1, 'reopening asks nothing');
    assert.equal($('.popover-phrase-mark').textContent, 'Grâce aux');

    // 10. A negative answer is kept too
    const NEG = 'Nous travaillons beaucoup ensemble.';
    SENTENCES.neg = { sentence: NEG, words: [] };
    document.body.insertAdjacentHTML('beforeend', `<div class="sentence-card"><p class="sentence-french-text" id="line-neg">${renderWords(NEG)}</p></div>`);
    phraseIndex.set(srsSentenceKey(NEG), Object.assign(window.FrenchPhraseContext.fromAnalysis(SENTENCES.neg), { translation_zh: '' }));
    phraseAnswer = () => ({ phrases: [] });
    await tap('neg', 'travaillons');
    await wait(10);
    await tap('neg', 'beaucoup');
    await tap('neg', 'ensemble');
    assert.equal(phraseCalls(), 2, 'one request for the no-expression sentence, then none');
    assert.equal($('.popover-phrase').hidden, true);

    // 11. Logged out: never asks
    token = '';
    const LOGGED = 'Elles chantent souvent le soir.';
    SENTENCES.out = { sentence: LOGGED, words: [] };
    document.body.insertAdjacentHTML('beforeend', `<div class="sentence-card"><p class="sentence-french-text" id="line-out">${renderWords(LOGGED)}</p></div>`);
    phraseIndex.set(srsSentenceKey(LOGGED), window.FrenchPhraseContext.fromAnalysis(SENTENCES.out));
    await tap('out', 'chantent');
    assert.equal(phraseCalls(), 2);
    token = 'test-token';

    // 12. A selection / table chunk of the exact expression shows it, without a highlight
    const chip = document.getElementById('outside');
    const chunkLookups = lookups();
    await popover.show('à partir des', chip, { sentence: SENTENCE }, { silent: true });
    assert.equal($('.popover-phrase').hidden, false);
    assert.equal($('.popover-dict').hidden, true, 'the whole expression: its meaning is in 语境 only');
    assert.equal(lookups(), chunkLookups, 'and nothing to look up');
    assert.deepEqual(highlighted(), []);
    // ...but a partial selection does not claim it
    await popover.show('partir des sessions', chip, { sentence: SENTENCE }, { silent: true });
    assert.equal($('.popover-phrase').hidden, true);
    assert.equal(api.phraseTextFor(SENTENCE, 'partir'), 'À partir des', 'a table star keeps saving the expression');

    // 13. A nested lookup of a word inside the card is about that word alone
    await tap('a', 'partir', 0);
    $('.popover-phrase-canonical [data-lookup-word="de"]').click();
    await wait(10);
    assert.equal($('.popover-phrase').hidden, true, 'nested word: no expression');
    pop.querySelector('.popover-back').click();
    assert.deepEqual(highlighted(), ['À', 'partir', 'des'], 'back restores the highlight');

    // 14. Close clears the highlight; the 700ms settle still holds for phrase cards
    await tap('a', 'partir', 0);
    document.getElementById('outside').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(popover.isOpen(), true, 'settle: synthetic mousedown / scroll keep it open');
    await wait(720);
    document.getElementById('outside').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    assert.equal(popover.isOpen(), false);
    assert.deepEqual(highlighted(), [], 'closing clears the highlight');

    console.log('PASS: fixed expressions on the word card (match, highlight, cache, no markup).');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
