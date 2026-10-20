// Run with: node tests/test_word_tap_targets.cjs (uses the frontend's jsdom).
// Word tap targets on /study: hit-target CSS, word markup, nearest-word lookup, click -> popover.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../frontend/node_modules/jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const css = read('study.css');
const block = selector => {
    const start = css.indexOf(`\n${selector} {`);
    assert.notEqual(start, -1, `${selector} rule`);
    return css.slice(start, css.indexOf('}', start));
};

// ---- Hit-target CSS ----
const word = block('.interactive-word');
assert.match(word, /position: relative;/, 'anchors the hit area');
assert.match(word, /touch-action: manipulation;/, 'no double-tap zoom on a word');
assert.match(word, /-webkit-user-select: text;\s*user-select: text;/, 'a phrase can still be selected');
assert.match(word, /-webkit-tap-highlight-color: rgba\(var\(--primary-rgb\)/, 'tap feedback in the theme colour');
assert.match(word, /isolation: isolate;/, 'the hit area below needs its own stacking context');
const hit = block('.interactive-word::after');
assert.match(hit, /position: absolute;/, 'the hit area adds no layout');
assert.match(hit, /height: max\(100%, var\(--word-tap-height, 0px\)\);/, 'at least --word-tap-height tall');
assert.match(hit, /left: -0\.15em;[\s\S]*right: -0\.15em;/, 'neighbouring words meet in the gap between them');
assert.doesNotMatch(hit, /pointer-events: none/, 'the hit area must receive the tap');
assert.match(hit, /z-index: -1;/, 'behind the word text, so a drag that starts on the word selects from inside it');
// 44px on touch screens, for the hit area and for the line it sits in
const coarse = css.split('@media (pointer: coarse) {').slice(1).map(part => part.slice(0, part.indexOf('\n}\n')));
assert(coarse.some(rule => /--word-tap-height: 44px;/.test(rule)), '44px word hit area on touch screens');
assert(coarse.some(rule => /line-height: var\(--word-tap-height\);/.test(rule)), 'lines as tall as the hit area, so rows tile');
assert.equal(css.lastIndexOf('line-height: var(--word-tap-height);') > css.lastIndexOf('\n.sentence-french-text {'), true, 'the touch line height comes after the base line-height');
// Hover highlight only where a pointer hovers; the active word keeps its width
assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.interactive-word:hover \{/, 'hover highlight');
assert.doesNotMatch(block('.interactive-word.is-active-word'), /font-weight/, 'no re-flow under the popover');
// The old rule that made words in a closed sentence untappable must stay gone
assert.doesNotMatch(css, /\.sentence-card:not\(\.is-open\) \.interactive-word\s*\{/);
assert.doesNotMatch(css, /\.interactive-word\s*\{[^}]*pointer-events:\s*none/);

// ---- Word markup: punctuation stays with its word ----
const study = read('study.js');
const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
const end = study.indexOf('    window.renderInteractiveWordsHtml =');
assert(start > 0 && end > start, 'renderInteractiveWordsHtml source');
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: ' · tap' });
const sentence = "J'ai déjà deux enfants, et ma femme est enceinte, donc… « c'est vrai » ? 3,5 km.";
const dom = new JSDOM(`<p id="line" lang="fr">${render(sentence)}</p>`, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
const { document, window } = dom.window;
const line = document.getElementById('line');
assert.equal(line.textContent, sentence, 'markup never changes the text');
const words = [...line.querySelectorAll('.interactive-word')];
const byWord = Object.fromEntries(words.map(w => [w.dataset.word, w]));
assert.equal(byWord.enfants.textContent, 'enfants,', 'the comma belongs to the word before it');
assert.equal(byWord.enceinte.textContent, 'enceinte,');
assert.equal(byWord["J'ai"].textContent, "J'ai", 'no punctuation, nothing attached');
assert.equal(byWord.km.textContent, 'km.', 'a final full stop too');
assert.equal(byWord['3,5'].dataset.word, '3,5', 'numbers stay one tap target');
assert.equal(byWord.enfants.dataset.word, 'enfants', 'the spoken word never carries punctuation');
assert.equal(byWord.enfants.dataset.token, 'enfants');
assert.equal(byWord.enfants.getAttribute('role'), 'button');
assert.equal(byWord.enfants.getAttribute('tabindex'), '0');
assert.equal(byWord.enfants.title, 'enfants · tap');
assert.equal(line.querySelectorAll('.interactive-word .interactive-word').length, 0);
assert.equal(render(''), '');
assert.equal(render('Bonjour'), render('Bonjour'));

// ---- Nearest word, and click -> popover through the shared popover ----
window.requestAnimationFrame = fn => setTimeout(fn, 0);
window.HTMLElement.prototype.scrollIntoView = () => {};
const rectFor = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const boxes = new Map();
window.Element.prototype.getClientRects = function () { const r = boxes.get(this); return r ? [r] : []; };
window.Element.prototype.getBoundingClientRect = function () { return boxes.get(this) || rectFor(0, 0, 0, 0); };
window.Range.prototype.getBoundingClientRect = function () { return rectFor(10, 10, 110, 30); };
window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
const { nearestElement } = window.FrenchWordPopover;
// "deux" 100-140 and "enfants," 146-212 on one line; "et" 20-40 on the next, 44px lower
boxes.set(byWord.deux, rectFor(100, 100, 140, 120));
boxes.set(byWord.enfants, rectFor(146, 100, 212, 120));
boxes.set(byWord.et, rectFor(20, 144, 40, 164));
const all = [byWord.deux, byWord.enfants, byWord.et];
assert.equal(nearestElement(all, 120, 110, 22), byWord.deux, 'inside a word');
assert.equal(nearestElement(all, 142, 110, 22), byWord.deux, 'in the gap, closer to the word before');
assert.equal(nearestElement(all, 144, 110, 22), byWord.enfants, 'in the gap, closer to the word after');
assert.equal(nearestElement(all, 120, 134, 22), byWord.deux, 'between two lines: the nearer line');
assert.equal(nearestElement(all, 30, 132, 22), byWord.et, 'between two lines: the nearer line, other way');
assert.equal(nearestElement(all, 300, 110, 22), null, 'far from every word (empty end of a line)');
assert.equal(nearestElement(all, 234, 110, 22), byWord.enfants, 'exactly at the slop still counts');
assert.equal(nearestElement(all, 235, 110, 22), null);
assert.equal(nearestElement([], 10, 10, 22), null);
assert.equal(nearestElement(all, NaN, NaN, 22), null, 'a click without a position matches nothing');
assert.equal(nearestElement([document.createElement('i')], 10, 10, 22), null, 'an element without a box is skipped');

const spoken = [];
const popover = window.FrenchWordPopover.create({
    speak: text => spoken.push(text),
    wordSelector: '.interactive-word',
    localLookup: (lower, text) => ({ token: text, lemma: lower, pos: 'noun', phonetic: '', explanation_en: `meaning of ${text}`, explanation_cn: '' }),
});
const popup = popover.element;
// A click on a word: the popover opens, speaks the word without punctuation and marks the word
popover.show(byWord.enfants.dataset.word, byWord.enfants, { sentence });
assert.equal(popover.isOpen(), true);
assert.deepEqual(spoken, ['enfants']);
assert(byWord.enfants.classList.contains('is-active-word'));
assert.equal(popup.querySelector('.popover-word').textContent.trim(), 'enfants');
// A tap on another word moves it (still one popover)
popover.show('deux', byWord.deux, { sentence });
assert(!byWord.enfants.classList.contains('is-active-word') && byWord.deux.classList.contains('is-active-word'));
assert.deepEqual(spoken, ['enfants', 'deux']);
assert.equal(document.querySelectorAll('.floating-word-popover:not([hidden])').length, 1);
popover.close();

// A long press selects one word instead of clicking it: the word opens like a tap...
const select = (from, to) => {
    const range = document.createRange();
    range.setStartBefore(from);
    range.setEndAfter(to || from);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
};
const settled = () => new Promise(resolve => setTimeout(resolve, 700));
(async () => {
    popover.close();
    spoken.length = 0;
    select(byWord.deux);
    await settled();
    assert.equal(popover.isOpen(), false, 'a single selected word does not open the popover');
    assert.deepEqual(spoken, []);
    // ...and extending the selection to a phrase opens the phrase instead
    select(byWord.deux, byWord.enfants);
    await settled();
    assert.equal(popover.isOpen(), true, 'a selected phrase opens as a phrase');
    assert.equal(popup.querySelector('.popover-word').textContent.replace(/\s+/g, ' ').trim(), 'deux enfants', 'the popover trims the comma off a phrase');
    // A click already opened the word (a double click selects it afterwards): no second opening
    popover.close();
    spoken.length = 0;
    popover.show('deux', byWord.deux, { sentence });
    select(byWord.deux);
    await settled();
    assert.deepEqual(spoken, ['deux'], 'a word the click already opened is not opened again');
    // A single word of plain French text (not a tap target) is still not opened by selecting it
    popover.close();
    spoken.length = 0;
    document.body.insertAdjacentHTML('beforeend', '<p lang="fr" id="plain">bonjour</p>');
    const plain = document.getElementById('plain');
    select(plain.firstChild, plain.firstChild);
    await settled();
    assert.equal(popover.isOpen(), false);
    assert.deepEqual(spoken, []);
    console.log('PASS: hit-target CSS, word markup, nearest word, click and long-press -> word popover.');
    window.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
