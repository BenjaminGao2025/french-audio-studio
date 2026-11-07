/* ==========================================================================
   French Audio Studio - Fixed expressions of a sentence (à partir de, il y a, grâce à)
   A tap on "partir" in "À partir des sessions" shows the whole "à partir de". Same matching
   rules as phrase_context.py (tests/fixtures/phrase_cases.json keeps the two equal): whole
   words only, case / accents / ’ ignored, contractions and elision understood (des = de + les,
   aux = à + les, d'une, l'heure), and only spaces or hyphens between the words.
   Sources, best first: the analysis's own `phrases`, multi-word entries of its word table,
   "part of the phrase …" notes in that table, then (older sentences only) POST /api/phrase-context.
   ========================================================================== */

(function (root) {
    'use strict';

    const ATOM_RE = /aujourd['’]hui|[\p{L}\p{M}]+['’]?/giu;
    const GAP_RE = /^[\s\-‐‑–]*$/u;
    const MAX_ATOMS = 8;

    function fold(text) {
        return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/’/g, "'").replace(/œ/g, 'oe').replace(/æ/g, 'ae');
    }

    function atoms(text) {
        const out = [];
        for (const m of String(text || '').matchAll(ATOM_RE)) out.push({ norm: fold(m[0]), start: m.index, end: m.index + m[0].length });
        return out;
    }

    function sameWord(canonical, surface) {
        if (canonical === surface) return true;
        if (canonical === 'de') return surface === "d'" || surface === 'du' || surface === 'des';
        if (canonical === 'a') return surface === 'au' || surface === 'aux';
        if (canonical === 'la') return surface === "l'";
        if (canonical === 'si') return surface === "s'";
        return canonical.length >= 2 && canonical.endsWith('e') && surface === `${canonical.slice(0, -1)}'`;
    }

    // Every {start, end} where the words of `pattern` follow each other in `text`
    function find(pattern, text) {
        pattern = String(pattern || '');
        const want = atoms(pattern).map(a => a.norm);
        if (want.length < 2 || want.length > MAX_ATOMS || pattern.includes('…') || pattern.includes('...')) return [];
        const have = atoms(text);
        const found = [];
        for (let i = 0; i + want.length <= have.length; i++) {
            let ok = true;
            for (let j = 0; j < want.length && ok; j++) {
                ok = sameWord(want[j], have[i + j].norm)
                    && (j === 0 || GAP_RE.test(text.slice(have[i + j - 1].end, have[i + j].start)));
            }
            if (ok) found.push({ start: have[i].start, end: have[i + want.length - 1].end });
        }
        return found;
    }

    const CONTRACTIONS = { des: 'de + les', du: 'de + le', au: 'à + le', aux: 'à + les' };

    // "des = de + les": contractions in the sentence's form of the expression
    function contractionNotes(surface, canonical) {
        const s = atoms(surface);
        const c = atoms(canonical);
        if (s.length !== c.length) return [];
        const notes = [];
        s.forEach((atom, i) => {
            if (atom.norm === c[i].norm) return;
            const word = surface.slice(atom.start, atom.end).toLowerCase();
            if (CONTRACTIONS[atom.norm]) notes.push(`${word} = ${CONTRACTIONS[atom.norm]}`);
            else if (atom.norm.endsWith("'")) notes.push(`${word} = ${canonical.slice(c[i].start, c[i].end).toLowerCase()}`);
        });
        return notes;
    }

    const clip = (value, n) => String(value || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

    // "Part of the phrase à partir de = starting from", "固定搭配「à partir de」"
    const MENTION_RE = /part of (?:the |a |an )?(?:fixed |set |common )?(?:phrase|expression|idiom|chunk)\s*[:：]?\s*|固定(?:搭配|短语|表达|词组|用法)\s*[:：]?\s*/giu;
    function mentionsIn(note, sentence, word) {
        const found = [];
        for (const m of String(note || '').matchAll(MENTION_RE)) {
            const rest = note.slice(m.index + m[0].length).replace(/^["“'‘«「《\s]+/u, '');
            const words = [];
            let last = null;
            for (const atom of atoms(rest)) {
                if (last && !GAP_RE.test(rest.slice(last.end, atom.start))) break;
                words.push(atom);
                last = atom;
                if (words.length >= MAX_ATOMS) break;
            }
            // The longest run of those words that the sentence really has, around this word
            for (let n = words.length; n >= 2; n--) {
                const phrase = rest.slice(words[0].start, words[n - 1].end);
                const own = fold(word);
                const covers = find(phrase, sentence).some(h => atoms(sentence.slice(h.start, h.end)).some(a => a.norm === own));
                if (!covers) continue;
                const after = rest.slice(words[n - 1].end).match(/^\s*["”'’»」》]?\s*(?:=|:|means|meaning)\s*([^.;()\n]{1,60})/i);
                const meaning = after ? after[1].trim() : '';
                const zh = /[一-鿿]/.test(meaning);
                found.push({ text: phrase, phrase, meaning_zh: zh ? meaning : '', meaning_en: zh ? '' : meaning });
                break;
            }
        }
        return found;
    }

    /**
     * The fixed expressions a sentence analysis already holds.
     *   structured: the analysis returned `phrases` (an empty list means: none)
     *   aware: the word table groups expressions (or notes them), so it already looked for them
     */
    function fromAnalysis(s) {
        const sentence = String((s && (s.sentence || s.original)) || '');
        const phrases = [];
        const add = (p, source) => {
            const text = clip(p.text, 80);
            const phrase = clip(p.phrase, 80);
            if (!find(text, sentence).length && !find(phrase, sentence).length) return;
            const key = fold(atoms(phrase).length >= 2 ? phrase : text);
            const same = phrases.find(q => fold(q.phrase) === key || fold(q.text) === fold(text));
            const entry = {
                text, phrase: atoms(phrase).length >= 2 ? phrase : text.toLowerCase(),
                meaning_zh: clip(p.meaning_zh, 40), meaning_en: clip(p.meaning_en, 80), literal_zh: clip(p.literal_zh, 160), source,
            };
            if (!same) { phrases.push(entry); return; }
            for (const field of ['meaning_zh', 'meaning_en', 'literal_zh']) if (!same[field]) same[field] = entry[field];
        };
        const structured = Boolean(s && Array.isArray(s.phrases));
        if (structured) s.phrases.forEach(p => p && typeof p === 'object' && add(p, 'analysis'));
        const words = (s && s.words && s.words.length ? s.words : (s && s.tokens) || []).filter(w => w && typeof w === 'object');
        words.forEach(w => {
            const fr = String(w.fr || w.token || '').trim();
            if (!/\s/.test(fr)) return;
            const lemma = String(w.lemma || '').trim();
            add({
                text: fr, phrase: /\s/.test(lemma) ? lemma : fr,
                meaning_zh: w.meaning_zh || w.explanation_cn, meaning_en: w.meaning || w.explanation_en,
            }, 'words');
        });
        words.forEach(w => {
            const fr = String(w.fr || w.token || '').trim();
            if (!fr || /\s/.test(fr)) return;
            [w.meaning, w.why, w.meaning_zh, w.explanation_en, w.explanation_cn].forEach(note => {
                mentionsIn(String(note || ''), sentence, fr.replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu, '')).forEach(p => add(p, 'note'));
            });
        });
        return { sentence, phrases, structured, aware: structured || phrases.length > 0, words: atoms(sentence).length };
    }

    // Where each expression sits in `text` (a sentence or one of its build-up steps), first come
    // first served: two expressions never claim the same words
    function occurrences(phrases, text) {
        const taken = [];
        const out = [];
        (phrases || []).forEach(p => {
            const hits = find(p.text, text).length ? find(p.text, text) : find(p.phrase, text);
            hits.forEach(h => {
                if (taken.some(t => h.start < t.end && t.start < h.end)) return;
                taken.push(h);
                const surface = text.slice(h.start, h.end);
                out.push({ phrase: p, start: h.start, end: h.end, surface, notes: contractionNotes(surface, p.phrase) });
            });
        });
        return out.sort((a, b) => a.start - b.start);
    }

    // A few words either side of the expression, for the card
    function snippet(text, start, end, radius = 28) {
        let from = Math.max(0, start - radius);
        let to = Math.min(text.length, end + radius);
        // Cut at word boundaries inside the radius (the first space after `from`, the last before `to`)
        if (from > 0) { const cut = text.indexOf(' ', from); from = cut !== -1 && cut < start ? cut + 1 : from; }
        if (to < text.length) { const cut = text.lastIndexOf(' ', to); to = cut >= end ? cut : to; }
        return {
            before: (from > 0 ? '… ' : '') + text.slice(from, start),
            match: text.slice(start, end),
            after: text.slice(end, to) + (to < text.length ? ' …' : ''),
        };
    }

    const api = { fold, atoms, find, contractionNotes, fromAnalysis, occurrences, snippet };
    root.FrenchPhraseContext = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
