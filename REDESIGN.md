# Redesign 1.1.0

A reading app, not an admin console. The 1.0.6 theme (warm paper, olive, bronze, Inter + Source Serif 4) stays. The current shell is the stock Sidebar in [Stock shadcn pass](#stock-shadcn-pass). The Navigation section below is the previous reading-bar pass.

## Navigation

Desktop (app container ≥ 900px):

- One horizontal reading bar. Brand on the left, five destinations as text in the bar, version and account on the right.
- No left rail. No second header under the bar.
- The bar sits on the warm ground. It does not paint a full-width white admin strip.

Mobile:

- Thin top bar: brand and account. Version stays as a small control when it fits.
- Bottom tab bar, same five destinations: Study, Review, Practice, Progress, Settings.
- Active tab is an olive label with a soft pill behind the icon. Padding uses `env(safe-area-inset-bottom)`.

Focused modes hide both the bar destinations and the bottom tabs. A slim strip remains: Exit, a short name, and progress when a count exists.

- `review/session` — Exit returns to Review. The strip shows card n of N.
- `study/run` — Exit returns to the Recall or Dictation launcher. The exercise owns the page.

Routes do not change. Modified clicks on nav links still follow the real `href`.

## The page

The app ground is a deeper warm tone than the sheet. Each screen is a centered paper sheet, not a full-bleed canvas beside a rail.

- Reading and study copy sit in about 40–48rem.
- Saved, the workspace with the word dock, and review lists may use a wider sheet so French is not squeezed.
- French uses Source Serif 4 and `overflow-wrap: anywhere`. Headings use `text-wrap: balance`.
- One filled olive button is the primary action on a screen. Other actions are outline, text, or inside More.

## Page inventory

| Route | Layout |
| --- | --- |
| `study/new`, `study` with no analysis | Study home dashboard. |
| `study` with sentences | Sentence workspace. |
| `study/personal` | Same sheet. Back to Study. Own-words practice unchanged. |
| `study/grammar` | Same sheet. Grammar map unchanged. |
| `study/photo` | Same sheet. Photo import unchanged. |
| `study/recall`, `study/dictation` | Launcher on the sheet. One primary Start. |
| `study/run` | Focused. Exercise only, plus Exit. |
| `review`, `review/due` | Review home: today’s counts, one Start review, then Saved and Mastered. |
| `review/session` | Focused card. |
| `review/saved`, `review/library` | Saved list. Filters, search, favorites, practice-from-selection stay. Wide table on desktop, cards when narrow. |
| `review/mastered` | Mastered list on the sheet. |
| `practice` | Studio grid of the six existing destinations. |
| `practice/listen`, `speak`, `write`, `studio` | Existing flows, sheet chrome, one primary in the flow. |
| `practice/episodes`, `practice/episodes/:id` | Readable episode list and the existing player. |
| `practice/exams` | Honest placeholder, same sheet. |
| `progress`, `progress/devices` | Journey number first, then the existing charts and lists. |
| `progress/history` | History on the sheet. Tabs stay. |
| `settings`, `settings/account` | Grouped sections. Practice feedback stays a vertical list with a visible volume number. |
| signed-out gate, `/login` | Centered paper card on the warm ground. |
| `design` | Token reference inside the new chrome. |
| `moved`, unknown | Short paper page, one primary. |

Due today (`StudyReviewNotice`) renders only on Study home.

## Study home

The Start composer is the object: a framed well, French (or an idea) in the textarea, photo import as a quieter action beside Analyse.

- Continue, when a saved analysis can be reopened, is a card under Start. It is not a banner paragraph.
- Due today is two labeled facts (cards, to revisit) and one secondary button. Not a middle-dot sentence.
- “Practise my own words” and “My grammar map” are the same quiet text buttons.
- Recall and Dictation sit under “Practise without new text”, closed until opened.
- If Analyse cannot run, the button stays and the reason is visible.

## Study workspace

The French sentence is the largest type on the page, larger than any title. Words stay clickable.

Directly under the sentence, one quiet toolbar: sentence n of N, previous / next, play, speed, repeat, play all. Add to review sits on that row as a secondary button. New text, history, and edit source live under More.

Tools sit in the region under the sentence. They do not share the sentence’s size.

Three groups, then the tabs of the open group. `study.tab` values do not change.

- Understand: Words, Grammar, Explain it
- Listen & speak: Sounds, Steps, Say it (`shadowing`)
- Check yourself: Recall, Dictation

The group control is a segmented choice. The inner tabs scroll sideways inside the group. Layout uses the app container, not a 600px viewport query. There is no eight-key keypad.

Each tool keeps its existing primary action (listen, make a practice card, record, check, test me). No new tools.

Recall and Dictation inside the workspace still hide the French sentence until the answer is revealed.

## Word card

Unchanged contract. First line is the word, the speaker, and bracket IPA such as `[tɔ̃be]`. Then the simple-English meaning in this sentence. The dictionary definition is visible. No example sentence and no full-sentence translation. Desktop is a dock beside the sentence, below the toolbar, so it does not cover the player. Narrow widths stay a sheet portaled above the bottom bar, with the shell inert.

## Review

Home (`review`, `review/due`): the session count is the figure. Learning, due, and new are separate facts. One primary: Start review (or Continue review when a session is open). Saved and Mastered are the other sections, still real routes. Quota sentences stay, because they explain a limit; they are not a joined status line.

Session (`review/session`): focused. The front is a card sized to its prompt, not an empty stage. One keyboard line (Space, R). After reveal: large French, then Again / Hard / Good / Easy. Each grade shows its key and its interval, with color weight from again toward easy. Intervals stay on the buttons; the hint line is not repeated above them.

Saved: one filter row, one count, French wraps, no nowrap ellipsis. Search, filters, favorites, and practice from a selection stay.

## Practice, Progress, Settings, sign-in

Practice landing is a two-column studio of the current destinations (one column when narrow). Listen, speak, write, studio, and episodes keep their flows inside the sheet.

Episodes are a list of French titles with separate facts (level, length, place), not one middle-dot dump.

Progress leads with the 1,000-hour figure, then the existing today / week / pace facts and the rest of the page. History matches the sheet.

Settings keeps Review, Playback, Practice feedback, Account, Devices, and Background listening as stacked groups. Feedback rows stay label plus control on one baseline. Volume shows the number.

The signed-out gate and the login form are one paper card, centered. No marketing paragraph.

## What does not change

SRS math, audio pipeline, auth, API payloads, IPA formatting, feedback sounds, keyboard shortcuts, `:focus-visible` (no ring on a route-change heading), `prefers-reduced-motion`, and every URL.

## Stock shadcn pass

shadcn/ui is the only component system. The earlier reading bar and bottom tab bar are retired.

Shell: the stock Sidebar block (`SidebarProvider`, `Sidebar`, `SidebarMenu`, `SidebarInset`), not the sidebar-07 team switcher. Five destinations map to one menu. On a narrow window the sidebar uses its own sheet. Focused modes (`review/session`, `study/run`) hide the sidebar and keep a slim Exit header inside the inset. Warm paper, olive, and bronze exist only as CSS variables (`--background`, `--primary`, `--sidebar`, and the rest). Inter is the UI face. Source Serif 4 is only for French.

Login is a login-01 card: label, input, and one primary button. Saved and History use `@tanstack/react-table` with the shadcn Table. Settings is stacked label-and-control sections separated by Separator. Practice landing is a card grid. Transient status uses Sonner. Persistent form errors stay inline Alerts.

Stock variants only: default, secondary, outline, ghost, link, and destructive when the action deletes or discards. No custom gradients, glows, or display numbers.
