# Task 112 — The accessibility contract (sequential, after the token lane)

## Goal

Make the app meet `design/Accessibility Contract.dc.html` — WCAG 2.2 AA,
delivered unrequested in round 9 and headed *"every lane / what each lane has
to test before a PR is done"*.

Most of it is already decided somewhere: colour-is-never-the-only-channel is
§AB and Form Contract §2, the reduced-motion collapse is the Motion
Doctrine's, the live-region rules are §AF. The contract's own framing is
*"the rules below are already half-stated across five files; this is the one
place they all are"*. **What is new is not the rules but the requirement to
meet and test them**, plus a handful we do not meet today.

## Why it is a lane and not a checklist item

It touches `src/ui/` and nearly every component under
`src/modules/*/components/`. So does the token lane, and so does motion
adoption. Three cross-cutting sweeps run as parallel worktrees would conflict
on every file — this is the same contention the schema protocol exists to
manage, with no equivalent protocol for components.

**Run it sequentially on main**, the way 106 was, and **after the token
lane**: the focus outline (2px, offset 2px), the 8px gap between adjacent hit
areas, and the 44px target padding are all token values, and writing them as
raw px now means rewriting them immediately after.

## You own

- `src/ui/` — every primitive.
- `src/modules/*/components/` — read-only for behaviour, edited for markup
  and focus/ARIA only. Do not change what a component does.
- `test/ui/**` and the `ui` vitest project.
- **Not** `src/routes/` beyond adding a heading where a screen has none, and
  **not** any server function, schema or migration.

## Requirements

Grouped by whether we already comply. **Measure before you build** — the
contract collects existing decisions, and several are already satisfied.

### Already decided; verify and pin with a test

1. **Colour is never the only channel.** Verdicts carry the three-slot
   position mark plus a word; errors carry border weight plus a hi-viz band;
   coverage is ink density. `src/ui/Marks.tsx` already implements §AB. Add
   the test that fails if a mark's meaning becomes hue-only again.
2. **Opacity never encodes meaning.** `Marks.tsx` retired `text-night/30`
   and says so in a comment. Pin it.
3. **Reduced motion collapses to a 90ms opacity change**, never to zero.
   Nothing loops except the breathing brackets, which hold still at full
   opacity under reduced motion. No parallax, no autoplay. `src/ui/motion.css`
   carries the vars; verify `Skeleton` honours the hold.

### Not met today — the actual work

4. **Hit areas.** Everything tappable gets 44×44, with 8px between adjacent
   targets, **padding the target rather than growing the glyph**. Tab bar
   items are 44 tall regardless of drawn height — `src/ui/TabBar.tsx` draws
   them shorter. The contract says "including 9px mono chips"; per the
   precedence rule those chips are `MONO.xs` (10px), padded to 44. See open
   queue item 10.
5. **Focus.** A 2px solid outline, offset 2px, in the text colour of the
   ground (ink on paper, paper on ink). Never removed, never replaced by a
   colour change alone. Pill buttons get a pill outline; everything else gets
   square corners. Focus order follows visual order.
6. **Headings.** `h2` when an element heads a group, plain text otherwise.
   Onboarding cards carry their own `h1` (§AE). **A screen with no heading is
   a bug** — audit all 33 routes.
7. **One live region per screen.** Failures, "Copied", "Saved" and W3's three
   face-sentences write to it. Success is silent unless the runner did
   something (§AF). `use-form-submit.ts` already owns the form half; the
   non-form cases (copy link, autosave, blur result) do not have a home.
8. **Disabled controls.** Dropping an element from the tab order hides why it
   is unavailable (Form Contract §5). The one exception is a control
   genuinely absent from the product state, which should not render at all.
   This is the same rule as the existing "never the `disabled` attribute on a
   submit button" — extend it past submit buttons.
9. **Text alternatives for the data marks.** Coverage bars, verdict marks,
   day strips, the three-slot mark and weighting bars each need a text
   alternative that says the whole thing in one sentence. Decorative
   placeholders and icons are `aria-hidden`. Note `CoverageMark` is
   *deliberately* `aria-hidden` today because every caller prints the level
   beside it — **verify that claim caller by caller** before adding a label,
   or you will produce "partial, partial".
10. **Contrast.** Body text 4.5:1; headline scale (≥24px Archivo Black) 3:1;
    text on any accent surface is ink. Check against T1's light values.

## Out of scope

- Dark mode (task 111). Check contrast against T1's light column only.
- Desktop (its own lane). The top bar's focus order is that lane's problem.
- Motion *adoption* — adding moves to surfaces that have none. This lane only
  guarantees that whatever animates respects reduced motion.
- Any behaviour change. If meeting the contract seems to require one, stop
  and ask.

## Test expectations

- Component-level assertions in the `ui` jsdom project (`*.dom.test.tsx`):
  focus outline present after `Tab`, heading level per component, live-region
  text after an action, `aria-hidden` on decorative marks.
- A route-level test that every route renders exactly one `h1`.
- Everything under `src/ui/**/*.tsx` and `src/modules/**/*.tsx` is already in
  the mutation ratchet at 100%. New markup needs assertions that *observe*
  it, not tests that merely execute it.
- **Open question for the owner:** an automated checker (`axe-core` /
  `jest-axe`) would cover 4, 5, 6 and 10 far better than hand-written
  assertions, but it is a new dev dependency and the stack is fixed. Worth a
  yes/no before the lane starts — if no, the assertions above are the
  fallback and the contrast check is manual.

## Done criteria

- Every requirement above either met, or listed in `docs/deferred.md` with
  the owner's agreement.
- `npm run verify && npm test && npm run build` green.
- No new `eslint-disable`, `@ts-expect-error`, `.skip` or `.only`.
- The PR body lists which of requirements 1–3 were already satisfied and are
  now pinned, versus which of 4–10 were built — a reviewer should not have to
  diff to find out.
- No demo video: nothing a user sees changes shape. Keyboard focus and screen
  reader output do change, and neither records usefully.
