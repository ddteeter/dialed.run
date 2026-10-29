# Design: 161 Held on upload and other sites (round 41 #84, #85)

## Problem

Round 41 answers open-queue items 45 and 46 (D-147). Review's row for a
photo held on upload gets a kinder tag, a reworded line, and a tile that
stands in for the removed original without showing it. The "where else to
go" line is reworded and moved to the bottom of the two `/takedown`
receipts. Text of record: `design/docs/product.md` § Round 41, items 84–85, and
§ Round 42's "84 · 85 follow-ups".

## Approach

Each step is one commit that passes the commit gate.

1. **Tag** (`ReviewQueue.tsx`). `[{row.source}]` becomes a label read from
   a `Record<ReviewSource, string>`, so `fingerprint` reads
   `[held on upload]` and the others are unchanged. Done when a dom test
   pins all three labels.
2. **Line** (`RemovedMatchLine` in `PhotoMatches.tsx`). "A close match to
   an image removed as intimate on {OCT 3}, {3 BITS} apart." At 0 bits:
   "The same image as one removed as intimate on {OCT 3}." Done when dom
   tests cover 0, 1 and 3 bits.
3. **`photo_id`** (additive migration `0072_add_removed_fingerprint_photo`).
   A nullable `removed_fingerprints.photo_id`, filled by `keptFingerprints`
   (each kit photo's id, from its `INSERT … SELECT`) and by
   `keptGarmentFingerprint` (the garment's id). Done when the worker tests
   read the id back after a Remove, for both a kit photo and a garment.
4. **REMOVED tiles**. A held-on-upload row reads every kept fingerprint
   within 8 bits, nearest first (round 42), each with the kept row's
   `photo_id` (falling back to the action's `subject_id`), the action's
   `subject_type`, and the owner's handle via `subject_owner_id`. The
   line names the nearest. In MATCHING PHOTOS the removed images are the
   first tiles. Each is an empty 1px `--hairline`
   frame reading REMOVED at the tile size, then its id (a garment's shown
   as "Garment …"), `{N} BITS · REMOVED {OCT 3}`, and `@owner` when there
   is a handle. It never shows an image, has no link and no takedown, and
   counts toward the heading's N. The uploader still sees only
   [CHECKING]; nothing changes on their side. Done when worker and dom
   tests cover the tile, the count, and an owner with no handle.
5. **Other sites** (`ElsewhereHelp.tsx`). The new wording, with both
   services as links that open in a new tab. Each link's accessible name
   ends "(opens in a new tab)" through a visually hidden span. The line
   is `text-small text-quiet`, with a `--hairline` above it and space
   before it. It goes last in the receipt body on the `/takedown` receipt
   and on `/takedown/confirm` DONE only, not on the already-decided state.
   It comes off W1's intimate reason; the way-out line stays. Done when
   the dom tests, the `targets-and-focus` entry and the takedown demo
   spec are updated.
6. **W1 receipt** (`ReportSheet.tsx`, round 42). For an intimate-image
   report only, a successful send swaps the sheet in place, with no
   toast: REPORT SENT, "Thanks for telling us.", "It's hidden from
   everyone now. We'll review it within a day and keep it down if it
   breaks the rule." (owner's wording, 2026-10-29), a hairline, the
   other-sites line, and Done (ink, 52). Focus goes to the head. Done or
   Esc close it, and focus then goes to the page heading: W1 opens from D
   and a profile, one subject each, so there is no next item. **Delta:**
   the board also lists the scrim, but `Sheet` closes on no scrim
   anywhere (DS5 rules out a desktop scrim), so W1 keeps that rule.
   Other reasons keep the "Report sent." status. Done when dom tests
   cover both branches and the focus moves.
7. **Docs**. Round 42 is imported and recorded in `docs/design-deltas.md`
   (done first, with this doc).

## Contract touches

- Schema: **one additive nullable column**, `removed_fingerprints.photo_id`
  (migration 0072, decided with Drew on 2026-10-28). It is additive, so
  the protocol says proceed. The `public-pages` branch also has a
  migration numbered 0071 that it must renumber; whichever branch merges
  second takes the next number.
- No new routes, bindings, queues or crons.
- Screens: D1 Review row (84), the `/takedown` receipt and confirm DONE
  (85), and W1's new intimate-image receipt (round 42).

## Test plan

- dom: the review row's tag labels; `RemovedMatchLine` at 0, 1 and 3 bits;
  the REMOVED tile (frame text, id, garment id, distance and date, owner
  and no owner, no `img`, no link, counted in the heading).
- dom: `ElsewhereHelp` wording, its accessible names and `target`; DONE
  shows it and decided does not; W1's intimate branch no longer shows it
  under the reason; W1's receipt (intimate only), Done, and focus.
- worker: `photo_id` kept for a kit photo and for a garment; the review
  queue returns the removed match's id, type and owner.
- e2e: the takedown demo spec asserts the new line.
- Mutation: touched-file Stryker reaches 100%.

## Open questions

None. Round 42 answered all three asks: W1's receipt is drawn, every
removal within 8 bits gets a tile, and inline links keep the built style.
