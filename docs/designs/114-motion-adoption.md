# Design: 114 Motion Doctrine adoption

## Problem

`design/motion.js` defines 12 surfaces; `src/ui/motion.css` ports every
variable; two files consume any of it. The product's moves are simply
absent, so every confirmation a runner gets today is a repaint. This lane
builds the v1 surfaces from the per-surface map — nothing more, and no
value that is not already in the port.

## Approach

`src/ui/motion.css` grows the moves as Tailwind `@utility` rules (including
`breathe`, converted from a hand-written class so it is registered in the
same index as everything else — D-78). Three of the nine need behaviour as
well as CSS, and those get one small unit each in `src/ui/`:

| #   | surface          | where                                    | move                                                                |
| --- | ---------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| 3   | Tab switch       | `ui/TabBar.tsx`, `feed/Feed.tsx`         | pink underline translates under the active label; content unchanged |
| 4   | Log flow step    | `ui/FlowStep.tsx` → A1/A2/A3             | enters from the trailing edge; Back reverses it                     |
| 5   | Verdict commit   | `feed/VerdictForm.tsx`                   | brackets converge on the chosen row, then the row locks             |
| 6   | Sheet / drawer   | `ui/Sheet.tsx`                           | travels from its own edge; exits faster, on `ease-exit`             |
| 7   | Closet filter    | `ui/use-list-motion.ts` → `ClosetGrid`   | FLIP: survivors travel to their new cells, no fade, no re-enter     |
| 8   | Row press        | `row-press` utility → 4 row lists        | background flips to ink; no scale                                   |
| 10  | Numbers & temps  | `ui/Digits.tsx` → `feed/EntryDetail.tsx` | the useful count rolls vertically                                   |
| 11  | Retire a garment | `ui/use-list-motion.ts` → `ClosetGrid`   | the row collapses its own height on `ease-exit`                     |

7 and 11 are one hook, not two, and that is a correction to the first
draft: the reflow's "before" has to be measured after the collapse has
finished and before the removal commits, so only something owning both
moments can get it right. Split, the survivors travel back to where they
were before the collapse and then forward again.

The active-indicator rule is the Desktop Contract's, not a measurement:
_"same active rule (pink underline, no crossfade — motion.js 'Tab switch'
applies unchanged)"_.

**Reduced motion is written per move, not inherited.** `motion.css`
collapses `quick`/`move`/`reveal` to 90ms at the variable level, but a
90ms translate is still a translate and the doctrine's rule is _"every
move collapses to a 90ms opacity change"_. Every utility that travels
therefore carries its own `prefers-reduced-motion` block that swaps the
transform for opacity, and the two JS moves branch on `matchMedia`.

Requirements 1 and 2 are verified, not rebuilt — except that verifying 1
found it wrong: `Skeleton` animates on Tailwind's `animate-pulse`, a 2s
loop on a foreign cubic-bezier that does not collapse under reduced motion
at all. It becomes `breathe`, the product's one waiting device.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: no new screens. Moves land on C, E1, D, A1–A3, G, notifications.
- `docs/design-deltas.md` open-queue **item 12** (not 2 — renumbered) closes;
  item **18** opens for the one undesigned surface this lane shipped (E1's
  segmented control keeps a static indicator).

## Test plan

- `test/ui/motion-css.dom.test.tsx` (unit) — reads `src/ui/motion.css` off disk
  and pins it against `design/motion.js`: every utility's duration and
  easing resolve to the var the map names, nothing carries a raw ms or
  cubic-bezier, and every travelling utility has a reduced-motion block
  that changes opacity and not transform.
- `test/ui/motion-surfaces.dom.test.tsx` (unit) — one case per surface:
  the element carries the move, and the indicator/bracket/row-state moves
  when the state does.
- `test/ui/list-motion.dom.test.tsx` (unit) — the hook against stubbed
  rects and a stubbed `animate`, both reduced-motion branches included.
- `test/architecture/failure-path-is-static.test.ts` (unit) — surface 2:
  the failure components carry no motion utility, so a later lane cannot
  animate one.
- Existing demos re-recorded; the closet demo gains a "Show retired"
  beat so the reflow and the collapse are on film.

## Open questions

1. **Surface 9, Toast / banner, is already answered — and the answer is
   no.** Round 4's §AF ("Feedback with nowhere to land") decides it:
   _"no toast, ever. The control that did the thing says what happened, in
   its own place, for a fixed hold."_ Its move is a 90ms opacity swap that
   reduced motion leaves alone. **v1 has no control that needs it** —
   nothing copies a link or leaves the device — so the row stays unbuilt
   rather than being given a home it does not have. Flagging it because
   the packet asked for nine and this is the one that is eight.
2. Surface 4 animates the entering step only. The outgoing step unmounts
   on navigation, and the only way to hold it is a root view transition,
   which the doctrine's own View Transitions note forbids (_"name only two
   things"_) and which would animate tab switches too.
