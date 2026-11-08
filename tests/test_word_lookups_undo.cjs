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

for (const mode of ['without saving', 'unsaved', 'saved']) {
    test(`importance stays visible ${mode} across lookup tiers and reopens`, async (t) => {
        const { w, el } = page();
        t.after(() => w.close());
        const counts = { zero: 0, alors: 1, quatre: 4, cinq: 5, failli: 6, neuf: 9, dix: 10 };
        w.fetch = async (url, init) => {
            assert.equal(url, '/api/srs/lookups');
            const { word } = JSON.parse(init.body);
            return { ok: true, json: async () => ({ count: counts[word] }) };
        };
        const saving = mode === 'without saving' ? undefined : {
            isSaved: () => mode === 'saved',
            entries: () => mode === 'saved' ? [{ importance: 3 }] : [],
            setImportance: async () => {},
        };
        const card = w.FrenchWordPopover.create({
            speak() {}, getAuthToken: () => 'token', saving,
            localLookup: word => ({ token: word, explanation_en: 'meaning' }),
        });
        function check(count) {
            const row = card.element.querySelector('.popover-importance');
            assert.equal(row.hidden, false, `${mode}, count ${count}: row visible`);
            assert.equal(card.element.querySelector('.popover-footer').hidden, false);
            assert.equal(row.querySelectorAll('button').length, 5);
            assert.equal(row.querySelectorAll('button.filled').length, count >= 10 ? 5 : count >= 5 ? 4 : 3);
            assert.equal(row.querySelectorAll('button:disabled').length, mode === 'saved' ? 0 : 5);
            assert.equal(card.element.querySelector('.popover-lookup-count').textContent,
                count ? `Looked up ${count} ${count === 1 ? 'time' : 'times'}` : '');
        }
        for (const [word, count] of Object.entries(counts)) {
            await card.show(word, el);
            await flush();
            check(count);
            card.close();
            await card.show(word, el); // cached count / debounce path
            check(count);
        }
    });
}

test('saved snapshot shows importance and keeps it after the word is removed', async (t) => {
    const { w, el } = page();
    t.after(() => w.close());
    w.fetch = async url => ({
        ok: true, status: 200,
        json: async () => url === '/api/srs/lookups' ? { count: 6 } : { words: [{
            text: 'failli', card_id: 'snapshot-card', sentence: "J’ai failli tomber.", importance: 3,
            target_meta: { snap: '1', dict_en: 'almost', lemma: 'faillir' },
        }] },
    });
    const book = w.FrenchWordPopover.createWordBook({ getToken: () => 'token' });
    await book.load();
    const card = w.FrenchWordPopover.create({
        speak() {}, getAuthToken: () => 'token', saving: book.popoverSaving,
        localLookup: word => {
            const snapshot = book.savedMeaning(word);
            assert.ok(snapshot);
            return { token: word, explanation_en: snapshot.explanation_en };
        },
    });
    await card.show('failli', el);
    await flush();
    assert.equal(card.element.querySelector('.popover-importance').hidden, false);
    assert.equal(card.element.querySelectorAll('.importance-stars button.filled').length, 4);
    book.clear();
    card.refreshSaved();
    assert.equal(card.element.querySelector('.popover-importance').hidden, false);
    assert.equal(card.element.querySelectorAll('.importance-stars button.filled').length, 4);
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
