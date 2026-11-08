/* ==========================================================================
   French Audio Studio - How one word works in one sentence (the 语境 part of the word card)
   The card's 词典 part is the word on its own; this is the word HERE: which occurrence of the
   sentence was tapped, and its Chinese "why this form" note from POST /api/word-context, asked
   only when a card opens. Same occurrence rule as word_context.py (tests/fixtures/
   word_context_cases.json keeps the two equal): case does not matter, accents do (à is not a),
   and a word glued to an apostrophe (the "une" of "d'une") is not a whole word.
   ========================================================================== */

(function (root) {
    'use strict';

    const WORD_MAX = 40;
    const MAX_CHUNK_WORDS = 4;  // words of a chunk such as "est-ce que"
    const isWordChar = ch => /[\p{L}\p{N}\p{M}_]/u.test(ch);
    const isApostrophe = ch => ch === "'" || ch === '’';
    const foldCase = text => String(text || '').normalize('NFC').replace(/’/g, "'").toLowerCase();
    const normalized = text => foldCase(text).replace(/\s+/g, ' ').trim();

    // A French word or short chunk as the page shows it: letters, apostrophes, hyphens and single
    // spaces ("avez-vous", "est-ce que"); '' otherwise
    function cleanWord(value) {
        const word = String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
        if (!word || word.length > WORD_MAX || word.split(' ').length > MAX_CHUNK_WORDS
            || !/^[\p{L}\p{M}'’ -]+$/u.test(word) || !/\p{L}/u.test(word)) return '';
        return word;
    }

    // [start, end) of every whole-word occurrence of `word` in `sentence`, in order
    function spans(word, sentence) {
        const want = foldCase(word).replace(/\s+/g, ' ');
        const text = String(sentence || '').normalize('NFC');
        const have = foldCase(text);
        if (!want || have.length !== text.length) return [];
        const out = [];
        for (let at = have.indexOf(want); at !== -1; at = have.indexOf(want, at + 1)) {
            const end = at + want.length;
            const before = at > 0 ? text[at - 1] : '';
            const after = end < text.length ? text[end] : '';
            if (!(before && (isWordChar(before) || isApostrophe(before))) && !(after && isWordChar(after))) out.push({ start: at, end });
        }
        return out;
    }

    const keyOf = target => `${normalized(target.sentence)}\n${normalized(target.word)}\n${target.occurrence}`;
    const clip = (value, n) => String(value || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

    /**
     * One answer per sentence, word and occurrence for the page's lifetime (the server keeps it per
     * user). Taps on the same word share the request; a failure is dropped, so Retry asks again.
     *   options: getToken(), fetch (defaults to window.fetch)
     *   explain(target, hints) -> Promise<{state: 'ready'|'empty'|'unavailable', meaning_zh, meaning_en, why_zh}>
     */
    function createClient(options) {
        const cache = new Map();
        const doFetch = (...args) => (options.fetch || root.fetch)(...args);
        function explain(target, hints = {}) {
            const key = keyOf(target);
            if (cache.has(key)) return cache.get(key);
            const token = options.getToken ? options.getToken() : '';
            if (!token) return Promise.resolve({ state: 'unavailable' });  // not cached: signing in makes it available
            const request = doFetch('/api/word-context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    sentence: String(target.sentence).slice(0, 600),
                    word: target.word,
                    occurrence: target.occurrence,
                    translation_zh: clip(target.translation_zh, 600),
                    hints: {
                        meaning_zh: clip(hints.meaning_zh, 200), meaning_en: clip(hints.meaning_en, 300),
                        note_en: clip(hints.note_en, 600), lemma: clip(hints.lemma, 100), pos: clip(hints.pos, 60),
                    },
                }),
            }).then(async res => {
                const data = await res.json().catch(() => ({}));
                // Not a word of this sentence: a fixed answer, kept like any other
                if (res.status === 422) return { state: 'unavailable' };
                if (!res.ok) {
                    const err = new Error((data.detail && data.detail.message) || `HTTP ${res.status}`);
                    err.status = res.status;
                    throw err;
                }
                const ctx = data.context && typeof data.context === 'object' ? data.context : {};
                const result = { meaning_zh: clip(ctx.meaning_zh, 24), meaning_en: clip(ctx.meaning_en, 80), why_zh: clip(ctx.why_zh, 200) };
                result.state = result.meaning_zh || result.meaning_en || result.why_zh ? 'ready' : 'empty';
                return result;
            });
            request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
            cache.set(key, request);
            return request;
        }
        return { explain, size: () => cache.size };
    }

    const api = { cleanWord, spans, keyOf, createClient };
    root.FrenchWordContext = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
