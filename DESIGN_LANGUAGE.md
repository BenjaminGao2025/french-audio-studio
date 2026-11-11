# Design language

A calm study tool for an adult learning French. The page should feel like a book on a desk, not a dashboard and not a game.

## Principles

- French is the hero. On a learning surface the sentence is the largest type, set in Source Serif 4. UI chrome stays in Inter and stays quieter than the sentence.
- One primary action. Olive is for the thing the learner does next. Everything else is an outline or a text button, at the button’s own width. Only an explicit block button stretches.
- Calm feedback. Correct, wrong, and “look at this” use green, brick, and bronze. They are not the same hue as the primary button.
- Quiet chrome. The player, tabs, and filters are a second row. No helper paragraph in the sidebar. No second status chip saying what the banner already said.

## Tokens

Light mode only. `color-scheme: light`. Canvas `#f3efe6`, surface `#fbf8f2`, ink `#2a2622`, secondary text `#5c5348`. Primary olive `#2f4634`. Focus ring bronze `#8a5a2b`. Success `#1d6b45`, warning `#8a5a12`, error `#8f3b32`, info `#5c4630` on `#f1e6d4`. Neutral notices use the warm divider `#e3dacb`, not a cool gray. Radius 10px on controls, 14px on panels, 18px on sheets.

Do not put the olive on links, badges, focus, and success at once. Links are a dull teal `#3d5c56`. Empty stars and secondary labels use `#5c5348`.

## Type

- UI: Inter Variable (`--font`). Buttons, settings, tables, navigation.
- French only: Source Serif 4 Variable (`--font-fr`), via `.font-fr`, `.sentence-fr`, `.step-fr`, `.t-fr-lg`, `.saved-french`, `.saved-card-fr`, `.wp-headword`.
- Both faces are SIL Open Font License 1.1, self-hosted from `@fontsource-variable`. Do not load Google Fonts at runtime.
- Sentence size is `clamp(1.85rem, 3.4cqi, 2.5rem)`. Page titles stay at `1.25rem`.

## Components

shadcn/ui (radix-vega, Tailwind CSS v4) supplies Button, Tabs, Switch, Slider, and Tooltip. The app wrappers in `web/src/components/ui/index.tsx` keep the old call-site API: four button kinds, a visible disabled reason, and dialog focus restore.

The desktop word card is a dock column beside the sentence. Below 640px of the app container it becomes a sheet portaled to `#app-root`, above the bottom nav, with the shell marked inert. Saved sentences are a wrapping table at desktop width and a card list when the app is narrow. Container queries decide layout. Do not add a raw `600px` viewport breakpoint for these.

## Do not

- Default zinc sidebar plus blue primary.
- Cream and terracotta, or acid green on black.
- Full-width buttons that were not marked block.
- Middle-dot metadata strings on study and review chrome. One labeled fact, or a chip.
- A thick focus ring on a heading that was focused only to move the screen reader. Keep `:focus-visible` on real controls.
