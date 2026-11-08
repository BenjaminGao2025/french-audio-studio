// Run with: node tests/test_saved_meaning.cjs
// A tapped word that has another saved card shows that card's kept meaning (no live lookup).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.localStorage.setItem('frenchStudio.uiLang', 'zh');
for (const name of ['i18n.js', 'speech-eval.js', 'word-popover.js']) window.eval(fs.readFileSync(path.join(__dirname, '../static', name), 'utf8'));

const words = [
    { text: 'préfère', card_id: 'a', sentence: 'Je préfère partir.', target_meta: { snap: '1', dict_zh: '更喜欢', dict_en: 'prefer', ctx_zh: '宁愿', ctx_en: 'would rather', why_zh: '后接不定式', lemma: 'préférer' } },
    { text: 'partir', card_id: 'b', sentence: 'Je dois partir.', target_meta: { meaning_zh: '离开', meaning_en: 'leave' } },
    { text: 'vide', card_id: 'c', sentence: 'Il est vide.', target_meta: { snap: '1' } },
];
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ words }) });

(async () => {
    const book = window.FrenchWordPopover.createWordBook({ getToken: () => 't', notePayload: s => ({ sentence: s }) });
    await book.load();
    const got = book.savedMeaning('Préfère');
    assert.equal(got.explanation_zh, '更喜欢');
    assert.equal(got.explanation_en, 'prefer');
    assert.equal(got.lemma, 'préférer');
    assert.equal(got.ctx_zh, '宁愿');
    assert.equal(got.sentence, 'Je préfère partir.');
    // an older card (no snapshot) still has its one meaning, but no 语境
    const old = book.savedMeaning('partir');
    assert.equal(old.explanation_zh, '离开');
    assert.equal(old.ctx_zh, '');
    // a snapshot with nothing in it, and an unknown word, give no stored meaning
    assert.equal(book.savedMeaning('vide'), null);
    assert.equal(book.savedMeaning('inconnu'), null);
    console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
