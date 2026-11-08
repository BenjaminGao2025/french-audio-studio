// Run with: node tests/test_word_card_headline.cjs
// Every word card has the same layout: a short Chinese core + English headline, a concise 词典 line
// (long glosses fold) and a 语境 zone. A review snapshot (localLookup / saved meaning) with only the
// long English gloss must never show that gloss as the headline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const SENTENCE = "La loi n'a le droit de défendre que les actions nuisibles à la société.";
const GLOSS = '1. (adj.) straight; upright; right (side). 2. (n.m.) right, law, legal study; fee/tax. 3. (adv.) straight, directly.';

function page(options) {
    const dom = new JSDOM(`<body><p id="line" lang="fr">${SENTENCE.replace('droit', '<span class="fr-word" id="w">droit</span>')}</p></body>`,
        { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
    const { window } = dom;
    window.requestAnimationFrame = fn => setTimeout(fn, 0);
    const box = { left: 10, top: 100, right: 60, bottom: 120, width: 50, height: 20 };
    window.Element.prototype.getBoundingClientRect = () => box;
    window.Element.prototype.getClientRects = () => [box];
    window.eval(read('i18n.js'));
    window.eval(read('speech-eval.js'));
    window.eval(read('word-popover.js'));
    const start = SENTENCE.indexOf('droit');
    const popover = window.FrenchWordPopover.create({
        speak() {}, wordSelector: '.fr-word', selectionPopover: false,
        contextFor: () => ({ sentence: SENTENCE }),
        wordContext: {
            target: (word, el, ctx) => ({ sentence: ctx.sentence, word, occurrence: 0, start, end: start + 5 }),
            // a kept snapshot answers with no request
            explain: () => Promise.resolve({ meaning_zh: '权利', meaning_en: 'right', why_zh: '名词，表示权利', state: 'ready' }),
        },
        localLookup: () => ({ lemma: 'droit', pos: 'adj.', phonetic: 'drwa', explanation_en: GLOSS, explanation_cn: '' }),
        ...options,
    });
    return { window, popover, document: window.document };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = (doc, sel) => doc.querySelector(`.floating-word-popover ${sel}`);

(async () => {
    // Snapshot with an English-only gloss; the live lookup supplies the Chinese core
    {
        const { popover, document } = page({
            lookup: async () => ({ token: 'droit', lemma: 'droit', pos: 'n.m.', phonetic: 'drwa', explanation_cn: '1. (形) 直的；正直的。2. (阳名) 权利；法律；税费。3. (副) 径直。', explanation_en: GLOSS }),
        });
        await popover.show('droit', document.getElementById('w'), { sentence: SENTENCE });
        await wait(80);
        const head = text(document, '.popover-headline');
        assert.ok(head && !head.hidden, 'headline is shown');
        const zh = text(document, '.popover-headline-zh').textContent;
        const en = text(document, '.popover-headline-en').textContent;
        assert.ok(zh && /[一-鿿]/.test(zh) && zh.length <= 20, `Chinese core headline, got ${JSON.stringify(zh)}`);
        assert.ok(en && en.length <= 36 && !/\d\./.test(en) && !/\(adj\.\)/.test(en), `short English, got ${JSON.stringify(en)}`);
        assert.ok(!head.textContent.includes('3. (adv.)'), 'raw gloss is not the headline');
        // 词典 zone keeps the full gloss, folded, with a toggle
        const dict = text(document, '.popover-dict');
        assert.ok(!dict.hidden);
        assert.ok(text(document, '.popover-content').classList.contains('is-clamped'), 'long gloss is folded');
        const more = text(document, '.popover-dict-more');
        assert.ok(!more.hidden);
        more.click();
        assert.ok(!text(document, '.popover-content').classList.contains('is-clamped'), 'toggle expands');
        // 语境 zone: sentence with the word marked, plus the meaning here
        const ctx = text(document, '.popover-context');
        assert.ok(!ctx.hidden);
        assert.equal(text(document, '.popover-context-mark').textContent, 'droit');
        assert.ok(text(document, '.popover-context-snippet').textContent.includes('actions nuisibles'), 'full sentence');
        assert.ok(text(document, '.popover-context-meaning').textContent.includes('权利'));
        // Why folded
        assert.ok(!text(document, '.popover-why-detail').open, 'Why is collapsed');
    }
    // No Chinese anywhere and the lookup fails: the headline falls back to the sentence meaning, never the gloss
    {
        const { popover, document } = page({ lookup: async () => { throw Object.assign(new Error('down'), { retryable: false }); } });
        await popover.show('droit', document.getElementById('w'), { sentence: SENTENCE });
        await wait(80);
        const head = text(document, '.popover-headline');
        assert.ok(!head.hidden);
        assert.ok(!/\d\.\s*\(/.test(head.textContent), `no raw gloss: ${head.textContent}`);
        assert.ok(head.textContent.length < 60);
        assert.ok(text(document, '.popover-headline-zh').textContent.includes('权利'), 'falls back to the snapshot meaning');
    }
    console.log('PASS: word card headline + 词典/语境 zones on the review snapshot path.');
})().catch(err => { console.error(err); process.exit(1); });
