// Run with: node tests/test_accent_fix.cjs
// The accent note under a sentence, and how the original survives extraction. Runs the real
// functions and strings of study.js, which needs no DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const study = fs.readFileSync(path.join(__dirname, '../static/study.js'), 'utf8');
const between = (from, to) => {
    const start = study.indexOf(from);
    const end = study.indexOf(to, start);
    assert(start >= 0 && end > start, `source of ${from}`);
    return study.slice(start, end);
};

const escapeSource = between('function escapeHtml(str) {', "const { cleanFrenchToken");
const helpers = between('    function withAccentNotes(', '    // The header is the same whether');
const notes = study.match(/accentFixedNote: \(original\) => `[^`]*`/g);
assert.equal(notes.length, 2);
const build = source => new Function(`${escapeSource}; const T = { ${source} }; ${helpers}; return { withAccentNotes, accentNoteHtml };`)();
const en = build(notes[0]);
const zh = build(notes[1]);

// Note rendering
assert.equal(
    zh.accentNoteHtml('A pied', 'À pied'),
    '<p class="sentence-accent-note">原文写作 A pied，已更正</p>',
);
assert.equal(
    en.accentNoteHtml('A pied', 'À pied'),
    '<p class="sentence-accent-note">Source reads “A pied”, corrected</p>',
);

// The original comes from a question bank: it is data, not markup
const hostile = zh.accentNoteHtml('<img src=x onerror="alert(1)">', 'À pied');
assert(!hostile.includes('<img'), hostile);
assert(hostile.includes('&lt;img'), hostile);

// Stored items have no field, and an equal original needs no note
assert.equal(zh.accentNoteHtml(undefined, 'À pied'), '');
assert.equal(zh.accentNoteHtml('', 'À pied'), '');
assert.equal(zh.accentNoteHtml('À pied', 'À pied'), '');

// Extraction fixed the text, so the analysis returned the corrected sentence with no field
const { withAccentNotes } = zh;
const fixes = [
    { fr: 'À pied', accent_fixed_from: 'A pied' },
    { fr: 'À Paris. À 8 heures.', accent_fixed_from: 'A Paris. A 8 heures.' },
];
assert.deepEqual(
    withAccentNotes([{ sentence: 'À pied' }], fixes),
    [{ sentence: 'À pied', accent_fixed_from: 'A pied' }],
);

// One extracted line can come back as several sentences
assert.deepEqual(
    withAccentNotes([{ sentence: 'À Paris.' }, { sentence: 'À 8 heures.' }], fixes).map(s => s.accent_fixed_from),
    ['A Paris.', 'A 8 heures.'],
);

// A part of a line with nothing fixed in it, an unrelated sentence, an analysis note that stands
assert.deepEqual(withAccentNotes([{ sentence: 'pied' }], fixes), [{ sentence: 'pied' }]);
assert.deepEqual(withAccentNotes([{ sentence: 'Je parle.' }], fixes), [{ sentence: 'Je parle.' }]);
assert.deepEqual(
    withAccentNotes([{ sentence: 'À pied', accent_fixed_from: 'a pied' }], fixes),
    [{ sentence: 'À pied', accent_fixed_from: 'a pied' }],
);
assert.deepEqual(withAccentNotes([{ sentence: 'À pied' }], []), [{ sentence: 'À pied' }]);
assert.deepEqual(withAccentNotes([{ original: 'À pied' }], fixes)[0].accent_fixed_from, 'A pied');

console.log('accent note: ok');
