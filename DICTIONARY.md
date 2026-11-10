# Source dictionary

`GET /api/lookup` reads `offline_dictionary.py` and never calls a language model, translates
definitions, or substitutes generated answers on a miss. A miss is `dictionary_state: not_found`;
a missing or unreadable index returns HTTP 503. Login is required, but dictionary reads do not
require an AI subscription or spend the AI rate allowance.

The word card displays selected **French source definitions**. The separate **Meaning in this
sentence · AI** section shows an English explanation specific to the sentence. Generated roots
and origin notes are no longer offered in this card.
Historical review snapshots remain unchanged and are labeled “Saved meaning”, not Dictionary.

## Data and attribution

- Definitions and IPA: Wiktionnaire contributors, extracted by Tatu Ylonen / Kaikki (Wiktextract).
  Source: <https://kaikki.org/frwiktionary/rawdata.html>, French entries from the 2026-10-01 dump,
  extracted 2026-11-02. Each displayed entry links to its original Wiktionnaire page and history.
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
