/**
 * French Audio Studio - Anki Spaced Repetition System (SM-2) & Deck Manager
 * Implements standard SuperMemo-2 (SM-2) algorithm:
 *   - Repetitions (n)
 *   - Interval (I) in days
 *   - Ease Factor (EF), minimum 1.3, initial 2.5
 *   - Due Date scheduling
 *   - Anki TSV Export (.tsv compatible with desktop Anki & AnkiMobile)
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AnkiDeck = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    const STORAGE_KEY = 'frenchStudio.ankiDeck';
    const DAY_MS = 24 * 60 * 60 * 1000;

    /**
     * Compute next review schedule using the SuperMemo-2 (SM-2) algorithm.
     * @param {Object} card Current card SM-2 state
     * @param {number} grade 1: Again (重来), 2: Hard (困难), 3: Good (良好), 4: Easy (简单)
     * @returns {Object} Updated SM-2 state { repetitions, interval, easeFactor, dueDate, lastReviewed }
     */
    function scheduleSM2(card, grade) {
        let repetitions = card.repetitions || 0;
        let interval = card.interval || 0;
        let easeFactor = card.easeFactor || 2.5;

        // Map user 1..4 scale to standard SM-2 0..5 quality score:
        // 1 (Again) -> q = 1 (incorrect response)
        // 2 (Hard)  -> q = 3 (correct response with serious difficulty)
        // 3 (Good)  -> q = 4 (correct response after hesitation)
        // 4 (Easy)  -> q = 5 (perfect response)
        const qMap = { 1: 1, 2: 3, 3: 4, 4: 5 };
        const q = qMap[grade] || 4;

        if (q < 3) {
            // Failed recall: reset repetitions and start over at 1 day
            repetitions = 0;
            interval = 1;
        } else {
            // Successful recall
            if (repetitions === 0) {
                interval = grade === 4 ? 3 : 1; // Easy bonus on first step
            } else if (repetitions === 1) {
                interval = grade === 4 ? 8 : 6;
            } else {
                let multiplier = easeFactor;
                if (grade === 2) multiplier = Math.max(1.15, easeFactor * 0.85);
                if (grade === 4) multiplier = easeFactor * 1.3;
                interval = Math.round(interval * multiplier);
            }
            repetitions += 1;
        }

        // Adjust Ease Factor (EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
        easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        if (easeFactor < 1.3) easeFactor = 1.3; // SM-2 standard lower bound

        const now = Date.now();
        const dueDate = new Date(now + interval * DAY_MS).toISOString();

        return {
            repetitions,
            interval,
            easeFactor: Number(easeFactor.toFixed(3)),
            dueDate,
            lastReviewed: new Date(now).toISOString()
        };
    }

    class DeckManager {
        constructor(storageKey = STORAGE_KEY) {
            this.storageKey = storageKey;
            this.cards = this.load();
        }

        load() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (!raw) return [];
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (err) {
                console.error('Failed to load flashcard deck from localStorage:', err);
                return [];
            }
        }

        save() {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.cards));
                return true;
            } catch (err) {
                console.error('Failed to save flashcard deck to localStorage:', err);
                return false;
            }
        }

        normalizeToken(token) {
            return (token || '').trim().toLowerCase();
        }

        hasCard(token) {
            const clean = this.normalizeToken(token);
            return this.cards.some(c => this.normalizeToken(c.token) === clean);
        }

        getCard(idOrToken) {
            const clean = this.normalizeToken(idOrToken);
            return this.cards.find(c => c.id === idOrToken || this.normalizeToken(c.token) === clean);
        }

        /**
         * Add a new card to the deck. If card exists, update its metadata.
         */
        addCard({ token, lemma, pos, phonetic, explanation_en, explanation_cn, sentence, sentence_cn }) {
            const clean = this.normalizeToken(token);
            if (!clean) return null;

            const existingIndex = this.cards.findIndex(c => this.normalizeToken(c.token) === clean);
            const now = new Date().toISOString();

            if (existingIndex >= 0) {
                // Update content fields without resetting SM-2 schedule
                const existing = this.cards[existingIndex];
                existing.lemma = lemma || existing.lemma;
                existing.pos = pos || existing.pos;
                existing.phonetic = phonetic || existing.phonetic;
                existing.explanation_en = explanation_en || existing.explanation_en;
                existing.explanation_cn = explanation_cn || existing.explanation_cn;
                if (sentence) existing.sentence = sentence;
                if (sentence_cn) existing.sentence_cn = sentence_cn;
                this.save();
                return existing;
            }

            const newCard = {
                id: 'fc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                token: token.trim(),
                lemma: (lemma || '').trim(),
                pos: (pos || '').trim(),
                phonetic: (phonetic || '').trim(),
                explanation_en: (explanation_en || '').trim(),
                explanation_cn: (explanation_cn || '').trim(),
                sentence: (sentence || '').trim(),
                sentence_cn: (sentence_cn || '').trim(),
                createdAt: now,
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                dueDate: now, // Due immediately upon creation
                lastReviewed: null,
                reviewHistory: []
            };

            this.cards.push(newCard);
            this.save();
            return newCard;
        }

        removeCard(idOrToken) {
            const clean = this.normalizeToken(idOrToken);
            const beforeLen = this.cards.length;
            this.cards = this.cards.filter(c => c.id !== idOrToken && this.normalizeToken(c.token) !== clean);
            if (this.cards.length !== beforeLen) {
                this.save();
                return true;
            }
            return false;
        }

        /**
         * Get cards due for review (dueDate <= now)
         */
        getDueCards() {
            const nowIso = new Date().toISOString();
            return this.cards
                .filter(c => !c.dueDate || c.dueDate <= nowIso)
                .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        }

        getAllCards() {
            return [...this.cards].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        }

        countDue() {
            const nowIso = new Date().toISOString();
            return this.cards.filter(c => !c.dueDate || c.dueDate <= nowIso).length;
        }

        countTotal() {
            return this.cards.length;
        }

        /**
         * Review a card and update its SM-2 schedule.
         * @param {string} cardId
         * @param {number} grade 1..4
         */
        reviewCard(cardId, grade) {
            const card = this.cards.find(c => c.id === cardId);
            if (!card) return null;

            const nextSchedule = scheduleSM2(card, grade);
            const reviewRecord = {
                reviewedAt: nextSchedule.lastReviewed,
                grade,
                interval: nextSchedule.interval,
                easeFactor: nextSchedule.easeFactor,
                repetitions: nextSchedule.repetitions
            };

            card.repetitions = nextSchedule.repetitions;
            card.interval = nextSchedule.interval;
            card.easeFactor = nextSchedule.easeFactor;
            card.dueDate = nextSchedule.dueDate;
            card.lastReviewed = nextSchedule.lastReviewed;

            if (!card.reviewHistory) card.reviewHistory = [];
            card.reviewHistory.push(reviewRecord);

            this.save();
            return card;
        }

        /**
         * Export entire deck as a standard Anki Tab-Separated Values (.tsv) file.
         * Fields:
         *   1. Front: Word / Phrase + IPA
         *   2. Back: Canonical base (lemma), POS, English Meaning, Chinese Meaning, Sentence with highlighted token
         *   3. Tags: FrenchStudio
         */
        exportToAnkiTsv() {
            if (this.cards.length === 0) {
                throw new Error('生词本为空，请先添加生词卡后再导出。');
            }

            // Anki header comments define field separator and note structure
            let tsv = '#separator:tab\n#html:true\n#tags column:3\n';

            this.cards.forEach(c => {
                const front = `<div style="font-size: 24px; font-weight: bold; color: #1c2821;">${escapeHtml(c.token)}</div>` +
                    (c.phonetic ? `<div style="color: #6b7770; font-size: 14px; margin-top: 4px;">${escapeHtml(c.phonetic)}</div>` : '');

                let back = `<div style="margin-bottom: 8px;">`;
                if (c.pos) back += `<span style="background: #eef1ed; color: #49544d; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-right: 6px;">${escapeHtml(c.pos)}</span>`;
                if (c.lemma && c.lemma.toLowerCase() !== c.token.toLowerCase()) {
                    back += `<span style="color: #08776a; font-weight: bold; font-size: 14px;">原形: ${escapeHtml(c.lemma)}</span>`;
                }
                back += `</div>`;

                back += `<div style="margin-top: 8px; font-size: 15px; color: #1c2821;"><strong>释义:</strong> ${escapeHtml(c.explanation_cn)}</div>`;
                if (c.explanation_en) {
                    back += `<div style="color: #6b7770; font-size: 13px; margin-top: 4px;"><em>${escapeHtml(c.explanation_en)}</em></div>`;
                }

                if (c.sentence) {
                    const highlighted = highlightTokenInSentence(c.sentence, c.token);
                    back += `<hr style="border: none; border-top: 1px solid #d7ddd8; margin: 12px 0 8px;">`;
                    back += `<div style="font-size: 13px; line-height: 1.5; color: #2c3831;">例句: ${highlighted}</div>`;
                    if (c.sentence_cn) {
                        back += `<div style="font-size: 12px; color: #6b7770; margin-top: 2px;">${escapeHtml(c.sentence_cn)}</div>`;
                    }
                }

                const cleanFront = front.replace(/\t/g, ' ').replace(/\n/g, '<br>');
                const cleanBack = back.replace(/\t/g, ' ').replace(/\n/g, '<br>');
                const tag = 'FrenchStudio::Vocabulary';

                tsv += `${cleanFront}\t${cleanBack}\t${tag}\n`;
            });

            return tsv;
        }

        downloadAnkiFile(filename = 'FrenchStudio_AnkiDeck.tsv') {
            const tsvContent = this.exportToAnkiTsv();
            const blob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function highlightTokenInSentence(sentence, token) {
        if (!sentence || !token) return escapeHtml(sentence || '');
        const escaped = escapeHtml(sentence);
        const tokenEscaped = escapeHtml(token);
        // Case-insensitive replace for bolding
        try {
            const regex = new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            return sentence.replace(regex, '<b style="color: #08776a;">$1</b>');
        } catch (e) {
            return escaped;
        }
    }

    return {
        DeckManager,
        scheduleSM2,
        escapeHtml
    };
});
