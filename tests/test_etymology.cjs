const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<p lang="fr" id="word">empêché</p>', {
    pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/',
});
const { window } = dom;
const rect = { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 };
window.Element.prototype.getBoundingClientRect = () => rect;
for (const file of ['i18n.js', 'speech-eval.js', 'word-popover.js']) {
    window.eval(fs.readFileSync(path.join(__dirname, '../static', file), 'utf8'));
}
let calls = [];
let spoken = [];
let resolveFetch;
window.fetch = (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { resolveFetch = resolve; });
};
const popover = window.FrenchWordPopover.create({
    speak: word => spoken.push(word), getAuthToken: () => 'session-token',
    localLookup: (lower, word) => ({ token: word, lemma: 'empêcher', explanation_cn: '阻止' }),
});
const anchor = window.document.getElementById('word');
const button = popover.element.querySelector('.popover-etymology-button');
const panel = popover.element.querySelector('.popover-etymology-text');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const etymologyCalls = () => calls.filter(c => c.url === '/api/etymology');
(async () => {
    await popover.show('empêché', anchor, {}, { silent: true });
    assert.equal(button.textContent, '词根词源');
    assert.equal(etymologyCalls().length, 0, 'show must not precompute etymology');
    assert.deepEqual(spoken, [], 'silent Meaning still opens without speech');
    button.click();
    assert.equal(button.disabled, true);
    button.click();
    assert.equal(etymologyCalls().length, 1, 'loading blocks duplicate clicks');
    const request = etymologyCalls()[0];
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer session-token');
    assert.deepEqual(JSON.parse(request.options.body), { word: 'empêché', lemma: 'empêcher' });
    const text = '<img src=x onerror=alert(1)>\n词源';
    resolveFetch({ ok: true, json: async () => ({ text }) });
    await tick();
    assert.equal(panel.textContent, text);
    assert.equal(panel.querySelector('img'), null, 'model text cannot inject HTML');
    assert.equal(panel.hidden, false);
    assert.equal(button.disabled, false);
    popover.element.querySelector('.btn-popover-speak-inline').click();
    assert.deepEqual(spoken, ['empêché']);
    button.click();
    const stale = resolveFetch;
    await popover.show('train', anchor, {}, { silent: true });
    assert.equal(panel.hidden, true);
    stale({ ok: true, json: async () => ({ text: 'stale result' }) });
    await tick();
    assert.equal(panel.textContent, '');
    button.click();
    resolveFetch({ ok: false, json: async () => ({}) });
    await tick();
    assert.equal(panel.hidden, false);
    assert(panel.textContent.length > 0);
    assert.equal(button.disabled, false, 'failure allows retry');
    button.click();
    popover.element.querySelector('.popover-close-btn').click();
    resolveFetch({ ok: true, json: async () => ({ text: 'closed result' }) });
    await tick();
    assert.equal(popover.isOpen(), false);
    assert.equal(panel.textContent, '');
    console.log('ok');
    window.close();
})().catch(err => { console.error(err); process.exit(1); });
