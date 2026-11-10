import { version } from "../../package.json";

export const APP_VERSION = version;

/** Newest first. Update package.json and add an entry here for each release. */
export const RELEASES = [
  {
    version: APP_VERSION,
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
