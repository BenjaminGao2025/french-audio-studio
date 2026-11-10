# Study and review UI

Calm desktop study tool. The existing palette stays. The work is hierarchy, fewer type sizes, and one control style.

## Hierarchy

1. The French sentence, or the textarea on Study home, is the only large element.
2. Translations, meanings, and scores sit one step down (body or support).
3. Phonetics, part of speech, lookup counts, and keyboard hints are meta.
4. One action row. Primary is the next thing to do. Secondary and ghost share the same 44px height.

## What is hidden, and why

| Removed or collapsed | Why |
| --- | --- |
| Due today inside the sentence workspace and practice tabs | It belongs on Study home only, as one line plus Review today’s cards. |
| “The sentence is hidden…”, step-mode notices, daily-limit policy paragraphs | The control or the empty sentence already says this. |
| Example sentence and “Meaning of …” title on the word card | The word is the title. The sentence is already on the page. |
| Dictionary accordion | The definition is the second thing a learner looks for, so it stays open. Usage notes stay collapsed. |
| Grammar notes on a review card | Still there, inside a disclosure, so a long note does not compete with the sentence. |
| Scattered diff superscripts | The differing token stays highlighted. One note under the line names the difference. |
| “Saved to practice history” and the recorded-as paragraph | Correct / Not quite / Answer known is enough. The save still happens. A failed save still offers Retry. |
| Answer text after Try it now | The learner types from memory. The attempt stays answer-known. |

## Token table

Taken from `web/src/styles.css` and DESIGN_SYSTEM.md. No second palette.

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#f7f8fa` | Page background |
| `--surface` | `#ffffff` | Cards, popover, table |
| `--text` / `--text-2` | `#172033` / `#475569` | Body / meta |
| `--primary` / `--primary-hover` / `--primary-weak` | `#1d4ed8` / `#1e40af` / `#eef3ff` | Primary button, selected tab, pressed chip |
| `--divider` / `--border-strong` | `#e2e8f0` / `#64748b` | Card and table rules |
| `--success` / `--success-bg` | `#166534` / `#f0fdf4` | Correct glow only |
| `--warning` / `--warning-bg` | `#92400e` / `#fffbeb` | Answer-shown banner, accent diffs |
| `--error` / `--error-bg` | `#b91c1c` / `#fef2f2` | Failed save, not a game-over flash |
| `--s1` … `--s6` | 4, 8, 12, 16, 24, 32 | All spacing |
| `--r-control` / `--r-panel` | 8px / 12px | Buttons, chips, cards |
| `--shadow-pop` | existing soft shadow | Popover and praise chip only |
| `.t-meta` / `.t-support` / `.t-body` / `.t-section` / `.t-page` | 12 / 14 / 16 / 20 / 24 | The only sizes in restyled blocks |
| `.t-fr-lg` | 24 | French sentence and revealed answer |
| Buttons | primary, secondary, tertiary (ghost), destructive | min-height 44, radius 8 |
| `.page--wide` | 1120px | Study home, workspace, review, saved list |

Praise uses the success tokens: a check, a soft green ring, and at 10 in a row a 0.7s scale. `prefers-reduced-motion` removes the motion. Wrong answers get a quiet low tone and no shake.

## Per page

**Study home.** Textarea is the hero (min-height 240). Due today, Practise my own words, and My grammar map share one toolbar. Recall and Dictation sit side by side. Last-analysis title stays “Pick up where you left off?”.

**Sentence workspace.** Eight tabs in one row: Words, Grammar, Sounds, Steps, Say it, Recall, Dictation, Explain it. Player controls are one secondary-button row. Word chips share a grid and one underline. The French sentence card hides during Recall and Dictation so the target is not on screen; previous/next stays when there is more than one sentence.

**Word card.** Anchored popover on desktop (440px), sheet only under 640px. Header is word, speaker, `[prɔpɔze]`-style phonetics. Then the in-sentence meaning (labeled AI), then the dictionary. Footer: Favorite, Importance with a muted lookup count, Sentence grammar as a text link.

**Review session.** French plus Play and Slow 0.75× on one row. Translations are quieter. Fill-in comparison has no superscripts. POS, lemma, and friendly IPA are one meta line. Ratings 1–4 and Mark mastered share the footer. Keyboard 1–4 and Enter are unchanged.

**Saved list.** One count line. Search, mastered, importance, and favorites align on one toolbar. The table is full width with fixed columns so Due and Actions are not cut off. Meaning hides Han text at display time and does not rewrite stored cards.

**Feedback.** Settings → Practice feedback: Sound, Volume, Spoken praise, Animation, stored in `localStorage` key `frenchStudio.feedback`. A correct Recall, Dictation, typed Review check, Say it score of 70 or more, or a self-rating on a card with no typed answer plays a short chime. Three in a row raises the pitch. Five in a row speaks “Excellent !” through the existing TTS URL and falls back to the chime. Ten in a row adds the small scale. Nothing waits on audio before Next.
