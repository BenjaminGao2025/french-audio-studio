/** Transcript-based shadowing feedback; the original French phonetic tolerance is preserved. */
    export function cleanFrenchToken(str: string) {
        return (str || '')
            .toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '')
            .trim();
    }

    // Words whose final -ent is pronounced /ɑ̃/ (or /ɛ̃/ in -ient), so it is not the silent verb
    // ending of "ils parlent". Without them "comment" and "comme" normalised to the same thing
    // and a learner saying /kɔm/ for /kɔmɑ̃/ scored 100. Accents are already stripped here.
    const PRONOUNCED_ENT = new Set([
        'absent', 'accent', 'accident', 'adolescent', 'agent', 'aliment', 'argent', 'argument',
        'cent', 'ciment', 'client', 'comment', 'compliment', 'consent', 'content', 'continent',
        'convient', 'dent', 'devient', 'different', 'document', 'equivalent', 'evident', 'excellent',
        'fragment', 'frequent', 'incident', 'innocent', 'instrument', 'intelligent', 'lent',
        'medicament', 'moment', 'monument', 'obtient', 'orient', 'parent', 'patient', 'permanent',
        'present', 'president', 'prudent', 'recent', 'regiment', 'ressent', 'revient', 'segment',
        'sentiment', 'serment', 'serpent', 'souvent', 'souvient', 'talent', 'temperament',
        'testament', 'tient', 'torrent', 'tourment', 'urgent', 'vent', 'vient', 'violent',
        'appartient', 'contient', 'maintient', 'parvient', 'provient', 'retient', 'soutient',
    ]);
    // -mment verbs (nommer, consommer, programmer...): their -ent is silent like any 3rd person
    // plural, unlike the -emment/-amment adverbs (évidemment, couramment).
    const SILENT_MMENT = new Set([
        'programment', 'reprogramment', 'deprogramment', 'enflamment', 'desenflamment',
    ]);
    // A grave è right before the final consonants (sèment, parsèment, diffèrent, lèvent) only
    // occurs in verb forms: nouns and adverbs in -ement keep a plain e there (événement,
    // complètement), so this decides before accents are stripped.
    const VERB_GRAVE_ENT = /è[^aeiouyàâäéèêëîïôöùûüœæ]+ent$/;

    // Final -s / -x that is pronounced: dropping it would make "fils" match "fil"
    const PRONOUNCED_S = new Set([
        'autobus', 'bonus', 'bus', 'cactus', 'campus', 'fils', 'helas', 'index', 'iris', 'mars',
        'oasis', 'os', 'ours', 'sens', 'tennis', 'virus', 'lys', 'jadis', 'atlas', 'albatros',
    ]);

    export function frenchPhoneticNormalize(word: string) {
        if (!word) return '';
        let w = word.toLowerCase().trim();
        w = w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '');
        const graveVerb = VERB_GRAVE_ENT.test(w.normalize('NFC'));
        // Decompose accents for phonetic tolerance (e.g. é -> e, à -> a, ç -> c)
        w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Plural -s / -x is silent (canadiennes -> canadienne, autorités -> autorite). Strip it
        // first, so "parents" and its homophone "parent" normalise alike.
        if ((w.endsWith('s') || w.endsWith('x')) && w.length >= 3 && !PRONOUNCED_S.has(w)) {
            w = w.slice(0, -1);
        }
        // The verb ending -ent of the 3rd person plural is silent (autorisent -> autorise,
        // ils sèment -> sème, ils nomment -> nomme), but not in adverbs/nouns in -ement and
        // -emment/-amment (lentement, gouvernement, évidemment, couramment) or the common words
        // above (comment, moment, souvent, client, il vient).
        if (w.endsWith('ent') && w.length >= 5) {
            let silent;
            if (graveVerb || SILENT_MMENT.has(w)) silent = true;
            else if (PRONOUNCED_ENT.has(w)) silent = false;
            else if (w.endsWith('emment') || w.endsWith('amment')) silent = false;
            else if (w.endsWith('mment')) silent = true;
            else silent = !w.endsWith('ement');
            if (silent) w = w.slice(0, -2);
        }
        return w;
    }

    function calculateLevenshteinSimilarity(s1: string, s2: string) {
        if (!s1 && !s2) return 1.0;
        if (!s1 || !s2) return 0.0;
        if (s1 === s2) return 1.0;

        const m = s1.length;
        const n = s2.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }

        const distance = dp[m][n];
        const maxLen = Math.max(m, n);
        return maxLen === 0 ? 1.0 : 1.0 - (distance / maxLen);
    }


export function evaluateShadowing(target: string, transcript: string) {
  const tokens = (s: string) => (s.replace(/['’]\s+/g, "'").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []);
  const expected = tokens(target), spoken = tokens(transcript);
  const similarities = expected.map((a) => spoken.map((b) => calculateLevenshteinSimilarity(frenchPhoneticNormalize(a), frenchPhoneticNormalize(b))));
  const n = expected.length, m = spoken.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1 - similarities[i - 1][j - 1]);
  const scores = expected.map(() => 0);
  let i = n, j = m;
  while (i || j) {
    if (i && j && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + 1 - similarities[i - 1][j - 1])) < 1e-6) {
      scores[i - 1] = similarities[i - 1][j - 1]; i--; j--;
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) i--; else j--;
  }
  const accuracy = n ? Math.round(scores.reduce((a, b) => a + b, 0) / n * 100) : 0;
  const completeness = n ? Math.round(scores.reduce((a, b) => a + (b >= .82 ? 1 : b >= .55 ? .5 : 0), 0) / n * 100) : 0;
  return { accuracy, completeness, score: Math.round(accuracy * .7 + completeness * .3), words: expected.map((word, i) => ({ word, score: Math.round(scores[i] * 100), status: scores[i] >= .82 ? "correct" : scores[i] >= .55 ? "close" : "missed" })) };
}
