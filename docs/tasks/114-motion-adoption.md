# Task 114 — Motion Doctrine adoption (sequential on main; adoption lane 2 of 4)

## Goal

Build the moves in the Motion Doctrine's per-surface map. The doctrine landed
in round 3 and was ported cleanly; it is almost entirely unused.

## Why it is a lane now

`docs/design-deltas.md` open-queue item 2 has said since 2026-09-06 that this
is _"not a design ask — an implementation debt"_, to be adopted
_"opportunistically"_ and audited at the launch gate. Six lanes shipped under
that instruction and none adopted any of it. Measured:

- The doctrine defines **12 surfaces** (`SURFACES` in `design/motion.js`).
- `src/ui/motion.css` ports every variable — `--dur-instant/quick/move/
reveal/breathe`, `--ease-snap/exit/align`, `--travel-element`. **The port is
  complete and correct.**
- **Two files in the app consume motion**: `use-form-submit.ts` and
  `Skeleton.tsx`. Two files contain any `transition`, `animate-` or
  `@keyframes` at all: `motion.css` and `Skeleton.tsx`.

One correction to the delta's own wording, because it changes the work: it
says surfaces animate _"not at all or ad hoc."_ **There is no ad hoc** — zero
raw ms values, zero cubic-beziers anywhere in `src`. Nothing needs unpicking.
The moves are simply absent, so this lane is additive.

## You own

- `src/ui/*.tsx`, `src/ui/motion.css`
- `src/modules/*/components/*.tsx` — the animating surfaces only
- `e2e/**` — the demo specs that show the moves

## Requirements

### Already satisfied — verify and pin, do not rebuild

1. **Pending / loading** — brackets breathe, 1 → 0.35 opacity, 900ms loop.
   `Skeleton.tsx`. Confirm it holds still at full opacity under reduced
   motion rather than stopping at an arbitrary frame.
2. **Offline / error** — _"nothing. Deliberately static."_ Satisfied by doing
   nothing. Add a test that fails if someone animates a failure path later;
   the Form Contract already says nothing in the failure path animates.

### To build — nine v1 surfaces

Each entry is `surface → move, duration, easing` straight from `SURFACES`.
**Do not paraphrase the map; read it.**

3. **Tab switch** — no content transition; the active indicator slides under
   the label. `instant`, `snap`. Explicitly _not_ a crossfade: _"a crossfade
   would add 200ms to the most-used gesture in the app."_
4. **Log flow step** — step slides in from the trailing edge, previous slides
   out. `move`, `snap`. Direction carries which way you are travelling, so
   Back must reverse it.
5. **Verdict commit** — brackets close onto the chosen verdict, then the row
   locks. `reveal`, `align`. _"The single most important input in the
   product. The bracket closing is the receipt."_ Get this one right.
6. **Sheet / drawer** — travels from its own edge; exits on `ease-exit` at
   `quick`. Leaving is faster than arriving. `src/ui/Sheet.tsx` does not move
   today.
7. **Closet filter** — items reflow to new positions. **No fade, no
   re-enter** — _"the garments did not go anywhere."_
8. **Row press** — background flips to ink. `instant`, `snap`. **No scale** —
   _"scale-on-press is a spring in disguise and it makes crisp type
   shimmer."_
9. **Toast / banner** — enters from the top edge, holds, accelerates away.
   `quick`, `snap`.
10. **Numbers & temps** — mono digits roll vertically, never crossfade.
    `quick`, `snap`. Plex Mono is tabular, which is what makes the roll read
    as a meter.
11. **Retire a garment** — the row collapses its own height. No drift, no
    fade. `move`, `exit`.

### Binding constraints

- **The NEVER list.** No bounce, spring or overshoot; no spinners or skeleton
  shimmer; no scroll-driven motion; nothing over 400ms; no stagger except the
  dressing-order reveal (which is Call-epic, not this lane).
- **Nothing travels far.** 24px for an element, one bracket width for a
  frame; containers may travel their own height.
- **Reduced motion collapses to a 90ms opacity change, never to zero.**
  `motion.css` already does this at the variable level — verify each new move
  actually inherits it rather than hardcoding a duration.
- **Never a raw ms value or cubic-bezier.** Use the vars. This is already
  true of the codebase and must stay true.

## Out of scope

- **Recommendation reveal** — the dressing-order stagger. That is the Call
  epic's payoff and there is no Call in v1.
- Any surface not in the map. _"If a surface isn't on this list, it doesn't
  animate yet. Ask before inventing one."_
- Desktop's top-bar behaviour (task 115).

## Test expectations

- jsdom cannot observe an animation running. Assert what is _declarative_:
  the element carries the transition, the duration resolves to the right
  variable, the reduced-motion path collapses. Do not write a test that
  passes because a class string exists — that is the vacuous-assertion trap
  `docs/guardrails/crushing-mutants.md` warns about.
- Tab switch and row press are in the mutation ratchet via
  `src/ui/**/*.tsx`; expect mutants on any duration or easing held in a const.
- **Playwright is where the moves are actually visible.** The demo project
  already records with `reducedMotion: "no-preference"` deliberately, so the
  doctrine's real behaviour shows. Extend the existing feature demos rather
  than adding a motion demo — motion is not a feature.

## Done criteria

- All nine surfaces built; 1 and 2 pinned.
- No raw ms or cubic-bezier introduced; NEVER list clean.
- Reduced motion verified on every new move.
- `npm run verify && npm test && npm run build` green.
- **Demo video: yes, and it is the point.** Every existing feature demo now
  shows motion it did not have. Re-record them.
- Close open-queue item 2 in `docs/design-deltas.md` in the same PR.
