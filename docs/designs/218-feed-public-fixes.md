# Design: 218 Feed, profiles and public pages fixes

## Problem

The styling-audit re-run (#666) left built-wrong findings on the feed, the
profiles and the public pages (#701, seven findings) and on the legal pages
and `/open-source` (#702, four findings). Separately, D's photo row is out of
a keyboard's reach for a viewer who doesn't own the entry (#694, D-189). This
lane fixes all three. Before fixing each finding I confirm it against a fresh
capture (skill `styling-audit`). Any finding that is already right on main is
ticked in the PR with a note.

## Approach

Most of these are one mechanism. An inline `Mono` inside a block or flex
item takes the parent's body leading for its line box, not the mono step's.
So a 10–11px mono line stands about 24 tall (R2-FEED-02, -05, R2-LEGAL-09).
The fix is to make `Mono` the box that sets the line: its parent becomes a
flex container, so `Mono` is a blockified flex item with its own leading. No
new utility is needed.

| finding     | fix                                                                                                                                              | file                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| R2-FEED-01  | the placement span becomes `flex`, so the `--tint` tile's span is a sized flex item again                                                        | `feed/components/PublicProfile.tsx`             |
| R2-FEED-02  | the date link takes `target-line` (N2-01's 44 hit area that doesn't grow the box) in place of `target inline-flex`; the meta span becomes `flex` | `feed/components/RunRow.tsx`                    |
| R2-FEED-03  | "@" on the block line; "Block without reporting" centred at TYPE.body in a 44 row (214), via a `ConfirmLink` tone if one fits, else at the site  | `safety/components/ReportSheet.tsx`             |
| R2-FEED-04  | select `brand` and print `garmentLabel` (what G's `withBrand` prints)                                                                            | `closet/public-rotation.ts`                     |
| R2-FEED-05  | `dt` and `dd` become `flex`                                                                                                                      | `feed/components/PublicKit.tsx`                 |
| R2-FEED-06  | "since Nov 2026" is bound (no-break spaces), so a wrap moves "· SINCE NOV 2026" whole and never splits the date                                  | `feed/components/RunnerSearch.tsx`              |
| R2-FEED-07  | the body's gutter is the bar's: `px-5 wide:px-6`, and the page measure is matched to `SignedOutFrame`'s                                          | `feed/components/PublicFrame.tsx`               |
| #694        | D's row becomes a `ScrollRegion` "Photos" (`data-part="photo"` kept), holding the `ul`; `ScrollRegion` is exported from the `ui` barrel          | `feed/components/PhotoPager.tsx`, `ui/index.ts` |
| R2-LEGAL-05 | the frame's `header` takes `max-w-column`, like the article                                                                                      | `account/components/ReadingFrame.tsx`           |
| R2-LEGAL-02 | the "Contents" `nav` is not drawn when `contents` is empty                                                                                       | `account/components/ReadingFrame.tsx`           |
| R2-LEGAL-04 | the code's box takes the punctuation that touches it (the "(" before, the ")" or "." after) into one unbreakable run                             | `account/components/LegalPage.tsx`              |
| R2-LEGAL-09 | the `dt` becomes `flex`, so a wrapped label sets at MONO.xs's leading                                                                            | `account/components/LegalPage.tsx`              |

Ownership for this wave (coordinator-10, 2026-11-14): `modules/feed` and
the lane's routes, plus `ReportSheet.tsx`, `public-rotation.ts`, the three
`account` reading components, and the one-line `ui/index.ts` export, each
with its tests.

## Contract touches

- Schema changes needed: **none**. New route files: none. New bindings,
  queues or crons: none.
- Screens: `/@handle`, `/kit/:id`, G and H (`/feed/me`, `/feed/u/*`), W1's
  profile sheet, `/feed/search`, D, `/privacy`, `/terms`, `/copyright`,
  `/open-source`.

## Test plan

- ui (`*.dom.test.tsx`), on each component it changes. Each test asserts
  the class or structure a mutant would remove: the tile's placement is a
  flex box; the date link is `target-line`; the meta, stats `dt`/`dd` and
  label `dt` are flex boxes; the block line reads "@handle's"; the search
  meta line doesn't wrap; the public body's gutter matches the bar's; D's
  row is a region named "Photos" that takes focus and still turns pages;
  an empty contents list draws no nav; a code's touching brackets sit in its
  unbreakable run, and spaces don't.
- worker: `public-rotation` prints brand and model, and a piece with no
  brand prints its name alone.
- e2e: a non-owner opens a 2+ photo entry in the a11y conformance case
  (`feed-d.conformance.spec.ts`, extended), because only axe in a real
  browser sees `scrollable-region-focusable`. The safety journey's
  "@handle" assertion is updated, and the transcripts are re-recorded.
  Layout heights (60-tall rows, the 19px gap) are checked against a
  re-capture, not pinned in a test.

## Issues

- Closes: #701, #694, #702.
- Opens: anything deferred, listed in the PR.

## Open questions

- **Guess (coordinator):** R2-FEED-06 binds the date rather than keeping
  the line to one line. R55·217 is words only, and truncating "SINCE NOV
  20…" loses the fact the line is for. So a long count still wraps, as one
  whole phrase.
