# Source dictionary

`GET /api/lookup` reads `offline_dictionary.py` and never calls a language model, translates
definitions, or substitutes generated answers on a miss. A miss is `dictionary_state: not_found`;
if neither configured index is available, or an opened index is corrupt, lookup returns HTTP 503. Login is required, but dictionary reads do not
require an AI subscription or spend the AI rate allowance.

The word card displays selected **English source glosses first, then French source definitions**. The separate **Meaning in this
sentence · AI** section shows an English explanation specific to the sentence. Generated roots
and origin notes are no longer offered in this card.
Historical review snapshots remain unchanged and are labeled “Saved meaning”, not Dictionary.

## Data and attribution

- Definitions and IPA: Wiktionnaire contributors, extracted by Tatu Ylonen / Kaikki (Wiktextract).
  Source: <https://kaikki.org/frwiktionary/rawdata.html>, French entries from the 2026-10-01 dump,
  extracted 2026-11-02. Each API entry includes its original Wiktionnaire page and history URLs.
- Lemma lookup and frequency ranking: Lexique **3.83**, by Boris New, Christophe Pallier,
  Ronald Peereman, Sophie Dufour, Christian Lachaud and contributors.
  Source: <https://lexique.org/databases/Lexique383/Lexique383.tsv>.
- Selected data license: **CC BY-SA 4.0**, <https://creativecommons.org/licenses/by-sa/4.0/>.
  Upstream Wiktionnaire license: <https://fr.wiktionary.org/wiki/Wiktionnaire:Licence>.
  License applies to the data independently of application code.
- Adaptations: French-only filtering, bounded selected source senses, normalized search keys,
  and combined Lexique metadata. Definitions are not generated or translated. Preserve attribution,
  the change notice, and CC BY-SA 4.0 when redistributing the adapted dictionary data.

Raw source files, downloaded license/README pages, the SQLite index and its checksummed manifest
are retained at `/home/mgacai/tts-dictionary-data`. No corpus is committed or baked into images.
The current index contains 2,112,393 Wiktionnaire entries and 142,694 Lexique rows. Its manifest
records dataset ID `48d9237cdd3a779471ad1347e736755e927b0231cbcd35a21bd273000a101728`.

## Runtime and rebuild

`compose.yml` mounts `french-v1.sqlite` read-only at `/app/dictionary/french.sqlite` and sets
`FRENCH_DICTIONARY_PATH` to that path. Connections use `mode=ro&immutable=1`, query-only mode,
a small SQLite page cache and a bounded process cache. Cache keys include the index's identity
so an atomic replacement is picked up. Search keeps accents and normalizes apostrophe variants.
Lexique ranks plausible parts of speech independently of the learner's sentence; multiple
plausible lemmas remain visible. Direct expressions such as `d’accord` use their actual entry.

To reproduce with retained files, choose a fresh output name; the builder refuses overwrites:

```sh
python3 scripts/build_french_dictionary.py \
  --raw /home/mgacai/tts-dictionary-data/raw-wiktextract-data.jsonl.gz \
  --lexique /home/mgacai/tts-dictionary-data/Lexique383.tsv \
  --output /home/mgacai/tts-dictionary-data/french-next.sqlite
```

Use the established deployment pipeline, which backs up application data before restarting.
The dictionary integration changes no user database schema and never edits the source index.

## English-gloss French index (Task A)

Official download: <https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl>,
linked from <https://kaikki.org/dictionary/French/>. This is French data extracted from
**English Wiktionary**, with English glosses, by Tatu Ylonen / Kaikki. The downloaded page
reports extraction on 2026-10-30 from the 2026-10-01 English Wiktionary dump.
Data adaptations use **CC BY-SA 4.0**; authors are English Wiktionary contributors and
Tatu Ylonen / Kaikki. We filter French records, normalize search keys and retain bounded
source senses, IPA and form-of references. No generated or translated definitions.

```sh
python3 scripts/build_english_dictionary.py \
  --raw /home/mgacai/polish-1.2-out/dict-build/kaikki.org-dictionary-French.jsonl \
  --output /home/mgacai/polish-1.2-out/dict-build/english-french-next.sqlite
```

The builder also accepts `.jsonl.gz`, refuses existing outputs, streams bounded lines,
checks SQLite integrity and writes a SHA-256 manifest. Keep raw data and generated indexes
outside the repository. The built `english-french-v1.sqlite` contains 404,126 entries,
55,332,864 bytes (52.77 MiB); `recorrection` is **absent** from the source French entries.
The existing `french-v1.sqlite` is unchanged.

Set `ENGLISH_DICTIONARY_PATH` to the absolute index path. The English schema remains v1,
with the same entries table and an empty Lexique table; metadata adds `gloss_language=en`.
Without this environment variable, the French-only path continues to work. Both readers
use read-only immutable connections and a bounded cache keyed by file identity.

`GET /api/lookup` retains `entries` for compatibility, now English first, with each entry's
`language` (`en` or `fr`). `entries_en` and `entries_fr` expose the same groups separately;
`datasets` identifies the corpora used. English entries link to English Wiktionary's French
section. Exact entries and corpus-backed lemma resolution precede spelling fallback in
both dictionaries. Only if neither corpus resolves the input do bounded prefix/suffix
rules try related entries. `match_type=related` and `related` explicitly label these
heuristic matches: they describe the related word, not an asserted definition of the input.

For a phrase: exact/lemma entry, then related whole phrase, then `match_type=components`
with ordered `components`. Each component resolves independently using the same rules;
missing stopwords are omitted, other missing components carry `dictionary_state=not_found`.
The top-level `entries` arrays are empty for component results. A wholly missing word/phrase
remains an explicit miss without AI. The card shows a short linked “Source: Wiktionary
(CC BY-SA)” line, with full contributor/change attribution in its native tooltip.

See TASK A in `REPORT-polish.md` for the exact operator deployment commands. They have
not been executed; no production configuration or containers were changed.
