/**
 * French Audio Studio - shadowing / speaking evaluation shared by /study and /review.
 * Compares a speech-recognition transcript with the target French sentence
 * word by word (phonetic-normalized Levenshtein), returning a 0-100 score.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SpeechEval = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    function cleanFrenchToken(str) {
        return (str || '')
            .toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '')
            .trim();
    }

    function frenchPhoneticNormalize(word) {
        if (!word) return '';
        let w = word.toLowerCase().trim();
        w = w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’«»[\]]/g, '');
        // Decompose accents for phonetic tolerance (e.g. é -> e, à -> a, ç -> c)
        w = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // In French, verbal 3rd person plural ending -ent is 100% silent (e.g. autorisent -> autorise)
        if (w.endsWith('ent') && w.length >= 5) {
            w = w.slice(0, -2);
        }
        // In French, plural nominal/adjectival endings -s and -x are silent (e.g. canadiennes -> canadienne, autorités -> autorite)
        if ((w.endsWith('s') || w.endsWith('x')) && w.length >= 3) {
            w = w.slice(0, -1);
        }
        return w;
    }

    function calculateLevenshteinSimilarity(s1, s2) {
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

    function evaluateFrenchPronunciation(targetSentence, spokenTranscript) {
        // Extract words from target sentence, preserving elisions (e.g. n'autorisent, d'accord, c'est)
        const rawTargetWords = (targetSentence || '').match(/(?:aujourd['’]hui|[A-Za-zÀ-ÖØ-öø-ÿŒœ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿŒœ]+)?['’]?|[0-9]+)/gi) || [];
        const targetWords = rawTargetWords
            .map(w => ({ raw: w, clean: cleanFrenchToken(w), norm: frenchPhoneticNormalize(w) }))
            .filter(item => item.clean.length > 0);

        if (targetWords.length === 0) {
            return {
                overallScore: 100,
                accuracy: 100,
                completeness: 100,
                ratingText: '卓越 (Excellent !)',
                ratingClass: 'excellent',
                wordResults: [],
            };
        }

        const spokenTokens = (spokenTranscript || '')
            .split(/\s+/)
            .filter(w => w.length > 0);

        const wordResults = [];
        let totalScoreSum = 0;
        let matchedCount = 0;

        targetWords.forEach((target, targetIdx) => {
            let bestSim = 0;

            // Check if target has an elision prefix (n', d', l', c', j', m', t', s', qu')
            let baseNorm = '';
            const elisionMatch = target.raw.match(/^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i);
            if (elisionMatch && elisionMatch[2]) {
                baseNorm = frenchPhoneticNormalize(elisionMatch[2]);
            }

            // 1. Single token comparison (with phonetic normalization & silent endings tolerance)
            for (let i = 0; i < spokenTokens.length; i++) {
                const sp = spokenTokens[i];
                const normSp = frenchPhoneticNormalize(sp);

                // Check normalized Levenshtein similarity
                let sim = calculateLevenshteinSimilarity(target.norm, normSp);

                // If target is an elision word (e.g. n'autorisent, d'accord), also check against base word (e.g. autorisent)
                // In connected French speech ("canadiennes n'autorisent"), the n' elision merges with preceding [n]
                if (baseNorm) {
                    const baseSim = calculateLevenshteinSimilarity(baseNorm, normSp);
                    if (baseSim >= 0.82) {
                        sim = Math.max(sim, Math.min(1.0, baseSim + 0.05));
                    }
                }
                if (sim > bestSim) bestSim = sim;
            }

            // 2. Adjacent two-token combination match
            // Handles cases where ASR inserts a space after apostrophe: "n'" + "autorisent", or "l'" + "homme"
            for (let i = 0; i < spokenTokens.length - 1; i++) {
                const combo = spokenTokens[i] + spokenTokens[i + 1];
                const normCombo = frenchPhoneticNormalize(combo);
                const sim = calculateLevenshteinSimilarity(target.norm, normCombo);
                if (sim > bestSim) bestSim = sim;
            }

            // 3. French enchaînement / assimilation check:
            // When preceding word ends in 'n' (like "canadiennes") and current word starts with n' (like "n'autorisent"),
            // the double [n] naturally fuses into a single [n] in fluent speech: [kanadjɛnotɔʁiz].
            // If the base verb (autorisent) is recognized, it is an authentic continuous pronunciation.
            if (baseNorm && targetIdx > 0) {
                const prevTargetNorm = targetWords[targetIdx - 1].norm;
                if (prevTargetNorm.endsWith('n') || prevTargetNorm.endsWith('ne')) {
                    for (let i = 0; i < spokenTokens.length; i++) {
                        const normSp = frenchPhoneticNormalize(spokenTokens[i]);
                        if (calculateLevenshteinSimilarity(baseNorm, normSp) >= 0.85) {
                            bestSim = Math.max(bestSim, 1.0);
                        }
                    }
                }
            }

            let status = 'missed';
            if (bestSim >= 0.82) {
                status = 'correct';
                matchedCount++;
            } else if (bestSim >= 0.55) {
                status = 'acceptable';
                matchedCount += 0.5;
            }

            const wordScore = Math.round(bestSim * 100);
            totalScoreSum += wordScore;

            wordResults.push({
                word: target.raw,
                score: wordScore,
                status: status,
            });
        });

        const accuracy = Math.round(totalScoreSum / targetWords.length);
        const completeness = Math.min(100, Math.round((matchedCount / targetWords.length) * 100));
        const overallScore = Math.round(accuracy * 0.7 + completeness * 0.3);

        let ratingText = '有待提高 (À travailler)';
        let ratingClass = 'needs-work';

        if (overallScore >= 90) {
            ratingText = '卓越 (Excellent !)';
            ratingClass = 'excellent';
        } else if (overallScore >= 75) {
            ratingText = '良好 (Très bien !)';
            ratingClass = 'good';
        } else if (overallScore >= 60) {
            ratingText = '及格 (Passable)';
            ratingClass = 'pass';
        }

        return {
            overallScore,
            accuracy,
            completeness,
            ratingText,
            ratingClass,
            wordResults,
        };
    }

    return {
        cleanFrenchToken,
        frenchPhoneticNormalize,
        calculateLevenshteinSimilarity,
        evaluateFrenchPronunciation,
    };
});
