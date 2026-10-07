// Run with: node tests/test_french_clicks.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const study = read('study.js');
const fragment = study.slice(study.indexOf('    function isFrenchPronunciationFragment('), study.indexOf('    function cleanAlignmentToken('));
const isFrench = new Function('window', `${fragment}; return isFrenchPronunciationFragment;`)({activeTokensMap: new Map([['bonjour', {}]])});
for (const text of ['explain', 'explanation', 'practice', 'learning', 'explain this', 'teacher class']) {
    assert.equal(isFrench(text, 'Bonjour, les enfants arrivent.'), false, text);
}
for (const text of ['bonjour', 'enfants', 'les enfants', 'école', '-ent', 'ou']) {
    assert.equal(isFrench(text, 'Bonjour, les enfants arrivent.'), true, text);
}

// Exercise the actual shared handler with selections in French, English and UI text.
const shared = read('word-popover.js');
const start = shared.indexOf("document.addEventListener('dblclick', (e) => {");
const end = shared.indexOf("        document.addEventListener('mousedown'", start);
const handlerSource = shared.slice(start, end);
let handler;
let spoken = [];
let selection;
const pop = {contains: () => false};
const root = {getSelection: () => selection};
new Function('document', 'root', 'pop', 'wordSelector', 'show', handlerSource)(
    {addEventListener: (event, fn) => { handler = fn; }}, root, pop, '.fr-word', word => spoken.push(word)
);
function click(lang, text, {interactive = false, outside = false} = {}) {
    const region = lang == null ? null : {lang, contains: node => node !== 'outside'};
    const range = {startContainer: 'inside', endContainer: outside ? 'outside' : 'inside', getBoundingClientRect: () => ({width: 20, height: 12})};
    selection = {rangeCount: 1, toString: () => text, getRangeAt: () => range};
    handler({target: {closest: selector => selector === '[lang]' ? region : selector === '.fr-word' && interactive ? {} : null}});
}
click('en', 'explain');
click('zh-CN', 'explain');
click(null, 'explain');
click('fr', 'bonjour', {outside: true});
click('fr', 'bonjour', {interactive: true}); // The single-click handler handles this.
assert.deepEqual(spoken, []);
click('fr', 'bonjour');
click('fr-CA', 'enfants');
assert.deepEqual(spoken, ['bonjour', 'enfants']);
console.log('PASS: English/UI selections stay silent; French selections and pronunciation targets remain enabled.');
