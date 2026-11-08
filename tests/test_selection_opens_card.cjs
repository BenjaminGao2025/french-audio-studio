// Selecting French text opens the meaning card directly (no Read/Meaning toolbar); the card's
// own speaker button remains the audio path. Covers mouse drag, system selection and range mode.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const SENTENCE = 'Désolé je préfère partir tout de suite.';
const dom = new JSDOM(
    `<body><div class="sentence-card"><p class="sentence-french-text" lang="fr" id="line"></p>
        <button data-range-toggle aria-pressed="false" type="button"></button></div></body>`,
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' },
);
const { document, window } = dom.window;
window.requestAnimationFrame = fn => setTimeout(fn, 0);
const rect = (l = 10, t = 100, r = 220, b = 124) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
window.Element.prototype.getBoundingClientRect = () => rect();
window.Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
window.Range.prototype.getBoundingClientRect = () => rect();
window.Range.prototype.getClientRects = () => [rect()];

const line = document.getElementById('line');
line.innerHTML = SENTENCE.split(/(\s+)/).map(part => (/\S/.test(part)
    ? `<span class="interactive-word" lang="fr" data-word="${part.replace(/[.,]/g, '')}">${part}</span>` : part)).join('');

window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));
window.eval(read('read-selection.js'));

const spoken = [];
const looked = [];
const popover = window.FrenchWordPopover.create({
    speak: text => spoken.push(text),
    wordSelector: '.interactive-word',
    selectionPopover: false,
    localLookup: (lower, word) => ({ token: word, lemma: lower, pos: 'v.', phonetic: '', explanation_en: `meaning of ${word}`, explanation_cn: '' }),
});
const rs = window.FrenchReadSelection.create({
    wordSelector: '.interactive-word',
    meaningOnSelect: true,
    speak: text => spoken.push(`READ:${text}`),
    meaning: (text, anchor, context) => {
        looked.push(text);
        return popover.show(text, anchor, context, { silent: true });
    },
    contextFor: () => ({ sentence: SENTENCE, sentence_cn: '' }),
    openWord: () => popover.activeElement(),
    rangeLineFor: toggle => toggle.closest('.sentence-card').querySelector('.sentence-french-text'),
});
const bar = rs.bar;
const by = word => [...line.querySelectorAll('.interactive-word')].find(el => el.dataset.word === word);
const wait = (ms = 450) => new Promise(resolve => setTimeout(resolve, ms));
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
    // System selection of a phrase: card opens, no toolbar, silent until the speaker is used.
    select(by('préfère'), by('partir'));
    await wait();
    assert.equal(looked.length, 1);
    assert.equal(looked[0], 'préfère partir');
    assert.equal(popover.isOpen(), true, 'the selected phrase card is open');
    assert.equal(bar.hidden, true, 'no Read/Meaning toolbar appears');
    assert.match(popover.element.querySelector('.popover-word').textContent, /préfère partir/);
    assert.deepEqual(spoken, [], 'opening from a selection does not auto-speak');
    popover.element.querySelector('.btn-popover-speak-inline').click();
    assert.deepEqual(spoken, ['préfère partir'], 'the card speaker still plays the selection');

    // A single selected word opens its own card too (old behaviour kept the bar here).
    popover.close();
    window.getSelection().removeAllRanges();
    select(by('tout'));
    await wait();
    assert.equal(looked.at(-1), 'tout');
    assert.equal(popover.isOpen(), true);
    assert.equal(bar.hidden, true);

    // Mouse drag: no bar while dragging; the card opens once on mouseup.
    popover.close();
    window.getSelection().removeAllRanges();
    const press = (el, x) => el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 110 }));
    press(by('tout'), 40);
    assert.equal(bar.hidden, true, 'the bar does not flash under a drag');
    by('suite').dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 110 }));
    assert.equal(bar.hidden, true);
    document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 110 }));
    await wait(50);
    assert.equal(looked.at(-1), 'tout de suite');
    assert.equal(popover.isOpen(), true, 'mouseup opens the dragged phrase card');
    assert.equal(bar.hidden, true);

    // Range mode: the hint bar stays while picking; a complete range opens the card and exits.
    popover.close();
    window.getSelection().removeAllRanges();
    const toggle = document.querySelector('[data-range-toggle]');
    toggle.click();
    assert.equal(bar.hidden, false, 'the hint bar explains range mode');
    by('je').click();
    assert.equal(bar.querySelector('.rs-hint').textContent, 'Tap the last word');
    by('partir').click();
    await wait(30);
    assert.equal(looked.at(-1), 'je préfère partir');
    assert.equal(popover.isOpen(), true);
    assert.equal(bar.hidden, true, 'a complete range leaves no toolbar');
    assert.equal(rs.isRangeMode(), false, 'range mode ends once the card opens');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');

    console.log('PASS: selections open the card directly; speaker plays; no Read/Meaning toolbar.');
    window.close();
})().catch(err => { console.error(err); process.exitCode = 1; });
