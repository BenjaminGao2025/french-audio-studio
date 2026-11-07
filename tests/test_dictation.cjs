// Run with: node tests/test_dictation.cjs
// Dictation (默写 / 听写) in the study card: grading parity with dictation.py, no French of the
// target anywhere in the card (text or attributes) before check, safe rendering, no automatic AI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(path.join(__dirname, '../static/dictation.js'), 'utf8');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dictation_cases.json'), 'utf8'));
const node = require('../static/dictation.js');

const SENTENCE = "Les autorités canadiennes n'autorisent aucune dispense.";
const FRENCH_WORDS = ['autorités', 'canadiennes', 'autorisent', 'aucune', 'dispense'];
const DATA = {
    sentence: SENTENCE,
    translationEn: 'The Canadian authorities authorize no exemption.',
    steps: [
        { fr: 'Les autorités autorisent.', en: 'The authorities authorize.', new: 'Trunk.' },
        { fr: 'Les autorités canadiennes autorisent.', en: '', new: 'canadiennes = Canadian.' },
        { fr: SENTENCE, en: '', new: 'aucune = no.' },
    ],
    voice: 'fr-CA-SylvieNeural',
};
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// A card shaped like study.js renders it: the French is in text, title, aria-label and data attributes
function setup({ token = 'tok', serverGrade = true, aiFeedback = null } = {}) {
    const dom = new JSDOM(`<body><article class="sentence-card" id="card">
        <h3 class="sentence-french-text" lang="fr" title="${SENTENCE}">${SENTENCE}</h3>
        <button aria-label="Play ${SENTENCE}" data-text="${SENTENCE}">play</button>
        <ol class="buildup-steps"><li aria-label="Les autorités canadiennes autorisent.">Les autorités canadiennes autorisent.</li></ol>
        <span class="dictation-sr">aucune dispense</span>
    </article></body>`, { runScripts: 'outside-only', url: 'http://localhost/study' });
    const { window } = dom;
    window.eval(SOURCE);
    const calls = [];
    const fetch = async (url, init) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        const reply = (status, data) => ({ status, ok: status < 400, json: async () => data });
        if (url === '/api/dictation/items') {
            return reply(200, { item_id: 'a'.repeat(32), has_steps: true, targets: [], summary: { write: { 0: { attempts: 0 } }, listen: {} } });
        }
        if (url === '/api/dictation/attempts') {
            if (!serverGrade) return reply(503, null);
            const body = JSON.parse(init.body);
            const target = node.localTargets(DATA)[body.step];
            return reply(200, { ...node.grade(target.expected, body.answer), attempt_id: 'b'.repeat(32), saved: true, expected: target.expected, prompt_en: target.prompt_en, note: target.note, summary: null });
        }
        if (url.endsWith('/ai')) return reply(200, { feedback: aiFeedback, cached: false });
        return reply(404, null);
    };
    const played = [];
    const exits = [];
    const ctl = window.FrenchDictation.create({
        fetch, getToken: () => token, lang: 'zh',
        play: (text, opts) => played.push({ text, ...opts }),
        onExit: (card, mode) => exits.push(mode),
    });
    const card = window.document.getElementById('card');
    return { window, card, ctl, calls, played, exits, original: card.innerHTML };
}

function assertNoFrench(card, words = FRENCH_WORDS) {
    const html = card.outerHTML.toLowerCase();
    for (const w of words) assert(!html.includes(w), `"${w}" leaked into the card: ${html.slice(0, 400)}`);
}

async function answer(env, text) {
    const input = env.card.querySelector('.dictation-input');
    input.value = text;
    env.card.querySelector('.dictation-check').click();
    await flush();
}

test('grading mirrors dictation.py', () => {
    assert.equal(FIXTURES.accent_credit, node.ACCENT_CREDIT);
    for (const c of FIXTURES.grade) assert.deepEqual(node.grade(c.expected, c.answer), c.result, c.name);
    for (const c of FIXTURES.tokenize) {
        const tokens = node.tokenize(c.text);
        assert.deepEqual(tokens.map(t => t.text), c.tokens, c.text);
        assert.deepEqual(tokens.map(t => t.norm), c.norms, c.text);
    }
});

test('step prompts never borrow the whole-sentence English', () => {
    const targets = node.localTargets(DATA);
    assert.deepEqual(targets.map(t => t.prompt_en), [DATA.translationEn, 'The authorities authorize.', '', DATA.translationEn]);
    assert.equal(node.localTargets({ ...DATA, steps: [DATA.steps[0]] }).length, 1);  // one step is no build-up
});

for (const mode of ['write', 'listen']) {
    test(`${mode}: no French of the target in the card before check`, async () => {
        const env = setup();
        env.ctl.open(env.card, DATA, mode);
        await flush();
        assertNoFrench(env.card);
        // Step by step: every step stays hidden too
        env.card.querySelector('.dictation-scope-btn[data-scope="steps"]').click();
        for (let step = 1; step <= 3; step++) {
            assertNoFrench(env.card);
            await answer(env, 'x');
            env.card.querySelector('.dictation-next-step, .dictation-again').click();
        }
        assert(env.card.querySelector('.dictation-step-label').textContent.includes('1 / 3'));
    });
}

// The learner types accents on their own keyboard: no row of accent buttons under the field,
// in either mode, whole sentence or step by step. Accent mistakes are still graded as such.
for (const mode of ['write', 'listen']) {
    test(`${mode}: no accent quick-insert row, accents still graded`, async () => {
        const env = setup();
        env.ctl.open(env.card, DATA, mode);
        const noRow = () => {
            assert.equal(env.card.querySelector('.dictation-accents, .dictation-accent, [data-char]'), null);
            assert(env.card.querySelector('.dictation-input'));
        };
        noRow();
        env.card.querySelector('.dictation-scope-btn[data-scope="steps"]').click();
        noRow();
        env.card.querySelector('.dictation-scope-btn[data-scope="whole"]').click();
        await answer(env, 'les autorites canadiennes n’autorisent aucune dispense');
        noRow();
        assert.equal(env.card.querySelectorAll('.dt-accent').length, 1);
    });
}

test('no accent-row styles are left, phone layouts included', () => {
    const css = fs.readFileSync(path.join(__dirname, '../static/study.css'), 'utf8');
    assert(!/\.dictation-accents?\b/.test(css));
});

test('write mode shows the step English as the prompt', () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'write');
    assert.equal(env.card.querySelector('.dictation-prompt').textContent, DATA.translationEn);
    env.card.querySelector('.dictation-scope-btn[data-scope="steps"]').click();
    assert.equal(env.card.querySelector('.dictation-prompt').textContent, 'The authorities authorize.');
});

test('a step without English offers dictation instead of a wrong prompt', async () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'write');
    env.card.querySelector('.dictation-scope-btn[data-scope="steps"]').click();
    await answer(env, 'les autorités autorisent');
    env.card.querySelector('.dictation-next-step').click();
    assert.equal(env.card.querySelector('.dictation-prompt'), null);
    assert(env.card.querySelector('.dictation-noprompt'));
    assert(!env.card.textContent.includes(DATA.translationEn));
    env.card.querySelector('.dictation-switch-listen').click();
    assert.equal(env.card.querySelector('.dictation-view').dataset.mode, 'listen');
    assert(env.card.querySelector('.dictation-play'));
});

test('listen mode plays the sentence voice, with replay and slow speed', () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'listen');
    const [normal, slow] = env.card.querySelectorAll('.dictation-play');
    normal.click();
    slow.click();
    normal.click();
    assert.deepEqual(env.played.map(p => [p.text, p.voice, p.rate]), [
        [SENTENCE, DATA.voice, 1], [SENTENCE, DATA.voice, 0.75], [SENTENCE, DATA.voice, 1],
    ]);
    assert(env.card.querySelector('.dictation-hint').hidden);
});

test('after check: diff, the full answer, and the AI only on request', async () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'write');
    await answer(env, 'les autorites canadiennes autorisent aucune dispense');
    const box = env.card.querySelector('.dictation-result');
    assert.equal(box.hidden, false);
    assert.equal(box.querySelector('.dictation-answer-text').textContent, SENTENCE);
    assert.equal(box.querySelectorAll('.dt-accent').length, 1);
    assert.equal(box.querySelectorAll('.dt-missing').length, 1);
    assert(box.querySelector('.dictation-save-state').dataset.state === 'saved');
    assert.equal(env.card.querySelector('.dictation-check').textContent, '检查');  // not stuck on "checking…"
    const attempt = env.calls.find(c => c.url === '/api/dictation/attempts');
    assert.deepEqual(Object.keys(attempt.body).sort(), ['answer', 'item_id', 'mode', 'step']);  // no target, no user id
    assert(!env.calls.some(c => c.url.endsWith('/ai')), 'the AI must not run without a click');
    assert(box.querySelector('.dictation-ai-btn'));
});

test('a correct answer offers no AI review', async () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'write');
    await answer(env, SENTENCE);
    assert.equal(env.card.querySelector('.dictation-ai-btn'), null);
    assert(env.card.querySelector('.dictation-score.is-correct'));
});

test('hostile prompt, answer and AI output render as text', async () => {
    const evil = '<img src=x onerror="window.pwned=1">';
    const env = setup({ aiFeedback: { summary: evil, points: [{ wrong: evil, right: `<b>${evil}</b>`, why: evil }], tip: evil } });
    const data = { ...DATA, translationEn: `Hi ${evil}`, steps: [] };
    env.ctl.open(env.card, data, 'write');
    assert.equal(env.card.querySelectorAll('img').length, 0);
    assert(env.card.querySelector('.dictation-prompt').textContent.includes(evil));
    await answer(env, `les ${evil} autorités`);
    assert.equal(env.card.querySelectorAll('img, b').length, 0);
    env.card.querySelector('.dictation-ai-btn').click();
    await flush();
    assert.equal(env.calls.filter(c => c.url.endsWith('/ai')).length, 1);
    assert.equal(env.card.querySelectorAll('img, b').length, 0);
    assert(env.card.querySelector('.dictation-ai-summary').textContent.includes(evil));
    assert.equal(env.window.pwned, undefined);
});

test('signed out or server down: graded locally, labelled as not saved', async () => {
    const out = setup({ token: '' });
    out.ctl.open(out.card, DATA, 'write');
    await answer(out, 'les autorités');
    assert.equal(out.calls.length, 0);
    assert.equal(out.card.querySelector('.dictation-save-state').dataset.state, 'local');
    assert.equal(out.card.querySelector('.dictation-answer-text').textContent, SENTENCE);
    const down = setup({ serverGrade: false });
    down.ctl.open(down.card, DATA, 'listen');
    await answer(down, 'les autorités');
    assert.equal(down.card.querySelector('.dictation-save-state').dataset.state, 'server');
    assert(down.card.querySelector('.dictation-diff'));
});

test('reveal shows the answer without scoring', async () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'write');
    env.card.querySelector('.dictation-reveal').click();
    await flush();
    assert.equal(env.card.querySelector('.dictation-answer-text').textContent, SENTENCE);
    assert.equal(env.card.querySelector('.dictation-save-state').dataset.state, 'revealed');
    assert(!env.calls.some(c => c.url === '/api/dictation/attempts'));
});

test('leaving restores the original card exactly', () => {
    const env = setup();
    env.ctl.open(env.card, DATA, 'write');
    env.ctl.open(env.card, DATA, 'listen');  // switching modes keeps the parked card
    assert(env.ctl.isOpen(env.card));
    env.card.querySelector('[data-exit-mode="blind"]').click();
    assert.equal(env.card.innerHTML, env.original);
    assert.deepEqual(env.exits, ['blind']);
    assert(!env.ctl.isOpen(env.card));
    assert(!env.card.classList.contains('is-dictating'));
});

// Sentence punctuation is never an error: not in the diff, the counts, the legend or the verdict
for (const lang of ['zh', 'en']) {
    test(`${lang}: Joyeux Nöel for "Joyeux Noël !" is an accent mistake only`, async () => {
        const dom = new JSDOM('<body><article class="sentence-card" id="card"><p>card</p></article></body>', { runScripts: 'outside-only', url: 'http://localhost/study' });
        dom.window.eval(SOURCE);
        const ctl = dom.window.FrenchDictation.create({ lang, getToken: () => '' });
        const card = dom.window.document.getElementById('card');
        const data = { sentence: 'Joyeux Noël !', translationEn: 'Merry Christmas!', steps: [] };
        ctl.open(card, data, 'write');
        const check = async text => {
            card.querySelector('.dictation-input').value = text;
            card.querySelector('.dictation-check').click();
            await flush();
            return card.querySelector('.dictation-result');
        };
        let box = await check('Joyeux Nöel');
        const words = Array.from(box.querySelectorAll('.dt-word'));
        assert.equal(words.length, 2);
        assert.equal(box.querySelectorAll('.dt-accent').length, 1);
        assert.equal(box.querySelectorAll('.dt-wrong, .dt-missing, .dt-extra').length, 0);
        assert(!box.querySelector('.dictation-diff').textContent.includes('!'));
        const legend = box.querySelector('.dictation-legend').textContent.replace(/\s+/g, ' ').trim();
        assert.equal(legend, lang === 'zh' ? '对 1重音 1' : 'right 1accent 1');
        const verdict = box.querySelector('.dictation-verdict').textContent;
        assert.equal(verdict, lang === 'zh' ? '只差重音' : 'Only accents to fix');
        const text = box.textContent;
        for (const banned of ['撇号', '标点', 'apostrophe', 'punctuation']) assert(!text.includes(banned), banned);
        // The full answer still reads naturally, with its "!"
        assert.equal(box.querySelector('.dictation-answer-text').textContent, 'Joyeux Noël !');
        card.querySelector('.dictation-retry').click();
        box = await check('Joyeux Noël');
        assert.equal(box.querySelector('.dictation-accuracy').textContent, '100%');
        assert.equal(box.querySelector('.dictation-verdict').textContent, lang === 'zh' ? '全对 ✓' : 'All correct ✓');
    });
}

test('quotes, guillemets and marks never show in the diff; elisions do', async () => {
    const dom = new JSDOM('<body><article class="sentence-card" id="card"><p>card</p></article></body>', { runScripts: 'outside-only', url: 'http://localhost/study' });
    dom.window.eval(SOURCE);
    const ctl = dom.window.FrenchDictation.create({ lang: 'zh', getToken: () => '' });
    const card = dom.window.document.getElementById('card');
    ctl.open(card, { sentence: "« J'ai faim », dit-il ; puis : “L'homme ?” Oui !", translationEn: 'x', steps: [] }, 'listen');
    card.querySelector('.dictation-input').value = "'jai faim' dit-il puis l'homme oui";
    card.querySelector('.dictation-check').click();
    await flush();
    const ops = Array.from(card.querySelectorAll('.dt-word'));
    const diff = card.querySelector('.dictation-diff').textContent;
    for (const mark of ['«', '»', '“', '”', ';', ':', '?', '!', ',']) assert(!diff.includes(mark), mark);
    assert.equal(card.querySelectorAll('.dt-accent').length, 1);  // j' without its apostrophe
    assert.equal(card.querySelectorAll('.dt-wrong, .dt-missing, .dt-extra').length, 0);
    assert.equal(ops.length, 9);  // J' ai faim dit il puis L' homme Oui
});
