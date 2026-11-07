// Run with: node tests/test_card_layout_mobile.cjs
// /study sentence cards on a phone: an open card's four buttons (listen, repeat, select, save)
// sit on their own row under the sentence so the French uses the full card width; the desktop
// header (text left, buttons right) is unchanged. jsdom has no layout, so this pins the CSS;
// the 390px browser screenshots check the result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const css = read('study.css');

// Top-level rule bodies, with the media query each one is in ('' for none)
function rules(source) {
    const out = [];
    const stack = [];
    let i = 0;
    let head = 0;
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
    while (i < clean.length) {
        const ch = clean[i];
        if (ch === '{') {
            stack.push({ selector: clean.slice(head, i).trim(), start: i + 1 });
            head = i + 1;
        } else if (ch === '}') {
            const open = stack.pop();
            const media = stack.filter(s => s.selector.startsWith('@media')).map(s => s.selector).join(' ');
            if (open && !open.selector.startsWith('@')) out.push({ selector: open.selector, body: clean.slice(open.start, i), media });
            head = i + 1;
        }
        i += 1;
    }
    return out;
}
const all = rules(css);
const find = (selector, media) => all.filter(r => r.selector === selector && r.media === media);
const one = (selector, media = '') => {
    const found = find(selector, media);
    assert.equal(found.length, 1, `exactly one "${selector}" rule in "${media || 'no media'}"`);
    return found[0].body;
};

// ---- Desktop: the header is unchanged ----
const head = one('.sentence-head');
assert.match(head, /display: flex;/);
assert.match(head, /align-items: flex-start;/);
assert.doesNotMatch(head, /flex-wrap/, 'desktop header does not wrap');
assert.match(one('.sentence-head-actions'), /flex: 0 0 auto;/, 'desktop buttons sit at the right of the text');
assert.match(one('.sentence-head-text'), /flex: 1;/);
// Nothing outside a phone-width media query wraps the header or moves its buttons
for (const rule of all.filter(r => /sentence-head(-actions)?\b/.test(r.selector) && !/max-width: 640px/.test(r.media))) {
    assert.doesNotMatch(rule.body, /flex-wrap: wrap|flex: 1 0 100%|flex-basis: 100%/, `${rule.selector} (${rule.media || 'no media'}) keeps the desktop layout`);
}

// ---- Phone: the open card's buttons get their own full-width row ----
const PHONE = '@media (max-width: 640px)';
assert.match(one('.sentence-card.is-open .sentence-head', PHONE), /flex-wrap: wrap;/, 'the header wraps on a phone');
assert.match(one('.sentence-card.is-open .sentence-head-text', PHONE), /flex: 1 1 0;/, 'the text takes the whole first row');
const actions = one('.sentence-card.is-open .sentence-head-actions', PHONE);
assert.match(actions, /flex: 1 0 100%;/, 'the buttons wrap onto a row of their own');
assert.match(actions, /justify-content: flex-start;/, 'buttons start under the text');
assert.match(actions, /gap: var\(--space-3\);/, 'room between touch targets');
assert.match(actions, /margin-top: 0;/, 'no touch offset on the new row');
assert.match(one('.sentence-card.is-open .sentence-head:has(.sentence-toggle) .sentence-head-actions', PHONE), /padding-left: 26px;/, 'lined up with the French past the arrow');
// The rules come after the base and touch rules they override
const last = (needle) => css.lastIndexOf(needle);
assert.ok(last('.sentence-card.is-open .sentence-head-actions {') > last('\n.sentence-head-actions {'), 'after the base rule');
assert.ok(last('.sentence-card.is-open .sentence-head-actions {') > css.indexOf('@media (pointer: coarse) {\n    .sentence-french-text,'), 'after the touch margin-top rule');
// A closed card keeps its single listen button beside the line (compact list)
assert.equal(all.some(r => /sentence-card:not\(\.is-open\)[^,]*sentence-head-actions/.test(r.selector) && /flex-wrap|100%/.test(r.body)), false);

// ---- Touch: every button is a full 44px target on the phone layout ----
const touch = one('.sentence-card.is-open .sentence-head-actions .btn-repeat-toggle.btn-head-repeat,\n    .sentence-card.is-open .sentence-head-actions .btn-sentence-save', '@media (max-width: 640px) and (pointer: coarse)');
for (const prop of ['width', 'min-width', 'height', 'min-height']) assert.match(touch, new RegExp(`(^|\\s)${prop}: 44px;`), `${prop} 44px`);
assert.ok(last('.sentence-card.is-open .sentence-head-actions .btn-repeat-toggle.btn-head-repeat') > last('.sentence-head-actions .btn-repeat-toggle.btn-head-repeat {'), 'after the 34px repeat rule');
assert.match(one('.btn-speak-round'), /width: 44px;[\s\S]*height: 44px;/, 'listen is 44px');
assert.match(one('.btn-range-select'), /width: 44px;[\s\S]*height: 44px;/, 'select is 44px');

// ---- The four buttons are still in the header, in order, with their hooks ----
const study = read('study.js');
const start = study.indexOf('<div class="sentence-head-actions">');
const markup = study.slice(start, study.indexOf('</header>', start));
const order = ['btn-speak-round', 'btn-head-repeat', 'btn-range-select', 'btn-sentence-save'].map(c => markup.indexOf(c));
assert.ok(order.every(i => i > 0), 'all four buttons render in the actions block');
assert.deepEqual([...order].sort((a, b) => a - b), order, 'listen, repeat, select, save');
assert.match(markup, /data-range-toggle/, 'select still drives range mode');
// A near miss between the buttons on a phone does not close the card
assert.match(study, /e\.target\.closest\('\.sentence-head-actions'\) && window\.matchMedia\?\.\('\(max-width: 640px\)'\)\.matches\) return;/);

console.log('PASS: phone card layout puts the four buttons under the full-width French; desktop header unchanged; 44px touch targets.');
