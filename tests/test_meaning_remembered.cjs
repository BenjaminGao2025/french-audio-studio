// Run with: node tests/test_meaning_remembered.cjs
// On a phone the tap on the selection bar can clear the selection, collapse its box to 0x0 and
// hide the bar (state gone) before pointerup. Meaning and Read must still act on the text the
// bar was showing; the click that ends the tap must not fall through to the word under the bar;
// and the phrase popover must not close while its own phrase stays selected.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const SENTENCE = 'Le passage peut être empêché par la neige.';
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
const rectFor = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const boxes = new Map();
// collapsed: the phone dropped the selection and every live range box is now 0x0
let collapsed = false;
window.Element.prototype.getClientRects = function () { const r = boxes.get(this); return r ? [r] : []; };
window.Element.prototype.getBoundingClientRect = function () { return boxes.get(this) || rectFor(0, 0, 0, 0); };
window.Range.prototype.getBoundingClientRect = function () { return collapsed ? rectFor(0, 0, 0, 0) : rectFor(60, 100, 260, 124); };
window.Range.prototype.getClientRects = function () { return collapsed ? [] : [this.getBoundingClientRect()]; };

const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
const line = document.getElementById('line');
line.innerHTML = render(SENTENCE);
const words = [...line.querySelectorAll('.interactive-word')];
words.forEach((w, i) => boxes.set(w, rectFor(8 + i * 36, 100, 40 + i * 36, 120)));

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
const selectionBar = window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    speak: text => spoken.push(`READ:${text}`),
    meaning: (text, anchor, context) => {
        meanings.push({ text, box: anchor.getBoundingClientRect() });
        popover.show(text, anchor, context, { silent: true });
    },
    contextFor: () => ({ sentence: SENTENCE, sentence_cn: '' }),
});
// Like study.js: a tap on a word opens (and speaks) that word
document.addEventListener('click', (e) => {
    const word = e.target.closest('.interactive-word');
    if (word && window.FrenchReadSelection.isTap(e)) popover.show(word.dataset.word, word, { sentence: SENTENCE });
});

const bar = document.querySelector('.read-selection-bar');
const meaningBtn = bar.querySelector('.rs-meaning');
const readBtn = bar.querySelector('.rs-read');
const wait = ms => new Promise(r => setTimeout(r, ms));
const byWord = w => words.find(el => el.dataset.word === w);

const select = (fromWord, toWord) => {
    const range = document.createRange();
    range.setStartBefore(byWord(fromWord));
    range.setEndAfter(byWord(toWord));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
};
const press = btn => btn.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch', cancelable: true }));
const lift = btn => btn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'touch', cancelable: true }));
// The phone drops the selection mid-tap, its box collapses, and another path hides the bar
const dropSelectionMidTap = () => {
    window.getSelection().removeAllRanges();
    collapsed = true;
    document.dispatchEvent(new window.Event('selectionchange'));
    selectionBar.hide();
};

(async () => {
    // 1. Meaning after the selection, its box and the bar state are all gone
    select('peut', 'empêché');
    await wait(350);
    assert.equal(bar.hidden, false, 'bar shows for the selection');
    assert.equal(selectionBar.current(), 'peut être empêché');
    press(meaningBtn);
    dropSelectionMidTap();
    assert.equal(selectionBar.current(), '', 'live state is gone before pointerup');
    spoken.length = 0;
    lift(meaningBtn);
    await wait(20);
    assert.equal(meanings.length, 1, 'Meaning runs on the remembered text');
    assert.equal(meanings[0].text, 'peut être empêché');
    const box = meanings[0].box;
    assert(box.width > 0 || box.height > 0, 'anchor box is not 0x0, so show() does not bail out');
    assert.equal(popover.isOpen(), true, 'lookup popover opens');
    assert.match(popover.element.querySelector('.popover-word').textContent, /peut.*empêché/);
    assert.equal(spoken.length, 0, 'Meaning stays silent');

    // 2. The click that ends the tap lands on the word that was under the hidden bar. A real
    // trailing click carries the tap's position, i.e. where the Meaning button was.
    const ghostAt = { clientX: parseFloat(bar.style.left) + 4, clientY: parseFloat(bar.style.top) + 4 };
    byWord('par').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...ghostAt }));
    await wait(20);
    assert.equal(spoken.length, 0, 'the trailing click does not open and speak the word under the bar');
    assert.match(popover.element.querySelector('.popover-word').textContent, /peut.*empêché/, 'phrase popover still shown');
    // A real tap later still works
    await wait(650);
    byWord('par').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    await wait(20);
    assert.deepEqual(spoken, ['par'], 'a later tap on a word still opens it');
    popover.close();

    // 3. Read selection speaks the remembered text the same way
    collapsed = false;
    select('peut', 'empêché');
    await wait(350);
    press(readBtn);
    dropSelectionMidTap();
    spoken.length = 0;
    lift(readBtn);
    await wait(20);
    assert.deepEqual(spoken, ['READ:peut être empêché'], 'Read speaks the remembered text');
    await wait(650);

    // 4. Selection kept on Meaning (touchstart preventDefault worked): the popover's own
    // selectionchange handling must not close it while that phrase is still selected...
    collapsed = false;
    meanings.length = 0;
    select('peut', 'empêché');
    await wait(350);
    press(meaningBtn);
    lift(meaningBtn);
    await wait(20);
    assert.equal(meanings.length, 1);
    document.dispatchEvent(new window.Event('selectionchange'));
    await wait(700);
    assert.equal(popover.isOpen(), true, 'popover stays open over its own still-selected phrase');
    // ...but selecting other words still closes it
    select('la', 'neige');
    await wait(700);
    assert.equal(popover.isOpen(), false, 'a new selection closes the stale phrase popover');

    console.log('PASS: Meaning/Read act on the remembered selection; trailing click swallowed; popover survives its own selection.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
