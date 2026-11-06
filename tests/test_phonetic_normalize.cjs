// Run with: node tests/test_phonetic_normalize.cjs
// French spelling vs sound in the shadowing score: silent endings are tolerated (the speech
// recogniser may write a homophone), but pronounced ones must not be.
const assert = require('node:assert/strict');
const { frenchPhoneticNormalize: norm, evaluateFrenchPronunciation } = require('../static/speech-eval.js');

const same = (a, b, why) => assert.equal(norm(a), norm(b), `${a} ~ ${b}: ${why}`);
const differ = (a, b, why) => assert.notEqual(norm(a), norm(b), `${a} ≠ ${b}: ${why}`);

// Silent endings: homophones match
same('autorisent', 'autorise', 'verb -ent is silent');
same('parlent', 'parle', 'verb -ent is silent');
same('aiment', 'aime', 'verb -ent is silent, even after m');
same('parents', 'parent', 'plural -s is silent');
same('canadiennes', 'canadienne', 'plural -s is silent');
same('mais', 'mai', 'both /mɛ/');
same('Été', 'ete', 'accents are tolerated');
// Verbs whose 3rd person plural ends in -ement / -mment / è+consonant+ent: still silent -ent
same('sèment', 'sème', 'ils sèment /sɛm/: not a nasal -ement noun');
same('parsèment', 'parsème', 'ils parsèment /paʁsɛm/');
same('écrèment', 'écrème', 'ils écrèment');
same('blasphèment', 'blasphème', 'ils blasphèment');
same('diffèrent', 'diffère', 'verb diffèrent, unlike the adjective différent');
same('préfèrent', 'préfère', 'verb -ent is silent');
same('lèvent', 'lève', 'verb -ent is silent');
same('nomment', 'nomme', 'ils nomment /nɔm/: not an -emment adverb');
same('consomment', 'consomme', 'ils consomment');
same('gomment', 'gomme', 'ils gomment');
same('programment', 'programme', 'ils programment, not an -amment adverb');
same('étudient', 'étudie', 'verb -ent is silent after i');
same('Sèment.', 'sème', 'punctuation and capitals do not hide the verb');

// Pronounced endings: different sounds stay different
differ('comment', 'comme', '/kɔmɑ̃/ vs /kɔm/');
differ('content', 'conte', '/kɔ̃tɑ̃/ vs /kɔ̃t/');
differ('moment', 'mome', '-ment noun');
differ('lentement', 'lenteme', '-ement adverb');
differ('évidemment', 'evidemme', '-emment adverb');
differ('vient', 'vie', '/vjɛ̃/');
differ('fils', 'fil', '/fis/ vs /fil/');
differ('bus', 'bu', '/bys/ vs /by/');
differ('différent', 'diffère', 'adjective différent keeps /ɑ̃/');
differ('couramment', 'courame', '-amment adverb');
differ('gouvernement', 'gouverneme', '-ement noun');
differ('complètement', 'complèteme', 'an è earlier in an -ement adverb is not a verb ending');
differ('événement', 'evenme', '-ement noun');

// End to end: saying "comme" for "comment" is no longer a perfect word
const wrong = evaluateFrenchPronunciation('Comment ça va ?', 'comme ça va');
assert(wrong.wordResults[0].score < 100, 'comment read as comme is not scored 100');
const right = evaluateFrenchPronunciation('Ils parlent souvent.', 'ils parle souvent');
assert.equal(right.overallScore, 100, 'a homophone spelling from the recogniser is fine');
const sown = evaluateFrenchPronunciation('Ils sèment du blé.', 'ils sème du blé');
assert.equal(sown.overallScore, 100, `ils sèment heard as "sème" is a homophone (got ${sown.overallScore})`);
const named = evaluateFrenchPronunciation('Ils nomment le chat.', 'ils nomme le chat');
assert.equal(named.overallScore, 100, `ils nomment heard as "nomme" is a homophone (got ${named.overallScore})`);
// jusqu' is an elision like l' or qu'
const elided = evaluateFrenchPronunciation("Jusqu'à demain", 'jusqu à demain');
assert(elided.overallScore >= 90, `jusqu'à elision tolerated (got ${elided.overallScore})`);

console.log('PASS: French silent vs pronounced endings in the shadowing score.');
