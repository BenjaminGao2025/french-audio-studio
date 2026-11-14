import { version } from "../../package.json";

export const APP_VERSION = version;

/** Newest first. Update package.json and add an entry here for each release. */
export const RELEASES = [
  {
    version: APP_VERSION,
    date: "2026-11-14",
    changes: [
      "The word card's Forms table is tidier: even columns, one line under each row, a small highlight on the form in your sentence, and a note on what it shows.",
    ],
  },
  {
    version: "1.3.22",
    date: "2026-11-14",
    changes: [
      "Recall and Dictation read the French aloud once after a correct answer, right after the praise sound. Turn it off in Settings → Read correct answers aloud.",
      "Ask AI on a word card: a short question such as 啥意思 is now answered about that word, not the whole sentence.",
    ],
  },
  {
    version: "1.3.21",
    date: "2026-11-13",
    changes: [
      "The word card has a Forms table: tap tous and see tout, tous, toute and toutes, with the form in your sentence highlighted. Tap a form to hear it.",
      "Drag the bottom-right corner of the word card to make it bigger or smaller; it keeps that size next time. Double-click the corner to go back to the usual size.",
      "The word card is easier to scan: the meaning in this sentence sits in its own panel, and Word origin, Ask AI and Notes step back.",
    ],
  },
  {
    version: "1.3.20",
    date: "2026-11-13",
    changes: [
      "Drag the grip at the top of a word card to move it off the sentence; with the grip focused, the arrow keys move it too.",
    ],
  },
  {
    version: "1.3.19",
    date: "2026-11-13",
    changes: [
      "The player bar at the bottom glides smoothly instead of moving in small jumps.",
      "Continue with Google on the sign-in page, once Google sign-in is set up for this site.",
      "An account can have no device limit; Settings → Signed-in devices says so.",
    ],
  },
  {
    version: "1.3.18",
    date: "2026-11-13",
    changes: [
      "When a new version is live, an open window offers Reload, so you no longer need to quit and reopen the app.",
      "With large text, the collapsed sidebar shows just the logo, and Settings labels stay on one line.",
    ],
  },
  {
    version: "1.3.17",
    date: "2026-11-13",
    changes: [
      "A word tapped in a build-up step is explained in that step: “a” in “La loi a le droit” is “has”, not the letter A.",
      "When the meaning in the sentence can’t load, the card says so instead of showing a dictionary sense that may not fit.",
      "A wrong word marks only the letters that differ in red: activit[ies] → activit[és].",
    ],
  },
  {
    version: "1.3.16",
    date: "2026-11-13",
    changes: [
      "⌘ Enter (Ctrl Enter on Windows) sends the text: Analyse text in Study, and the main button in Write, Speak, Audio Studio, Explain, Ask and My own ideas.",
      "The first build-up step now says which French words are who, does what and what, for example “La loi: who. a: has. le droit: what.”",
    ],
  },
  {
    version: "1.3.15",
    date: "2026-11-13",
    changes: [
      "Study has a visible New text button at the top while you study a text.",
      "Build-up steps for a new analysis are small: each step adds a few words with a plain note, and a long sentence gets more steps.",
      "In Steps, the words a step adds stand out and the words you already met fade back.",
      "An answer the server has graded is never shown as “Checking didn’t finish”.",
    ],
  },
  {
    version: "1.3.14",
    date: "2026-11-13",
    changes: [
      "Settings → Text size makes the whole app larger on this device (115%, 130% or 145%), like an editor’s font size.",
      "Study is calmer: one More menu at the end of the player row, and no header row for a single sentence.",
      "Check yourself is calmer: a quieter Step by step / Whole sentence switch, only the step count, Review as a bookmark icon, and a right answer is no longer shown twice.",
      "A 100% answer now plays a short rising fanfare.",
      "Buttons show one focus ring instead of two.",
    ],
  },
  {
    version: "1.3.13",
    date: "2026-11-13",
    changes: [
      "A review card left open for more than an hour can be rated again; before, saving the rating kept failing.",
    ],
  },
  {
    version: "1.3.12",
    date: "2026-11-13",
    changes: [
      "Fill-in cards blank and highlight only the whole word: “ma” no longer cuts into “mais”.",
      "The importance stars sit closer together.",
    ],
  },
  {
    version: "1.3.11",
    date: "2026-11-13",
    changes: [
      "The word card and menus now stand out from the page: a lighter surface, a clear edge and a soft shadow.",
    ],
  },
  {
    version: "1.3.10",
    date: "2026-11-13",
    changes: [
      "The app now records which screens you use, for how long, and its main buttons, so it can be improved around how you study. This stays on our own server for 180 days and never includes what you type (see Privacy).",
    ],
  },
  {
    version: "1.3.9",
    date: "2026-11-13",
    changes: [
      "Tapping the same word again keeps its word card open.",
      "A dictation or recall answer with every word right gets a short celebration.",
      "Open in History goes straight to the analysis in Study.",
    ],
  },
  {
    version: "1.3.8",
    date: "2026-11-12",
    changes: [
      "Calmer Study page: one row for sentence navigation and More, quiet audio controls, Add to review as the main action.",
      "Clear two-level tabs, and compact icon actions on each step.",
      "The sidebar logo no longer touches the top edge.",
    ],
  },
  {
    version: "1.3.7",
    date: "2026-11-12",
    changes: [
      "Saving a word gives it 3 stars. Tap the stars to choose 2–5; every 5 more lookups add a star. Existing words were recalculated once from their lookups.",
      "Word card section titles stand out from their content.",
      "Add a note with ⌘ Enter (Ctrl Enter on Windows).",
    ],
  },
  {
    version: "1.3.6",
    date: "2026-11-12",
    changes: ["Steps and Step by step open first. Save individual steps for review.", "Compact word-by-word layout, phrase-specific context, and single audio playback.", "Answer checking splits words at punctuation, so a missing space cannot shift later words. The marks and score on screen now always match the saved result."],
  },
  {
    version: "1.3.5",
    date: "2026-11-12",
    changes: [
      "Importance uses five-point stars.",
      "Choose Simple English or 中文 for sentence explanations. Tap French words in explanations for nested lookup.",
      "Ask AI answers the question first, including English words in the translation.",
    ],
  },
  {
    version: "1.3.4",
    date: "2026-11-11",
    changes: ["Word-deck stars and Importance now agree. Lookups can automatically save words.", "Removed duplicate answer praise below the page."],
  },
  {
    version: "1.3.3",
    date: "2026-11-11",
    changes: [
      "Importance uses dots. Recall and Dictation results show a score and inline corrections.",
      "Deployment tests keep source checks when Node is unavailable.",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-11-11",
    changes: [
      "Install on iPhone Home Screen or in the Mac Dock. App bars and word cards respect safe areas.",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-11-11",
    changes: [
      "Removed the French character keyboard and Enter hint from Recall and Dictation.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-11-11",
    changes: [
      "Tap phonetics to hear pronunciation. Star a word to save it to your word deck.",
      "Word cards and review evaluations open with sentence meaning and Dictionary expanded.",
      "Typed answers show character differences. Type it again supports unlimited repetitions.",
      "Study home has a balanced grid and compact Listen cards.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-11",
    changes: [
      "History is easy to reach from Study home and Progress.",
      "The word-card reading column keeps normal page padding.",
      "The Listen review card is a balanced card.",
      "Practise without new text matches the other Study link cards.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-11",
    changes: [
      "The review session is a card. Progress sits in the header. Grades share one even row. Mark mastered, slow playback, and pause are in the card menu.",
      "Pages use a title, breadcrumbs, and cards. The word card opens over the sentence. Dictionary senses past the first two stay behind Show more.",
      "Empty states are a short title and at most one action. Instructional filler is gone.",
      "Sentence More is a labelled menu. On a phone the player is one row: previous, play, next, place, and more.",
      "Narrow pages keep a side gutter. The sentence player stays one row and moves speed, repeat, and play-all into More when the bar itself is narrow.",
      "Review shows the daily new-card numbers without the introduction explainer.",
      "Saved cards use the stock data table. Importance stays on one line. French still wraps.",
      "Streak is a card. Practice destinations are the cards themselves.",
      "The app now uses stock shadcn/ui: sidebar, buttons, forms, dialogs, tables, and toasts.",
      "Warm paper, olive, and bronze stay as theme colors. French text stays in Source Serif 4.",
      "Saved cards and History are data tables. Settings is a stacked form. The login screen is a card.",
      "Review grades still show their keys and intervals. Due today stays on the Study home only.",
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
