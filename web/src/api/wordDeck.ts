import { lookupKey } from "../lib/lookup";
import { announce, get } from "../state/store";
import { loadLibrary } from "./review";
import { clozeTarget, deleteSavedCard, saveNote } from "./srs";
import type { StudySentence } from "../data/fixtures";
import type { ApiWord } from "./study";

export const wordCards = (word: string) => get().cards.filter(c => (c.mode === "cloze" || c.mode === "recognize" || (!c.mode && c.kind === "Fill-in")) && lookupKey(c.word ?? "") === lookupKey(word));

export async function toggleWordDeck(word: string, sentence: StudySentence, details: Partial<ApiWord> = {}) {
  // Always resolve membership from the full library, including other sentence contexts.
  await loadLibrary();
  const cards = wordCards(word);
  if (cards.length) {
    for (const c of cards) await deleteSavedCard(c.id);
    announce("Word removed from your deck.");
  } else {
    const target = await clozeTarget({ fr: word, meaning: "", meaning_zh: "", lemma: word, type: "", ipa: "", why: "", english_link: "", false_friend: false, ...details });
    await saveNote({ sentence: sentence.fr, translation_en: sentence.raw?.translation_en || sentence.en, translation_zh: sentence.raw?.translation_zh ?? "", modes: [], targets: [target] });
    announce("Word saved to your deck.");
  }
}
