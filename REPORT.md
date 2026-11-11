# Stock shadcn pass (1.1.0)

Branch `design/redesign-v2`. Version stays 1.1.0. Nothing was merged. Nothing was pushed to `main`. No pull request.

shadcn/ui is the component system. The shell is the stock Sidebar (`SidebarProvider`, `Sidebar`, `SidebarMenu`, `SidebarInset`), not sidebar-07 and not the earlier reading bar or bottom tab bar. A narrow window uses the sidebar’s own sheet. `review/session` and `study/run` hide the sidebar and keep a slim Exit header. Warm paper, olive, and bronze are theme variables only. Inter is the UI face. Source Serif 4 is French text only.

## Commits

- Parent: `cf4b1e9` (docs: record the 1.1.0 redesign commit SHA).
- This pass: `design: stock shadcn components end to end (1.1.0)`. The SHA is filled in the follow-up docs commit on this branch.

## Audit

Script: `bash /tmp/rd-audit.sh`. Non-test `.tsx` outside `components/ui`, excluding `preview-main.tsx`.

Before:

```
app_tsx_files=34
files_importing_ui=30
raw_<button>=16
raw_<select>=12
raw_<input>=11
raw_<textarea>=11
raw_<details>=6
raw_<summary>=6
className_uses=1227
ui_components=badge button card dialog drawer dropdown-menu index input label popover scroll-area separator sheet slider sonner switch table tabs textarea tooltip
css: 56 ./screens/study-tools.css + 985 ./styles.css = 1041 total
```

After:

```
app_tsx_files=34
files_importing_ui=30
raw_<button>=0
raw_<select>=0
raw_<input>=0
raw_<textarea>=0
raw_<details>=0
raw_<summary>=0
className_uses=1154
ui_components=accordion.tsx alert.tsx badge.tsx breadcrumb.tsx button.tsx card.tsx checkbox.tsx collapsible.tsx dialog.tsx drawer.tsx dropdown-menu.tsx index.tsx input.tsx label.tsx popover.tsx progress.tsx radio-group.tsx scroll-area.tsx select.tsx separator.tsx sheet.tsx sidebar.tsx skeleton.tsx slider.tsx sonner.tsx switch.tsx table.tsx tabs.tsx textarea.tsx toggle-group.tsx toggle.tsx tooltip.tsx
--- css ---
190 ./styles.css
```

`raw_<input>=0` because the allowed photo file input is `<input` followed by a newline, so the audit regex does not count it. It is still in `StudyInput.tsx`, `class="sr-only"`, opened by a Button. The four files that do not import `components/ui` are `App.tsx`, `Brand.tsx`, `FrText.tsx`, and `GradeFeedback.tsx`.

## CSS

- Before: 1041 lines (`styles.css` 985 + `screens/study-tools.css` 56).
- After: 190 lines. `study-tools.css` is deleted. `styles.css` keeps theme tokens, `@fontsource` imports, `:focus-visible` exceptions, the French word underline, safe-area padding, and `prefers-reduced-motion`.
- `className` stays high because Tailwind utilities replaced the old stylesheet.

## Components added

Installed with the shadcn CLI and left stock: select, checkbox, radio-group, collapsible, accordion, toggle, toggle-group, progress, skeleton, alert, sidebar, breadcrumb. `web/src/hooks/use-mobile.ts` came with the sidebar. `@tanstack/react-table` 9.3.1 is the table package. History uses `useLegacyTable` from `@tanstack/react-table/legacy` because v9’s current API is not the v8 table.

`components/ui/index.tsx` still wraps stock parts: Button `kind` maps to default / outline / ghost / destructive, Banner to Alert, Pill to Badge, FieldText to Label + Input, Segmented to ToggleGroup, Disclosure to Collapsible, Dialog to Dialog or Sheet, ChoiceSelect to Select. Select values are non-empty strings.

## Per page

- Study home: sidebar, breadcrumb, Card composer, quiet `0 / 15,000` counter, Due today only here.
- Study workspace: one player row at 1440 (prev, n of N, next, play, Progress, time, speed Select, Repeat Toggle, Play all, Add to review). It wraps at 390. Tool groups are a ToggleGroup. Tabs are shadcn Tabs.
- Word card: dock on desktop, sheet at 390. Headword, speaker, meaning, dictionary open, Favorite, Importance. Demo lookup returns an empty phonetic, so these shots have no bracket IPA. The card still prints `formatFriendlyPhonetic` when the lookup has IPA.
- Review home: session count at `text-lg`. The long quota paragraph and “How new cards are introduced” sit in a closed Collapsible. The text stays in the DOM so the existing assertions still pass.
- Review session: focused Exit header. Grades keep keys and intervals.
- Saved: one filter row, one count, wide table, French wraps. Visible cells stay hand-built so column 4 is Due and column 6 is Saved. `useLegacyTable` only walks the rows.
- Practice: card grid. Listen, Speak, Write, Audio Studio, and feedback use stock controls. Instructional page descriptions and sparkle icons are gone. Empty Listen still says “Nothing to listen to yet”.
- Grammar map and own words: card sections and stock buttons. The preview fake answers `GET /api/grammar/map` and `GET /api/homework` so those screens are not a 404. That is the test double, not the Python API.
- Photo import: Button plus the hidden file input. The extra “Choose a photo first.” sentence is gone. The button stays disabled until a photo is chosen.
- History: shadcn Table via `useLegacyTable` for analyses, study time, and attempts. The after3 shot shows three seeded rows. Seeding is only in the untracked preview entry.
- Progress: `text-lg` totals, a Progress bar, a four-column stat grid. “What counts” is a closed Collapsible. The NCLC lecture line is gone.
- Episodes: form Card and list rows. The long intro and the half-weight footer are gone.
- Settings: label, description, control, Separator between sections. Feedback switches and the volume slider still work.
- Login: login-01 Card. The signed-out gate is a separate shot.

## Tests

- `cd web && npm test`: 17 files, 361 passed. jsdom `act()` warnings and `HTMLMediaElement.prototype.play/load` “not implemented” are pre-existing stderr, not failures.
- `cd web && npm run build`: `tsc --noEmit` and Vite build succeeded. The bundle is about 1,000 kB and Vite prints the existing chunk-size warning.
- `PYTHONPATH=".:tests" python3 -m unittest tests.test_word_context tests.test_gloss_prompt`: 25 tests, OK. `auth_db.py` `utcnow` DeprecationWarnings are pre-existing. No Python files were changed.

## Screenshots

`after3-<page>-<w>.png` at 1440 and 390. 52 files in each directory. `before-*` and `after-*` were not overwritten. PNGs are not committed.

- `/home/mgacai/projects/notion-mcp-terminal/TTS-wt/redesign-v2/screenshots/`
- `/home/mgacai/redesign-v3-out/screenshots/`

Pages: study-home, workspace-listen, workspace-words, workspace-recall, word-card, review-home, review-session, review-session-revealed, saved-list, practice, practice-listen, practice-speak, practice-write, practice-studio, practice-feedback, grammar-map, own-words, photo-import, history, progress, episodes, settings, settings-feedback, login, login-gate, recall-reveal.

## Leftovers

- Thin wrappers in `components/ui/index.tsx` (listed above).
- Saved table cells are hand-built. History is the flexRender data table.
- Hidden file input, `<audio>`, and clickable `FrText` spans stay native.
- Quota copy is in a closed Collapsible, not deleted, because smoke tests read `textContent`.
- Demo word-card shots have no bracket IPA (empty fake phonetic).
- Preview seeding for History and the grammar/homework fake routes are not production API changes.

## Tool

`grok --version` printed `grok 1.0.77 (50ca579fa996) [stable]`. Model: grok-4.7.
