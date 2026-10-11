/* ==========================================================================
   French Audio Studio - Word popover, shared by /study and /review
   Tap a French word: hear it and see phonetics, part of speech, base form and
   meaning. Lookup order: number reading -> the page's own data (e.g. the
   sentence analysis) -> built-in A1 dictionary -> server /api/lookup.
   Pages plug in speech, login, extra lookups and (optionally) saving.
   ========================================================================== */

(function (root) {
    'use strict';

    const I18N = root.FrenchI18n;
    const EN = I18N.lang() === 'en';
    const pick = I18N.pick;
    const formatFriendlyPhonetic = root.SpeechEval.formatFriendlyPhonetic;

    const TEXT = {
        en: {
            baseForm: 'base form: ', contextWord: 'Word in context', readAs: 'Read as: ',
            lookingUpMeaning: 'Looking up the meaning...', lookupFailed: 'Lookup failed', noDefinition: 'Could not get the meaning',
            partOfPhrase: (word, phrase) => `“${word}” is part of the fixed expression “${phrase}” here: learn it as a whole.`,
            popoverStarTitle: 'Add to review (shortcut S)', popoverSaved: 'In review (click to remove)',
            popoverReplayTitle: 'Replay (shortcut R)', replayTitle: 'Click to replay', closeEsc: 'Close (Esc)',
            importanceLabel: 'Importance', importanceTitle: (n) => `Importance ${n} of 5 (review the most important first)`,
            posOrdinal: 'ordinal', posTime: 'time', posNumber: 'number',
            firstNote: (fem) => `First${fem ? ' (feminine)' : ''}. In French dates only the 1st uses an ordinal: le 1er mai is read le premier mai; other days are read as plain numbers.`,
            ordinalNote: (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`,
            timeNote: (h, minutes) => `${h}:${String(minutes).padStart(2, '0')}`,
            decimalNote: 'French uses a comma as the decimal point',
            numberNote: (n, isYear) => `${n}${isYear ? ' (a year is read the same way)' : ''}`,
        },
        zh: {
            baseForm: '原形: ', contextWord: '语境词汇', readAs: '读作：',
            lookingUpMeaning: '正在查询字义...', lookupFailed: '查词失败', noDefinition: '暂无法获取释义',
            partOfPhrase: (word, phrase) => `「${word}」在这句里是固定搭配「${phrase}」的一部分，要整体理解。`,
            popoverStarTitle: '加入复习 (快捷键 S)', popoverSaved: '已加入复习（点击移除）',
            popoverReplayTitle: '重播发音 (快捷键 R)', replayTitle: '点击重播发音', closeEsc: '关闭 (Esc)',
            importanceLabel: '重要度', importanceTitle: (n) => `重要度 ${n} / 5（复习时可以只挑重要的）`,
            posOrdinal: '序数词', posTime: '时间', posNumber: '数字',
            firstNote: (fem) => `第一${fem ? '（阴性）' : ''}。法语日期里只有 1 号用序数词：le 1er mai 读作 le premier mai，其他日子直接读数字。`,
            ordinalNote: (n) => `第 ${n}`,
            timeNote: (h, minutes) => `${h} 点${minutes ? ' ' + minutes + ' 分' : ''}`,
            decimalNote: '法语用逗号表示小数点',
            numberNote: (n, isYear) => `${n}${isYear ? '（作年份时也这样读）' : ''}`,
        },
    };
    const T = TEXT[EN ? 'en' : 'zh'];

    const BASIC_FRENCH_WORDS = {
        // Pronouns
        "je": { token: "je", lemma: "je", pos: "pron. pers.", phonetic: "/ʒə/", explanation_cn: "我 (第一人称单数主格代词)", explanation_en: "I (subject pronoun)" },
        "j'": { token: "j'", lemma: "je", pos: "pron. pers.", phonetic: "/ʒ/", explanation_cn: "我 (je 在元音或哑音h前的省音形式)", explanation_en: "I (elision of je)" },
        "tu": { token: "tu", lemma: "tu", pos: "pron. pers.", phonetic: "/ty/", explanation_cn: "你 (第二人称单数主格代词)", explanation_en: "you (singular/informal)" },
        "il": { token: "il", lemma: "il", pos: "pron. pers.", phonetic: "/il/", explanation_cn: "他 / 它 (第三人称阳性单数主格代词)", explanation_en: "he / it" },
        "elle": { token: "elle", lemma: "elle", pos: "pron. pers.", phonetic: "/ɛl/", explanation_cn: "她 / 它 (第三人称阴性单数主格代词)", explanation_en: "she / it" },
        "on": { token: "on", lemma: "on", pos: "pron. indéf.", phonetic: "/ɔ̃/", explanation_cn: "人们 / 我们 (泛指人称代词，常作口语中的我们)", explanation_en: "one / we / people" },
        "nous": { token: "nous", lemma: "nous", pos: "pron. pers.", phonetic: "/nu/", explanation_cn: "我们 (第一人称复数代词)", explanation_en: "we / us" },
        "vous": { token: "vous", lemma: "vous", pos: "pron. pers.", phonetic: "/vu/", explanation_cn: "您 / 你们 (第二人称尊称或复数代词)", explanation_en: "you (formal/plural)" },
        "ils": { token: "ils", lemma: "ils", pos: "pron. pers.", phonetic: "/il/", explanation_cn: "他们 (第三人称阳性复数代词)", explanation_en: "they (masculine)" },
        "elles": { token: "elles", lemma: "elles", pos: "pron. pers.", phonetic: "/ɛl/", explanation_cn: "她们 (第三人称阴性复数代词)", explanation_en: "they (feminine)" },
        "me": { token: "me", lemma: "me", pos: "pron. pers.", phonetic: "/mə/", explanation_cn: "我 / 我自己 (第一人称宾格/自反代词)", explanation_en: "me / myself" },
        "m'": { token: "m'", lemma: "me", pos: "pron. pers.", phonetic: "/m/", explanation_cn: "我 / 我自己 (me 在元音前的省音形式)", explanation_en: "me / myself (elision of me)" },
        "te": { token: "te", lemma: "te", pos: "pron. pers.", phonetic: "/tə/", explanation_cn: "你 / 你自己 (第二人称宾格/自反代词)", explanation_en: "you / yourself" },
        "t'": { token: "t'", lemma: "te", pos: "pron. pers.", phonetic: "/t/", explanation_cn: "你 / 你自己 (te 在元音前的省音形式)", explanation_en: "you / yourself (elision of te)" },
        "se": { token: "se", lemma: "se", pos: "pron. réfl.", phonetic: "/sə/", explanation_cn: "他自己/她自己/他们自己 (第三人称自反代词)", explanation_en: "himself / herself / themselves" },
        "s'": { token: "s'", lemma: "se", pos: "pron. réfl.", phonetic: "/s/", explanation_cn: "自反代词 (se 在元音前的省音形式)", explanation_en: "himself / herself (elision of se)" },
        "moi": { token: "moi", lemma: "moi", pos: "pron. tonique", phonetic: "/mwa/", explanation_cn: "我 (重读人称代词)", explanation_en: "me (disjunctive pronoun)" },
        "toi": { token: "toi", lemma: "toi", pos: "pron. tonique", phonetic: "/twa/", explanation_cn: "你 (重读人称代词)", explanation_en: "you (disjunctive pronoun)" },
        "lui": { token: "lui", lemma: "lui", pos: "pron. pers.", phonetic: "/lɥi/", explanation_cn: "他 / 她 (重读代词或间接宾语代词: 向他/向她)", explanation_en: "him / her / to him / to her" },
        "leur": { token: "leur", lemma: "leur", pos: "pron. / adj.", phonetic: "/lœʁ/", explanation_cn: "向他们 (间接宾格代词) 或 他们的 (主有形容词)", explanation_en: "to them / their" },
        "y": { token: "y", lemma: "y", pos: "pron. adv.", phonetic: "/i/", explanation_cn: "在那里 / 对某事 (副代词，代替 à+名词等)", explanation_en: "there / in it / to it" },
        "en": { token: "en", lemma: "en", pos: "pron. / prép.", phonetic: "/ɑ̃/", explanation_cn: "副代词 (从中，一些) 或 介词 (在…中，乘…)", explanation_en: "of it / some / in / by" },

        // Demonstratives & Relatives
        "ce": { token: "ce", lemma: "ce", pos: "adj. / pron.", phonetic: "/sə/", explanation_cn: "这个 (阳性指示形容词) 或 这/它 (指示代词)", explanation_en: "this / that / it" },
        "c'": { token: "c'", lemma: "ce", pos: "pron. dém.", phonetic: "/s/", explanation_cn: "这 / 它 (ce 在元音前的省音形式，如 c'est)", explanation_en: "this / it (elision of ce)" },
        "cet": { token: "cet", lemma: "ce", pos: "adj. dém.", phonetic: "/sɛt/", explanation_cn: "这个 (ce 在元音或哑音h开头的阳性单数名词前)", explanation_en: "this / that (masc. before vowel)" },
        "cette": { token: "cette", lemma: "ce", pos: "adj. dém.", phonetic: "/sɛt/", explanation_cn: "这个 (阴性单数指示形容词)", explanation_en: "this / that (feminine)" },
        "ces": { token: "ces", lemma: "ce", pos: "adj. dém.", phonetic: "/se/", explanation_cn: "这些 / 那些 (复数指示形容词)", explanation_en: "these / those" },
        "ça": { token: "ça", lemma: "cela", pos: "pron. dém.", phonetic: "/sa/", explanation_cn: "这个 / 那个 (指示代词口语形式)", explanation_en: "that / this / it" },
        "qui": { token: "qui", lemma: "qui", pos: "pron. rel.", phonetic: "/ki/", explanation_cn: "谁 / 哪个 (主格关系代词或疑问代词)", explanation_en: "who / which / that" },
        "que": { token: "que", lemma: "que", pos: "pron. / conj.", phonetic: "/kə/", explanation_cn: "宾格关系代词 (什么/引导从句) 或 比较级连接词 (比)", explanation_en: "what / that / than" },
        "qu'": { token: "qu'", lemma: "que", pos: "pron. / conj.", phonetic: "/k/", explanation_cn: "que 在元音开头的省音形式", explanation_en: "what / that (elision of que)" },
        "quoi": { token: "quoi", lemma: "quoi", pos: "pron. interr.", phonetic: "/kwa/", explanation_cn: "什么 (重读疑问代词)", explanation_en: "what" },
        "dont": { token: "dont", lemma: "dont", pos: "pron. rel.", phonetic: "/dɔ̃/", explanation_cn: "其中 / 关于它的 (代替 de+先行词 的关系代词)", explanation_en: "whose / of which" },

        // Articles & Contractions
        "le": { token: "le", lemma: "le", pos: "art. déf.", phonetic: "/lə/", explanation_cn: "定冠词 (阳性单数): 这个 / 表特指或类别", explanation_en: "the (masculine singular)" },
        "la": { token: "la", lemma: "la", pos: "art. déf.", phonetic: "/la/", explanation_cn: "定冠词 (阴性单数): 这个 / 表特指或类别", explanation_en: "the (feminine singular)" },
        "les": { token: "les", lemma: "le", pos: "art. déf.", phonetic: "/le/", explanation_cn: "定冠词 (复数): 这些 / 那些", explanation_en: "the (plural)" },
        "l'": { token: "l'", lemma: "le", pos: "art. déf.", phonetic: "/l/", explanation_cn: "定冠词 (le/la 在元音或哑音h前的省音形式)", explanation_en: "the (elision of le/la)" },
        "un": { token: "un", lemma: "un", pos: "art. indéf.", phonetic: "/œ̃/", explanation_cn: "一个 (阳性单数不定冠词 / 数词1)", explanation_en: "a / an / one (masculine)" },
        "une": { token: "une", lemma: "un", pos: "art. indéf.", phonetic: "/yn/", explanation_cn: "一个 (阴性单数不定冠词 / 数词1)", explanation_en: "a / an / one (feminine)" },
        "des": { token: "des", lemma: "des", pos: "art. indéf. / contracté", phonetic: "/de/", explanation_cn: "1. 不定冠词复数 (一些，若干); 2. 缩合冠词 de+les (来自…的)", explanation_en: "some / of the (plural)" },
        "du": { token: "du", lemma: "du", pos: "art. part. / contracté", phonetic: "/dy/", explanation_cn: "1. 部分冠词 (一些阳性不可数); 2. 缩合冠词 de+le (来自…的)", explanation_en: "some / of the (contraction of de + le)" },
        "au": { token: "au", lemma: "à + le", pos: "art. contracté", phonetic: "/o/", explanation_cn: "在…，去… (介词 à 与阳性定冠词 le 的缩合形式)", explanation_en: "at the / to the (contraction of à + le)" },
        "aux": { token: "aux", lemma: "à + les", pos: "art. contracté", phonetic: "/o/", explanation_cn: "在…，去… (介词 à 与复数定冠词 les 的缩合形式)", explanation_en: "at the / to the (contraction of à + les)" },

        // Prepositions
        "à": { token: "à", lemma: "à", pos: "prép.", phonetic: "/a/", explanation_cn: "在，到，向，给 (基础介词)", explanation_en: "at, to, in" },
        "de": { token: "de", lemma: "de", pos: "prép.", phonetic: "/də/", explanation_cn: "…的，来自，从，关于 (基础介词)", explanation_en: "of, from, about" },
        "d'": { token: "d'", lemma: "de", pos: "prép.", phonetic: "/d/", explanation_cn: "…的，从，来自 (de 在元音或哑音h前的省音形式)", explanation_en: "of, from (elision of de)" },
        "dans": { token: "dans", lemma: "dans", pos: "prép.", phonetic: "/dɑ̃/", explanation_cn: "在…里面，在…之内，在…之后(时间)", explanation_en: "in, inside, into" },
        "pour": { token: "pour", lemma: "pour", pos: "prép.", phonetic: "/puʁ/", explanation_cn: "为了，对于，给", explanation_en: "for, in order to" },
        "avec": { token: "avec", lemma: "avec", pos: "prép.", phonetic: "/a.vɛk/", explanation_cn: "和…一起，带有，用", explanation_en: "with" },
        "sur": { token: "sur", lemma: "sur", pos: "prép.", phonetic: "/syʁ/", explanation_cn: "在…上面，关于", explanation_en: "on, upon, above" },
        "sous": { token: "sous", lemma: "sous", pos: "prép.", phonetic: "/su/", explanation_cn: "在…下面", explanation_en: "under, beneath" },
        "par": { token: "par", lemma: "par", pos: "prép.", phonetic: "/paʁ/", explanation_cn: "由，被，通过，经由", explanation_en: "by, through" },
        "chez": { token: "chez", lemma: "chez", pos: "prép.", phonetic: "/ʃe/", explanation_cn: "在…家，在…处", explanation_en: "at the home/place of" },
        "sans": { token: "sans", lemma: "sans", pos: "prép.", phonetic: "/sɑ̃/", explanation_cn: "没有，无", explanation_en: "without" },
        "vers": { token: "vers", lemma: "vers", pos: "prép.", phonetic: "/vɛʁ/", explanation_cn: "朝向，接近", explanation_en: "towards, around" },
        "entre": { token: "entre", lemma: "entre", pos: "prép.", phonetic: "/ɑ̃tʁ/", explanation_cn: "在…之间", explanation_en: "between, among" },
        "pendant": { token: "pendant", lemma: "pendant", pos: "prép.", phonetic: "/pɑ̃.dɑ̃/", explanation_cn: "在…期间", explanation_en: "during, for" },
        "avant": { token: "avant", lemma: "avant", pos: "prép.", phonetic: "/a.vɑ̃/", explanation_cn: "在…之前", explanation_en: "before" },
        "après": { token: "après", lemma: "après", pos: "prép.", phonetic: "/a.pʁɛ/", explanation_cn: "在…之后", explanation_en: "after" },
        "depuis": { token: "depuis", lemma: "depuis", pos: "prép.", phonetic: "/də.pɥi/", explanation_cn: "自从，已有…时间", explanation_en: "since, for" },

        // Conjunctions
        "et": { token: "et", lemma: "et", pos: "conj.", phonetic: "/e/", explanation_cn: "和，与，并且 (并列连词，注意从不联诵)", explanation_en: "and" },
        "ou": { token: "ou", lemma: "ou", pos: "conj.", phonetic: "/u/", explanation_cn: "或者，还是 (选择连词)", explanation_en: "or" },
        "où": { token: "où", lemma: "où", pos: "adv. / pron.", phonetic: "/u/", explanation_cn: "在哪里，在…的地方 (疑问副词或关系代词)", explanation_en: "where" },
        "mais": { token: "mais", lemma: "mais", pos: "conj.", phonetic: "/mɛ/", explanation_cn: "但是，可是 (转折连词)", explanation_en: "but" },
        "donc": { token: "donc", lemma: "donc", pos: "conj.", phonetic: "/dɔ̃k/", explanation_cn: "因此，所以", explanation_en: "therefore, so" },
        "car": { token: "car", lemma: "car", pos: "conj.", phonetic: "/kaʁ/", explanation_cn: "因为 (并列连词)", explanation_en: "because, for" },
        "ni": { token: "ni", lemma: "ni", pos: "conj.", phonetic: "/ni/", explanation_cn: "既不…也不…", explanation_en: "neither / nor" },
        "si": { token: "si", lemma: "si", pos: "conj. / adv.", phonetic: "/si/", explanation_cn: "如果 (条件从句) / 对否定的肯定回答: 怎么不", explanation_en: "if / so / yes" },
        "comme": { token: "comme", lemma: "comme", pos: "conj. / adv.", phonetic: "/kɔm/", explanation_cn: "如同，正如，既然，因为", explanation_en: "as, like, since" },
        "quand": { token: "quand", lemma: "quand", pos: "conj.", phonetic: "/kɑ̃/", explanation_cn: "当…的时候", explanation_en: "when" },

        // Negations & Adverbs
        "ne": { token: "ne", lemma: "ne", pos: "adv. nég.", phonetic: "/nə/", explanation_cn: "不 (否定词前半部分，与 pas 搭配)", explanation_en: "not (negative particle)" },
        "n'": { token: "n'", lemma: "ne", pos: "adv. nég.", phonetic: "/n/", explanation_cn: "不 (ne 在元音前的省音形式)", explanation_en: "not (elision of ne)" },
        "pas": { token: "pas", lemma: "pas", pos: "adv. nég.", phonetic: "/pa/", explanation_cn: "不，没有 (否定核心副词)", explanation_en: "not" },
        "plus": { token: "plus", lemma: "plus", pos: "adv.", phonetic: "/ply/ 或 /plys/", explanation_cn: "更多，再加上；在否定句 ne...plus 中表不再", explanation_en: "more / no more" },
        "jamais": { token: "jamais", lemma: "jamais", pos: "adv.", phonetic: "/ʒa.mɛ/", explanation_cn: "从不，绝不 (ne...jamais)", explanation_en: "never" },
        "rien": { token: "rien", lemma: "rien", pos: "pron. indéf.", phonetic: "/ʁjɛ̃/", explanation_cn: "什么也没有，无事 (ne...rien)", explanation_en: "nothing" },
        "toujours": { token: "toujours", lemma: "toujours", pos: "adv.", phonetic: "/tu.ʒuʁ/", explanation_cn: "总是，一直，仍然", explanation_en: "always, still" },
        "souvent": { token: "souvent", lemma: "souvent", pos: "adv.", phonetic: "/su.vɑ̃/", explanation_cn: "经常，常常", explanation_en: "often" },
        "très": { token: "très", lemma: "très", pos: "adv.", phonetic: "/tʁɛ/", explanation_cn: "非常，很", explanation_en: "very" },
        "bien": { token: "bien", lemma: "bien", pos: "adv.", phonetic: "/bjɛ̃/", explanation_cn: "好，很好，确实", explanation_en: "well, good" },
        "mal": { token: "mal", lemma: "mal", pos: "adv. / n.m.", phonetic: "/mal/", explanation_cn: "坏，糟糕，不好；痛苦", explanation_en: "badly, poor" },
        "ici": { token: "ici", lemma: "ici", pos: "adv.", phonetic: "/i.si/", explanation_cn: "这里，这儿", explanation_en: "here" },
        "là": { token: "là", lemma: "là", pos: "adv.", phonetic: "/la/", explanation_cn: "那里，那儿", explanation_en: "there" },
        "trop": { token: "trop", lemma: "trop", pos: "adv.", phonetic: "/tʁo/", explanation_cn: "太，过于，过多", explanation_en: "too, too much" },
        "beaucoup": { token: "beaucoup", lemma: "beaucoup", pos: "adv.", phonetic: "/bo.ku/", explanation_cn: "许多，很多", explanation_en: "a lot, much" },
        "peu": { token: "peu", lemma: "peu", pos: "adv.", phonetic: "/pø/", explanation_cn: "少，不多", explanation_en: "little, few" },
        "aussi": { token: "aussi", lemma: "aussi", pos: "adv.", phonetic: "/o.si/", explanation_cn: "也，同样地", explanation_en: "also, too" },
        "maintenant": { token: "maintenant", lemma: "maintenant", pos: "adv.", phonetic: "/mɛ̃t.nɑ̃/", explanation_cn: "现在，如今", explanation_en: "now" },
        "aujourd'hui": { token: "aujourd'hui", lemma: "aujourd'hui", pos: "adv.", phonetic: "/o.ʒuʁ.dɥi/", explanation_cn: "今天", explanation_en: "today" },
        "hier": { token: "hier", lemma: "hier", pos: "adv.", phonetic: "/jɛʁ/", explanation_cn: "昨天", explanation_en: "yesterday" },
        "demain": { token: "demain", lemma: "demain", pos: "adv.", phonetic: "/də.mɛ̃/", explanation_cn: "明天", explanation_en: "tomorrow" },
        "oui": { token: "oui", lemma: "oui", pos: "adv.", phonetic: "/wi/", explanation_cn: "是，是的", explanation_en: "yes" },
        "non": { token: "non", lemma: "non", pos: "adv.", phonetic: "/nɔ̃/", explanation_cn: "不，不是", explanation_en: "no" },
        "merci": { token: "merci", lemma: "merci", pos: "interj. / n.", phonetic: "/mɛʁ.si/", explanation_cn: "谢谢", explanation_en: "thank you" },
        "bonjour": { token: "bonjour", lemma: "bonjour", pos: "interj. / n.m.", phonetic: "/bɔ̃.ʒuʁ/", explanation_cn: "你好，早上好", explanation_en: "hello, good morning" },

        // Possessives
        "mon": { token: "mon", lemma: "mon", pos: "adj. poss.", phonetic: "/mɔ̃/", explanation_cn: "我的 (阳性单数)", explanation_en: "my (masculine)" },
        "ma": { token: "ma", lemma: "mon", pos: "adj. poss.", phonetic: "/ma/", explanation_cn: "我的 (阴性单数)", explanation_en: "my (feminine)" },
        "mes": { token: "mes", lemma: "mon", pos: "adj. poss.", phonetic: "/me/", explanation_cn: "我的 (复数)", explanation_en: "my (plural)" },
        "ton": { token: "ton", lemma: "ton", pos: "adj. poss.", phonetic: "/tɔ̃/", explanation_cn: "你的 (阳性单数)", explanation_en: "your (masculine)" },
        "ta": { token: "ta", lemma: "ton", pos: "adj. poss.", phonetic: "/ta/", explanation_cn: "你的 (阴性单数)", explanation_en: "your (feminine)" },
        "tes": { token: "tes", lemma: "ton", pos: "adj. poss.", phonetic: "/te/", explanation_cn: "你的 (复数)", explanation_en: "your (plural)" },
        "son": { token: "son", lemma: "son", pos: "adj. poss.", phonetic: "/sɔ̃/", explanation_cn: "他的 / 她的 (阳性单数)", explanation_en: "his / her / its (masculine)" },
        "sa": { token: "sa", lemma: "son", pos: "adj. poss.", phonetic: "/sa/", explanation_cn: "他的 / 她的 (阴性单数)", explanation_en: "his / her / its (feminine)" },
        "ses": { token: "ses", lemma: "son", pos: "adj. poss.", phonetic: "/se/", explanation_cn: "他的 / 她的 (复数)", explanation_en: "his / her / its (plural)" },
        "notre": { token: "notre", lemma: "notre", pos: "adj. poss.", phonetic: "/nɔtʁ/", explanation_cn: "我们的 (单数)", explanation_en: "our" },
        "nos": { token: "nos", lemma: "notre", pos: "adj. poss.", phonetic: "/no/", explanation_cn: "我们的 (复数)", explanation_en: "our (plural)" },
        "votre": { token: "votre", lemma: "votre", pos: "adj. poss.", phonetic: "/vɔtʁ/", explanation_cn: "您的 / 你们的 (单数)", explanation_en: "your" },
        "vos": { token: "vos", lemma: "votre", pos: "adj. poss.", phonetic: "/vo/", explanation_cn: "您的 / 你们的 (复数)", explanation_en: "your (plural)" },

        // Verbs: être
        "être": { token: "être", lemma: "être", pos: "v. aux.", phonetic: "/ɛtʁ/", explanation_cn: "是，存在 (动词原形/助动词)", explanation_en: "to be" },
        "suis": { token: "suis", lemma: "être", pos: "v.", phonetic: "/sɥi/", explanation_cn: "是 (être 的第一人称单数直陈式现在时)", explanation_en: "am (first-person singular present of être)" },
        "es": { token: "es", lemma: "être", pos: "v.", phonetic: "/ɛ/", explanation_cn: "是 (être 的第二人称单数直陈式现在时)", explanation_en: "are (second-person singular present of être)" },
        "est": { token: "est", lemma: "être", pos: "v.", phonetic: "/ɛ/", explanation_cn: "是 (être 的第三人称单数直陈式现在时)", explanation_en: "is (third-person singular present of être)" },
        "sommes": { token: "sommes", lemma: "être", pos: "v.", phonetic: "/sɔm/", explanation_cn: "是 (être 的第一人称复数直陈式现在时)", explanation_en: "are (first-person plural present of être)" },
        "êtes": { token: "êtes", lemma: "être", pos: "v.", phonetic: "/ɛt/", explanation_cn: "是 (être 的第二人称复数直陈式现在时)", explanation_en: "are (second-person plural present of être)" },
        "sont": { token: "sont", lemma: "être", pos: "v.", phonetic: "/sɔ̃/", explanation_cn: "是 (être 的第三人称复数直陈式现在时)", explanation_en: "are (third-person plural present of être)" },
        "été": { token: "été", lemma: "être", pos: "p.p. / n.m.", phonetic: "/e.te/", explanation_cn: "曾经是 (être 过去分词) 或 夏天(名词)", explanation_en: "been / summer" },

        // Verbs: avoir
        "avoir": { token: "avoir", lemma: "avoir", pos: "v. aux.", phonetic: "/a.vwaʁ/", explanation_cn: "有，拥有 (动词原形/助动词)", explanation_en: "to have" },
        "ai": { token: "ai", lemma: "avoir", pos: "v.", phonetic: "/e/", explanation_cn: "有 (avoir 的第一人称单数直陈式现在时，如 J'ai)", explanation_en: "have (first-person singular present of avoir)" },
        "as": { token: "as", lemma: "avoir", pos: "v.", phonetic: "/a/", explanation_cn: "有 (avoir 的第二人称单数直陈式现在时)", explanation_en: "have (second-person singular present of avoir)" },
        "a": { token: "a", lemma: "avoir", pos: "v.", phonetic: "/a/", explanation_cn: "有 (avoir 的第三人称单数直陈式现在时)", explanation_en: "has (third-person singular present of avoir)" },
        "avons": { token: "avons", lemma: "avoir", pos: "v.", phonetic: "/a.vɔ̃/", explanation_cn: "有 (avoir 的第一人称复数直陈式现在时)", explanation_en: "have (first-person plural present of avoir)" },
        "avez": { token: "avez", lemma: "avoir", pos: "v.", phonetic: "/a.ve/", explanation_cn: "有 (avoir 的第二人称复数直陈式现在时)", explanation_en: "have (second-person plural present of avoir)" },
        "ont": { token: "ont", lemma: "avoir", pos: "v.", phonetic: "/ɔ̃/", explanation_cn: "有 (avoir 的第三人称复数直陈式现在时)", explanation_en: "have (third-person plural present of avoir)" },
        "eu": { token: "eu", lemma: "avoir", pos: "p.p.", phonetic: "/y/", explanation_cn: "曾经有 (avoir 的过去分词)", explanation_en: "had (past participle of avoir)" },
        "ayant": { token: "ayant", lemma: "avoir", pos: "part. prés.", phonetic: "/ɛ.jɑ̃/", explanation_cn: "有着，具有 (avoir 的现在分词)", explanation_en: "having, possessing (present participle of avoir)" },

        // Verbs: aller
        "aller": { token: "aller", lemma: "aller", pos: "v.", phonetic: "/a.le/", explanation_cn: "去，前往 (动词原形)", explanation_en: "to go" },
        "vais": { token: "vais", lemma: "aller", pos: "v.", phonetic: "/vɛ/", explanation_cn: "去 (aller 的第一人称单数直陈式现在时)", explanation_en: "go (first-person singular present of aller)" },
        "vas": { token: "vas", lemma: "aller", pos: "v.", phonetic: "/va/", explanation_cn: "去 (aller 的第二人称单数直陈式现在时)", explanation_en: "go (second-person singular present of aller)" },
        "va": { token: "va", lemma: "aller", pos: "v.", phonetic: "/va/", explanation_cn: "去 (aller 的第三人称单数直陈式现在时)", explanation_en: "goes (third-person singular present of aller)" },
        "allons": { token: "allons", lemma: "aller", pos: "v.", phonetic: "/a.lɔ̃/", explanation_cn: "去 (aller 的第一人称复数直陈式现在时)", explanation_en: "go (first-person plural present of aller)" },
        "allez": { token: "allez", lemma: "aller", pos: "v.", phonetic: "/a.le/", explanation_cn: "去 (aller 的第二人称复数直陈式现在时)", explanation_en: "go (second-person plural present of aller)" },
        "vont": { token: "vont", lemma: "aller", pos: "v.", phonetic: "/vɔ̃/", explanation_cn: "去 (aller 的第三人称复数直陈式现在时)", explanation_en: "go (third-person plural present of aller)" },

        // Verbs: faire
        "faire": { token: "faire", lemma: "faire", pos: "v.", phonetic: "/fɛʁ/", explanation_cn: "做，制造，从事 (动词原形)", explanation_en: "to do / to make" },
        "fais": { token: "fais", lemma: "faire", pos: "v.", phonetic: "/fɛ/", explanation_cn: "做 (faire 的第一/二人称单数直陈式现在时)", explanation_en: "do / make (present tense of faire)" },
        "fait": { token: "fait", lemma: "faire", pos: "v. / n.m.", phonetic: "/fɛ/", explanation_cn: "做 (faire 第三人称现在时) 或 事实(名词)", explanation_en: "does / makes / fact" },
        "faisons": { token: "faisons", lemma: "faire", pos: "v.", phonetic: "/fə.zɔ̃/", explanation_cn: "做 (faire 的第一人称复数直陈式现在时)", explanation_en: "do / make" },
        "faites": { token: "faites", lemma: "faire", pos: "v.", phonetic: "/fɛt/", explanation_cn: "做 (faire 的第二人称复数直陈式现在时)", explanation_en: "do / make" },
        "font": { token: "font", lemma: "faire", pos: "v.", phonetic: "/fɔ̃/", explanation_cn: "做 (faire 的第三人称复数直陈式现在时)", explanation_en: "do / make" },

        // Verbs: pouvoir, vouloir, devoir, savoir, voir, venir, dire, prendre
        "pouvoir": { token: "pouvoir", lemma: "pouvoir", pos: "v.", phonetic: "/pu.vwaʁ/", explanation_cn: "能够，可以 (动词原形)", explanation_en: "to be able to, can" },
        "peux": { token: "peux", lemma: "pouvoir", pos: "v.", phonetic: "/pø/", explanation_cn: "能，可以 (pouvoir 的第一人称单数现在时)", explanation_en: "can (first-person singular of pouvoir)" },
        "peut": { token: "peut", lemma: "pouvoir", pos: "v.", phonetic: "/pø/", explanation_cn: "能，可以 (pouvoir 的第三人称单数现在时)", explanation_en: "can (third-person singular of pouvoir)" },
        "vouloir": { token: "vouloir", lemma: "vouloir", pos: "v.", phonetic: "/vu.lwaʁ/", explanation_cn: "想要，意愿 (动词原形)", explanation_en: "to want" },
        "veux": { token: "veux", lemma: "vouloir", pos: "v.", phonetic: "/vø/", explanation_cn: "想，要 (vouloir 的第一/二人称单数现在时)", explanation_en: "want (present tense of vouloir)" },
        "veut": { token: "veut", lemma: "vouloir", pos: "v.", phonetic: "/vø/", explanation_cn: "想，要 (vouloir 的第三人称单数现在时)", explanation_en: "wants (third-person singular of vouloir)" },
        "devoir": { token: "devoir", lemma: "devoir", pos: "v.", phonetic: "/də.vwaʁ/", explanation_cn: "应当，必须 (动词原形)", explanation_en: "to have to, must" },
        "dois": { token: "dois", lemma: "devoir", pos: "v.", phonetic: "/dwa/", explanation_cn: "必须，应该 (devoir 的第一/二人称单数现在时)", explanation_en: "must / should" },
        "doit": { token: "doit", lemma: "devoir", pos: "v.", phonetic: "/dwa/", explanation_cn: "必须，应该 (devoir 的第三人称单数现在时)", explanation_en: "must / should" },
        "savoir": { token: "savoir", lemma: "savoir", pos: "v.", phonetic: "/sa.vwaʁ/", explanation_cn: "知道，获悉 (动词原形)", explanation_en: "to know" },
        "sais": { token: "sais", lemma: "savoir", pos: "v.", phonetic: "/sɛ/", explanation_cn: "知道 (savoir 的第一/二人称单数现在时)", explanation_en: "know" },
        "sait": { token: "sait", lemma: "savoir", pos: "v.", phonetic: "/sɛ/", explanation_cn: "知道 (savoir 的第三人称单数现在时)", explanation_en: "knows" },
        "voir": { token: "voir", lemma: "voir", pos: "v.", phonetic: "/vwaʁ/", explanation_cn: "看见，理解 (动词原形)", explanation_en: "to see" },
        "vois": { token: "vois", lemma: "voir", pos: "v.", phonetic: "/vwa/", explanation_cn: "看见 (voir 的第一/二人称单数现在时)", explanation_en: "see" },
        "voit": { token: "voit", lemma: "voir", pos: "v.", phonetic: "/vwa/", explanation_cn: "看见 (voir 的第三人称单数现在时)", explanation_en: "sees" },
        "venir": { token: "venir", lemma: "venir", pos: "v.", phonetic: "/və.niʁ/", explanation_cn: "来，来自 (动词原形)", explanation_en: "to come" },
        "viens": { token: "viens", lemma: "venir", pos: "v.", phonetic: "/vjɛ̃/", explanation_cn: "来 (venir 的第一/二人称单数现在时)", explanation_en: "come" },
        "vient": { token: "vient", lemma: "venir", pos: "v.", phonetic: "/vjɛ̃/", explanation_cn: "来 (venir 的第三人称单数现在时)", explanation_en: "comes" },
        "dire": { token: "dire", lemma: "dire", pos: "v.", phonetic: "/diʁ/", explanation_cn: "说，讲述 (动词原形)", explanation_en: "to say / to tell" },
        "dis": { token: "dis", lemma: "dire", pos: "v.", phonetic: "/di/", explanation_cn: "说 (dire 的第一/二人称单数现在时)", explanation_en: "say" },
        "dit": { token: "dit", lemma: "dire", pos: "v.", phonetic: "/di/", explanation_cn: "说 (dire 的第三人称单数现在时)", explanation_en: "says" },
        "prendre": { token: "prendre", lemma: "prendre", pos: "v.", phonetic: "/pʁɑ̃dʁ/", explanation_cn: "拿，取，乘坐，吃喝 (动词原形)", explanation_en: "to take" },
        "prends": { token: "prends", lemma: "prendre", pos: "v.", phonetic: "/pʁɑ̃/", explanation_cn: "拿，乘 (prendre 的第一/二人称单数现在时)", explanation_en: "take" },
    };

    Object.values(BASIC_FRENCH_WORDS).forEach(item => {
        if (item.phonetic) item.phonetic = formatFriendlyPhonetic(item.phonetic);
    });

    // French number reading (traditional spelling), e.g. 2026 -> deux mille vingt-six
    const FR_UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
        'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
    const FR_TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

    function frenchBelow100(n) {
        if (n <= 16) return FR_UNITS[n];
        if (n < 20) return 'dix-' + FR_UNITS[n - 10];
        if (n < 70) {
            const tens = FR_TENS[Math.floor(n / 10)];
            const unit = n % 10;
            if (unit === 0) return tens;
            return unit === 1 ? `${tens} et un` : `${tens}-${FR_UNITS[unit]}`;
        }
        if (n < 80) return n === 71 ? 'soixante et onze' : 'soixante-' + frenchBelow100(n - 60);
        if (n === 80) return 'quatre-vingts';
        return 'quatre-vingt-' + frenchBelow100(n - 80);
    }

    function frenchBelow1000(n, isFinal = true) {
        const hundreds = Math.floor(n / 100);
        const rest = n % 100;
        let words = '';
        if (hundreds > 0) {
            words = hundreds === 1 ? 'cent' : `${FR_UNITS[hundreds]} cent${rest === 0 && isFinal ? 's' : ''}`;
        }
        if (rest > 0) {
            let restWords = frenchBelow100(rest);
            if (!isFinal && rest === 80) restWords = 'quatre-vingt';
            words = words ? `${words} ${restWords}` : restWords;
        }
        return words || 'zéro';
    }

    function frenchCardinal(n) {
        if (n === 0) return 'zéro';
        if (n >= 1e9) return String(n);
        const millions = Math.floor(n / 1e6);
        const thousands = Math.floor((n % 1e6) / 1000);
        const rest = n % 1000;
        const parts = [];
        if (millions) parts.push(millions === 1 ? 'un million' : `${frenchBelow1000(millions)} millions`);
        if (thousands) parts.push(thousands === 1 ? 'mille' : `${frenchBelow1000(thousands, false)} mille`);
        if (rest) parts.push(frenchBelow1000(rest));
        return parts.join(' ');
    }

    function frenchOrdinal(n) {
        if (n === 1) return 'premier';
        let words = frenchCardinal(n);
        if (words.endsWith('cinq')) return words + 'uième';
        if (words.endsWith('neuf')) return words.slice(0, -1) + 'vième';
        words = words.replace(/s$/, '');
        if (words.endsWith('e')) words = words.slice(0, -1);
        return words + 'ième';
    }

    function frenchNumberReading(token) {
        const t = (token || '').trim();
        let m;
        if ((m = t.match(/^1(er|re|ère)$/i))) {
            const fem = m[1].toLowerCase() !== 'er';
            return { spoken: fem ? 'première' : 'premier', pos: T.posOrdinal, note: T.firstNote(fem) };
        }
        if ((m = t.match(/^(\d{1,6})(e|ème|eme)$/i))) {
            return { spoken: frenchOrdinal(parseInt(m[1], 10)), pos: T.posOrdinal, note: T.ordinalNote(m[1]) };
        }
        if ((m = t.match(/^(\d{1,2})h(\d{2})?$/i))) {
            const h = parseInt(m[1], 10);
            const minutes = m[2] ? parseInt(m[2], 10) : 0;
            const spoken = `${h === 1 ? 'une' : frenchCardinal(h)} heure${h > 1 ? 's' : ''}${minutes ? ' ' + frenchCardinal(minutes) : ''}`;
            return { spoken, pos: T.posTime, note: T.timeNote(h, minutes) };
        }
        if ((m = t.match(/^(\d{1,9}),(\d{1,3})$/))) {
            return { spoken: `${frenchCardinal(parseInt(m[1], 10))} virgule ${frenchCardinal(parseInt(m[2], 10))}`, pos: T.posNumber, note: T.decimalNote };
        }
        if ((m = t.match(/^\d{1,9}$/))) {
            const n = parseInt(t, 10);
            return { spoken: frenchCardinal(n), pos: T.posNumber, note: T.numberNote(n, n >= 1100 && n <= 2099) };
        }
        return null;
    }
    window.frenchNumberReading = frenchNumberReading;

    const ELISION_RE = /^(?:aujourd['’]hui|([cjdlnmstqu]|qu)['’](.+))$/i;

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function popoverMarkup() {
        return `
        <div class="popover-arrow" aria-hidden="true"></div>
        <div class="popover-header">
            <div class="popover-main-info">
                <div class="popover-word-row">
                    <strong class="popover-word">--</strong>
                    <button class="btn-popover-star-icon" type="button" title="${escapeHtml(T.popoverStarTitle)}" hidden>
                        <i data-lucide="star" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="popover-phonetic-row">
                    <button class="btn-popover-speak-inline" type="button" title="${escapeHtml(T.popoverReplayTitle)}">
                        <i data-lucide="volume-2" aria-hidden="true"></i>
                    </button>
                    <span class="popover-phonetic" title="${escapeHtml(T.replayTitle)}"></span>
                    <span class="pos-tag popover-pos" hidden></span>
                    <span class="lemma-tag popover-lemma" hidden></span>
                </div>
            </div>
            <button class="icon-btn popover-close-btn" type="button" title="${escapeHtml(T.closeEsc)}">
                <i data-lucide="x" aria-hidden="true"></i>
            </button>
        </div>
        <div class="popover-body">
            <div class="popover-loading" hidden style="display: none;">
                <i data-lucide="loader" class="spin-icon"></i>
                <span>${escapeHtml(T.lookingUpMeaning)}</span>
            </div>
            <div class="popover-content">
                <div class="popover-cn-text"></div>
                <div class="popover-en-text"></div>
            </div>
            <div class="popover-importance" hidden>
                <span class="importance-label">${escapeHtml(T.importanceLabel)}</span>
                <span class="importance-stars">
                    <button type="button" data-level="1">★</button><button type="button" data-level="2">★</button><button type="button" data-level="3">★</button><button type="button" data-level="4">★</button><button type="button" data-level="5">★</button>
                </span>
            </div>
        </div>`;
    }

    function refreshIcons() {
        if (root.lucide && typeof root.lucide.createIcons === 'function') root.lucide.createIcons();
    }

    /**
     * options:
     *   speak(text)                       play French audio (required)
     *   getAuthToken()                    bearer token for /api/lookup
     *   localLookup(lower, word, context) the page's own data for a word, or null
     *   remember(lower, item)             called with every looked-up entry
     *   wordSelector                      CSS selector of clickable words (clicks on them never close the popover)
     *   contextFor(element)               {sentence, sentence_cn} around a selected phrase, for saving it
     *   saving: { isSaved(item), toggle(item), entries(token), setImportance(entries, level) }
     *                                     optional "add to review" star and importance stars
     */
    function create(options) {
        const speak = options.speak;
        const wordSelector = options.wordSelector || '';
        const saving = options.saving || null;
        const lookupCache = new Map();

        const pop = document.createElement('div');
        pop.className = 'floating-word-popover';
        pop.hidden = true;
        pop.setAttribute('aria-live', 'polite');
        pop.innerHTML = popoverMarkup();
        document.body.appendChild(pop);
        const q = (sel) => pop.querySelector(sel);
        const els = {
            word: q('.popover-word'), star: q('.btn-popover-star-icon'), speak: q('.btn-popover-speak-inline'),
            phonetic: q('.popover-phonetic'), pos: q('.popover-pos'), lemma: q('.popover-lemma'),
            close: q('.popover-close-btn'), loading: q('.popover-loading'), content: q('.popover-content'),
            cn: q('.popover-cn-text'), en: q('.popover-en-text'), importance: q('.popover-importance'),
        };
        els.star.hidden = !saving;

        let currentCard = null;
        let activeEl = null;
        let target = null;

        const isOpen = () => !pop.hidden;

        function close() {
            pop.hidden = true;
            pop.style.display = 'none';
            els.loading.hidden = true;
            els.loading.style.display = 'none';
            if (activeEl && activeEl.classList) activeEl.classList.remove('is-active-word');
            activeEl = null;
            target = null;
        }

        function position(el = target) {
            if (!el || pop.hidden) return;
            const rect = el.getBoundingClientRect();
            if (!rect || (rect.width === 0 && rect.height === 0)) return;
            const width = 290;
            pop.style.display = 'flex';
            const height = pop.offsetHeight || 160;
            let left = rect.left + (rect.width / 2) - (width / 2);
            left = Math.max(12, Math.min(left, root.innerWidth - width - 12));
            // 16px gap so the tapped word stays fully visible; flip below when there is no room above
            const gap = 16;
            const spaceAbove = rect.top - height - gap;
            const spaceBelow = root.innerHeight - (rect.bottom + height + gap);
            let top;
            let below;
            if (spaceAbove < 65 && spaceBelow >= 0) {
                top = rect.bottom + gap; below = true;
            } else if (spaceAbove < 65 && spaceBelow < 0) {
                below = spaceAbove <= spaceBelow;
                top = below ? Math.min(root.innerHeight - height - 12, rect.bottom + gap) : Math.max(12, rect.top - height - gap);
            } else {
                top = rect.top - height - gap; below = false;
            }
            pop.classList.toggle('arrow-top', below);
            pop.style.left = `${left}px`;
            pop.style.top = `${top}px`;
            const arrow = q('.popover-arrow');
            if (arrow) arrow.style.left = `${Math.max(18, Math.min(width - 18, rect.left + rect.width / 2 - left))}px`;
        }

        function renderImportance() {
            if (!saving || !currentCard) { els.importance.hidden = true; return; }
            const entries = saving.entries(currentCard.token) || [];
            els.importance.hidden = entries.length === 0;
            if (!entries.length) return;
            const level = Math.max(...entries.map(w => w.importance || 3));
            els.importance.querySelectorAll('button[data-level]').forEach(btn => {
                const n = Number(btn.dataset.level);
                btn.classList.toggle('filled', n <= level);
                btn.title = T.importanceTitle(n);
            });
        }

        function refreshSaved() {
            renderImportance();
            if (!saving || !currentCard) return;
            const saved = saving.isSaved(currentCard);
            els.star.classList.toggle('active', saved);
            els.star.title = saved ? T.popoverSaved : T.popoverStarTitle;
        }

        function render(item) {
            currentCard = item;
            els.word.textContent = item.token;
            const phonetic = formatFriendlyPhonetic(item.phonetic || '');
            els.phonetic.textContent = phonetic;
            els.phonetic.hidden = !phonetic;
            els.pos.textContent = item.pos || '';
            els.pos.hidden = !item.pos;
            const showLemma = item.lemma && item.lemma.toLowerCase() !== item.token.toLowerCase();
            els.lemma.textContent = showLemma ? `${T.baseForm}${item.lemma}` : '';
            els.lemma.hidden = !showLemma;
            if (EN) {
                els.cn.textContent = pick(item.explanation_cn, item.explanation_en) || T.contextWord;
                els.en.textContent = '';
            } else if (item.explanation_cn) {
                els.cn.textContent = item.explanation_cn;
                els.en.textContent = item.explanation_en || '';
            } else {
                els.cn.textContent = item.explanation_en || T.contextWord;
                els.en.textContent = '';
            }
            els.loading.hidden = true;
            els.loading.style.display = 'none';
            els.content.hidden = false;
            els.content.style.display = 'block';
            refreshSaved();
            refreshIcons();
            position();
            requestAnimationFrame(() => position());
        }

        function remember(lower, item) {
            lookupCache.set(lower, item);
            if (options.remember) options.remember(lower, item);
        }

        async function show(rawWord, element, context = {}) {
            if (!element) return;
            const word = (rawWord || '').replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '').trim();
            if (!word || word.length > 40 || (!/[a-zA-ZÀ-ÿ]/.test(word) && !frenchNumberReading(word))) return;
            const rect = element.getBoundingClientRect();
            if (!rect || (rect.width === 0 && rect.height === 0)) return;

            target = element;
            pop.hidden = false;
            pop.style.display = 'flex';
            if (activeEl && activeEl !== element && activeEl.classList) activeEl.classList.remove('is-active-word');
            activeEl = element.classList ? element : null;
            if (activeEl) activeEl.classList.add('is-active-word');
            const withContext = (item) => Object.assign({}, item, {
                sentence: context.sentence || item.sentence || '',
                sentence_cn: context.sentence_cn || item.sentence_cn || '',
            });

            const number = frenchNumberReading(word);
            if (number) {
                speak(number.spoken);
                render(withContext({
                    token: word, speech: number.spoken, lemma: word, pos: number.pos, phonetic: '',
                    explanation_cn: EN ? '' : `${T.readAs}${number.spoken}`,
                    explanation_en: EN ? `${T.readAs}${number.spoken} · ${number.note}` : number.note,
                }));
                return;
            }

            const lower = word.toLowerCase();
            const elided = (lower.match(ELISION_RE) || [])[2];
            // Elided forms such as "l'" are read as their full word
            speak((word.endsWith("'") || word.endsWith('’')) ? (BASIC_FRENCH_WORDS[lower]?.lemma || word) : word);

            // 1. The page's own data (sentence analysis, fixed expressions, the card being reviewed)
            const local = options.localLookup ? options.localLookup(lower, word, context) : null;
            if (local) { render(withContext(Object.assign({ token: word }, local))); return; }

            // 2. Already looked up, or in the built-in A1 dictionary
            const known = lookupCache.get(lower) || (elided && lookupCache.get(elided))
                || BASIC_FRENCH_WORDS[lower] || (elided && BASIC_FRENCH_WORDS[elided]);
            if (known) {
                const item = withContext(Object.assign({}, known, { token: word }));
                remember(lower, item);
                render(item);
                return;
            }

            // 3. Server lookup
            currentCard = withContext({ token: word, lemma: word, pos: '', phonetic: '', explanation_cn: '', explanation_en: '' });
            els.word.textContent = word;
            els.phonetic.textContent = '';
            els.pos.hidden = true;
            els.lemma.hidden = true;
            els.loading.hidden = false;
            els.loading.style.display = 'flex';
            els.content.hidden = true;
            els.content.style.display = 'none';
            refreshSaved();
            refreshIcons();
            position(element);
            try {
                const token = options.getAuthToken ? options.getAuthToken() : '';
                const res = await fetch(`/api/lookup?word=${encodeURIComponent(word)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.detail?.message || T.lookupFailed);
                const item = withContext(data);
                remember(lower, item);
                if (isOpen() && els.word.textContent === word) render(item);
            } catch (err) {
                if (isOpen() && els.word.textContent === word) {
                    els.loading.hidden = true;
                    els.loading.style.display = 'none';
                    els.content.hidden = false;
                    els.content.style.display = 'block';
                    els.cn.textContent = T.noDefinition;
                    els.en.textContent = err.message;
                    position(element);
                }
            }
        }

        function replay() {
            if (currentCard && currentCard.token) speak(currentCard.speech || currentCard.token);
        }

        els.close.addEventListener('click', close);
        els.speak.addEventListener('click', (e) => { e.stopPropagation(); replay(); });
        els.phonetic.addEventListener('click', (e) => { e.stopPropagation(); replay(); });
        els.star.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (saving && currentCard) {
                await saving.toggle(currentCard);
                refreshSaved();
            }
        });
        els.importance.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-level]');
            if (!btn || !saving || !currentCard) return;
            e.stopPropagation();
            const entries = saving.entries(currentCard.token) || [];
            if (!entries.length) return;
            await saving.setImportance(entries, Number(btn.dataset.level));
            renderImportance();
        });

        // Only explicitly marked French content can trigger double-click lookup.
        document.addEventListener('dblclick', (e) => {
            if (pop.contains(e.target)) return;
            if (wordSelector && e.target.closest(wordSelector)) return;
            if (e.target.closest('button, input, textarea, select')) return;
            const frenchRegion = e.target.closest('[lang]');
            if (!frenchRegion || !/^fr(?:-|$)/i.test(frenchRegion.lang)) return;
            const selection = root.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            if (!frenchRegion.contains(range.startContainer) || !frenchRegion.contains(range.endContainer)) return;
            const selected = selection.toString().trim();
            if (!selected) return;
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            show(selected, { getBoundingClientRect: () => rect });
        });

        // Drag-selecting two or more French words (mouse, or a long press on a phone) opens the
        // popover for the phrase: it is spoken and can be saved for review like a single word.
        const frenchRegionOf = (node) => {
            const el = node && (node.nodeType === 1 ? node : node.parentElement);
            const region = el && el.closest('[lang]');
            return region && /^fr(?:-|$)/i.test(region.lang) && !pop.contains(region) ? region : null;
        };
        const isFrenchNode = (node) => Boolean(frenchRegionOf(node));
        // Only the French text of a selection: a drag across the word-by-word gloss also
        // covers the English line under each word, which must not be read or saved.
        function frenchTextOf(range) {
            const rootNode = range.commonAncestorContainer;
            if (rootNode.nodeType === 3) return isFrenchNode(rootNode) ? range.toString() : '';
            const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
            let text = '';
            let lastRegion = null;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const region = frenchRegionOf(node);
                if (!region || !range.intersectsNode(node)) continue;
                let piece = node.textContent;
                if (node === range.endContainer) piece = piece.slice(0, range.endOffset);
                if (node === range.startContainer) piece = piece.slice(range.startOffset);
                // Separate French words that sit in different elements (one per gloss column)
                if (lastRegion && region !== lastRegion && !region.contains(lastRegion) && !lastRegion.contains(region)) text += ' ';
                text += piece;
                lastRegion = region;
            }
            return text;
        }
        let mouseHeld = false;
        let selectionTimer = null;
        let lastPhrase = '';
        function showSelectedPhrase() {
            const selection = root.getSelection();
            const range = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
            const selected = range ? frenchTextOf(range).replace(/\s+/g, ' ').trim() : '';
            if (!selected || !selected.includes(' ')) { lastPhrase = ''; return; }
            if (selected === lastPhrase) return;
            if (document.activeElement && document.activeElement.matches('input, textarea, [contenteditable="true"]')) return;
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            lastPhrase = selected;
            const anchor = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
            const context = options.contextFor ? options.contextFor(anchor) || {} : {};
            show(selected, { getBoundingClientRect: () => rect }, context);
        }
        const scheduleSelection = (delay) => {
            clearTimeout(selectionTimer);
            selectionTimer = setTimeout(showSelectedPhrase, delay);
        };
        document.addEventListener('mousedown', (e) => { if (e.button === 0) mouseHeld = true; });
        document.addEventListener('mouseup', () => {
            if (!mouseHeld) return;
            mouseHeld = false;
            scheduleSelection(0);
        });
        // Touch selections have no mouseup: wait until the selection handles settle
        document.addEventListener('selectionchange', () => { if (!mouseHeld) scheduleSelection(600); });
        document.addEventListener('mousedown', (e) => {
            if (isOpen() && !pop.contains(e.target) && !(wordSelector && e.target.closest(wordSelector))) close();
        });
        root.addEventListener('scroll', () => { if (isOpen()) close(); }, { passive: true });
        root.addEventListener('resize', () => { if (isOpen()) position(); }, { passive: true });
        // Capture phase, so these keys win over the page's own shortcuts while the popover is open
        document.addEventListener('keydown', (e) => {
            if (!isOpen()) return;
            const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
            if (e.key === 'Escape') { close(); e.preventDefault(); e.stopImmediatePropagation(); return; }
            if (typing) return;
            if (e.key === 'r' || e.key === 'R') { replay(); e.preventDefault(); e.stopImmediatePropagation(); return; }
            if ((e.key === 's' || e.key === 'S') && saving) { els.star.click(); e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);

        return { show, close, isOpen, refreshSaved, element: pop };
    }

    /**
     * The word book: every word saved for review, whichever sentence it came from
     * (like Eudic's word book). Shared by the study and review pages.
     * options:
     *   getToken()                 the user's login token
     *   notePayload(sentence)      {sentence, translation_zh, translation_en, extra} for a new note
     *   findLocal(sentence, token) a card the page already knows about, or null
     *   onSaved(note), onRemoved(sentence, cardId), onChange(), onError(err)
     */
    function createWordBook(options) {
        const byText = new Map();  // lower-cased word -> [{card_id, sentence, importance}]
        const keyOf = (token) => (token || '').trim().toLowerCase();
        const changed = () => { if (options.onChange) options.onChange(); };

        async function call(method, path, body) {
            const res = await fetch(path, {
                method,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.getToken()}` },
                body: body ? JSON.stringify(body) : undefined,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail?.message || `HTTP ${res.status}`);
            return data;
        }

        function entries(token) {
            return byText.get(keyOf(token)) || [];
        }

        function isSaved(sentence, token) {
            if (options.findLocal && options.findLocal(sentence, token)) return true;
            if (entries(token).length > 0) return true;
            const clean = keyOf(token);
            if (!clean) return false;
            for (const [text, list] of byText.entries()) {
                if (text.includes(' ') || text.includes("'") || text.includes("’")) {
                    const re = new RegExp(`(^|[\\s'’])${clean}([\\s'’]|$)`, 'i');
                    if (re.test(text)) {
                        if (!sentence) return true;
                        const sKey = (s) => (s || '').replace(/’/g, "'").replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                        if (list.some(w => sKey(w.sentence) === sKey(sentence))) return true;
                    }
                }
            }
            return false;
        }

        async function load() {
            byText.clear();
            if (options.getToken()) {
                try {
                    const data = await call('GET', '/api/srs/words');
                    (data.words || []).forEach(w => {
                        const key = keyOf(w.text);
                        if (!byText.has(key)) byText.set(key, []);
                        byText.get(key).push(w);
                    });
                } catch (err) {
                    console.warn('Failed to load saved words:', err);
                }
            }
            changed();
        }

        function clear() {
            byText.clear();
            changed();
        }

        async function toggle({ token, sentence, meta }) {
            const clean = (token || '').trim();
            if (!clean) return;
            const local = options.findLocal ? options.findLocal(sentence, clean) : null;
            const elsewhere = entries(clean);
            const chunkElsewhere = [];
            if (!local && elsewhere.length === 0) {
                const cKey = clean.toLowerCase();
                for (const [text, list] of byText.entries()) {
                    if (text.includes(' ') || text.includes("'") || text.includes("’")) {
                        const re = new RegExp(`(^|[\\s'’])${cKey}([\\s'’]|$)`, 'i');
                        if (re.test(text)) {
                            const sKey = (s) => (s || '').replace(/’/g, "'").replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                            list.forEach(w => {
                                if (!sentence || sKey(w.sentence) === sKey(sentence)) chunkElsewhere.push(w);
                            });
                        }
                    }
                }
            }
            try {
                if (local || elsewhere.length || chunkElsewhere.length) {
                    // The word is in the book (from this or another sentence): the star removes it
                    const ids = new Set([...elsewhere, ...chunkElsewhere].map(w => w.card_id));
                    if (local) ids.add(local.id);
                    for (const id of ids) await call('DELETE', `/api/srs/cards/${encodeURIComponent(id)}`);
                    if (options.onRemoved) {
                        if (local) options.onRemoved(sentence || clean, local.id);
                        [...elsewhere, ...chunkElsewhere].forEach(w => options.onRemoved(w.sentence, w.card_id));
                    }
                } else {
                    const inSentence = Boolean(sentence) && sentence.toLowerCase().includes(clean.toLowerCase());
                    // A word that is not in this sentence (e.g. from an AI answer) is saved on its own
                    const payload = inSentence ? options.notePayload(sentence) : { sentence: clean };
                    let targetText = clean;
                    if (inSentence && options.resolveChunk) {
                        targetText = options.resolveChunk(sentence, clean) || clean;
                    }
                    payload.targets = [{ text: targetText, mode: inSentence ? 'cloze' : 'recognize', meta: meta || {} }];
                    payload.auto_listen = true;
                    const note = await call('POST', '/api/srs/notes', payload);
                    if (options.onSaved) options.onSaved(note);
                }
            } catch (err) {
                if (options.onError) options.onError(err);
            }
            await load();
        }

        async function setImportance(list, level) {
            try {
                await call('POST', '/api/srs/importance', { card_ids: list.map(w => w.card_id), importance: level });
                list.forEach(w => { w.importance = level; });
            } catch (err) {
                if (options.onError) options.onError(err);
            }
        }

        // Ready-made `saving` option for create(): the popover star and importance stars
        const popoverSaving = {
            isSaved: (item) => isSaved(item.sentence, item.token),
            entries,
            toggle: (c) => toggle({
                token: c.token,
                sentence: c.sentence || '',
                meta: {
                    meaning_zh: c.explanation_cn,
                    meaning_en: c.explanation_en,
                    lemma: c.lemma,
                    pos: c.pos,
                    ipa: c.phonetic,
                    hook: c.hook,
                },
            }),
            setImportance,
        };

        return { load, clear, entries, isSaved, toggle, setImportance, popoverSaving };
    }

    root.FrenchWordPopover = { create, createWordBook, numberReading: frenchNumberReading, basicWords: BASIC_FRENCH_WORDS };
})(window);
