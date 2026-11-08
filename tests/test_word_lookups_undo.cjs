// Word card lookup counts, normalized word keys and the undoable removal star.
// Run with: node --test tests/test_word_lookups_undo.cjs (needs jsdom at the repo root).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = f => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const flush = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function page() {
    const dom = new JSDOM('<body><span id="anchor">bonjour</span></body>', {
        runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/study',
    });
    const w = dom.window;
    w.localStorage.setItem('frenchStudio.uiLang', 'zh');
    for (const f of ['i18n.js', 'speech-eval.js', 'phrase-context.js', 'word-popover.js']) w.eval(read(f));
    const el = w.document.querySelector('#anchor');
    el.getBoundingClientRect = () => ({ left: 30, right: 120, top: 80, bottom: 100, width: 90, height: 20 });
    return { w, dom, el };
}

test('word keys and phrase matching normalize curly apostrophes and NBSP', async (t) => {
    const { w, dom } = page();
    t.after(() => w.close());
    const words = [
        { text: 'd’accord', card_id: 'card-curly', sentence: 'D’accord !', importance: 3 },
        { text: 'il y a', card_id: 'card-nbsp', sentence: 'Il y a un chat.', importance: 3 },
    ];
    const calls = [];
    w.fetch = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET' });
        return { ok: true, status: 200, json: async () => ({ words }) };
    };
    const book = w.FrenchWordPopover.createWordBook({ getToken: () => 'token' });
    await book.load();

    assert.equal(book.entries("d'accord").length, 1);
    assert.equal(book.entries('D’ACCORD').length, 1);
    assert.equal(book.isSaved('D’accord !', 'd’accord'), true);
    assert.equal(book.isSaved('D’accord !', "d'accord"), true);
    // A tapped word inside a saved chunk, across the apostrophe/NBSP spellings.
    assert.equal(book.isSaved('Il y a un chat.', 'y'), true);
    assert.equal(book.isSaved('Il y a un chat.', 'y'), true);
    assert.equal(book.isSaved('Une autre phrase.', 'y'), false);

    await book.remove({ token: "d'accord", sentence: "D'accord !" });
    assert.ok(calls.some(c => c.method === 'DELETE' && c.url.includes('card-curly')));

    const PC = w.FrenchPhraseContext;
    assert.equal(PC.fold('il y a'), PC.fold('il y a'));
    assert.equal(PC.fold('il y a'), PC.fold('il y a'));
    assert.equal(PC.find('il y a', 'Il y a un chat.').length, 1);
});

test('card open shows the per-user lookup count and debounces repeated opens', async (t) => {
    const { w, dom, el } = page();
    t.after(() => w.close());
    const posts = [];
    w.fetch = async (url, init = {}) => {
        if (url === '/api/srs/lookups') {
            const body = JSON.parse(init.body);
            posts.push(body.word);
            return { ok: true, status: 200, json: async () => ({ word: body.word, count: 7, importance: 4, incremented: true }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    const saved = { isSaved: () => true, entries: () => [{ importance: 3 }], toggle: async () => {}, remove: async () => {} };
    const card = w.FrenchWordPopover.create({
        speak() {},
        getAuthToken: () => 'token',
        localLookup: () => ({ token: 'bonjour', lemma: 'bonjour', pos: 'interj.', explanation_cn: '你好' }),
        saving: saved,
        lookupDebounceMs: 5000,
    });
    await card.show('bonjour', el);
    await flush();
    assert.deepEqual(posts, ['bonjour']);
    assert.equal(card.element.querySelector('.popover-lookup-count').textContent, 'Looked up 7 times');
    assert.equal(card.element.querySelector('.popover-lookup-count').hidden, false);
    const filled = card.element.querySelectorAll('.importance-stars button.filled');
    assert.equal(filled.length, 4); // lookup-derived 4 beats the saved card's 3

    // Two quick reopens of the same word: the client does not count them again.
    await card.show('bonjour', el);
    await card.show('Bonjour', el);
    await flush();
    assert.deepEqual(posts, ['bonjour']);
});

test('a higher manual importance is kept when the lookup count is lower', async (t) => {
    const { w, dom, el } = page();
    t.after(() => w.close());
    w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ word: 'bonjour', count: 6, importance: 4, incremented: true }) });
    const card = w.FrenchWordPopover.create({
        speak() {},
        getAuthToken: () => 'token',
        localLookup: () => ({ token: 'bonjour', lemma: 'bonjour', explanation_cn: '你好' }),
        saving: { isSaved: () => true, entries: () => [{ importance: 5 }], toggle: async () => {}, remove: async () => {} },
    });
    await card.show('bonjour', el);
    await flush();
    assert.equal(card.element.querySelectorAll('.importance-stars button.filled').length, 5);
});

test('removal star waits five seconds and the toast can undo it', async (t) => {
    const { w, dom, el } = page();
    t.after(() => w.close());
    let removed = 0;
    const card = w.FrenchWordPopover.create({
        speak() {},
        getAuthToken: () => 'token',
        localLookup: () => ({ token: 'bonjour', lemma: 'bonjour', explanation_cn: '你好' }),
        saving: {
            isSaved: () => true,
            entries: () => [{ importance: 3 }],
            toggle: async () => { removed++; },
            remove: async () => { removed++; },
        },
        undoMs: 25,
    });
    await card.show('bonjour', el);
    const star = card.element.querySelector('.btn-popover-star-icon');
    const toast = w.document.querySelector('.word-card-toast');
    assert.equal(star.classList.contains('active'), true);

    star.click();
    await flush(5);
    assert.equal(removed, 0, 'the delete must wait for the undo window');
    assert.equal(toast.hidden, false);
    assert.match(toast.textContent, /Removed/);
    assert.match(toast.textContent, /Undo/);
    assert.equal(star.classList.contains('active'), false);

    toast.querySelector('.word-card-toast-undo').click();
    await flush(40);
    assert.equal(removed, 0, 'undo restores the save without a server call');
    assert.equal(toast.hidden, true);
    assert.equal(star.classList.contains('active'), true);

    star.click();
    await flush(40);
    assert.equal(removed, 1, 'after the window the removal is committed');
    assert.equal(toast.hidden, true);
});

test('saved words reload when the card opens and when the tab becomes visible', async (t) => {
    const { w, dom, el } = page();
    t.after(() => w.close());
    let reloads = 0;
    const card = w.FrenchWordPopover.create({
        speak() {},
        getAuthToken: () => 'token',
        localLookup: () => ({ token: 'bonjour', lemma: 'bonjour', explanation_cn: '你好' }),
        saving: { isSaved: () => false, entries: () => [], toggle: async () => {}, reload: () => { reloads++; } },
    });
    await card.show('bonjour', el);
    assert.equal(reloads, 1);
    Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => 'visible' });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    assert.equal(reloads, 2);
});
