# Design: 036 UI unit testing

Spike, answered. Status: the `ui` project exists and `src/ui/form.tsx` is
at 85.42%. Whether `.tsx` joins the mutation ratchet is still D-42.

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
- **`ui`** — `environment: "jsdom"`, `@testing-library/react` +
  `user-event`, for component behaviour.

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

- **Does `.tsx` join the mutation ratchet?** Still D-42. Stryker does cope
  with the multi-project config (that was the other half of the spike), and
  `form.tsx` went 39.58% → **85.42%** on the strength of these 16 tests.
  The seven survivors left are all presentation: three Tailwind class
  strings, `cursor-default`/`cursor-pointer`, and two `visibility` literals
  where the mutant renders identically to the original. So ~85% is the
  honest ceiling for a component of this shape, and a `break: 100` ratchet
  would mean asserting class strings — which break on every redesign and
  catch nothing. A lower per-scope threshold, or a mutator exclusion for
  `StringLiteral` inside `className`, is the shape of the answer.
- **What migrates next?** `test/closet/components.test.tsx` builds its
  fixtures through drizzle against D1. A component that needs a database to
  test is a smell; those move to plain props as part of migrating it.
- Nothing about `src/ui` beyond `form.tsx` is covered yet. `Skeleton.tsx`
  (D-37) and the tab bar (D-31) are the next candidates, and both have open
  design rows already.
