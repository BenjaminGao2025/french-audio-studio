// Run with: node tests/test_word_card_settle.cjs
// A single word card gets the same 700ms settle window as a Meaning card: the synthetic mousedown
// and the mobile chrome scroll that follow the opening tap must not close it. After the window,
// a mousedown outside or a scroll closes it as before; a deliberate drag over another word still
// closes it at once (see test_selection_closes_popover.cjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const dom = new JSDOM('<p lang="fr" id="line"><span class="interactive-word" id="s">sûreté,</span> et la résistance <span class="interactive-word" id="o">l\'oppression.</span></p>',
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
const line = document.getElementById('line');
const o = document.getElementById('o');
const wait = ms => new Promise(r => setTimeout(r, ms));
const press = el => {
    el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    el.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
};

(async () => {
    window.getSelection().removeAllRanges();
    await popover.show("l'oppression", o, {});
    assert.equal(popover.isOpen(), true);

    // Synthetic mousedown/mouseup off the words right after the tap (no selection): stays open
    press(line);
    await wait(20);
    assert.equal(popover.isOpen(), true, 'a mousedown during settle must not close a word card');

    // Mobile chrome show/hide scroll right after the tap: stays open
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(popover.isOpen(), true, 'a scroll during settle must not close a word card');

    // After the window a mousedown outside closes it
    await wait(750);
    line.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
    assert.equal(popover.isOpen(), false, 'after settle, a mousedown outside closes the word card');
    line.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));

    // ...and so does a scroll
    await popover.show("l'oppression", o, {});
    await wait(750);
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(popover.isOpen(), false, 'after settle, a scroll closes the word card');

    console.log('PASS: word card survives settle mousedown/scroll; still closes after.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
