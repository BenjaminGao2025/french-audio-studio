"""Sentence analysis for the study page: the prompt, and parsing the model's JSON into sentences,
tokens, chunks and tips."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any

import httpx
from pydantic import BaseModel, Field

import grammar
import phrase_context
from services import ai
from web_common import MAX_TEXT_CHARS

logger = logging.getLogger(__name__)


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    model: ai.TransformModel = ai.DEFAULT_MODEL


TRIVIAL_SINGLE_WORDS = {
    "je",
    "tu",
    "il",
    "elle",
    "on",
    "nous",
    "vous",
    "ils",
    "elles",
    "ce",
    "c'",
    "c’",
    "ça",
    "de",
    "d'",
    "d’",
    "à",
    "au",
    "aux",
    "dans",
    "en",
    "par",
    "pour",
    "avec",
    "sans",
    "sous",
    "un",
    "une",
    "des",
    "du",
    "le",
    "la",
    "les",
    "l'",
    "l’",
    "et",
    "ou",
    "mais",
    "donc",
    "or",
    "ni",
    "car",
    "ne",
    "pas",
    "y",
    "se",
    "s'",
    "s’",
    "me",
    "te",
}


def _is_unwanted_token(token_text: str) -> bool:
    clean = token_text.strip()
    if not clean:
        return True
    # 1. Punctuation: e.g. '.', ',', '!', '?', ';', ':', '«', '»', '...', '-', '(', ')'
    if not re.search(r"[a-zA-ZÀ-ÿ]", clean):
        return True
    # 2. Pure digits or numbers: e.g. '40', '10', '3.5'
    if re.fullmatch(r"[\d\s.,]+", clean):
        return True
    # 3. Collocations / multi-word expressions (contain spaces) are ALWAYS KEPT!
    if " " in clean:
        return False
    # 4. Filter single elementary words based on user's ~200 baseline
    if clean.lower() in TRIVIAL_SINGLE_WORDS:
        return True
    return False


OPTION_LABEL_RE = re.compile(r"^\(?([A-Ha-h]|\d{1,2})[.)]\)?$")
OPTION_PREFIX_RE = re.compile(r"^\(?([A-Ha-h]|\d{1,2})[.)]\)?\s+(?=\S)")


def _attach_option_labels(sentences: list[dict]) -> list[dict]:
    """Answer options like "A." are labels, not sentences: put them on the sentence they mark."""
    out: list[dict] = []
    pending = ""
    for item in sentences:
        text = str(item.get("sentence") or "").strip()
        only = OPTION_LABEL_RE.match(text)
        if only:
            pending = only.group(1)
            continue
        label = pending or str(item.get("label") or "")[:3]
        prefix = OPTION_PREFIX_RE.match(text)
        if prefix:
            label = label or prefix.group(1)
            text = text[prefix.end() :]
            item = {**item, "sentence": text, "original": text}
            for key in ("translation_en", "translation_zh", "translation_cn", "accent_fixed_from"):
                if item.get(key):
                    item[key] = OPTION_PREFIX_RE.sub("", str(item[key]), count=1)
        out.append({**item, "label": label} if label else item)
        pending = ""
    return out


def _filter_sentence_tokens(tokens: list[dict]) -> list[dict]:
    filtered = [tok for tok in tokens if not _is_unwanted_token(tok.get("token", ""))]
    if filtered:
        return filtered
    # Fallback if every single token was filtered out: keep content words with letters
    fallback = [
        tok
        for tok in tokens
        if re.search(r"[a-zA-ZÀ-ÿ]", tok.get("token", "")) and not re.fullmatch(r"[\d\s.,]+", tok.get("token", ""))
    ]
    return fallback or tokens


def format_friendly_phonetic(raw: str) -> str:
    if not raw:
        return ""
    s = str(raw).strip()
    s = re.sub(r"^[/[\\(\s]+", "", s)
    s = re.sub(r"[/\]\\)\s]+$", "", s).strip()
    s = re.sub(r"[.·•\-]", "", s)
    s = re.sub(r"[ʁʀ]", "r", s)
    s = re.sub(r"ɡ", "g", s)
    if not s:
        return ""
    return f"[{s}]"


# Question banks often drop the accent on capitals ("A pied"). The models restore it, and the
# wording they started from stays visible in a small note under the sentence.
ACCENT_RULE = (
    "Missing accents: the source often drops French accents, mostly on capitals. Restore an accent only "
    "where French spelling requires it: A pied → À pied, A l'heure → À l'heure, A Paris → À Paris, "
    "A 8 heures → À 8 heures, Ecole → École, Etre → Être, Ca va → Ça va, je vais a Paris → je vais à Paris. "
    "Change nothing else: correct text stays exactly as it is, and you fix no grammar, spelling, punctuation or wording. "
    "A stays A when it is the verb avoir (A-t-il fini ?), an answer label (A., B)), a level (A1, A2) "
    "or a letter (vitamine A). Leave names of people, acronyms and non-French words as written.\n"
)


def _unaccented(ch: str) -> str:
    return unicodedata.normalize("NFD", ch)[0]


def _accent_fixed_from(fixed: str, original: Any) -> str:
    """original when fixed only adds accents to it, else "": anything more is no accent fix."""
    if not isinstance(original, str):
        return ""
    fixed = unicodedata.normalize("NFC", fixed)
    original = unicodedata.normalize("NFC", " ".join(original.split()))
    if original == fixed or len(original) != len(fixed):
        return ""
    return original if all(a == b or a == _unaccented(b) for a, b in zip(original, fixed)) else ""


def _accent_source_of(line: str, source: str) -> str:
    """How source wrote line, when line only added accents to it. Offsets survive _unaccented."""
    line = unicodedata.normalize("NFC", line)
    source = unicodedata.normalize("NFC", source)
    if line in source:
        return ""
    at = "".join(map(_unaccented, source)).find("".join(map(_unaccented, line)))
    return _accent_fixed_from(line, source[at : at + len(line)]) if at != -1 else ""


def _analyze_payload(request: AnalyzeRequest) -> dict:
    prompt = (
        "You are explaining a French sentence to an A1–A2 learner. Their native language is Chinese and their English is basic.\n\n"
        "Language rules:\n"
        "- The English must be easier than the French being taught. The reader is learning French, not English.\n"
        "- Short sentences: at most 12 words each. One idea per sentence.\n"
        "- Use everyday words only. Do not use words like: elided, auxiliary, particle, indefinite, omit, agree with (grammar sense), construction.\n"
        "- No brackets or long explanations inside brackets.\n"
        "- Show, don't describe. Every explanation must include a real example from the sentence. Do not describe a rule without showing it.\n"
        "- Pattern to follow: one short rule sentence + one example.\n"
        "- Before you output, reread each explanation. If a learner with basic English would need to read it twice, rewrite it shorter.\n\n"
        "Missing words:\n"
        '- Forms, signs, certificates and titles often leave out words like "this" and "is".\n'
        "- When a sentence leaves out words, show the short version and the full sentence one after the other.\n"
        "- Put the missing words in [brackets] in the full sentence, in both French and English.\n"
        "- Then add one short sentence, for example: \"Forms often leave out 'this' and 'is'. Like a label.\"\n"
        "- Include this in grammar_points when a phrase leaves out words.\n\n"
        "Good and bad explanation examples:\n"
        "BAD (too abstract, too long):\n"
        "\"On forms and certificates, French often drops 'C'est une...' (It is a...) and 'est' (is) to keep the text short, writing 'Attestation valable' instead of 'Cette attestation est valable'.\"\n\n"
        "GOOD:\n"
        "Short version: Attestation valable\n"
        "Full sentence: [Cette] attestation [est] valable.\n"
        "English: [This] certificate [is] valid.\n"
        'Forms often leave out "this" and "is". Like a label.\n\n'
        "BAD:\n"
        "\"negative particle (elided to n' before a vowel; pairs with 'aucune' for negation)\"\n\n"
        "GOOD:\n"
        "ne becomes n' before a vowel: ne + est → n'est.\n"
        'Here it works with aucune to mean "no".\n\n'
        "Answer options:\n"
        "- A label like 'A.', 'B.', '1.' or 'a)' before an answer option is not a sentence. Never return it as its own sentence; leave it out of \"sentence\" and put it in \"label\" (e.g. \"label\": \"A\") of the sentence it marks.\n\n"
        + ACCENT_RULE
        + '- Put the corrected text in "sentence" and put the text exactly as it was written in "accent_fixed_from". '
        'If you restored nothing, "accent_fixed_from" is "".\n'
        "- Every other field uses the corrected text too: alignment, build_up, words, grammar_points, structure, pronunciation_tips. Never write the typo there.\n"
        "- À is the preposition à with a capital letter. It is not the verb a. In the word table use lemma 'à' and type 'small linking word', "
        "and say in why that À is the preposition à.\n"
        "- Give À its meaning in the phrase: À Paris = in Paris, À 8 heures = at 8 o'clock. "
        "À pied and À l'heure are fixed expressions and stay ONE chunk: À pied = on foot, À l'heure = on time. Never a lone À = On.\n\n"
        "Accuracy rules:\n"
        "- The word table must cover every word in the sentence, in order, including small words like par, les, de, à.\n"
        "- Fixed expressions stay together as ONE entry when their meaning is not the sum of the words "
        "(à partir de, il y a, grâce à, au lieu de, par rapport à, à cause de, en fonction de). "
        "Put the dictionary form in lemma and the whole expression's meaning in meaning / meaning_zh. "
        "Example: 'À partir des' → fr: 'À partir des', lemma: 'à partir de', meaning: 'starting from', meaning_zh: '从……起', "
        "why: 'des = de + les.'\n"
        "- Numbers, dates, ordinals and abbreviations are words too: 1er, 2026, 15h30, TCF. "
        "In meaning say how to read them aloud, e.g. '1er' → meaning: 'first (say: premier)', '2026' → meaning: 'say: deux mille vingt-six'. "
        "The ipa is for the spoken form.\n"
        "Write each ipa in learner-friendly form: no slashes, no syllable dots or hyphens, use r instead of ʁ and g instead of ɡ. "
        "Example: proposer is prɔpɔze, not /pʁɔ.pɔ.ze/.\n"
        "meaning is this word in this sentence, in short simple English. Do not repeat the French word. Do not translate the whole sentence.\n"
        '- Never list a word that is not in the sentence. Example: if the sentence uses ne … aucune, do not list "ne … pas".\n'
        "- Every French sentence in the build-up must be correct French.\n\n"
        'Fixed expressions list ("phrases"):\n'
        '- List every fixed expression of the sentence again in "phrases", so a tap on one of its words can show the whole. '
        "Only expressions whose words stand next to each other. Ordinary word groups are not fixed expressions: "
        "les sessions, a été, est autorisée, à Paris.\n"
        "- Each: text (the words exactly as the sentence writes them, e.g. 'À partir des'), phrase (dictionary form, "
        "'à partir de'), meaning_zh ('从……起'), meaning_en ('starting from'), literal_zh: ONE short Chinese sentence "
        "on why reading it word by word is wrong, e.g. 'partir 单独是“离开”，但 à partir de 是固定介词短语，表示起点；"
        "这里 des = de + les。'\n"
        '- Most sentences have none: then "phrases": []. Never invent one.\n\n'
        "Chinese meaning:\n"
        "- Every word also gets meaning_zh: its short Chinese meaning in THIS sentence (2–8 characters), e.g. 没有任何, 豁免, 被允许的.\n\n"
        "English bridge:\n"
        "- If a French word looks like an English word with the same meaning, show it (autorisée → authorized).\n"
        '- If it looks like an English word but means something different, warn clearly: "False friend! actuellement = currently, not actually."\n'
        "- If there is no English look-alike, leave it empty. Do not force one.\n\n"
        "Word-by-word alignment:\n"
        "- Top row French, bottom row English, word by word, keeping the French order.\n"
        "- The English under each French chunk is what it means IN THIS SENTENCE, in plain learner English, not an etymological or dictionary-literal gloss. Small words are translated too: à = to / at, de = of / from, du = of the, au = to the. Never drop a preposition just because natural English drops it: 'à la question' = 'to the question', not 'the question'. When natural English says it differently (correspond à = matches), say so in the order note.\n"
        "- A fixed expression is ONE chunk with its real meaning, never split word by word: ce qu'on appelle = so-called / what people call, en fait = in fact, il y a = there is / ago, ne … que = only.\n"
        "- Traps (also for meaning / meaning_zh in the word table): on = people / we / they (generic subject, never 'one'); "
        "en as a pronoun = some / of it / from there (in only as a preposition); y = there / it; "
        "se / s' = oneself / each other, or nothing in English (s'appeler = to be called); dont = whose / of which; "
        "ne … que = only, not a negation; ce que / ce qu' = what, not 'that which'.\n"
        "- Then one short sentence on where French and English order differ. If they are the same, say so.\n"
        '- For very short phrases of 4 words or fewer where word order is identical to English, you may leave "alignment": [] and "order_note": "".\n\n'
        "Build-up (layers):\n"
        "- CRITICAL RULE FOR SHORT SENTENCES: If the sentence or phrase has 5 words or fewer (e.g. 'Délivrance des résultats', 'Bonjour tout le monde', 'Merci beaucoup', short titles/headings), DO NOT create a build-up! Return empty array: \"build_up\": []. Do NOT artificially split short phrases.\n"
        "- For longer sentences (more than 5 words), build it like a tree: the short core first, then small pieces. The learner is a beginner: every step must be easy.\n"
        "  1. Step 1 is the bare core: the FIRST main clause reduced to subject + verb + object (for an imperative, verb + object), "
        "even if it feels very short, with nothing of a relative clause in it (e.g. 'Choisissez celle.', not 'Choisissez celle qui correspond.'). "
        "Never start from a later clause, a clause after et/mais, or a subordinate clause.\n"
        "  2. Each next step adds ONE small piece of at most 6 new words, in the sentence's own order: what hangs on the core first (an object, a de … group, a relative clause qui/que/dont), "
        "then a coordinated main clause (et/mais/ou + verb), then place/time phrases. "
        "A longer piece is cut into two or more steps. A list (a, b et c) or a part between commas is added one item at a time.\n"
        "  3. Keep the original word order in every step, and end with the exact original sentence. "
        "Use as many steps as the sentence needs: 3–5 for a normal sentence, up to 10 for a very long one. Never add 10 or more words in one step.\n"
        "  Example: 'Choisissez celle qui correspond à l'image et cochez une case sur la feuille de réponses.' → "
        "1 'Choisissez celle.' → 2 'Choisissez celle qui correspond à l'image.' → "
        "3 '… et cochez une case.' → 4 the full sentence (adds sur la feuille de réponses). "
        "Wrong: starting with 'Cochez une case.'\n"
        '- Each step has: French, English, and "new": the added French words, a colon, then what they tell in at most 10 easy English words. '
        "No grammar words such as trunk, branch, clause, complement, subordinate, modifier. No \"New:\" prefix. "
        '(e.g. "qui correspond à l\'image: says which one."). '
        'Step 1\'s note names each part by its own French words, so the learner sees which word does what: '
        '"La loi: who. a: has. le droit: what." / "Choisissez: do what (choose). celle: which (the one)." '
        'Never a formula such as "subject + verb + object" or "who does what" without the French words. '
        'Write the added French words in full (no "..." or "…") and say what they mean, never just "adds the second idea". '
        'A second clause after et / mais / ou gets a note like step 1, naming its own parts: '
        '"et joignez: and attach. une copie: what." The French of a step never ends with "..." or "…".\n\n'
        "Grammar points:\n"
        "- 1–3 points, the most useful ones for this sentence.\n"
        "- Each has: a short title, a simple explanation, and a memory hook (word history, a comparison with English or Chinese, or a simple picture).\n\n"
        "Pronunciation tips:\n"
        "- Only the tricky parts: silent letters (e.g. silent -ent in verbs), liaison between words, tricky vowels or nasals.\n"
        "- Format each tip starting with the clean French word or liaison phrase being taught, followed by a colon: 'French word: simple explanation'. Example: \"'informations': the starting 'in-' is the nasal vowel [ɛ̃] (like 'vin' or 'matin'), not English 'in'\".\n"
        "- Do NOT write phrases like \"'in-' in 'informations':\" before the colon; always put the clean French word before the colon.\n"
        "- Always enclose the French words or phonetic representations in single quotes, e.g. \"'leurs diplômes': The 's' in 'leurs' is silent before consonant 'diplômes'\".\n\n"
        "Sentence structure (a colour bar under the sentence):\n"
        '- "structure": the sentence cut into chunks, left to right, together covering the whole sentence. Punctuation may be left out, except a ? that makes a question.\n'
        "- Each chunk: text (the exact words), block, role, detail, gid.\n"
        "- block: N = noun group (nouns, articles, adjectives, pronouns), V = verb (the conjugated verb with its auxiliary, an infinitive), "
        "S = how the sentence is built (negation words, question words, prepositions, conjunctions, relative pronouns, il y a, c'est).\n"
        "- role: 2–8 Chinese characters, e.g. 主语代词, 谓语动词, 否定, 介词. detail: short Chinese with the French forms: "
        "a verb is 'infinitive · person · tense' (pouvoir · tu · 直陈式现在时), a noun group is gender and number (la + table · 阴性单数).\n"
        "- gid: the id from the list below that this chunk shows (it may be from another block), or null. Never invent an id.\n"
        '- "grammar_ids": 1–6 ids from the list that this sentence shows, most useful first.\n'
        "- Example: 'Tu peux m'aider ?' → \"structure\": ["
        '{"text": "Tu", "block": "N", "role": "主语代词", "detail": "tu · 第二人称单数", "gid": "N.pronoun.subject"}, '
        '{"text": "peux", "block": "V", "role": "情态动词", "detail": "pouvoir · tu · 直陈式现在时", "gid": "V.present.pouvoir"}, '
        '{"text": "m\'", "block": "N", "role": "宾语代词", "detail": "me → m\' · 放在不定式前", "gid": "S.order.object_pronoun"}, '
        '{"text": "aider", "block": "V", "role": "不定式", "detail": "aider · 动词 + 不定式", "gid": "V.verb_infinitive"}, '
        '{"text": "?", "block": "S", "role": "语调疑问", "detail": "句末升调，语序不变", "gid": "S.question.intonation"}], '
        '"grammar_ids": ["V.present.pouvoir", "V.verb_infinitive", "S.order.object_pronoun", "S.question.intonation", "N.pronoun.subject"]\n'
        "Grammar point ids:\n" + grammar.prompt_inventory() + "\n\n"
        "Output JSON format strictly matching this schema:\n"
        "{\n"
        '  "sentences": [\n'
        "    {\n"
        '      "schemaVersion": 2,\n'
        '      "sentence": "Aucune dispense n\'est autorisée par les autorités canadiennes.",\n'
        '      "accent_fixed_from": "",\n'
        '      "translation_en": "No exemption is authorized by the Canadian authorities.",\n'
        '      "translation_zh": "加拿大当局不允许任何豁免。",\n'
        '      "alignment": [\n'
        '        {"fr": "Aucune", "en": "No"},\n'
        '        {"fr": "dispense", "en": "exemption"},\n'
        '        {"fr": "n\'est", "en": "is"},\n'
        '        {"fr": "autorisée", "en": "authorized"},\n'
        '        {"fr": "par", "en": "by"},\n'
        '        {"fr": "les autorités", "en": "the authorities"},\n'
        '        {"fr": "canadiennes", "en": "Canadian"}\n'
        "      ],\n"
        '      "order_note": "Almost the same order as English. Only difference: French puts canadiennes after the noun. English says Canadian authorities.",\n'
        '      "build_up": [\n'
        '        {"fr": "Les autorités autorisent.", "en": "The authorities authorize.", "new": "Les autorités: who. autorisent: do what (authorize)."},\n'
        '        {"fr": "Les autorités canadiennes autorisent.", "en": "The Canadian authorities authorize.", "new": "canadiennes: Canadian. It comes after the noun."},\n'
        '        {"fr": "Les autorités canadiennes n\'autorisent pas la dispense.", "en": "The Canadian authorities do not authorize the exemption.", "new": "ne … pas la dispense: not, and what they allow."},\n'
        '        {"fr": "Les autorités canadiennes n\'autorisent aucune dispense.", "en": "The Canadian authorities authorize no exemption.", "new": "aucune: no, not any. It takes the place of pas."},\n'
        '        {"fr": "Aucune dispense n\'est autorisée par les autorités canadiennes.", "en": "No exemption is authorized by the Canadian authorities.", "new": "est autorisée par: is authorized by, like English."}\n'
        "      ],\n"
        '      "words": [\n'
        '        {"fr": "aucune", "ipa": "okyn", "lemma": "aucun", "type": "describing word", "meaning": "no, not any", "meaning_zh": "没有任何", "why": "Ends in -e because dispense is a feminine word. Used with ne, but without pas.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "dispense", "ipa": "dispɑ̃s", "lemma": "dispense", "type": "naming word", "meaning": "exemption", "meaning_zh": "豁免", "why": "Feminine noun.", "english_link": "dispensation", "false_friend": false},\n'
        '        {"fr": "n\'est", "ipa": "nɛ", "lemma": "être", "type": "action word form", "meaning": "is (negative)", "meaning_zh": "不是", "why": "ne becomes n\' before a vowel. Combined with aucune.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "autorisée", "ipa": "otɔrize", "lemma": "autoriser", "type": "action word form", "meaning": "authorized", "meaning_zh": "被允许的", "why": "Ends in -e because dispense is a feminine word.", "english_link": "authorized", "false_friend": false},\n'
        '        {"fr": "par", "ipa": "par", "lemma": "par", "type": "small linking word", "meaning": "by", "meaning_zh": "由；被", "why": "Shows who does the action.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "les", "ipa": "le", "lemma": "le", "type": "small pointer word", "meaning": "the (plural)", "meaning_zh": "这些（复数）", "why": "Points to more than one authority.", "english_link": "", "false_friend": false},\n'
        '        {"fr": "autorités", "ipa": "otɔrite", "lemma": "autorité", "type": "naming word", "meaning": "authorities", "meaning_zh": "当局", "why": "Ends in -s because it is plural.", "english_link": "authorities", "false_friend": false},\n'
        '        {"fr": "canadiennes", "ipa": "kanadjɛn", "lemma": "canadien", "type": "describing word", "meaning": "Canadian (plural)", "meaning_zh": "加拿大的", "why": "Ends in -nes because autorités is feminine plural.", "english_link": "Canadian", "false_friend": false}\n'
        "      ],\n"
        '      "grammar_points": [\n'
        '        {"title": "aucune … ne = no / not any (no pas!)", "explanation": "aucune already means no. Adding pas would say no twice.", "hook": "Aucun problème! = No problem! Same aucun."},\n'
        '        {"title": "Passive: est autorisée par = is authorized by", "explanation": "est autorisée par works like English is authorized by.", "hook": "Same word order as English."},\n'
        '        {"title": "Describing words go after the noun", "explanation": "French names the thing first, then says what kind: les autorités canadiennes.", "hook": "Exceptions are short common words: beau, jeune, bon, grand, petit…"}\n'
        "      ],\n"
        '      "structure": [\n'
        '        {"text": "Aucune dispense", "block": "N", "role": "主语", "detail": "aucune + dispense · 阴性单数", "gid": "S.neg.aucun"},\n'
        '        {"text": "n\'est autorisée", "block": "V", "role": "谓语（被动）", "detail": "être · elle · 直陈式现在时 + 过去分词 autorisée", "gid": "V.passive"},\n'
        '        {"text": "par", "block": "S", "role": "介词", "detail": "par = 由、被，引出做事的人", "gid": null},\n'
        '        {"text": "les autorités canadiennes", "block": "N", "role": "施动者", "detail": "les + autorités + canadiennes · 阴性复数 · 形容词在后", "gid": "N.adj.position"}\n'
        "      ],\n"
        '      "grammar_ids": ["S.neg.aucun", "V.passive", "N.adj.position", "N.adj.agreement", "S.elision"],\n'
        '      "phrases": [],\n'
        '      "pronunciation_tips": [\n'
        "        \"'les autorités': link the 's' to make a /z/ sound → 'lé-zo-to-ri-té'\",\n"
        "        \"'autorisée': 's' between two vowels sounds like /z/\",\n"
        "        \"'canadiennes': the ending '-nes' sounds like /n/\"\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "NOTE: The words array must cover every single word in the sentence in sequential order, including small words (articles, prepositions, etc.)."
    )
    return {
        "model": ai.AGY_MODEL,
        "messages": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": f"Explain this French text for an A1–A2 learner in valid JSON strictly following the schema:\n\n{request.text}",
            },
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.1,
    }


def _parse_analysis_json(raw_text: str, fallback_text: str) -> dict:
    cleaned = raw_text.strip()

    # Strip thinking blocks from reasoning models (<think>...</think>)
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned).strip()

    # If wrapped in markdown code fence
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    candidate = fence_match.group(1).strip() if fence_match else cleaned

    parsed_data = None
    try:
        parsed_data = json.loads(candidate)
    except Exception:
        first_brace = candidate.find("{")
        last_brace = candidate.rfind("}")
        first_bracket = candidate.find("[")
        last_bracket = candidate.rfind("]")

        is_object = first_brace != -1 and last_brace > first_brace
        is_array = first_bracket != -1 and last_bracket > first_bracket

        if is_object and (not is_array or first_brace < first_bracket):
            json_substr = candidate[first_brace : last_brace + 1]
        elif is_array:
            json_substr = candidate[first_bracket : last_bracket + 1]
        else:
            json_substr = candidate

        # Remove trailing commas before } or ]
        cleaned_json = re.sub(r",\s*([\]}])", r"\1", json_substr)
        try:
            parsed_data = json.loads(cleaned_json)
        except Exception as exc:
            logger.warning("Failed to parse JSON from upstream LLM: %s. Snippet: %r", exc, raw_text[:300])

    sentences_raw = None
    if isinstance(parsed_data, list):
        sentences_raw = parsed_data
    elif isinstance(parsed_data, dict):
        if "sentences" in parsed_data and isinstance(parsed_data["sentences"], list):
            sentences_raw = parsed_data["sentences"]
        elif (
            "sentence" in parsed_data
            or "original" in parsed_data
            or "alignment" in parsed_data
            or "words" in parsed_data
        ):
            sentences_raw = [parsed_data]

    if sentences_raw:
        valid_sentences = []
        for s in sentences_raw:
            if not isinstance(s, dict):
                continue
            is_v2 = s.get("schemaVersion") == 2 or "words" in s or "build_up" in s or "alignment" in s
            sentence_text = str(s.get("sentence") or s.get("original") or "").strip()
            if not sentence_text:
                continue
            fixed_from = _accent_fixed_from(sentence_text, s.get("accent_fixed_from")) or _accent_source_of(
                sentence_text, fallback_text
            )
            accent_note = {"accent_fixed_from": fixed_from} if fixed_from else {}

            if is_v2:
                raw_words = s.get("words", [])
                clean_words = []
                for w in raw_words:
                    if isinstance(w, dict):
                        fr = str(w.get("fr") or w.get("token") or "").strip()
                        if fr:
                            clean_words.append(
                                {
                                    "fr": fr,
                                    "ipa": format_friendly_phonetic(str(w.get("ipa") or w.get("phonetic") or "")),
                                    "lemma": str(w.get("lemma") or fr),
                                    "type": str(w.get("type") or w.get("pos") or ""),
                                    "meaning": str(w.get("meaning") or w.get("explanation_en") or ""),
                                    "meaning_zh": str(w.get("meaning_zh") or w.get("explanation_cn") or ""),
                                    "why": str(w.get("why") or ""),
                                    "english_link": str(w.get("english_link") or ""),
                                    "false_friend": bool(w.get("false_friend", False)),
                                }
                            )

                raw_alignment = s.get("alignment", [])
                clean_alignment = []
                for a in raw_alignment:
                    if isinstance(a, dict):
                        fr = str(a.get("fr", "")).strip()
                        en = str(a.get("en", "")).strip()
                        if fr or en:
                            clean_alignment.append({"fr": fr, "en": en})

                raw_buildup = s.get("build_up", [])
                clean_buildup = []
                for b in raw_buildup:
                    if isinstance(b, dict):
                        fr = str(b.get("fr", "")).strip()
                        en = str(b.get("en", "")).strip()
                        new_note = re.sub(r"^(new\s*:\s*)+", "", str(b.get("new", "")).strip(), flags=re.IGNORECASE)
                        if fr:
                            clean_buildup.append({"fr": fr, "en": en, "new": new_note})

                raw_grammar = s.get("grammar_points", [])
                clean_grammar = []
                for g in raw_grammar:
                    if isinstance(g, dict):
                        title = str(g.get("title", "")).strip()
                        exp = str(g.get("explanation", "")).strip()
                        hook = str(g.get("hook", "")).strip()
                        if title or exp:
                            clean_grammar.append({"title": title, "explanation": exp, "hook": hook})

                raw_tips = s.get("pronunciation_tips", [])
                clean_tips = [str(tip).strip() for tip in raw_tips if str(tip).strip()]

                structure = grammar.clean_structure(s.get("structure"), sentence_text)
                grammar_ids = grammar.clean_grammar_ids(s.get("grammar_ids"), structure)

                trans_en = str(s.get("translation_en") or "")
                trans_zh = str(s.get("translation_zh") or s.get("translation_cn") or "")

                # Tokens fallback for popover & legacy export
                legacy_tokens = [
                    {
                        "token": w["fr"],
                        "lemma": w["lemma"],
                        "pos": w["type"],
                        "phonetic": w["ipa"],
                        "explanation_en": f"{w['meaning']}. {w['why']}".strip(". "),
                        "explanation_cn": w["meaning_zh"],
                    }
                    for w in clean_words
                ]

                valid_sentences.append(
                    {
                        "schemaVersion": 2,
                        "label": str(s.get("label") or "").strip()[:3],
                        "sentence": sentence_text,
                        "original": sentence_text,
                        **accent_note,
                        "translation_en": trans_en,
                        "translation_zh": trans_zh,
                        "translation_cn": trans_zh,
                        "alignment": clean_alignment,
                        "order_note": str(s.get("order_note", "")),
                        "build_up": clean_buildup,
                        "words": clean_words,
                        "tokens": legacy_tokens,
                        "grammar_points": clean_grammar,
                        "structure": structure,
                        "grammar_ids": grammar_ids,
                        "pronunciation_tips": clean_tips,
                        # Only when the model answered: a missing list is "unknown", not "none"
                        **(
                            {"phrases": phrase_context.clean_phrases(s["phrases"], sentence_text)}
                            if isinstance(s.get("phrases"), list)
                            else {}
                        ),
                    }
                )
            else:
                # Legacy V1
                raw_tokens = s.get("tokens", [])
                clean_tokens = []
                for tok in raw_tokens:
                    if isinstance(tok, dict) and "token" in tok:
                        t_str = str(tok.get("token", "")).strip()
                        if t_str:
                            clean_tokens.append(
                                {
                                    "token": t_str,
                                    "lemma": str(tok.get("lemma", t_str)),
                                    "pos": str(tok.get("pos", "")),
                                    "phonetic": format_friendly_phonetic(str(tok.get("phonetic", ""))),
                                    "explanation_en": str(tok.get("explanation_en", "")),
                                    "explanation_cn": str(tok.get("explanation_cn", "")),
                                }
                            )
                filtered_tokens = _filter_sentence_tokens(clean_tokens)
                valid_sentences.append(
                    {
                        "schemaVersion": 1,
                        "original": sentence_text,
                        "sentence": sentence_text,
                        **accent_note,
                        "translation_en": str(s.get("translation_en", "")),
                        "translation_cn": str(s.get("translation_cn", "")),
                        "translation_zh": str(s.get("translation_cn", "")),
                        "tokens": filtered_tokens,
                    }
                )
        valid_sentences = _attach_option_labels(valid_sentences)
        if valid_sentences:
            return {"sentences": valid_sentences}

    # Fallback heuristic segmenter (only if upstream LLM completely failed)
    raw_sentences = [sent.strip() for sent in re.split(r"(?<=[.!?。！？])\s+", fallback_text) if sent.strip()]
    if not raw_sentences:
        raw_sentences = [fallback_text.strip()]

    fallback_sentences = []
    for sent in raw_sentences:
        raw_words = re.findall(r"[\w'’\-]+", sent)
        fallback_words = [
            {
                "fr": word,
                "ipa": "",
                "lemma": word.lower(),
                "type": "word",
                "meaning": "Vocabulary item in sentence context",
                "why": "Word from original sentence.",
                "english_link": "",
                "false_friend": False,
            }
            for word in raw_words
        ]
        fallback_sentences.append(
            {
                "schemaVersion": 2,
                "sentence": sent,
                "original": sent,
                "translation_en": "",
                "translation_zh": "",
                "translation_cn": "",
                "alignment": [{"fr": w["fr"], "en": ""} for w in fallback_words],
                "order_note": "",
                "build_up": [{"fr": sent, "en": "", "new": "Original sentence"}],
                "words": fallback_words,
                "tokens": [
                    {
                        "token": w["fr"],
                        "lemma": w["lemma"],
                        "pos": w["type"],
                        "phonetic": "",
                        "explanation_en": w["meaning"],
                        "explanation_cn": "",
                    }
                    for w in fallback_words
                ],
                "grammar_points": [],
                "pronunciation_tips": [],
            }
        )
    return {"sentences": fallback_sentences}


async def request_french_analysis(request: AnalyzeRequest, api_key: str) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = _analyze_payload(request)
    async with httpx.AsyncClient(timeout=ai.UPSTREAM_TIMEOUT_SECONDS) as client:
        _, raw_text = await ai.post_chat(client, payload, headers)
        return _parse_analysis_json(raw_text, request.text)
