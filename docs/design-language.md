# Design language

The canon a builder needs to keep a new screen on-house. It is a **discipline aid, not a gate** — nothing here is enforced by reading this file. Consistency is bought by structure: the `<PageContainer>` primitive (`packages/ui/src/page-container.tsx`), the contrast gate `packages/ui/test/tokens.test.ts`, and the `/design-review` pass. This doc explains the shapes those mechanisms protect so the right thing is the obvious thing.

## Page measure + gutters

Every in-app route centers its content in a capped measure with the app's standard gutters. Compose `<PageContainer>` rather than hand-writing the wrapper:

- `measure="default"` → **768px** (`max-w-3xl`) — the standard body measure.
- `measure="prose"` → **672px** (`max-w-2xl`) with deeper top padding — the reading / empty-state / not-found measure.

Gutters are mobile **20px** (`px-5`) → desktop **32px** (`md:px-8`); vertical **32px** (`py-8`, or `py-12` on the prose tier). These live in one place inside the primitive, so a new screen gets the canonical measure by composing it — not by remembering a string.

The Activity Player carries its own full-height host (`h-dvh` flex column, single scroll region) and a two-tier measure keyed off the Part kind: text Parts use the 672px prose measure, media Parts (PDF / audio / video / embed) use the 768px measure, since WCAG 1.4.10 lists media as a reflow exception and a blanket prose cap crushes it. The player's title strip and footer share the active Part's measure and sit inside the same post-rail flow column as the body, so the three share a left edge for every Part kind — the offset from the 240px Part rail is structural, not a hand-synced literal.

## Type scale

- Base body is **13px** Inter (`packages/ui/src/styles.css` `body`), line-height 1.5. The whole app's text rhythm is built on this floor; it is AA-passing app-wide.
- **In-app page titles** are `font-serif text-[28px] text-[var(--color-ink)] leading-tight` at **weight 400** (the serif default — no weight utility). Source Serif 4 supplies the serif face. Every in-app route title (home, group, track, library, people, admin, the Activity Player) and the account stub follow this one shape.
- **Standalone landing heroes** are the deliberate exception: the sign-in screen and the invite-accept screen are full-screen surfaces outside the AppShell with their own hero scale (sign-in `font-semibold text-3xl`, invite `text-[22px]`). They are page heroes, not in-app page titles, so they intentionally do not follow the `text-[28px]` rule. New landing-style surfaces join this family; new in-app routes follow the page-title rule above.
- Sizes appear as arbitrary values, not named utilities: `text-[10px]`/`text-[11px]` for uppercase section labels and meta/mono counts, `text-[12px]`–`text-[13px]` for body. Weights used: 400, 500 (`font-medium`), 600 (`font-semibold`).

## Surfaces + elevation

- Near-white / near-black surfaces: `--color-bg` / `--color-surface` / `--color-surface-2` / `--color-surface-3`, with hairline `--color-rule` borders. The palette and its dark override live in `packages/ui/src/styles.css` `@theme`.
- **Elevation is surface + border, never box-shadow** — there is no `--shadow-*` token.
- **Three radii only**: `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 10px, plus literal `rounded-full` for pills and dots.
- One accent (`--color-accent`); status roles good / warn / danger each ship a `*-soft` background and a `*-border`. Every foreground clears WCAG 1.4.3 AA against every surface; `packages/ui/test/tokens.test.ts` fails `pnpm test` if a new token does not.

## Deliberate substitutions (plan → shipped → why)

The shipped app diverges from the design prototype / frontend-design plan in a few places. Each is consistent app-wide and intentional:

| Plan                                            | Shipped                                        | Why                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Instrument Serif display face                   | Source Serif 4 (`--font-serif`)                | A text-grade serif that reads cleanly at title sizes and has a full weight range; the display face was a flourish the calm layout did not need.                          |
| JetBrains Mono count face (`--font-mono` token) | Tailwind `font-mono` + `tabular-nums`          | No bespoke mono token ships; the platform mono stack with tabular figures aligns counts without a font dependency.                                                       |
| `--shadow-sm` / `--shadow-md` elevation tokens  | No shadow tokens; elevation = surface + border | Hairline rules over near-flat surfaces carry hierarchy without shadow; shadows read heavy against the muted palette.                                                     |
| Six-step radius scale (`xs`–`full`)             | Three radii (4 / 6 / 10) + `rounded-full`      | Three steps cover every surface; the extra steps produced indistinguishable corners.                                                                                     |
| 14–16px body base                               | 13px body base                                 | The intentional tighter rhythm of the calm layout; AA-passing app-wide.                                                                                                  |
| Custom date-time picker                         | Native `datetime-local`                        | The native control is the one browser-default spot kept on purpose: it gives free keyboard / locale / timezone accessibility that a custom picker would have to re-earn. |
