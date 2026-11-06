// Run with: node tests/test_meaning_visible.cjs
// Meaning must stay on the selection bar for phrases longer than the old 40-char cap, and the
// bar must not vanish on selectionchange while the selection is still valid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const LONG = 'à toutes dignités, places et emplois publics.';
assert.ok(LONG.length > 40 && LONG.length <= 200, 'fixture longer than old cap');
const MEDIUM = 'étant égaux à ses yeux';

const dom = new JSDOM(
    `<body><div class="sentence-card is-open"><p class="sentence-french-text" lang="fr" id="line"></p></div></body>`,
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' },
);
const { document, window } = dom.window;
window.requestAnimationFrame = fn => setTimeout(fn, 0);
window.PointerEvent = class PointerEvent extends window.MouseEvent {
    constructor(type, init = {}) {
        super(type, init);
        this.pointerType = init.pointerType || '';
        this.pointerId = init.pointerId || 1;
    }
};
const rectFor = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
const boxes = new Map();
window.Element.prototype.getClientRects = function () { const r = boxes.get(this); return r ? [r] : []; };
window.Element.prototype.getBoundingClientRect = function () { return boxes.get(this) || rectFor(0, 0, 0, 0); };
window.Range.prototype.getBoundingClientRect = function () { return rectFor(20, 100, 360, 124); };
window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };

const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
const line = document.getElementById('line');
line.innerHTML = render(`Tous sont ${LONG} ${MEDIUM}.`);
[...line.querySelectorAll('.interactive-word')].forEach((w, i) => boxes.set(w, rectFor(8 + i * 28, 100, 34 + i * 28, 120)));

window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
window.eval(read('read-selection.js'));

const spoken = [];
const meanings = [];
const popover = window.FrenchWordPopover.create({
    speak: t => spoken.push(t),
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, text) => ({ token: text, lemma: lower, pos: 'phrase', phonetic: '', explanation_en: text, explanation_cn: '' }),
});
window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    speak: t => spoken.push(`READ:${t}`),
    meaning: (text, anchor, ctx) => { meanings.push(text); popover.show(text, anchor, ctx, { silent: true }); },
    contextFor: () => ({ sentence: line.textContent, sentence_cn: '' }),
});

const bar = document.querySelector('.read-selection-bar');
const meaningBtn = bar.querySelector('.rs-meaning');
const readBtn = bar.querySelector('.rs-read');
const wait = ms => new Promise(r => setTimeout(r, ms));

const selectByWords = async (fromWord, toWord) => {
    const words = [...line.querySelectorAll('.interactive-word')];
    const from = words.find(w => (w.dataset.word || w.textContent).includes(fromWord));
    const to = words.find(w => (w.dataset.word || w.textContent).includes(toWord));
    assert(from && to, `words ${fromWord}..${toWord}`);
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(350);
};

(async () => {
    // Long phrase: Meaning button must remain (old code hid it at 40 chars)
    await selectByWords('toutes', 'publics');
    assert.equal(bar.hidden, false, 'bar shows for long phrase');
    assert.equal(readBtn.hidden, false, 'Read shows');
    assert.equal(meaningBtn.hidden, false, `Meaning must show for ${LONG.length}-char phrase`);
    // selectionchange while still selected must not hide the bar
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(50);
    assert.equal(bar.hidden, false, 'selectionchange does not blank a valid selection bar');

    meanings.length = 0;
    spoken.length = 0;
    meaningBtn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch' }));
    await wait(30);
    assert.equal(meanings.length, 1, 'Meaning opens for long phrase');
    assert.ok(meanings[0].length > 40, 'lookup text keeps the long phrase');
    assert.equal(spoken.length, 0, 'Meaning stays silent');
    assert.equal(popover.isOpen(), true);

    popover.close();
    // Medium phrase that previously sometimes showed no bar
    await selectByWords('étant', 'yeux');
    assert.equal(bar.hidden, false, 'bar shows for medium phrase');
    assert.equal(meaningBtn.hidden, false);

    // show() accepts >40
    spoken.length = 0;
    const anchor = { getBoundingClientRect: () => rectFor(40, 100, 280, 124) };
    await popover.show(LONG, anchor, {}, { silent: true });
    assert.equal(popover.isOpen(), true, 'show() accepts phrases up to 200 chars');

    console.log('PASS: Meaning stays visible past 40 chars; bar survives selectionchange; show accepts long phrases.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
