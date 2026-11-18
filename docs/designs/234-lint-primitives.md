# Design: 234 lint-primitives

## Problem

Shared primitives get re-typed by hand, and nothing catches it. A hand-typed
`[tag]` is read aloud (D-150, live on two Desk heads, #792), a hand copy of a
pill drifts from the ruled kinds (R58·308), and `font-mono text-mono-*` is
written out in 17 places. This lane fixes the sites and adds one
`no-restricted-syntax` selector per primitive, each landing at zero
(#792, #793, #794). The owner granted the `eslint.config.js` edit, limited
to these selectors and their `files` exemptions (#793, 2026-11-17).

## Approach

New selectors go in one composed array, `primitiveRestrictions`, which
joins every `src/**` block. The auth module's block skips the cross-lane
rules, but these still reach it. Each exemption is its own `files` block
that restates the other arrays (the replace trap at the top of the config).

- **Brackets → `Bracketed`** (#793.1). Flags a JSX text node with `[` or
  `]`, and a JSX template literal that starts with `[`.
  - Exempt: the bracket primitives `Bracketed`, `Wordmark`, `BracketHeadline`
    and `form.tsx` (`PendingWords`), and `VerdictForm` (the verdict scale's
    animated brackets). Also `EmailLayout` (react-email: no Tailwind, no
    `aria-hidden` reader) and `ops/og/cards.tsx` (satori, an image).
  - `Bracketed` gains `bare` (no `Mono` of its own) for `BandHistory`.
  - `BracketHeadline` moves to `src/ui` and gains a title step, for
    `NotificationList`'s "[ Quiet ]".
  - `RunnerSearch` uses `PendingLabel`.
- **Desk heads** (#792). `RowHead` and `RequestHead` draw the head
  `aria-hidden` and say it in one `sr-only` line, as `DeskForm`'s record
  head does (#787's spacing holds because the heard line is one text
  node). The tags render through `Bracketed`. The record head's own heard
  line said `[tag]` too, so it loses its brackets. `regionTag`'s `[TN]`
  was heard in `DeskAccess`, so `Bracketed` replaces it and the helper
  goes.
- **Pills → the pill constants** (#793.2, owner ruling on #793). Flags
  `rounded-pill` in a class string that is interactive (`target` or
  `cursor-pointer`), outside `form.tsx`. Chips, badges, avatars, dots and
  thumbs use `rounded-pill` as the only full-round radius, so they're
  outside the rule.
  - Ink copies move to `INK_PILL` and hairline copies to `SECONDARY_PILL`.
    Their padding, height and the 167.2 width rule change to the
    constant's. Every change is listed in design-deltas.
  - Exempt until #834 rules, with removal tracked in #835: the bar's 44
    pink pill, onboarding's small pills, Follow, the round icon buttons,
    and any site that matches no ruled kind. `google-button.tsx` is
    exempt for good (Google's spec).
- **Mono** (#794). `Mono.tsx` exports `MONO_CLASS` (the ramp as it stands,
  uppercase at xs/sm) and `MONO_CASED_CLASS` (the same sizes without the
  uppercase, for fields and mixed-case heads). `STEP_CLASS` derives from
  them. Links, buttons, inputs, paragraphs and every mixed-case head take
  a constant, since `Mono`'s xs and sm steps shout. The selector is `font-mono` in a class string outside
  `src/ui`, unprefixed only. A breakpoint switch (`desk:font-mono`, in
  `VerdictBacklog`) can't be a constant, so it stays.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: the Desk queue and removal heads (heard text only). Pill sites
  across the app change to their kind's padding and width (design-deltas,
  demo video).

## Test plan

- vitest `ui`: `Bracketed` `bare`, and `BracketHeadline` at the title step.
- vitest `ui`: the heard text of `RowHead` and `RequestHead` (no brackets,
  spaced). The CI e2e transcripts then confirm it in Chromium.
- vitest `ui`: `MONO_CLASS` and `MONO_CASED_CLASS` are pinned against
  `STEP_CLASS` (derive, don't mirror).
- vitest `node` (`test/architecture/`): each selector is fed a positive and
  a negative snippet through ESLint's API, so a regex that fails open
  fails the test.
- Full lint is at zero, plus the full `npm test`, the CI-style e2e, the
  build, and Stryker on every changed file.

## Issues

- Closes: #792, #793, #794, #818
- Opens: #835 (remove the pill exemptions; blocked by #834). Deferred:
  #834 (Design 334), #838 (Design 335).

## Open questions

- GUESS (#818 / #838): the Desk runner row's tags are 8 apart and wrap as
  wholes until desk (`desk:flex-nowrap`); below 720 a long tag may still
  break inside itself, as R58·276 holds. Design 335 settles where R60·327
  and 276 meet.

- GUESS: `VerdictForm`'s animated brackets stay a file exemption rather
  than a `Bracketed` mode. They're a motion device, not notation.
- GUESS: `BracketHeadline`'s title step keeps its 8px bracket margin, so
  "[ Quiet ]" gains about 2px a side.
