# Design: 215 The full-photo viewer (Design 249)

## Problem

Round 55 · 241 made A2's attached photo a 76 thumbnail beside an add box,
and said pressing it opens the full photo, but nothing drew the viewer.
Round 56 · 249 draws it (249.1), the add box (249.2), Remove in the
viewer's foot (249.3) and a 76 × 95 thumbnail (249.4). The closet's one
photo well stays as it is (249.5). This lane builds all of that for A2 (#659).

## Approach

- **`src/ui/PhotoViewer.tsx`** (new). A native `<dialog>` opened with
  `showModal()`, so Esc and Android's system back both arrive as the
  dialog's `cancel` (Chrome's close watcher) with no history entry of our
  own. Phone: full screen in `--ground`, a 56 head (MONO.xs
  "PHOTO 1 OF 2", the ✕ in its 44), the photo `object-contain` at its own
  ratio on `--tint`, and a scroll-snap row a thumb swipes (PhotoPager's
  idiom). The counter follows the scrolled photo. From `wide`: a centred
  panel at `max-w-column`, `rounded-sheet`, on `--panel` with a hairline
  and `--lift`, over the scrim, with 44 ← → pager arrows and ← → keys.
  Foot: "Remove photo" as `SECONDARY_PILL` (the hairline pill, D-186),
  full width on a phone and hugging at width, with no confirm.
- **`src/ui/PhotoRow.tsx`** (new). The thumbnails (76 × 95,
  `rounded-field`, `object-cover`, 8 apart at both widths), each a button
  that opens the viewer on its photo, then the add box last: the
  thumbnail's size, `--panel`, a hairline edge, "+" over ADD PHOTO in
  MONO.xs. It is a `<label>` around the `sr-only` input, as the well is,
  and it takes drops through `useFileDrop`. It leaves at
  `maxPhotosPerEntry`. The row owns focus. Closing the viewer returns
  focus to the thumbnail that opened it. A Remove sends it to the next
  thumbnail, else the one before, else the add box.
- **`AttachKit.tsx`** (after 8b and 8d merge). `useHeldPhoto` becomes a
  held list up to the cap. Each photo has its own idempotency key (law 8b)
  and is sent in order after the attach. A failure keeps the unsent
  photos held, with the message under the row. W3's blur step runs per
  pick, as now. The kicker "Outfit photo · optional" stays above the row.
- **`FileWell.tsx`**: no change in behaviour (249.5). If the add box's
  input repeats `WellInput`, I export the shared piece rather than copy it.
- The lift is today's `--lift` (`tokens.css`). Lane 9a (#652) may change
  its value or add a dark edge, and the viewer takes that change with no edit here.

## Contract touches

- Schema changes needed: **none** (the per-entry photo cap already exists).
- New route files: none. New bindings/queues/crons: **none**.
- Screens: A2 (the photo row and the viewer). Design-delta rows for
  R56·249.1–.4 come in coordinator-9's Round 56 import, not here.

## Test plan

- `test/ui/photo-viewer.dom.test.tsx` (vitest ui): the counter and its
  absence for one photo, the arrows and ← → keys, both ends of the row,
  Esc, ✕ and `cancel` closing, and Remove's callback and close.
- `test/ui/photo-row.dom.test.tsx` (vitest ui): the sizes and order, the
  add box at the cap, a pick or drop reaching `onFiles`, and focus after
  close and after Remove (next, previous, then the add box).
- `test/modules/attach-kit.dom.test.tsx` (extend): two photos held, both
  sent with distinct keys, and a failed second send keeps it held.
- `e2e/conformance/a2-attach.conformance.spec.ts` (extend). It is the
  only check that sees the real dialog's top layer, backdrop and
  focus at both widths. The demo is a throwaway spec.
- `run-logging.journey.spec.ts`: it is updated where it reads the old well.

## Issues

- Closes: #659.
- Opens: anything deferred (listed in the PR).

## Open questions (building on these guesses)

1. **A2 holds several photos.** "PHOTO 1 OF 2", "swipe between photos"
   and "leaves at the photo cap" read as up to `maxPhotosPerEntry` (4) on
   A2, where today it holds one.
2. **With no photo, A2 shows only the add box**, under the kicker, as the
   board draws it. The dashed well and its hint "Flat on the floor works
   best." leave A2. The hint is dropped unless Design says where it goes.
3. **Names.** A thumbnail's button is "Photo 1 of 2". The add box's name is
   "Add photo". The arrows are "Previous photo" and "Next photo".
