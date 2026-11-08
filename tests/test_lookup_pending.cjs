// Run with: node tests/test_lookup_pending.cjs
// The word card's server lookup can never leave "查询中" up forever: a request that never answers is
// aborted after the timeout and retried once, then the card says 暂无释义; a failed or aborted
// lookup is not remembered as pending; "Afin" and "afin" share one request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const dom = new JSDOM('<body><p class="line" lang="fr"><span class="w">Afin</span> <span class="w">afin</span></p></body>',
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
const { document } = window;
window.requestAnimationFrame = fn => setTimeout(fn, 0);
const rect = { left: 10, top: 300, right: 110, bottom: 320, width: 100, height: 20 };
window.Element.prototype.getBoundingClientRect = () => rect;
window.Element.prototype.getClientRects = () => [rect];
window.localStorage.setItem('frenchStudio.uiLang', 'zh');
window.eval(read('i18n.js'));
window.eval(read('speech-eval.js'));
window.eval(read('word-popover.js'));

// A fetch whose behaviour per call is scripted; a "hang" only ends when the card aborts it
const calls = [];
let script = [];
window.fetch = (url, init = {}) => {
    calls.push(String(url));
    const step = script.shift() || 'ok';
    if (step === 'hang') {
        return new Promise((_, reject) => {
            if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
    }
    if (step === 'ok') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ token: 'Afin', lemma: 'afin', pos: 'conj.', phonetic: '', explanation_cn: '为了', explanation_en: 'in order to' }) });
    }
    return Promise.resolve({ ok: false, status: 502, json: async () => ({ detail: { message: 'boom' } }) });
};

const popover = window.FrenchWordPopover.create({
    speak: () => {}, wordSelector: '.w', selectionPopover: false, lookupTimeoutMs: 40,
});
const [first, second] = document.querySelectorAll('.w');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const card = () => document.querySelector('.floating-word-popover');
const text = sel => card().querySelector(sel).textContent.trim();
const visible = sel => { const el = card().querySelector(sel); return Boolean(el) && !el.hidden && el.style.display !== 'none'; };

(async () => {
    // 1. Never answers: aborted, retried once, then 暂无释义 and no spinner
    script = ['hang', 'hang'];
    await popover.show('Afin', first, { sentence: 'Afin de réussir.' }, { silent: true });
    await wait(60);
    assert.equal(calls.length, 2, 'one retry after the timeout');
    assert.equal(visible('.popover-loading'), false, 'the spinner is gone');
    assert.match(text('.popover-dict .popover-content'), /暂无释义/);

    // 2. The failure left nothing pending: the next tap asks again, and the answer shows at once
    script = ['ok'];
    await popover.show('Afin', first, { sentence: 'Afin de réussir.' }, { silent: true });
    await wait(10);
    assert.equal(calls.length, 3);
    assert.match(text('.popover-cn-text'), /为了/);

    // 3. A 5xx is retried once, and the retry's answer is used
    popover.close();
    script = ['err', 'ok'];
    await popover.show('Alors', second, { sentence: 'Alors.' }, { silent: true });
    await wait(20);
    assert.equal(calls.length, 5, 'one retry after a 5xx');
    assert.match(text('.popover-cn-text'), /为了/);

    // 4. "Pourtant" and "pourtant" tapped back to back share one request
    popover.close();
    const before = calls.length;
    script = ['ok'];
    const one = popover.show('Pourtant', first, { sentence: 'Pourtant.' }, { silent: true });
    const two = popover.show('pourtant', second, { sentence: 'pourtant.' }, { silent: true });
    await Promise.all([one, two]);
    await wait(10);
    assert.equal(calls.length - before, 1, 'one request for both letter cases');
    assert.equal(visible('.popover-loading'), false);

    console.log('PASS: word card lookup timeout, retry, shared pending and 暂无释义 fallback.');
    process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
