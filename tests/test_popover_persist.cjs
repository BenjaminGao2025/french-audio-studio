// Run with: node tests/test_popover_persist.cjs
// After Meaning opens a phrase card, selection settle / synthetic mousedown / scroll must not
// auto-dismiss it (Ben: "选完后有时候会自动消失").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const PHRASE = 'également admissibles à toutes dignités, places et emplois publics';
const SENTENCE = `Tous les citoyens ${PHRASE}.`;

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
window.Range.prototype.getBoundingClientRect = function () { return rectFor(20, 120, 420, 160); };
window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };

const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
document.getElementById('line').innerHTML = render(SENTENCE);
[...document.querySelectorAll('.interactive-word')].forEach((w, i) => boxes.set(w, rectFor(8 + i * 24, 120, 30 + i * 24, 140)));

window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
window.eval(read('read-selection.js'));

const spoken = [];
const popover = window.FrenchWordPopover.create({
    speak: t => spoken.push(t),
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, text) => ({ token: text, lemma: lower, pos: 'phrase', phonetic: '', explanation_en: text, explanation_cn: '' }),
});
window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    speak: () => {},
    meaning: (text, anchor, ctx) => popover.show(text, anchor, ctx, { silent: true }),
    contextFor: () => ({ sentence: SENTENCE, sentence_cn: '' }),
});

const bar = document.querySelector('.read-selection-bar');
const wait = ms => new Promise(r => setTimeout(r, ms));
const by = (part) => [...document.querySelectorAll('.interactive-word')].find(w => (w.dataset.word || '').includes(part) || w.textContent.includes(part));

(async () => {
    const from = by('également');
    const to = by('publics');
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(350);
    assert.equal(bar.hidden, false);

    // Meaning → open silent phrase card
    const meaningBtn = bar.querySelector('.rs-meaning');
    meaningBtn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch', clientX: 200, clientY: 40 }));
    await wait(30);
    assert.equal(popover.isOpen(), true, 'Meaning opened the card');
    assert.equal(spoken.length, 0, 'silent');

    // 1) Synthetic mousedown between chips (not on .interactive-word) — old code closed immediately
    const line = document.getElementById('line');
    line.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 15, clientY: 130 }));
    assert.equal(popover.isOpen(), true, 'mousedown under the bar during settle must not close');

    // 2) selectionchange while OS adjusts handles — mutate live selection but coversRange uses clone
    const tweaked = document.createRange();
    tweaked.setStartBefore(from);
    tweaked.setEndAfter(by('emplois') || to);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(tweaked);
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(650); // past selection schedule (600ms) but clone should still cover / settle may apply
    assert.equal(popover.isOpen(), true, 'selection settle must not auto-close Meaning card');

    // 3) scroll during settle (mobile chrome)
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(popover.isOpen(), true, 'scroll during settle must not close');

    // After settle, tapping empty non-word area still closes
    await wait(800);
    line.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 15, clientY: 130 }));
    assert.equal(popover.isOpen(), false, 'after settle, mousedown outside still closes');

    console.log('PASS: Meaning card survives settle mousedown/selection/scroll; still closes after.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
