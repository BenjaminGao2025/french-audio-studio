// Run with: node tests/test_word_tap_during_sel.cjs
// With a selection + Read/Meaning bar up, tapping a DIFFERENT word must open that word's
// popover (old isTap-blocked-everything / ghost-swallow-everywhere behavior failed this).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const LONG = 'toutes dignités, places et emplois publics.';
const OTHER = 'étant';
const SENTENCE = `Les hommes ${LONG} ${OTHER} égaux à ses yeux.`;

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
window.Range.prototype.getBoundingClientRect = function () { return rectFor(20, 100, 400, 124); };
window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };

const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
// Extract wordAtTap the same way study defines it (needs FrenchReadSelection + FrenchWordPopover)
const watStart = study.indexOf('    const WORD_TAP_SLOP = 22;');
const watEnd = study.indexOf('\n    }\n\n\n    // -------------------------------------------------------------------------\n    // 9. Text Analysis Request', watStart);
assert(watStart > 0 && watEnd > watStart, 'wordAtTap source');

const line = document.getElementById('line');
line.innerHTML = render(SENTENCE);
[...line.querySelectorAll('.interactive-word')].forEach((w, i) => boxes.set(w, rectFor(8 + i * 30, 100, 36 + i * 30, 120)));

window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
window.eval(read('read-selection.js'));

const spoken = [];
const opened = [];
const popover = window.FrenchWordPopover.create({
    speak: t => spoken.push(t),
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, text) => ({ token: text, lemma: lower, pos: 'n.', phonetic: '', explanation_en: text, explanation_cn: '' }),
});
window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    speak: t => spoken.push(`READ:${t}`),
    meaning: (text, anchor, ctx) => popover.show(text, anchor, ctx, { silent: true }),
    contextFor: () => ({ sentence: SENTENCE, sentence_cn: '' }),
});

const wordAtTap = new Function('window', `${study.slice(watStart, watEnd + 6)}; return wordAtTap;`)(window);

const bar = document.querySelector('.read-selection-bar');
const wait = ms => new Promise(r => setTimeout(r, ms));
const by = (part) => [...line.querySelectorAll('.interactive-word')].find(w => (w.dataset.word || w.textContent).includes(part));

(async () => {
    // Select the long phrase
    const from = by('toutes');
    const to = by('publics');
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(350);
    assert.equal(bar.hidden, false, 'bar up for long selection');
    assert.equal(window.FrenchReadSelection.isTap({ detail: 1, clientX: 10, clientY: 10 }), false, 'isTap still false with selection');

    // Tap a different word — must resolve through wordAtTap and open popover
    const other = by('étant');
    assert(other, 'other word');
    const hit = wordAtTap({ target: other, detail: 1, clientX: 50, clientY: 110 });
    assert.equal(hit, other, 'wordAtTap returns the other word despite selection');
    assert.equal(bar.hidden, true, 'selection bar dismissed');
    assert.equal(window.getSelection().isCollapsed, true, 'selection cleared');

    await popover.show(other.dataset.word, other, { sentence: SENTENCE });
    assert.equal(popover.isOpen(), true);
    assert.match(popover.element.querySelector('.popover-word').textContent, /étant/i);
    assert.ok(spoken.includes(other.dataset.word) || spoken.some(s => s.includes('étant')), 'word tap still speaks');

    // Ghost swallow must not block a far-away word after Meaning
    window.getSelection().removeAllRanges();
    range.setStartBefore(from);
    range.setEndAfter(to);
    window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(350);
    boxes.set(bar, rectFor(200, 40, 380, 84));
    // Fake remembered bar box via place by reading — fire Meaning pointerup
    const meaningBtn = bar.querySelector('.rs-meaning');
    meaningBtn.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' }));
    meaningBtn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch', clientX: 220, clientY: 50 }));
    await wait(20);
    // Far word: pointerdown updates press point first (as a real tap would), then wordAtTap
    const far = by('étant');
    const farBox = far.getBoundingClientRect();
    const fx = farBox.left + 2, fy = farBox.top + 2;
    far.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: fx, clientY: fy, pointerType: 'touch' }));
    const again = wordAtTap({ target: far, detail: 1, clientX: fx, clientY: fy });
    assert.equal(again, far, 'after Meaning, another word tap still resolves');

    console.log('PASS: word tap during selection opens the other word; isTap selection rule unchanged.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
