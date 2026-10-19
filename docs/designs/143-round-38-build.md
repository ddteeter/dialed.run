# Design: 143 Round 38's answers, built

## Problem

Round 38 (imported by PR "docs: import design round 38") answers design
deltas 60–65. Nine of its answers change the app. Three of them (61b–61d,
Settings › Privacy) block public launch. Everything else is a
copy or layout change the round confirmed as different from what we built.

## Approach

Ten small commits, launch blockers first. Each commit has its own tests
and passes the commit gate.

| #   | Item | What changes                                                                                                                                                                                                                                                                                     | Where                                                                                                      |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | 61b  | The Change sheet's title becomes "Privacy". U1's row value becomes "New runs shared · Counted in totals", or "private" / "Not counted" when those apply.                                                                                                                                         | `onboarding/components/PrivateRunLine.tsx`, `Settings.tsx` (gains `countInTotals` from its route's loader) |
| 2   | 61c  | The Privacy sub-page has two groups: NEW RUNS (the form and its Save), a `--hairline-2` rule, then ANONYMOUS TOTALS · SAVES AS YOU SWITCH outside the form. The totals switch is last in tab order. The sheet keeps only the totals group.                                                       | `SettingsSubPage.tsx`, `TotalsSwitch.tsx`                                                                  |
| 3   | 61d  | The totals switch takes `isVerified` and shows the unconfirmed runner's ON and OFF lines.                                                                                                                                                                                                        | `TotalsSwitch.tsx` and its two callers                                                                     |
| 4   | 64   | The confirmed runner's ON line becomes two sentences, and "block" comes out of OFF.                                                                                                                                                                                                              | `TotalsSwitch.tsx`                                                                                         |
| 5   | 64   | The closet tile's `[ONLY YOU]` becomes `[CHECKING]`, spoken "Being checked, other runners can't see this photo".                                                                                                                                                                                 | `closet/components/ClosetGrid.tsx`                                                                         |
| 6   | 60   | A `moved` rename carries the handle as it is now (`after.username`, already read). The sentence names it, and D1's row header re-reads to it.                                                                                                                                                    | `account/username.ts`, `safety/rename.ts`, `DeskRunners.tsx`, `ReviewQueue.tsx`                            |
| 7   | 62a  | "desk@dialed.run" becomes a `mailto:` link in the ban band. The status region's text stays the same.                                                                                                                                                                                             | `safety/components/AccountClosed.tsx`                                                                      |
| 8   | 62b  | One DIGEST NOT EMAILED line per skipped operator, named, between the three numbers and Gave up. **No schema change:** on a day `DIGEST_UNCONFIRMED` is marked, Today reads the operator list (`admins()`) and which of them are still unconfirmed, the same `confirmedOf` read the digest makes. | `ops/desk.ts`, `ops/components/Today.tsx`                                                                  |
| 9   | 63a  | The kicker counts the total, from a `count(*)` in the same batch, on the same index. Past 12 there's a "+ N MORE · OPEN @name IN RUNNERS" link to D8 filtered to the runner. The id moves to MONO.sm and is selectable. With none, the kicker has no count.                                      | `safety/other-photos.ts`, `OtherPhotos.tsx`                                                                |
| 10  | —    | Re-record the demos that show these screens. Mark 60–65 built in design-deltas.                                                                                                                                                                                                                  | `e2e/onboarding`, `e2e/desk`, `docs/design-deltas.md`                                                      |

**On 8's derivation:** an operator who confirms mid-day drops off the line
early, although they did miss that day's email. I think that's acceptable:
the line exists to send someone to confirm, and they have. Storing the
skipped ids instead would need an additive table.

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**. New routes: **none**.
- Screens: U1, the Privacy sub-page, A3's Change sheet, the closet tile, D8, D1,
  Au1/Au2, Today (D5), Review (D1). Design-delta items 60–64. 65 needs no change.
- Item 6 changes `ForcedRename`'s `moved` variant (account → safety). This is a
  type within the app, not a wire format.

## Test plan

Existing test files are extended where they exist; the names below are for
the behaviour, not final paths.

- `totals-switch.dom.test.tsx` (ui): the confirmed and unconfirmed ON and OFF
  lines; the line follows the saved state.
- `settings-sub-page.dom.test.tsx` (ui): two groups in order, the switch is
  outside the `<form>`, and it comes last in tab order.
- `settings.dom.test.tsx` (ui): U1's row value in all four combinations.
- `private-run-line.dom.test.tsx` (ui): the sheet is titled Privacy.
- `closet-grid.dom.test.tsx` (ui): `[CHECKING]` and its accessible name.
- `test/account/force-rename.test.ts` (worker): `moved` carries the current handle.
- `desk-runners.dom.test.tsx`, `review-queue.dom.test.tsx` (ui): the sentence and
  the re-read header.
- `test/ops/desk.test.ts` (worker): skipped operators by name; none on a day
  without the mark.
- `test/safety/other-photos.test.ts` (worker): the total past 12, and an EXPLAIN
  showing the count uses the index. `other-photos.dom.test.tsx`: "+ N MORE",
  the kicker with no count, MONO.sm.
- Everything touched stays at 100% under mutation testing. Demos re-recorded
  (`pr-demo-video`).

## Open questions

None left. Settled on 2026-10-18:

1. **62b's name** (design follow-up): "Today's digest wasn't sent to
   @{handle}. Their email address, {masked}, isn't confirmed." The name is
   the runner @handle and the mask is `email/landing.ts`'s. Commit 8 reads
   both with the same derivation, so there's still no schema change.
2. **A3's unconfirmed line** (design follow-up): round 27's line stays.
   "Confirm your email" becomes a link that opens the confirm-email sheet.
   This joins commit 3 (`PrivateRunLine.tsx`).
3. **Two PRs** (owner). PR 1 is the launch blockers: 61b–61d, 64's copy,
   `[CHECKING]` and the A3 link (commits 1–5). PR 2 is 60, 62 and 63
   (commits 6–9). Each re-records its own demos (commit 10).
