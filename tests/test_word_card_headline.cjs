// Run with: node tests/test_word_card_headline.cjs
// Every word card has the same layout: a short English headline, a concise 词典 line
// (long glosses fold) and a 语境 zone. A review snapshot (localLookup / saved meaning) with only the
// long English gloss must never show that gloss as the headline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');

const SENTENCE = "La loi n'a le droit de défendre que les actions nuisibles à la société.";
const GLOSS = '1. (adj.) straight; upright; right (side). 2. (n.m.) right, law, legal study; fee/tax. 3. (adv.) straight, directly.';

function page(options, lang = 'en') {
    const dom = new JSDOM(`<body><p id="line" lang="fr">${SENTENCE.replace('droit', '<span class="fr-word" id="w">droit</span>')}</p></body>`,
        { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
    const { window } = dom;
    window.requestAnimationFrame = fn => setTimeout(fn, 0);
    const box = { left: 10, top: 100, right: 60, bottom: 120, width: 50, height: 20 };
    window.Element.prototype.getBoundingClientRect = () => box;
    window.Element.prototype.getClientRects = () => [box];
    window.localStorage.setItem('frenchStudio.uiLang', lang);
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
    // A saved English gloss stays in the dictionary; the short context meaning is the headline.
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
        assert.equal(zh, '', 'no Chinese headline');
        assert.equal(en, 'right', 'prefer the short meaning in this sentence');
        assert.doesNotMatch(head.textContent, /[一-鿿]/);
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
        assert.equal(text(document, '.popover-context-meaning').textContent, 'Here: right');
        assert.doesNotMatch(text(document, '.popover-dict').textContent, /[一-鿿]/);
        // Why folded
        assert.ok(!text(document, '.popover-why-detail').open, 'Why is collapsed');
    }
    // Even if the lookup is unavailable, the saved English sentence meaning is enough.
    {
        const { popover, document } = page({ lookup: async () => { throw Object.assign(new Error('down'), { retryable: false }); } });
        await popover.show('droit', document.getElementById('w'), { sentence: SENTENCE });
        await wait(80);
        const head = text(document, '.popover-headline');
        assert.ok(!head.hidden);
        assert.ok(!/\d\.\s*\(/.test(head.textContent), `no raw gloss: ${head.textContent}`);
        assert.ok(head.textContent.length < 60);
        assert.equal(text(document, '.popover-headline-en').textContent, 'right');
    }
    // Both UI languages: old bilingual snapshots, bad POS-only context and dictionary senses.
    for (const lang of ['en', 'zh']) {
        for (const label of ['adverb', '副词', 'adv.']) {
            const { window, popover, document } = page({
                localLookup: () => ({ lemma: 'alors', pos: 'adv.', explanation_cn: '副词；然后', explanation_en: 'adverb; then, so' }),
                wordContext: {
                    target: () => ({ sentence: 'Alors il part.', word: 'alors', start: 0, end: 5, occurrence: 0 }),
                    explain: async () => ({ meaning_en: label, meaning_zh: '副词', why_zh: '旧中文说明', state: 'ready' }),
                },
            }, lang);
            await popover.show('alors', document.getElementById('w'), {});
            await wait(30);
            assert.equal(text(document, '.popover-headline-en').textContent, 'then, so');
            assert.doesNotMatch(popover.element.textContent, /[一-鿿]/);
            window.close();
        }
        const { window, popover, document } = page({
            localLookup: () => ({ lemma: 'faillir', pos: 'v.', explanation_cn: '差点', explanation_en: 'to almost do something' }),
            wordContext: {
                target: () => ({ sentence: "J'ai failli tomber.", word: "J'ai failli", start: 0, end: 12, occurrence: 0 }),
                explain: async () => ({ meaning_zh: '我差点', meaning_en: 'I almost', why_zh: '旧中文说明', why_en: 'It almost happened.', state: 'ready' }),
            },
        }, lang);
        await popover.show("J'ai failli", document.getElementById('w'), {});
        await wait(30);
        assert.equal(text(document, '.popover-headline-en').textContent, 'I almost');
        assert.equal(text(document, '.popover-context-meaning').textContent, 'Here: I almost');
        assert.equal(text(document, '.popover-context-why').textContent, 'It almost happened.');
        assert.equal(text(document, '.popover-etymology-button').textContent, 'Etymology');
        assert.equal(text(document, '.popover-etymology-text').hidden, true);
        assert.equal(text(document, '.popover-why-detail').open, false);
        assert.doesNotMatch(popover.element.textContent, /[一-鿿]/);
        window.close();
    }
    console.log('PASS: word card headline + 词典/语境 zones on the review snapshot path.');
})().catch(err => { console.error(err); process.exit(1); });
