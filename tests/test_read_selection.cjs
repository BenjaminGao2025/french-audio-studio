// Run with: node tests/test_read_selection.cjs (uses the frontend's jsdom).
// Read selection on /study: a mouse drag, a system selection (long press) and the per-sentence
// range mode all end in the floating bar, whose Read button speaks exactly the snapped words.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const SENTENCE = "J'ai déjà deux enfants, et ma femme est enceinte, donc nous cherchons un appartement.";
const dom = new JSDOM(
    `<body><div class="sentence-card is-open"><div class="sentence-head">
        <p class="sentence-french-text" lang="fr" id="line"></p>
        <button class="btn-range-select" type="button" data-range-toggle aria-pressed="false"></button>
    </div></div></body>`,
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' },
);
const { document, window } = dom.window;
window.requestAnimationFrame = fn => setTimeout(fn, 0);

// The word markup study.js renders, with the punctuation kept inside the word
const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
assert(start > 0 && end > start, 'renderInteractiveWordsHtml source');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
document.getElementById('line').innerHTML = render(SENTENCE);
const line = document.getElementById('line');
const byWord = Object.fromEntries([...line.querySelectorAll('.interactive-word')].map(w => [w.dataset.word, w]));

// Geometry: words on one line, ranges with a box
const rectFor = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const boxes = new Map();
window.Element.prototype.getClientRects = function () { const r = boxes.get(this); return r ? [r] : []; };
window.Element.prototype.getBoundingClientRect = function () { return boxes.get(this) || rectFor(0, 0, 0, 0); };
window.Range.prototype.getBoundingClientRect = function () { return rectFor(10, 10, 110, 30); };
window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
// "J'ai" 8-34, "déjà" 38-72, "deux" 100-140, "enfants," 146-212 on one line at y 100..120
boxes.set(byWord["J'ai"], rectFor(8, 100, 34, 120));
boxes.set(byWord.déjà, rectFor(38, 100, 72, 120));
boxes.set(byWord.deux, rectFor(100, 100, 140, 120));
boxes.set(byWord.enfants, rectFor(146, 100, 212, 120));
boxes.set(byWord.ma, rectFor(216, 100, 240, 120));
boxes.set(byWord.femme, rectFor(244, 100, 292, 120));

// The shared word popover (a selected phrase no longer opens it: selectionPopover false)
window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
const spoken = [];
const popover = window.FrenchWordPopover.create({
    speak: text => spoken.push(text),
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, word) => ({ token: word, lemma: lower, pos: 'noun', phonetic: '', explanation_en: `meaning of ${word}`, explanation_cn: '' }),
});
window.eval(read('read-selection.js'));
const rs = window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    rangeLineFor: (toggle) => document.querySelector('.sentence-french-text'),
    speak: (text) => spoken.push(text),
    meaning: (text, anchor, context) => popover.show(text, anchor, context),
    contextFor: () => ({ sentence: SENTENCE }),
    openWord: () => popover.activeElement(),
});
const bar = rs.bar;
const settled = (ms = 450) => new Promise(resolve => setTimeout(resolve, ms));
const mouse = (type, target, x, y, extra = {}) =>
    target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra }));
const select = (from, to) => {
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to || from);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
};

(async () => {
    // ---- A tap is a tap; a drag is not ----
    const { isTap } = window.FrenchReadSelection;
    mouse('mousedown', byWord.deux, 120, 110);
    assert.equal(isTap({ detail: 1, clientX: 120, clientY: 110 }), true, 'a click where the press was is a tap');
    mouse('mousedown', byWord.deux, 120, 110);
    assert.equal(isTap({ detail: 1, clientX: 220, clientY: 110 }), false, 'a click away from the press is a drag');
    select(byWord.deux);
    assert.equal(isTap({ detail: 1, clientX: 120, clientY: 110 }), false, 'with text selected nothing is a tap');
    window.getSelection().removeAllRanges();
    await settled(50);

    // ---- Mouse drag: press on one word, move to another, release ----
    assert.equal(bar.hidden, true, 'no bar before anything is selected');
    mouse('mousedown', byWord.deux, 120, 110);
    mouse('mousemove', byWord.enfants, 210, 110);
    assert.equal(bar.hidden, false, 'the bar follows the drag');
    mouse('mouseup', document, 210, 110);
    await settled(50);
    assert.equal(bar.hidden, false, 'the bar stays after mouseup');
    assert.equal(rs.current(), 'deux enfants', 'the drag snapped to whole words, first word included');
    assert.equal(popover.isOpen(), false, 'a drag opens no word popover');
    bar.querySelector('.rs-read').click();
    assert.deepEqual(spoken, ['deux enfants'], 'Read speaks exactly the dragged words');
    await settled(50);

    // ---- A system selection (long press with handles) ----
    window.getSelection().removeAllRanges();
    bar.hidden = true;
    spoken.length = 0;
    select(byWord.femme);
    await settled();
    assert.equal(bar.hidden, false, 'a selected word shows the bar');
    assert.equal(popover.isOpen(), false, 'a single selected word does not open the popover');
    bar.querySelector('.rs-read').click();
    assert.deepEqual(spoken, ['femme'], 'Read speaks the selected word');
    // …and a selected phrase reads as a phrase, or opens its meaning
    select(byWord.ma, byWord.femme);
    await settled();
    assert.equal(rs.current(), 'ma femme', 'the phrase is snapped');
    bar.querySelector('.rs-read').click();
    assert.deepEqual(spoken, ['femme', 'ma femme']);
    bar.querySelector('.rs-meaning').click();
    assert.equal(popover.isOpen(), true, 'Meaning opens the phrase popover');
    assert.equal(popover.element.querySelector('.popover-word').textContent.trim(), 'ma femme');
    assert.deepEqual(spoken, ['femme', 'ma femme', 'ma femme'], 'the popover speaks the phrase too');
    popover.close();
    await settled(50);

    // ---- Range mode: the sentence's Select switch, then the first and the last word ----
    window.getSelection().removeAllRanges();
    const toggle = document.querySelector('[data-range-toggle]');
    toggle.click();
    assert.equal(line.classList.contains('is-range-mode'), true, 'the switch puts the line in range mode');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(bar.hidden, false, 'the bar explains the mode');
    assert.equal(bar.querySelector('.rs-hint').textContent, 'Tap the first word');
    assert.equal(bar.querySelector('.rs-read').hidden, true, 'nothing to read before the second word');
    byWord.deux.click();
    assert.equal(bar.querySelector('.rs-hint').textContent, 'Tap the last word');
    assert.equal(byWord.deux.classList.contains('is-range-word'), true, 'the first word is marked');
    byWord.enfants.click();
    await settled(20);
    assert.equal(rs.current(), 'deux enfants', 'the picked span is snapped');
    assert.equal(bar.querySelector('.rs-hint').hidden, true, 'the hint goes away');
    bar.querySelector('.rs-read').click();
    assert.deepEqual(spoken, ['femme', 'ma femme', 'ma femme', 'deux enfants'], 'Read speaks the picked span');
    bar.querySelector('.rs-done').click();
    assert.equal(bar.hidden, true, 'Done leaves range mode');
    assert.equal(line.classList.contains('is-range-mode'), false);
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(byWord.deux.classList.contains('is-range-word'), false, 'the marks are gone');
    assert.equal(rs.isRangeMode(), false);

    // ---- Snapping ----
    const { snapRange } = window.FrenchReadSelection;
    const span = (from, to) => { const r = document.createRange(); r.setStartBefore(from); r.setEndAfter(to || from); return r; };
    assert.equal(snapRange(span(byWord.deux, byWord.enfants)).text, 'deux enfants', 'words with their punctuation');
    assert.equal(snapRange(span(byWord.ma, byWord.femme)).text, 'ma femme');
    // A start or an end inside a word widens to the word edges
    const inside = document.createRange();
    inside.setStart(byWord.deux.firstChild, 1);
    inside.setEnd(byWord.enfants.firstChild, 4);
    assert.equal(snapRange(inside).text, 'deux enfants');
    // Plain (non-French) text and empty ranges hold nothing
    document.body.insertAdjacentHTML('beforeend', '<p id="plain">hello world</p>');
    const plain = document.getElementById('plain');
    assert.equal(snapRange(span(plain.firstChild, plain.firstChild)).text, '', 'plain text is not French');
    const collapsed = document.createRange();
    collapsed.selectNodeContents(line);
    collapsed.collapse(true);
    assert.equal(snapRange(collapsed).range, null, 'a collapsed range has nothing');

    console.log('PASS: tap vs drag, mouse drag -> bar -> TTS, system selection -> bar, range mode and snapping.');
    window.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
