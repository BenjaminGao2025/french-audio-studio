// Run with: node tests/test_selection_closes_popover.cjs
// Selecting another word (a drag, not a tap) must close the popover still open for the previous
// word; otherwise the old card sits over the new selection as if it were its meaning
// (bug: "sûreté" selected, popover still showing "à l'oppression").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const dom = new JSDOM('<p lang="fr"><span class="interactive-word" id="s">sûreté,</span> et la résistance <span class="interactive-word" id="o">l\'oppression.</span></p>',
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;
const rect = { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
window.Element.prototype.getBoundingClientRect = () => rect;
window.Element.prototype.getClientRects = () => [rect];
window.Range.prototype.getBoundingClientRect = () => rect;
window.Range.prototype.getClientRects = () => [rect];
window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
const popover = window.FrenchWordPopover.create({
    speak: () => {},
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, text) => ({ token: text, lemma: lower, pos: 'n.f.', phonetic: '', explanation_en: text, explanation_cn: '' }),
});
const s = document.getElementById('s');
const o = document.getElementById('o');
const selectWord = el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
};
const dragOver = el => {
    el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    selectWord(el);
    el.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
};
const wait = () => new Promise(r => setTimeout(r, 20));

(async () => {
    // Popover open for "l'oppression", then the user drags over "sûreté": it closes
    await popover.show("l'oppression", o, {});
    assert.equal(popover.isOpen(), true);
    dragOver(s);
    await wait();
    assert.equal(popover.isOpen(), false, 'a selection on another word closes the stale popover');
    assert(!o.classList.contains('is-active-word'));

    // A double click selects the open word itself: the popover stays
    window.getSelection().removeAllRanges();
    await popover.show('sûreté', s, {});
    dragOver(s);
    await wait();
    assert.equal(popover.isOpen(), true, 'selecting the open word keeps its popover');

    // A plain tap (collapsed selection) changes nothing
    window.getSelection().removeAllRanges();
    s.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    s.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await wait();
    assert.equal(popover.isOpen(), true);
    console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
