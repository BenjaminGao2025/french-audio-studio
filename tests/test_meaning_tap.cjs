// Run with: node tests/test_meaning_tap.cjs
// Meaning on the selection bar must open the lookup without speaking, and a mid-tap
// selectionchange (phone clearing the selection) must not hide the bar before the action runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const SENTENCE = 'Nul ne doit être inquiété pour ses opinions, même religieuses, pourvu que leur manifestation ne trouble pas.';
const dom = new JSDOM(
    `<body><div class="sentence-card is-open"><p class="sentence-french-text" lang="fr" id="line"></p></div></body>`,
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' },
);
const { document, window } = dom.window;
window.requestAnimationFrame = fn => setTimeout(fn, 0);
// jsdom has no PointerEvent; the production bar listens for pointerup/pointerdown
window.PointerEvent = class PointerEvent extends window.MouseEvent {
    constructor(type, init = {}) {
        super(type, init);
        this.pointerType = init.pointerType || '';
        this.pointerId = init.pointerId || 1;
    }
};
const rectFor = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const boxes = new Map();
window.Element.prototype.getClientRects = function () { const r = boxes.get(this); return r ? [r] : []; };
window.Element.prototype.getBoundingClientRect = function () { return boxes.get(this) || rectFor(0, 0, 0, 0); };
window.Range.prototype.getBoundingClientRect = function () { return rectFor(40, 100, 280, 124); };
window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };

const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
document.getElementById('line').innerHTML = render(SENTENCE);
const line = document.getElementById('line');
[...line.querySelectorAll('.interactive-word')].forEach((w, i) => boxes.set(w, rectFor(8 + i * 36, 100, 40 + i * 36, 120)));

window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
window.eval(read('read-selection.js'));

const spoken = [];
const meanings = [];
const popover = window.FrenchWordPopover.create({
    speak: text => spoken.push(text),
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, text) => ({ token: text, lemma: lower, pos: 'phrase', phonetic: '', explanation_en: `meaning of ${text}`, explanation_cn: '' }),
});
window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    speak: text => spoken.push(`READ:${text}`),
    meaning: (text, anchor, context) => {
        meanings.push(text);
        popover.show(text, anchor, context, { silent: true });
    },
    contextFor: () => ({ sentence: SENTENCE, sentence_cn: '' }),
});

const bar = document.querySelector('.read-selection-bar');
const meaningBtn = bar.querySelector('.rs-meaning');
const readBtn = bar.querySelector('.rs-read');
assert(bar && meaningBtn && readBtn, 'bar markup');

const selectPhrase = () => {
    const words = [...line.querySelectorAll('.interactive-word')];
    const from = words.find(w => w.dataset.word === 'ne');
    const to = words.find(w => w.dataset.word === 'inquiété');
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
};

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    selectPhrase();
    await wait(350);
    assert.equal(bar.hidden, false, 'bar shows for a native selection');
    assert.equal(meaningBtn.hidden, false, 'Meaning is offered for a short phrase');

    // Mid-tap: OS clears the selection and fires selectionchange while the finger is on Meaning.
    // Old code hid the bar; new code keeps it because pressing is set on pointerdown/touchstart.
    meaningBtn.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch', cancelable: true }));
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new window.Event('selectionchange'));
    assert.equal(bar.hidden, false, 'selectionchange while pressing must not hide the bar');

    spoken.length = 0;
    meanings.length = 0;
    meaningBtn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch', cancelable: true }));
    await wait(20);
    assert.equal(meanings.length, 1, 'Meaning runs from pointerup');
    assert.match(meanings[0], /ne.*inquiété/i);
    assert.equal(spoken.length, 0, 'Meaning must not auto-speak');
    assert.equal(popover.isOpen(), true, 'lookup popover opens');
    assert.match(popover.element.querySelector('.popover-word').textContent, /ne|inquiété/i);

    // A following synthetic click must not double-fire Meaning
    meanings.length = 0;
    meaningBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await wait(20);
    assert.equal(meanings.length, 0, 'click after pointerup is ignored');

    popover.close();
    selectPhrase();
    await wait(350);
    spoken.length = 0;
    readBtn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch' }));
    await wait(20);
    assert.equal(spoken[0] && spoken[0].startsWith('READ:'), true, 'Read selection still speaks');

    // Direct silent flag on show()
    spoken.length = 0;
    const w = line.querySelector('.interactive-word');
    await popover.show(w.dataset.word, w, { sentence: SENTENCE }, { silent: true });
    assert.equal(spoken.length, 0, 'silent show skips speak');
    spoken.length = 0;
    await popover.show(w.dataset.word, w, { sentence: SENTENCE });
    assert.equal(spoken.length, 1, 'normal show still speaks');

    console.log('PASS: Meaning stays tappable mid-selection-clear, opens silently; Read still speaks.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
