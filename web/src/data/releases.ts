import { version } from "../../package.json";

export const APP_VERSION = version;

/** Newest first. Update package.json and add an entry here for each release. */
export const RELEASES = [
  {
    version: APP_VERSION,
    date: "2026-11-10",
    changes: [
      "A new reading-app shell: a top bar on a wide screen, a bottom bar on a phone, and a paper page on a warm ground.",
      "Study home is a dashboard with a Start composer, a continue card, and Due today as structured facts.",
      "The French sentence is the center of the workspace. The eight tools sit in three groups: Understand, Listen & speak, and Check yourself.",
      "Review is a session dashboard, and the card session hides the main navigation. Grade buttons keep their keys and intervals.",
    ],
  },
  {
    version: "1.0.6",
    date: "2026-11-10",
    changes: [
      "Study, Review and Settings now use a calm reading theme: warm paper, olive actions, and a serif face for French sentences.",
      "French sentences are the large line on the workspace and in review. Player controls sit in a quiet toolbar.",
      "Saved cards wrap on a desktop table and become a card list on a phone. Word cards sit beside the sentence instead of covering the player.",
      "Practice feedback is a vertical list with a visible volume number. Grade buttons show an interval and a distinct weight.",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-11-10",
    changes: [
      "IPA is back to the friendly style, like [prɔpɔze], with brackets and no syllable dots.",
      "Word cards are a small panel next to the word: meaning in this sentence, dictionary shown, clear Favorite and Importance.",
      "A calmer, consistent layout across Study, Review and Saved; Due today only appears on the Study home.",
      "Words in revealed answers open the word card; Try it now lets you retry after showing the answer.",
      "Gentle sounds and streak praise for correct answers, adjustable in Settings → Practice feedback.",
    ],
  },
  {
    version: "1.0.4",
    date: "2026-11-09",
    changes: [
      "Dictionary now shows genuine French Wiktionnaire definitions, with source and contributor links.",
      "AI explains only the meaning in the current sentence; missing dictionary entries are no longer generated.",
      "Added inflected-word lookup with Lexique 3.83 and removed generated origin notes from word cards.",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-11-09",
    changes: [
      "Simplified word cards with a clear English meaning, a French example and expandable details.",
      "Removed Chinese explanations and added English roots and origin notes.",
      "Removed the inner scrollbar so each word popup has a single scroll area.",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-11-09",
    changes: [
      "Simplified Review to a single Saved cards table and removed the separate Word library view.",
      "Existing Word library links now open Saved cards.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-11-09",
    changes: [
      "Clicking a word on the front of a review card now opens its meaning and plays its pronunciation.",
      "Removed the French character shortcut buttons below the review answer field.",
      "Added a version number and update history to the app.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-09",
    changes: [
      "Introduced the new app for Study, Review, Practice, Progress and Settings.",
      "Added word meaning cards and pronunciation for clicked words and selected phrases.",
      "Improved review cards, saved words and step-by-step audio playback.",
      "Updated the app logo and home screen icons.",
    ],
  },
];
