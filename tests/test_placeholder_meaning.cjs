// Run with: node --test tests/test_placeholder_meaning.cjs
// A star pressed while the lookup is pending must never save the "查询中..." status text as the meaning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = f => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const flush = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function page() {
    const dom = new JSDOM('<body><span id="anchor">droit</span></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/study' });
    const w = dom.window;
    w.localStorage.setItem('frenchStudio.uiLang', 'zh');
    for (const f of ['i18n.js', 'speech-eval.js', 'phrase-context.js', 'word-popover.js']) w.eval(read(f));
    const el = w.document.querySelector('#anchor');
    el.getBoundingClientRect = () => ({ left: 30, right: 120, top: 80, bottom: 100, width: 90, height: 20 });
    return { w, el };
}
function bookWith(w, saved = []) {
    const posts = [];
    w.fetch = async (url, init = {}) => {
        if (init.method === 'POST' && url === '/api/srs/notes') { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ cards: [], id: 'n1' }) }; }
        return { ok: true, status: 200, json: async () => ({ words: saved, success: true }) };
    };
    return { book: w.FrenchWordPopover.createWordBook({ getToken: () => 't', notePayload: sentence => ({ sentence }) }), posts };
}

test('placeholder detection', (t) => {
    const { w } = page();
    t.after(() => w.close());
    const P = w.FrenchWordPopover;
    for (const text of ['查询中...', '查询中…', '正在查询字义...', 'Looking up the meaning...', '暂无释义', '查词失败', 'Could not get the meaning']) assert.equal(P.isPlaceholderMeaning(text), true, text);
    for (const text of ['权利；法律', 'right, law', 'looking glass', '']) assert.equal(P.isPlaceholderMeaning(text), false, text);
    assert.deepEqual({ ...P.cleanMeaningMeta({ meaning_zh: '查询中...', dict_en: 'right', lemma: 'droit' }) }, { dict_en: 'right', lemma: 'droit' });
});

test('saving through the word book strips placeholder meanings', async (t) => {
    const { w } = page();
    t.after(() => w.close());
    const { book, posts } = bookWith(w);
    await book.toggle({ token: 'droit', sentence: 'Le droit est clair.', meta: { meaning_zh: '查询中...', dict_zh: '查询中...', dict_en: 'right, law', lemma: 'droit' } });
    assert.equal(posts.length, 1);
    assert.deepEqual({ ...posts[0].targets[0].meta }, { dict_en: 'right, law', lemma: 'droit' });
});

test('the star waits for a pending lookup instead of saving placeholder text', async (t) => {
    const { w, el } = page();
    t.after(() => w.close());
    const { book, posts } = bookWith(w);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const popover = w.FrenchWordPopover.create({
        speak() {}, selectionPopover: false, saving: book.popoverSaving,
        lookup: async () => { await gate; return { token: 'droit', lemma: 'droit', pos: 'n.m.', phonetic: 'drwa', explanation_cn: '权利；法律', explanation_en: 'right, law' }; },
    });
    popover.show('droit', el, { sentence: 'Le droit est clair.' }, { silent: true });
    await flush();
    const star = w.document.querySelector('.floating-word-popover .btn-popover-star-icon');
    star.click();
    await flush();
    assert.equal(posts.length, 0, 'nothing is saved while the lookup is pending');
    release();
    await flush(80);
    assert.equal(posts.length, 1);
    const meta = posts[0].targets[0].meta;
    assert.equal(meta.dict_zh, '权利；法律');
    assert.equal(meta.meaning_zh, '权利；法律');
    assert.ok(!JSON.stringify(meta).includes('查询'));
});

test('a stored placeholder is not a saved meaning', async (t) => {
    const { w } = page();
    t.after(() => w.close());
    const { book } = bookWith(w, [{ text: 'droit', card_id: 'c1', sentence: 'Le droit est clair.', importance: 3, target_meta: { meaning_zh: '查询中...', dict_zh: '查询中...' } }]);
    await book.load();
    assert.equal(book.savedMeaning('droit'), null);
});
