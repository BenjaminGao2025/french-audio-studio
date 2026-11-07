// Run with: node tests/test_selection_bar_placement.cjs (needs `npm ci` at the repo root for jsdom).
// Where the Read / Meaning bar goes. A mouse keeps the old rule (above the selection, below when
// there is no room). A touch screen puts it BELOW the last selected line, clear of the end handle,
// because the system callout (Copy / Look Up) sits above the selection; its fallbacks stay inside
// the visual viewport and the safe area.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const rectFor = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

// ---- The pure rule -----------------------------------------------------------------------
{
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
    dom.window.eval(read('read-selection.js'));
    const { placement } = dom.window.FrenchReadSelection;
    const view = { left: 0, top: 0, right: 390, bottom: 844 };
    const one = rectFor(40, 300, 200, 344);
    const at = (rects, extra = {}) => placement({ rects, box: extra.box || rects[0], width: 220, height: 44, view, touch: true, ...extra });

    // Touch: below the line, past the handle, never covering it
    let p = at([one]);
    assert.equal(p.side, 'below');
    assert.equal(p.top, 344 + 36, 'below the line with room for the end handle');
    assert.ok(p.top >= one.bottom + 30, 'clear of the end handle knob');
    assert.equal(p.left, (40 + 200) / 2 - 110, 'centred on the selection');

    // A multiline selection: below the LAST line, not the box's first line
    const lines = [rectFor(60, 300, 380, 344), rectFor(16, 344, 380, 388), rectFor(16, 388, 140, 432)];
    p = at(lines, { box: rectFor(16, 300, 380, 432) });
    assert.equal(p.side, 'below');
    assert.equal(p.top, 432 + 36, 'under the last selected line');

    // Never off the sides
    p = at([rectFor(0, 300, 30, 344)]);
    assert.equal(p.left, 8, 'kept 8px from the left edge');
    p = at([rectFor(360, 300, 390, 344)]);
    assert.equal(p.left, 390 - 220 - 8, 'kept 8px from the right edge');

    // No room below, but room above: above, leaving room for the system callout
    const low = rectFor(40, 760, 200, 804);
    p = at([low]);
    assert.equal(p.side, 'above');
    assert.equal(p.top, 760 - 64 - 44, 'callout room between the bar and the text');
    assert.ok(p.top + 44 <= low.top - 56, 'the callout (about 50px) still fits between bar and text');

    // The selection runs off the bottom (a long selection): pinned to the bottom edge
    p = at([rectFor(16, 500, 380, 544), rectFor(16, 820, 380, 864)], { box: rectFor(16, 500, 380, 864) });
    assert.equal(p.side, 'pinned');
    assert.equal(p.top, 844 - 44 - 8, 'pinned 8px above the bottom of the screen');

    // No room below nor above (a short screen, e.g. with the keyboard up): pinned, still visible
    const short = { left: 0, top: 0, right: 390, bottom: 200 };
    p = placement({ rects: [rectFor(16, 60, 380, 104), rectFor(16, 104, 200, 148)], box: rectFor(16, 60, 380, 148), width: 220, height: 44, view: short, touch: true });
    assert.equal(p.side, 'pinned');
    assert.equal(p.top, 200 - 44 - 8);

    // The visual viewport (scrolled / zoomed) and the safe area bound every case
    const zoomed = { left: 0, top: 120, right: 390, bottom: 120 + 600 - 34 };
    p = placement({ rects: [rectFor(40, 520, 200, 564)], box: rectFor(40, 520, 200, 564), width: 220, height: 44, view: zoomed, touch: true });
    assert.equal(p.side, 'below', 'fits above the home indicator');
    assert.ok(p.top + 44 <= zoomed.bottom - 8);
    p = placement({ rects: [rectFor(40, 640, 200, 684)], box: rectFor(40, 640, 200, 684), width: 220, height: 44, view: zoomed, touch: true });
    assert.equal(p.side, 'above', 'the home indicator counts as no room');
    assert.ok(p.top >= zoomed.top + 8, 'above stays under the visual viewport top');
    p = placement({ rects: [rectFor(40, 150, 200, 194)], box: rectFor(40, 150, 200, 194), width: 220, height: 44, view: { ...zoomed, bottom: 230 }, touch: true });
    assert.equal(p.side, 'pinned', 'no room above the visual viewport top either');

    // Mouse: exactly the old rule
    const mouse = (rects, box) => placement({ rects, box: box || rects[0], width: 220, height: 44, view, touch: false });
    p = mouse([one]);
    assert.deepEqual([p.side, p.top], ['above', 300 - 10 - 44], 'a mouse puts it above, 10px off');
    p = mouse([rectFor(40, 30, 200, 60)]);
    assert.deepEqual([p.side, p.top], ['below', 60 + 10], 'no room above: 10px below');
    p = mouse([rectFor(16, 30, 380, 60), rectFor(16, 60, 380, 830)], rectFor(16, 30, 380, 830));
    assert.deepEqual([p.side, p.top], ['pinned', 844 - 44 - 8]);
    dom.window.close();
}

// ---- In the page: touch, the visual viewport and the safe area are read live -----------
const SENTENCE = 'Grâce aux efforts de tous, nous avons réussi à partir tôt.';
function page({ coarse, viewport, safeBottom = 0 }) {
    const dom = new JSDOM(
        '<body><div class="sentence-card is-open"><p class="sentence-french-text" lang="fr" id="line"></p></div></body>',
        { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' },
    );
    const { window } = dom;
    const { document } = window;
    window.requestAnimationFrame = fn => setTimeout(fn, 0);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    window.matchMedia = query => ({ matches: coarse && query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} });
    const vvListeners = {};
    if (viewport) {
        window.visualViewport = { ...viewport, addEventListener: (type, fn) => { (vvListeners[type] ||= []).push(fn); } };
    }
    // env(safe-area-inset-*) as the probe would compute it on a notched phone
    const computed = window.getComputedStyle.bind(window);
    window.getComputedStyle = el => (el.classList && el.classList.contains('rs-safe-probe')
        ? { paddingTop: '0px', paddingRight: '0px', paddingBottom: `${safeBottom}px`, paddingLeft: '0px' }
        : computed(el));
    const study = read('study.js');
    const start = study.indexOf('    function renderInteractiveWordsHtml(text) {');
    const end = study.indexOf('    window.renderInteractiveWordsHtml =');
    const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const render = new Function('escapeHtml', 'T', `${study.slice(start, end)}; return renderInteractiveWordsHtml;`)(escapeHtml, { wordTitleSuffix: '' });
    const line = document.getElementById('line');
    line.innerHTML = render(SENTENCE);
    const words = [...line.querySelectorAll('.interactive-word')];
    let rects = [rectFor(40, 300, 200, 344)];
    window.Element.prototype.getClientRects = () => [];
    window.Element.prototype.getBoundingClientRect = () => rectFor(0, 0, 0, 0);
    window.Range.prototype.getClientRects = () => rects;
    window.Range.prototype.getBoundingClientRect = () => rects.reduce((a, r) => rectFor(Math.min(a.left, r.left), Math.min(a.top, r.top), Math.max(a.right, r.right), Math.max(a.bottom, r.bottom)));
    window.eval(read('read-selection.js'));
    const rs = window.FrenchReadSelection.create({ wordSelector: '.interactive-word', speak: () => {}, meaning: () => {}, contextFor: () => ({ sentence: SENTENCE }) });
    const select = (from, to) => {
        const range = document.createRange();
        range.setStartBefore(from);
        range.setEndAfter(to);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new window.Event('selectionchange'));
    };
    const setRects = next => { rects = next; };
    return { window, rs, bar: rs.bar, words, select, setRects, vvListeners, close: () => window.close() };
}
const settled = (ms = 450) => new Promise(resolve => setTimeout(resolve, ms));
const top = bar => parseInt(bar.style.top, 10);

(async () => {
    // A touch screen: the bar lands below the selection
    let t = page({ coarse: true });
    t.select(t.words[0], t.words[2]);
    await settled();
    assert.equal(t.bar.hidden, false, 'a selected phrase shows the bar');
    assert.equal(t.bar.dataset.side, 'below');
    assert.equal(top(t.bar), 344 + 36, 'below the selected line on touch');
    assert.equal(t.rs.current(), 'Grâce aux efforts');
    // Scrolling moves the text: the bar follows it
    t.setRects([rectFor(40, 200, 200, 244)]);
    t.window.dispatchEvent(new t.window.Event('scroll'));
    await settled(20);
    assert.equal(top(t.bar), 244 + 36, 'the bar follows the scrolled text');
    // A multiline selection: under its last line
    t.setRects([rectFor(60, 300, 380, 344), rectFor(16, 344, 200, 388)]);
    t.select(t.words[0], t.words[6]);
    await settled();
    assert.equal(t.bar.dataset.side, 'below');
    assert.equal(top(t.bar), 388 + 36, 'under the last line of a multiline selection');
    // Scrolled out of the screen: hidden
    t.setRects([rectFor(40, -200, 200, -156)]);
    t.window.dispatchEvent(new t.window.Event('scroll'));
    await settled(20);
    assert.equal(t.bar.hidden, true, 'off-screen text takes the bar away');
    t.close();

    // The visual viewport (pinch zoom, keyboard) and the home indicator bound the bar
    t = page({ coarse: true, viewport: { offsetTop: 100, offsetLeft: 0, width: 390, height: 500 }, safeBottom: 34 });
    t.setRects([rectFor(40, 520, 200, 564)]);   // 564 + 36 + 44 > 100 + 500 - 34 - 8
    t.select(t.words[0], t.words[1]);
    await settled();
    assert.equal(t.bar.hidden, false);
    assert.equal(t.bar.dataset.side, 'above', 'no room above the home indicator: above, with callout room');
    assert.equal(top(t.bar), 520 - 64 - 44);
    assert.ok(top(t.bar) >= 100 + 8, 'inside the visual viewport');
    assert.ok(t.vvListeners.scroll && t.vvListeners.resize, 'follows the visual viewport as it moves');
    // The viewport scrolls down: now there is room below again
    t.window.visualViewport.offsetTop = 300;
    t.vvListeners.scroll.forEach(fn => fn());
    await settled(20);
    assert.equal(t.bar.dataset.side, 'below');
    assert.equal(top(t.bar), 564 + 36);
    assert.ok(top(t.bar) + 44 <= 300 + 500 - 34 - 8, 'above the home indicator');
    // A selection running off the bottom of the visual viewport: pinned to its bottom edge
    t.setRects([rectFor(16, 700, 380, 744), rectFor(16, 744, 380, 900)]);
    t.vvListeners.resize.forEach(fn => fn());
    await settled(20);
    assert.equal(t.bar.dataset.side, 'pinned');
    assert.equal(top(t.bar), 300 + 500 - 34 - 8 - 44);
    t.close();

    // A mouse: unchanged, above the selection, the window as the screen
    t = page({ coarse: false, viewport: { offsetTop: 100, offsetLeft: 0, width: 390, height: 500 }, safeBottom: 34 });
    t.select(t.words[0], t.words[2]);
    await settled();
    assert.equal(t.bar.dataset.side, 'above');
    assert.equal(top(t.bar), 300 - 10 - 44, 'a mouse still puts it 10px above');
    t.close();

    console.log('PASS: selection bar below on touch, multiline, scroll, visual viewport, safe area and fallbacks; mouse unchanged.');
})().catch(error => { console.error(error); process.exitCode = 1; });
