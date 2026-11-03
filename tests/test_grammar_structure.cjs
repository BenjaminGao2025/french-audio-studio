// Run with: node tests/test_grammar_structure.cjs (uses the frontend's jsdom).
// /study sentence header Repeat switch, the N/V/S structure bar, and the /grammar map rendering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/study' });
const { window } = dom;
const { document } = window;
window.localStorage.setItem('frenchStudio.uiLang', 'zh');
window.eval(read('i18n.js'));
window.eval(read('playback.js'));

// ---- The header and structure-bar functions, cut out of study.js ----
const study = read('study.js');
const start = study.indexOf('    function accentNoteHtml(');
const end = study.indexOf('    // Answer options ("A.", "B.") are labels');
assert(start > 0 && end > start, 'header + structure bar source');
const escapeHtml = s => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '');
const T = {
    accentFixedNote: o => o, hideBreakdown: 'hide', showBreakdown: 'show', listenSentence: 'listen', readSentenceAria: 'read',
    selectWordsTitle: 'select', selectWordsAria: 'select', sentenceAdd: 'add', addToReview: 'add',
    structureAria: '句子结构', structureBlock: { N: '名词组', V: '动词', S: '句子怎么组织' }, grammarMapLink: '语法地图',
};
const fns = new Function('window', 'T', 'escapeHtml', 'EN', 'pick', 'renderInteractiveWordsHtml',
    `${study.slice(start, end)}; return { sentenceHeadHtml, structureBarHtml, bindStructureBar };`)(
    window, T, escapeHtml, false, window.FrenchI18n.pick, text => escapeHtml(text));

// ---- Task A: a short sentence (no build-up) still has a Repeat switch in its header ----
const card = document.createElement('article');
card.className = 'sentence-card is-open';
card.innerHTML = fns.sentenceHeadHtml({ sentenceText: "Tu peux m'aider ?", transEn: 'Can you help me?', transZh: '你能帮我吗？', idx: 0, total: 1, open: true });
document.body.appendChild(card);
const headRepeat = card.querySelector('.sentence-head-actions .btn-repeat-toggle.btn-head-repeat');
assert(headRepeat, 'the sentence header has its own Repeat switch');
assert.equal(headRepeat.getAttribute('aria-pressed'), 'false');
assert.equal(card.querySelectorAll('.btn-step-repeat').length, 1, 'one Repeat switch, styled like the step ones');

// The study.js click handler: switching Repeat on loops the sentence right away
const handlerStart = study.indexOf('        // 1b. Sentence Repeat');
const handlerEnd = study.indexOf('        // 2. Token Pronunciation Buttons');
assert(handlerStart > 0 && handlerEnd > handlerStart, 'Repeat handler source');
const played = [];
new Function('window', 'card', 'targetSentence', 'playFrenchSpeech', study.slice(handlerStart, handlerEnd))(
    window, card, "Tu peux m'aider ?", text => played.push(text));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

(async () => {
// The page-wide Repeat listener (playback.js) flips the setting as the click bubbles up; the
// header handler reads it afterwards
headRepeat.click();
await tick();
assert.equal(window.FrenchPlayback.repeat(), true, 'the click switched Repeat on');
assert.equal(headRepeat.getAttribute('aria-pressed'), 'true');
assert.deepEqual(played, ["Tu peux m'aider ?"], 'and started the sentence');
headRepeat.click();
await tick();
assert.equal(window.FrenchPlayback.repeat(), false, 'a second click switches it off');
assert.deepEqual(played, ["Tu peux m'aider ?"], 'switching off does not play again');

// ---- Structure bar ----
assert.equal(fns.structureBarHtml(undefined), '', 'old history without structure renders nothing');
assert.equal(fns.structureBarHtml([{ text: 'x', block: 'Q' }, { text: '', block: 'N' }]), '', 'invalid spans are skipped');
const structure = [
    { text: 'Tu', block: 'N', role: '主语代词', detail: 'tu · 第二人称单数', gid: 'N.pronoun.subject', gid_zh: '主语代词', gid_en: 'subject pronouns' },
    { text: 'peux', block: 'V', role: '情态动词', detail: 'pouvoir · tu · 直陈式现在时', gid: 'V.present.pouvoir', gid_zh: '现在时：pouvoir', gid_en: 'pouvoir' },
    { text: '<img src=x onerror=alert(1)>', block: 'S', role: '<b>role</b>', detail: '"quoted" & <i>', gid: null },
    { text: 'bad', block: 'X', role: 'dropped' },
];
const body = document.createElement('div');
body.innerHTML = fns.structureBarHtml(structure);
card.appendChild(body);
fns.bindStructureBar(card, structure);
const spans = [...card.querySelectorAll('.structure-span')];
assert.deepEqual(spans.map(s => s.dataset.block), ['N', 'V', 'S'], 'one button per valid span, in order');
assert(spans.every(s => s.tagName === 'BUTTON' && s.type === 'button'), 'spans are buttons');
assert.equal(spans[2].textContent, '<img src=x onerror=alert(1)>', 'span text is escaped, not parsed');
assert.equal(card.querySelectorAll('img, b, i:not([data-lucide])').length, 0, 'no injected markup');
assert.match(spans[1].getAttribute('aria-label'), /peux · 动词 · 情态动词/);
const legend = [...card.querySelectorAll('.structure-key')].map(k => `${k.dataset.block}:${k.textContent}`);
assert.deepEqual(legend, ['N:名词组', 'V:动词', 'S:句子怎么组织'], 'legend for the three colours');
assert.equal(card.querySelector('.structure-map-link').getAttribute('href'), '/grammar');

const detail = card.querySelector('.structure-detail');
assert.equal(detail.hidden, true);
spans[1].click();
assert.equal(detail.hidden, false, 'a tap shows the detail');
assert.equal(spans[1].getAttribute('aria-expanded'), 'true');
assert.equal(detail.querySelector('.structure-detail-role').textContent, '情态动词');
assert.equal(detail.querySelector('.structure-detail-text').textContent, 'pouvoir · tu · 直陈式现在时');
const chip = detail.querySelector('.structure-gid-chip');
assert.equal(chip.textContent, '现在时：pouvoir', 'Chinese name of the grammar point');
assert.equal(chip.getAttribute('href'), '/grammar#V.present.pouvoir');
spans[2].click();
assert.equal(spans[1].getAttribute('aria-expanded'), 'false', 'only one span open');
assert.equal(detail.querySelector('.structure-gid-chip'), null, 'no chip without a grammar point');
assert.equal(detail.querySelector('.structure-detail-role').textContent, '<b>role</b>');
assert.equal(detail.querySelector('.structure-detail-text').textContent, '"quoted" & <i>');
assert.equal(detail.querySelectorAll('b, i').length, 0);
spans[2].click();
assert.equal(detail.hidden, true, 'a second tap closes it');

// ---- /grammar map ----
const page = new JSDOM(`<!DOCTYPE html><body><button id="lang-toggle"></button><p id="grammar-status"></p>
    <section id="grammar-login" hidden></section><div id="grammar-map"></div></body>`,
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/grammar' });
const pw = page.window;
pw.localStorage.setItem('frenchStudio.uiLang', 'zh');
pw.HTMLElement.prototype.scrollIntoView = () => {};
const requests = [];
pw.fetch = async (url) => {
    requests.push(url);
    return { ok: true, status: 200, json: async () => ({ point: { explain_zh: '<b>x</b>' }, sentences: [{ sentence: '<script>alert(1)</script>Tu peux.' }] }) };
};
pw.eval(read('i18n.js'));
pw.eval(read('grammar.js'));
assert.equal(pw.document.getElementById('grammar-login').hidden, false, 'not logged in: the login link shows');
assert.deepEqual(requests, [], 'and nothing is fetched');
const { renderMap } = pw.FrenchGrammarMap;
renderMap({
    seen: 1,
    blocks: [
        { id: 'N', zh: '名词组', en: 'Noun group', points: [{ id: 'N.gender', zh: '名词的阴阳性', fr: 'le genre', en: 'gender', level: 'A1', focus: false, count: 0 }] },
        { id: 'V', zh: '动词', en: 'Verb', points: [{ id: 'V.present.pouvoir', zh: '现在时：pouvoir', fr: '<i>pouvoir</i>', en: 'pouvoir', level: 'A1', focus: true, count: 3 }] },
        { id: 'S', zh: '句子怎么组织', en: 'Sentence building', points: [] },
    ],
});
const pd = pw.document;
assert.deepEqual([...pd.querySelectorAll('.grammar-block h2')].map(h => h.textContent), ['名词组', '动词', '句子怎么组织']);
const focus = pd.querySelector('.grammar-point.is-focus');
assert.equal(focus.querySelector('.grammar-count').textContent, '见过 3 次');
assert.equal(focus.querySelector('.grammar-point-fr').textContent, '<i>pouvoir</i>', 'escaped');
assert.equal(pd.querySelector('.grammar-point:not(.is-focus) .grammar-count').textContent, '还没见过');
assert.match(pd.getElementById('grammar-status').textContent, /1 \/ 2/);
focus.querySelector('.grammar-point-btn').click();
await tick();
assert.deepEqual(requests, ['/api/grammar/V.present.pouvoir/sentences']);
const panel = focus.querySelector('.grammar-point-panel');
assert.equal(panel.hidden, false);
assert.equal(panel.querySelector('.grammar-explain').textContent, '<b>x</b>');
assert.equal(panel.querySelector('.grammar-sentences li').textContent, '<script>alert(1)</script>Tu peux.', 'own sentences, escaped');
assert.equal(panel.querySelectorAll('script, b').length, 0);
console.log('grammar structure ok');
})().catch(err => { console.error(err); process.exit(1); });
