# Task 113 — The design system port (sequential on main; adoption lane 1 of 4)

## Goal

Port `design/tokens.js` and `Theme.dc.html`'s T1 colour table into the app,
collapse the values that predate them, and make the result enforceable.

This is the lane that fixes the drift the whole adoption sequence exists for:
**93 arbitrary Tailwind values, 17 sites bypassing the `Mono` primitive, 10
rival letter-spacings, and 5 invented font sizes** (10/11/13/15/17px) that no
token names.

## Why it is first

Every other adoption lane's numbers come from here. Motion's travel distances
are spacing steps; accessibility's focus outline, 44px targets and 8px gaps
are token values; desktop's breakpoints and measures are `BREAKPOINT` and
`MEASURE`. Doing any of them first means writing raw px and rewriting it
immediately.

## You own

- `src/ui/tokens.css`, `src/styles.css`, `src/ui/ink.css`
- `src/ui/*.tsx` — every primitive
- `src/modules/*/components/*.tsx` — className only. **No behaviour changes.**
- `eslint.config.js` is a forbidden zone — the lint rule below needs the
  owner. Write it, propose it, do not land it yourself.

## The mechanism: Tailwind v4 `@theme`, not a parallel system

`src/styles.css` already maps brand tokens into Tailwind's theme with
`@theme inline`. Extend that rather than inventing anything:

```css
@theme inline {
  --text-body: 15px;
  --text-body--line-height: 1.5;
  --text-body--letter-spacing: 0em;
  /* … one block per TYPE step and per MONO step … */
  --spacing-3: 12px;
  --radius-card: 12px;
  --breakpoint-wide: 720px;
  --breakpoint-desk: 1040px;
}
```

**This is the point of the lane, so do not miss it.** Tailwind v4 pairs
`--text-<name>--line-height` and `--text-<name>--letter-spacing` with the
size, so a single `text-body` utility applies all three. That makes
`tokens.js` law 1 — *"tracking is a function of size, not context"* —
enforced by the framework instead of by review. It is also why `Mono`'s
hardcoded `tracking-[0.08em]` caused 17 bypasses: one primitive could only
ever carry one tracking, and the scale has four.

## Requirements

1. **The type scale.** Seven `TYPE` steps and four `MONO` steps from
   `design/tokens.js`, each as a `--text-*` triple. Mono steps carry their
   `transform` too (`xs`/`sm` are uppercase).
2. **`Mono` takes a step.** `<Mono step="sm">` rather than one hardcoded
   treatment, defaulting to the step the existing call sites actually want —
   check each of the 17, do not assume.
3. **Collapse the 93.** `tokens.js`'s `COLLAPSE` table says where each stray
   goes; it is authoritative and explicitly a correction, not a value to
   keep. Known specifics: `Wordmark.tsx`'s `text-[#8B8B93]` is a raw hex and
   becomes T1's `--muted`; `Marks.tsx`'s `rounded-[2px]` has no token
   (`RADIUS.tight` is 4) — raise it rather than inventing one.
4. **T1 colour, light values only.** All 15 semantic roles — `--ground`,
   `--panel`, `--ink`, `--muted`, `--quiet`, `--hairline`, `--hairline-2`,
   `--action`, `--failure`, `--cold-text`, `--dialed-text`, `--tint`,
   `--photo`, `--placeholder`, `--unread` — mapped through `@theme`.
   **The dark column is task 111 and out of scope**, but name the roles now:
   the renaming is the expensive half and doing it twice is worse. Today's
   five brand tokens stay as the raw palette T1's roles resolve to.
5. **Spacing, radius, breakpoints, measures** per `SPACE`, `RADIUS`,
   `BREAKPOINT`, `MEASURE`. Reconcile `Page.tsx`'s `max-w-xl`/`max-w-sm`
   against `MEASURE.column` (620) and `MEASURE.panel` (390) — they are close
   but not equal, and the token wins.
6. **A pin test, following `test/ui/icons.test.tsx` exactly.** `tokens.js` is
   untyped JS in a read-only archive, so it cannot be derived from — import
   it with `?raw`, parse it, and assert every ported step matches. That test
   is the thing that makes the next design round tell you what moved instead
   of letting it rot silently. CLAUDE.md §Derive-don't-mirror requires it.
7. **The lint rule**, written and proposed. `tokens.js` ships nine `LINT`
   entries, but they are CSS-declaration regexes (`font-size:\s*\d`) and our
   styling is Tailwind utilities in JSX — **the intent ports, the patterns do
   not.** What we need is a rule rejecting arbitrary-value utilities
   (`text-[…]`, `tracking-[…]`, `rounded-[…]`, `p-[…]`, `gap-[…]`,
   `min-w-[…]`) outside a narrow allowlist, plus raw hex anywhere. Model it
   on the existing rule that rejects new `requireUserId` copies.

## Out of scope

- The dark column (111), motion (114), accessibility (112), desktop (115).
- Any layout change. If a collapsed value visibly moves something, that is
  expected — a *reflow* is fine, a *redesign* is not.
- Landing the eslint rule yourself.

## Test expectations

- The pin test above, non-vacuous: assert the parse found the expected number
  of steps before asserting anything about them, the way the icons test
  asserts `declared.size > 70`.
- `src/ui/**/*.tsx` and `src/modules/**/*.tsx` are in the mutation ratchet at
  100% and must stay there. Stryker does not mutate a plain
  `className="…"` attribute, but it does mutate a class string held in a
  const — and this lane creates those. Expect real mutants.
- Existing component tests asserting `toHaveClass` on old values will fail by
  design. **Update them to the token, do not weaken them.** Where one asserted
  a documented rule (mono is the tell a value was measured; 1px→2px marks a
  field error), the rule still holds — only its spelling changes.

## Done criteria

- Zero arbitrary-value utilities outside the allowlist; zero raw hex outside
  `tokens.css`.
- The pin test passes and fails when a step is edited.
- The lint rule is written and in the PR for the owner to land.
- `npm run verify && npm test && npm run build` green; mutation score holds.
- **Demo video: yes.** Type, spacing and colour change on every screen. This
  is precisely the case CLAUDE.md names — a screen whose appearance changed
  behind unchanged behaviour is the demo worth watching.
