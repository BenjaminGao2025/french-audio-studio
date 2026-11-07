// Run with: node tests/test_card_tabs.cjs (needs `npm ci` at the repo root for jsdom).
// Every sentence card has the same tabs, in the same order: Steps only where the sentence has a build-up,
// then Words, Grammar, Sounds, Say it, Recall, Dictation, Explain it. Recall / Dictation are top-level tabs
// (no "Write it:" row under Say it any more).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '../static');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const PAGE_SCRIPTS = ['audio-controller.js', 'theme.js', 'study-init.js', 'i18n.js', 'game.js', 'playback.js', 'speech-eval.js',
    'history.js', 'phrase-context.js', 'word-context.js', 'word-popover.js', 'read-selection.js', 'dictation.js', 'study.js'];

function page(lang) {
    const html = read('study.html').replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g, '');
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', e => errors.push(e.message));
    const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/study', virtualConsole });
    const { window } = dom;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    window.fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    window.localStorage.setItem('frenchStudio.uiLang', lang);
    for (const name of PAGE_SCRIPTS) window.eval(read(name));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert.equal(typeof window.renderStudyDeck, 'function', 'the study page started');
    return { window, document: window.document, errors };
}

const word = (fr, meaning_zh) => ({ fr, lemma: fr, type: 'noun', ipa: '', meaning: fr, meaning_zh, why: '' });
const LONG = {
    schemaVersion: 2, sentence: 'Je voudrais réserver une table pour deux personnes ce soir.', translation_zh: '我想今晚订一张两人桌。',
    translation_en: 'I would like to book a table for two tonight.',
    words: [word('réserver', '预订'), word('table', '桌子')],
    build_up: [
        { step: 1, fr: 'Je voudrais', zh: '我想要', new_tokens: ['Je', 'voudrais'] },
        { step: 2, fr: 'Je voudrais réserver une table', zh: '我想订一张桌子', new_tokens: ['réserver', 'une', 'table'] },
        { step: 3, fr: 'Je voudrais réserver une table pour deux personnes ce soir.', zh: '我想今晚订一张两人桌。', new_tokens: ['pour', 'deux', 'personnes', 'ce', 'soir'] },
    ],
    grammar_points: [{ title: 'voudrais', explanation: '条件式表示礼貌', hook: '' }],
    pronunciation_tips: [],
};
const SHORT = { schemaVersion: 2, sentence: "D'accord.", translation_zh: '好的。', translation_en: 'OK.', words: [word("d'accord", '好的')], build_up: [], grammar_points: [], pronunciation_tips: [] };
const LEGACY = { original: 'Bonjour.', translation_cn: '你好。', tokens: [{ token: 'Bonjour', explanation_en: 'hello', explanation_cn: '你好' }] };

const BASE = ['words', 'grammar', 'pron', 'shadowing', 'recall', 'dictation', 'explain'];
const LABELS = {
    en: { buildup: 'Steps', words: 'Words', grammar: 'Grammar', pron: 'Sounds', shadowing: 'Say it', recall: 'Recall', dictation: 'Dictation', explain: 'Explain it' },
    zh: { buildup: '一步步搭', words: '逐词剖析', grammar: '语法考点', pron: '发音重点', shadowing: '跟读打分', recall: '默写', dictation: '听写', explain: '自己讲' },
};

for (const lang of ['en', 'zh']) {
    const { window, document, errors } = page(lang);
    const structure = [{text: 'Je', block: 'N'}, {text: 'voudrais', block: 'V'}, {text: 'ce soir', block: 'S'}];
    window.renderStudyDeck([LONG, SHORT, LEGACY].map(s => ({...s, structure})));
    const cards = [...document.querySelectorAll('.sentence-card')];
    assert.equal(cards.length, 3);
    const tabsOf = card => [...card.querySelectorAll('.sentence-body > .card-tabs-bar .card-tab-btn')];
    const [long, short, legacy] = cards;

    for (const card of cards) {
        assert.equal(card.querySelectorAll('.structure-bar').length, 1);
        assert.equal(card.querySelector('[data-panel="grammar"]').firstElementChild.className, 'structure-bar');
        assert.equal(card.querySelector('.sentence-head .structure-bar, .sentence-body > .structure-bar'), null);
        assert.equal(card.querySelectorAll('.structure-span').length, 3);
        assert.equal(card.querySelector('.structure-map-link').getAttribute('href'), '/grammar');
    }
    long.querySelector('.feynman-mode-switch [data-mode="blind"]').click();
    assert.ok(long.querySelector('.buildup-steps-list').classList.contains('is-blind-mode'));
    long.querySelector('.feynman-mode-switch [data-mode="normal"]').click();
    assert.ok(!long.querySelector('.buildup-steps-list').classList.contains('is-blind-mode'));
    long.querySelector('.feynman-mode-switch [data-dictation-mode="write"]').click();
    assert.ok(long.classList.contains('is-dictating'));
    long.querySelector('[data-exit-mode="back"]').click();
    // Same base set, same order, same labels, on every card; Steps first only where there is a build-up
    assert.deepEqual(tabsOf(long).map(b => b.dataset.tab), ['buildup', ...BASE], `${lang}: long card keeps Say it next to Steps`);
    assert.deepEqual(tabsOf(short).map(b => b.dataset.tab), BASE, `${lang}: D'accord`);
    assert.deepEqual(tabsOf(legacy).map(b => b.dataset.tab), BASE, `${lang}: an old (V1) card gets the same tabs`);
    for (const card of cards) {
        for (const btn of tabsOf(card)) assert.equal(btn.textContent.trim(), LABELS[lang][btn.dataset.tab], `${lang}: ${btn.dataset.tab} label`);
        assert.equal(card.querySelectorAll('.card-tabs-bar').length, 1, 'one tab row');
        assert.equal(card.querySelector('.card-tabs-bar').getAttribute('role'), 'tablist');
        const buttons = tabsOf(card);
        assert.equal(buttons.filter(b => b.getAttribute('aria-selected') === 'true').length, 1, 'one selected tab');
        assert.ok(buttons.every(b => b.getAttribute('role') === 'tab' && b.type === 'button'), 'real tab buttons (Tab / Enter / Space)');
        // Panels: one per ordinary tab, wired both ways; Recall / Dictation open the exercise instead
        for (const btn of buttons.filter(b => !b.dataset.dictationMode)) {
            const panel = document.getElementById(btn.getAttribute('aria-controls'));
            assert.ok(panel && panel.dataset.panel === btn.dataset.tab && panel.getAttribute('role') === 'tabpanel', `${btn.dataset.tab} panel`);
        }
        assert.deepEqual(buttons.filter(b => b.dataset.dictationMode).map(b => [b.dataset.tab, b.dataset.dictationMode]), [['recall', 'write'], ['dictation', 'listen']]);
        assert.equal(card.querySelectorAll('.card-tab-panel').length, buttons.length - 2);
        // One Say it panel per card, no obsolete Write it sub-row
        assert.equal(card.querySelectorAll('.shadowing-panel').length, 1, 'Say it rendered once');
        assert.equal(card.querySelectorAll('.dictation-entry, .dictation-entry-label').length, 0, 'no Write it row');
        assert.doesNotMatch(card.textContent, /Write it|写出来：/);
        assert.equal(card.querySelectorAll('.feynman-mode-switch').length, card === long ? 1 : 0);
    }
    // Steps preserves its existing Show all / Test me / Recall / Dictation switcher
    assert.deepEqual([...long.querySelectorAll('.feynman-mode-switch .btn-feynman-toggle')].map(b => b.dataset.mode || b.dataset.dictationMode), ['normal', 'blind', 'write', 'listen']);
    // An empty Grammar / Sounds tab says so instead of disappearing
    assert.ok(short.querySelector('[data-panel="grammar"] .card-tab-empty').textContent.length > 4);
    assert.ok(short.querySelector('[data-panel="pron"] .card-tab-empty').textContent.length > 4);
    assert.ok(long.querySelector('[data-panel="grammar"] .grammar-point-card'), 'real grammar points still render');
    assert.ok(legacy.querySelector('[data-panel="words"] .breakdown-table'), 'V1 words table is the Words tab');

    // Say it on a Steps card: its tab shows the one Say it panel, wired to the full sentence
    const longTabs = tabsOf(long);
    longTabs.find(b => b.dataset.tab === 'shadowing').click();
    const sayIt = long.querySelector('[data-panel="shadowing"]');
    assert.equal(sayIt.hidden, false);
    assert.equal(long.querySelector('[data-panel="buildup"]').hidden, true);
    assert.equal(longTabs.find(b => b.dataset.tab === 'shadowing').getAttribute('aria-selected'), 'true');
    assert.ok(sayIt.querySelector('.btn-record'), 'record button for the whole sentence');
    assert.equal(long.querySelectorAll('.btn-buildup-record').length, 3, 'each step keeps its own record button');

    // Recall opens the exercise with the same tab row; another tab brings the card back on that tab
    longTabs.find(b => b.dataset.tab === 'recall').click();
    assert.ok(long.classList.contains('is-dictating'), 'Recall opened the exercise');
    const exerciseTabs = [...long.querySelectorAll('.dictation-tabs .card-tab-btn')];
    assert.deepEqual(exerciseTabs.map(b => b.dataset.tab), ['buildup', ...BASE], 'the exercise shows the same tabs');
    assert.equal(exerciseTabs.find(b => b.getAttribute('aria-selected') === 'true').dataset.tab, 'recall');
    exerciseTabs.find(b => b.dataset.tab === 'dictation').click();
    assert.equal(long.querySelector('.dictation-tabs .card-tab-btn.active').dataset.tab, 'dictation', 'Recall -> Dictation in place');
    long.querySelector('.dictation-tabs .card-tab-btn[data-tab="grammar"]').click();
    assert.ok(!long.classList.contains('is-dictating'), 'an ordinary tab leaves the exercise');
    assert.equal(long.querySelector('.sentence-body > .card-tabs-bar .card-tab-btn.active').dataset.tab, 'grammar');
    assert.equal(long.querySelector('[data-panel="grammar"]').hidden, false);
    assert.equal(document.activeElement.dataset.tab, 'grammar', 'focus lands on the tab it returned to');
    // Back from the exercise returns to the tab that was open before
    tabsOf(short).find(b => b.dataset.tab === 'dictation').click();
    assert.ok(short.classList.contains('is-dictating'));
    short.querySelector('[data-exit-mode="back"]').click();
    assert.ok(!short.classList.contains('is-dictating'));
    assert.equal(short.querySelector('.sentence-body > .card-tabs-bar .card-tab-btn.active').dataset.tab, 'words');
    assert.deepEqual(errors, [], `${lang}: no page errors`);
}

// The tab row scrolls sideways on a phone instead of widening the card
const css = read('study.css');
assert.match(css, /\.card-tabs-bar\s*\{[^}]*overflow-x:\s*auto/, 'tab row scrolls horizontally');
assert.doesNotMatch(css, /\.dictation-entry/, 'old Write it row styles are gone');

console.log('PASS: one tab set for every card (Steps + Words, Grammar, Sounds, Say it, Recall, Dictation, Explain it); Recall / Dictation are tabs.');
