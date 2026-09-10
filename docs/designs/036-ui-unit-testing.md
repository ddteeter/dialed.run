# Design: 036 UI unit testing

Spike, answered, and applied everywhere. **`src/ui` and
`src/modules/**/*.tsx` are at 100% and in the ratchet; every route is glue
and excluded.** D-42 is closed.

## Problem

The unit suite could not test a component's behaviour, only its first
paint. Every test ran in `@cloudflare/vitest-pool-workers`, which is
workerd and has no DOM, so component tests were `renderToString` — no
click, no state transition, no effect.

That left a named gap. CLAUDE.md's "Forms use the primitives, always"
contract is almost entirely interaction rules — never the `disabled`
attribute (it drops focus and stops announcing), `aria-disabled` +
`aria-busy` instead, the double-submit guard in the handler, error copy
from the schema, nothing in the failure path animating. **None of them had
a test that could reach them.** The only thing enforcing the contract was a
human reading a diff.

Playwright was doing real UI testing, and still is, but it is the wrong
instrument for this: it walks one path per journey, and it is single-worker
by design because every spec shares one dev server and one local D1 file
(D-28). A component's state space — each variant of a discriminated union,
each field's error, pending/failure/success, the retry path — cannot be
enumerated there at a sane cost.

The mutation numbers said the same thing from the other side: 1,484 mutants
across 47 `.tsx` files, and 28.57% on the four components that had tests at
all. Those mutants were not unasserted, they were unreachable from the
runner.

## Approach

Two vitest projects in one config, `test.projects`:

- **`worker`** — everything touching the platform (D1, R2, queues,
  bindings), unchanged, still `@cloudflare/vitest-pool-workers`.
- **`ui`** — `environment: "happy-dom"`, `@testing-library/react` +
  `user-event`, for component behaviour. happy-dom rather than jsdom
  because jsdom still does not implement `HTMLDialogElement.showModal` /
  `close` at 30.0.1, and `ui/Sheet.tsx` is built on the native `<dialog>`
  — so on jsdom the one primitive whose every line was uncovered stayed
  uncoverable.

A test opts into jsdom by being named `*.dom.test.tsx`. That is deliberate
over splitting by directory: files migrate one at a time, and which runtime
a test needs is visible in its filename rather than in this config.

The tests drive the real `useFormSubmit`, not a stand-in. The contract
lives in the hook, so a fake would only be testing the fake.

Two things this surfaced that the config had to absorb:

- `onUnhandledError` belongs at the **root** `test` block, not in a
  project. Vitest resolves unhandled errors against the root config, and
  the better-auth rejection filter silently stopped applying when it moved
  into the `worker` project.
- `tsconfig`'s `lib` gained `ES2024.Promise`, granularly. eslint's
  `unicorn/prefer-promise-with-resolvers` requires `Promise.withResolvers`
  and the ES2022 lib does not have it, so the two rules contradicted each
  other and the only other way out was a suppression. One API, not the
  whole ES2024 surface.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens implemented: **none** — no user-visible change, so no demo video
- New dev dependencies: `jsdom`, `@testing-library/react`,
  `@testing-library/user-event`, `@testing-library/jest-dom`. This is an
  addition to the fixed stack and was the owner's call.
- Human-managed files touched: `tsconfig.json` (the `lib` entry above)

## Test plan

`test/ui/form.dom.test.tsx`, 16 cases, every contract rule that had no test:

- the submit button is `aria-disabled`/`aria-busy` and never `disabled`,
  keeps focus and its accessible name through a submit, and carries neither
  attribute at rest
- three clicks start one submit; a fourth after it settles starts a second
- one field error announces then focuses the field; two announce then focus
  the summary; a summary row moves focus to its field
- an error clears on input, not on blur, and typing does not re-validate
- the mark is `data-invalid` plus a band, asserted as state rather than hue
- the hint disappears while the field is invalid and comes back
- the pending swap is `visibility`, so the button cannot change width
- the failure band announces, focuses retry, and retries the same values
- the failure band carries no animation class

**Every one was verified by breaking the source and watching it fail** —
swapping `aria-disabled` for `disabled`, deleting the `inFlight` guard,
adding a `clearField` on blur. That third one caught a bad test: the
clear-on-blur case was submitting an empty form, which focuses the
*summary*, so nothing ever blurred the field and the assertion passed
without testing anything.

## Open questions

- ~~**Does `.tsx` join the mutation ratchet?**~~ **Answered: yes, at 100%,
  with no lowered threshold and no exclusion.** `src/ui` went 65.09% →
  100%. My reading of `form.tsx`'s residue was wrong and worth recording as
  the mistake it was: I took the seven surviving class strings as
  representative and concluded ~85% was the ceiling. It is not, because
  **stryker does not mutate a plain `className="..."` JSX attribute at
  all** — only strings held in a const or built in an expression, of which
  there are 18 in the whole repo. And in `src/ui` every one of those
  carried a documented rule (mono is the tell a value was measured; the
  uppercase lives in CSS so the accessible name stays in normal case; a
  marked field goes 1px rule to 2px ink; pink is action), so asserting them
  is asserting the contract. The two genuine equivalents were removed
  structurally rather than granted.
- **What migrates next?** `src/modules/**/*.tsx` (471 mutants, 13 files),
  then `src/routes/**/*.tsx` (903 mutants, 24 files — 61% of the whole
  `.tsx` surface). `test/closet/components.test.tsx` builds its fixtures
  through drizzle against D1; a component that needs a database to test is
  a smell, and those move to plain props as part of migrating it.
- ~~**Are routes glue?**~~ **They are now, and it took work.** They were
  not: twelve of them held an `if`, a `.map()` or a JSX ternary, and one —
  `feed/photo.$.tsx` — held an entire server GET handler, visibility rule
  and all. The rule was widened to cover `src/routes/**/*.tsx` and to
  forbid a `.map(`, a JSX ternary and a JSX `&&`, and roughly a thousand
  lines moved into ten components and five plain functions. All 24 routes
  are excluded rather than the 21 that fail to import: the other three are
  route registration and `<head>` metadata, and their 54 mutants need the
  real generated router to reach.

  What that refactor found, which is the argument for it: **a denied
  location prompt left "attach the kit" on a skeleton forever** with no way
  through (the code comment claimed it degraded to the picker; it did not);
  **the per-entry photo cap did not count photos from the same selection**,
  so the server refused the extras and the runner saw a generic upload
  error; and **re-opening a verdict cleared per-item flags**, because the
  pickers were never seeded from what had been saved. All three lived in
  markup inside a route, where nothing could execute them.
