# Design: 236 Round 59 layout rulings (316, 317, 319, 320)

## Problem

Round 59 ruled four layout guesses from wave 11: the log flow's 300 rail
gets a measure, the Desk's quiet pill takes the hairline edge, the feed's
confirm band stops bleeding past its column, and the phone backlog card
drops its separator where the conditions wrap.

## Approach

- **316 (#771).** `styles.css` already holds `--container-aside: 300px`
  in the MEASURE block, and that _is_ tokens.js's `--measure-aside`
  (Tailwind's container namespace is where every MEASURE lives: `rail`,
  `panel`, `column`, `page`). `DeskSplit`'s track reads
  `var(--container-aside)` as it reads `var(--container-column)`; no
  second copy. The block's quoted rule becomes R59's "rails and asides
  pin their width here or nowhere".
- **317 (#778).** `QUIET_PILL` (`ui/form.tsx`) drops `border-ink` for the
  secondary's edge, `border-hairline dark:border-hairline-2`; the Desk is
  the night ground, so `dark:` always applies there. `min-h-11` stays,
  matched to `CHALK_PILL`.
- **319 (#780).** `FlushBand` keeps its phone bleed; from 720 it is
  `wide:mx-0 wide:px-4`: its box on the content edge, its text padded 16.
  Feed's posts list has the same bleed (`wide:-mx-6`, with `PostCard`'s
  `wide:px-6` putting the text back): from 720 the list is `wide:mx-0` and
  the post `wide:px-0`, so the 8 tint band between posts spans the 620 and
  the text stays on the content edge.
- **320 (#781).** CSS can't see a wrap, so the dot is clipped instead: on a
  card the run cell holds both parts in a `flex flex-wrap overflow-hidden`
  line. The run ends in an invisible `" · "` spacer; the conditions carry
  a visible `" · "` positioned `right-full`, over that spacer. When the
  conditions wrap, the dot falls left of the line's start and the line's
  overflow clips it; the spacer left at line one's end is invisible. The
  desk keeps its own conditions cell (`hidden desk:table-cell`), and the
  card's copy is `desk:hidden`, so exactly one is in the accessibility tree
  at any width.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: A1–A3 at desk (DeskSplit), the Desk's action bars, Feed and G
  (the band, the posts), DS2's phone card. Design-deltas entries for each.

## Test plan

- `test/ui/desk-split.dom.test.tsx` (vitest ui): the track names
  `--container-aside`, never a px; `test/architecture` theme test, if one
  pins the MEASURE block, follows.
- `form` pill tests (vitest ui): QUIET_PILL's hairline edge, dark
  hairline-2, min-h-11 shared with CHALK_PILL.
- FlushBand / Feed / PostCard (vitest ui): `wide:mx-0 wide:px-4` on the
  band, `wide:mx-0` on the list, `wide:px-0` on the post; phone classes
  unchanged.
- VerdictBacklog (vitest ui): replace the R58·301 test: the line's
  wrapper clips, the spacer is invisible and unheard, the dot is
  `absolute right-full` and unheard, the desk cell is `hidden
desk:table-cell`, and the card's copy reads as the desk's. The clip
  itself only layout shows; the browser project loads no Tailwind, so
  the demo's phone spec measures it (dot outside the line once the
  conditions wrap) rather than a committed test.
- The safety pane tests that pinned `border-ink` on QUIET_PILL sites
  follow 317.

## Issues

- Closes: #771, #778, #780, #781.
- Opens: #833 (Design 333, filed by coordinator-14), deferred, not closed.

## Open questions

- GUESS (319): the posts list counts under "nothing bleeds past its
  column", so its tint bands stop at the 620 from 720. Coordinator-14 did
  not veto it; Design confirms it in #833 (Design 333), which stays open.
