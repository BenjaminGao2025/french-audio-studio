# Redesign 1.1.0

Version stays 1.1.0. The component system is stock shadcn/ui. Warm paper, olive, and bronze exist only as theme variables in `web/src/styles.css`. Inter is the UI face. Source Serif 4 is only for French.

## Shell

The shell is the stock Sidebar block: `SidebarProvider`, `Sidebar`, `SidebarMenu`, `SidebarInset`. It is not the sidebar-07 team switcher, and not the earlier reading bar or bottom tab bar.

- Five destinations, one menu: Study, Review, Practice, Progress, Settings.
- A narrow window uses the sidebar’s own sheet. There is no bottom tab bar.
- Focused modes (`review/session`, `study/run`) hide the sidebar and keep a slim Exit header in the inset.
- The account menu is a DropdownMenu. Transient notices use Sonner. Persistent errors stay inline Alerts.

Routes do not change. Modified clicks on nav links still follow the real `href`.

## Components

Call sites import stock pieces from their own files (`button`, `alert`, `badge`, `label`, `input`, `select`, `tabs`, `collapsible`, `toggle-group`, `table`, `card`, `dropdown-menu`). Variants are only default, secondary, outline, ghost, link, and destructive. Sizes are the stock sizes.

`web/src/components/ui/index.tsx` keeps app helpers that compose those parts: `DisabledReason`, `Spinner`, `Skeleton`, `PageHead`, `Dialog` (dialog or sheet, focus restore), `WordDock`, `Popover`, `Importance`, `Stat`, plus re-exports. The old thin wrappers are gone: Button `kind`, Banner, Pill, DemoNote, FieldText, Segmented, the custom Tabs wrapper, Disclosure, ChoiceSelect.

Buttons that cannot run stay focusable with `aria-disabled`, a visible reason, and a click guard. They do not use the native `disabled` attribute, because tests and keyboard focus depend on that.

## Copy

Labels, counts, and real errors stay. Empty states are a short title and at most one action. Instructional paragraphs are gone: listen’s “you can still…”, the saved-list sermon, “First introduction…”, the family-day lecture, and the devices essay.

These stay on purpose:

- Review quota sentences, including “How new cards are introduced”. Smoke tests read them from the DOM.
- Keyboard hints on review grades.
- Disabled reasons and save/load errors.
- The exam badge “questions not yet verified”.
- “Listening on the go” as a time-lane name in `web/src/api/time.ts`, not as page copy.

## Study

Study home is the Start composer plus Due today (`StudyReviewNotice`). Due today renders only here: Cards, To revisit, and one button.

The sentence page leads with the French sentence. Words stay clickable, including revealed answers.

More is an outline Button labelled “More”, with the MoreHorizontal icon. It opens a DropdownMenu: Analyses in History, New text, Edit source / Hide source. It is closed by default and does not stretch into an empty bar.

The player:

- Desktop (1440): one row. Previous, n of N, next, play, progress, time, speed, repeat, play all, add to review.
- Phone (390): one row. Previous, play, next, n/N, and a “More playback controls” menu for time, speed, repeat, play all, and add to review.

Tools stay in three groups, then the tabs of the open group. `study.tab` values do not change.

- Understand: Words, Grammar, Explain it
- Listen & speak: Sounds, Steps, Say it (`shadowing`)
- Check yourself: Recall, Dictation

Recall and Dictation inside the workspace still hide the French sentence until the answer is revealed.

## Word card

First line: word, speaker, bracket IPA such as `[tɔ̃be]` via `formatFriendlyPhonetic` (syllable dots removed). Then the simple-English meaning in this sentence. The dictionary is visible. No example sentence and no full-sentence translation.

Desktop is a dock beside the sentence, under the player. Narrow widths use a sheet. The preview lookup in `web/src/test/fakeBackend.ts` returns raw IPA (`failli` → `/fa.ji/` → `[faji]`, `tombé` → `/tɔ̃.be/` → `[tɔ̃be]`) so the card is not blank in screenshots. `madame` stays empty so the word-card test still uses the sentence IPA.

## Saved and History

Both use `@tanstack/react-table` 9.3.1 through `useLegacyTable` and `flexRender` from `@tanstack/react-table/legacy`, rendered with the shadcn Table. v9’s current export is not the v8 `useReactTable`.

Saved keeps one filter row, one count, favorites, and practice-from-selection. Row selection is a Checkbox column and appears only while selecting. French wraps (`whitespace-normal`). Other columns, including Importance, are `whitespace-nowrap`. Default sort is Saved descending. Narrow widths use a card list of the same rows.

## Practice and Progress

Practice destinations are cards. The whole card is the button. There is no full-width Open on those cards. History row Open buttons stay.

Progress leads with the 1,000-hour figure. Streak is a stock Card (`CardHeader`, `CardTitle`, `CardDescription`) above Level. Family day is the checkbox label plus today’s duration.

## What does not change

SRS math, audio pipeline, auth, API payloads, IPA formatting, feedback sounds (`web/src/lib/feedback.ts`) and the Settings feedback toggles, keyboard shortcuts, `:focus-visible`, `prefers-reduced-motion`, and every URL.

## Page inventory

| Route | Layout |
| --- | --- |
| `study/new`, `study` with no analysis | Study home. Composer and Due today. |
| `study` with sentences | Sentence workspace, More menu, player row. |
| `study/personal`, `study/grammar`, `study/photo` | Same inset. Own words, grammar map, photo import. |
| `study/recall`, `study/dictation` | Launcher. One primary Start. |
| `study/run` | Focused. Exercise plus Exit. |
| `review`, `review/due` | Review home. Counts, Start, quota collapsible. |
| `review/session` | Focused card. Grade keys and intervals. |
| `review/saved`, `review/library` | Saved data table. `review/library` opens Saved. |
| `review/mastered` | Mastered list. |
| `practice` | Card grid of the six destinations. |
| `practice/listen`, `speak`, `write`, `studio` | Existing flows. |
| `practice/episodes`, `practice/episodes/:id` | Episode list and player. |
| `practice/exams` | Placeholder. Badge says questions are not yet verified. |
| `progress` | Journey, streak card, today, week. |
| `progress/devices` | Title only. The counting essay is gone. |
| `progress/history` | History data tables. |
| `settings`, `settings/account` | Stacked label and control. Feedback toggles stay. |
| signed-out gate, `/login` | Centered card. |
| `design` | Token reference. |
| `moved`, unknown | Short page. |
