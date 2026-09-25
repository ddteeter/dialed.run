# Design: 122 Closet — C, F, edit, garment detail to rounds 21–23

## Problem

Garment detail, the closet grid and F were built before round 22 drew them.
Detail's order, its actions and its retire/delete have no confirm; the
closet is grouped where §6c.10 says one flat grid; F still carries the
product-link field AC2b forbids and has no photo well. This lane builds all
three to Round 22 `#y`, `#well` and rulings 16–17.

## Approach

- **Detail** (`GarmentDetail.tsx`): identity (← Closet, kicker
  `CATEGORY · SIZE` + `[RETIRED]`, name, colorway line with the hex square
  when known) → photo (the filled well only — *"no photo means no well
  here; adding one is Edit's job"*) → stats (`km logged · n/m dialed`, then
  `WORKS AT [range]`, `WORKED AT` when retired) → composition (§AG block +
  the attribute words) → pairs with (chips `NAME · n`, up to three by
  co-dialed count, absent under 3 runs; retired: absent) → actions (Edit,
  Retire pills; Delete a text link on the right; retired: Unretire +
  Delete).
- **Confirm sheets** (`GarmentConfirm.tsx`, on `ui/Sheet`): retire and
  delete, focus on Keep it, primary repeats the verb, `[ Retiring ]` while
  in flight, `ControlFailureBand` on failure. Unretire has no confirm.
- **Remove photo**: `removeItemPhoto` in `photos.ts` — one D1 write
  (`photo_key = null`, `visibility = 'ok'`, the no-photo state) **then**
  the R2 deletes. D1 first on purpose (law 8c), and since the owner's
  review the D1 batch also writes an `outbox` row owing the item's R2
  prefix a delete — see **Outbox** below. `removePhotoFn` is glue.
- **Outbox (owner review of PR #101)**: Remove, Replace and Delete each
  write their D1 change and a `photo_delete` outbox row in one
  `db.batch()`, then run the R2 cleanup as a fast path that deletes the
  row on success. A failed fast path never fails the runner's action; the
  daily digest drains what is left (`modules/ops/outbox.ts`). The handler
  reconciles the garment's prefix against its row — deletes everything
  the row does not name — so one kind covers all three, and a photo
  uploaded after a failed Remove survives the drain. New table `outbox`,
  additive migration `0019_add_outbox` (owner-approved).
- **Performance**: `PerformanceSummary.runCount`; pairs-with counts only
  dialed entries and carries its count. No schema change.
- **F / Edit** (`GarmentForm.tsx`): product-link field and its "pending"
  line removed; order identity → attributes (AH1) → Size → Colorway →
  photo well → submit. A picked photo goes through W3's step and is held
  with a local preview; the save uploads it after the row exists (or
  removes the stored one). Edit is F prefilled: "Edit {name}", Save.
  One `usePhotoPick` hook serves both detail's Replace and F's well.
- **Closet** (`ClosetGrid.tsx`): one flat grid (§6c.10), heading row
  `N pieces` + a `Show retired` switch, retired tiles last with
  `[RETIRED]` in the kicker and no dimming, the dashed Add tile last in
  the grid; empty state per ruling 16.

## Contract touches

- Schema changes: `retired_at` (0018) and the `outbox` table (0019), both
  additive and owner-approved.
- New route files: none. New bindings/queues/crons: **none** — the outbox
  drainer rides the existing daily-digest firing.
- Screens: Y (detail, 1040, retire confirm, retired), well, F, Edit, C.

## Test plan

- worker: `removeItemPhoto` clears the key and visibility, deletes every
  R2 object, is a no-op without a photo, refuses another runner's item;
  `summarizeByItem` run counts; co-dialed pairs.
- ui: detail order/sections/retired; both sheets (copy, focus, pending,
  failure band, run-count sentence); Remove; F order, no link field, the
  held photo uploaded or removed on save, refusal as a field error; the
  grid's flat order, count, switch, kicker, empty state, Add tile.
- e2e: conformance specs for detail (390, 1040), retire confirm and the
  empty closet; the closet demo extended.

## Open questions (proceeding on the first answer; owner may veto)

1. Board's delete sheet deletes a garment with runs; CLAUDE.md says retire,
   don't delete. Built: Delete on a garment with runs opens the retire
   sheet.
2. `[RETIRED SEP 12]` needs a `retired_at` column; built `[RETIRED]`.
3. Failure kickers (`Not retired`, `Not deleted`, `Still retired`,
   `Photo kept`) follow item 9's pattern but are not drawn.
4. §AH rule 08 said "no swatch" on the identity line; round 22 draws one.
   Built the round-22 square, shown only when a hex is known.
