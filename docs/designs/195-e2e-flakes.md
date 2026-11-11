# Design: 195 e2e flakes

## Problem

Three e2e specs failed once each on unrelated PRs and passed on re-run (#566),
and the a11y fixture never checks a state a spec only asserts on (#364, R-189).
Each flake has its own cause; two are races in the tests' ending, one is a
real bug in a screen, and one hid a real accessibility finding.

## Approach

**1. `focus-obscured` on `/closet/edit/:id`: the end checks ran before
hydration.** On the dev server `load` fires before the client code is
fetched, and `closet-edit.spec.ts` ends on an `expect` the server's HTML
already satisfies. When hydration lands, the router restores scroll to the
top, so the stop the Tab walk had just scrolled to is off screen when it is
measured. With the CPU throttled 6×, 3 of 40 runs had the scroll reset
inside the walk and those 3 reported `focus-obscured`; no other run did.
Fix (`e2e/support/a11y.ts`): the fixture waits for `html[data-hydrated]`
before it reads a test's final state. A document with no module script (the
fixture's probes) has nothing to wait for; an app page that never hydrates
is a checker error. Same sweep after: 0 of 40.

**2. `p-as-heading` on `/notifications`: a real finding on a state no spec
ends on.** M's spec held "Mark all read", then removed the route, which
releases the call. The list re-read itself while `finally` deleted the
rows; when the delete won, the test ended on the empty list, whose "Quiet"
is a paragraph drawn at title size. That shows on every visit to the empty
list. Fixes: the spec releases the call itself and waits for three read
rows; "Quiet" becomes an `<h2>`, as every other title-size line in the app
is; a new test in the M spec ends on the empty list.

**3. `corrections.spec.ts:122`, "It should say" read "": a bug in the
sheet.** `CorrectionSheet` copied the waiting correction into the field at
pick time, so a pick that beat the sheet's read of the product stayed
empty. Fix: the value is derived at render (`typed ?? sent?.value`).

**4. #364: check after a web-first `expect` that passed.** Not the cause of
any flake above. Every locator matcher ends in `Locator._expect`, so the
fixture wraps that one method, as it wraps the actions: no proxy, and
`.not`, `.soft` and `expect.configure` are covered. A failed matcher is not
checked; `expect.poll`, `toPass` and `toHaveURL` are not covered. `_expect`
is private, which is the cost of not proxying: the wrapper throws if it is
missing or its answer changes shape, and `a11y.spec.ts` pins the behaviour,
so a Playwright bump fails loudly. Checked after, not before: the asserted
state exists once the matcher passes. **Cost, measured** on the full
CI-style suite (dev server, fresh D1), hook off against on: 838 → 872
checked states, axe time 23.8 s → 25.1 s, wall 608 s → 610 s. No new
finding: most asserted states were already checked before an action.

Trap: a run with `A11Y_RECORD=1` rewrites `e2e/a11y-coverage.json` with its
own figure. Measure without it, or restore the file.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: M's empty state (S2b), heading semantics only; §AG's WRONG? sheet.

## Test plan

- dom: `correction-sheet.dom.test.tsx`, a field picked before the read fills
  once it lands; typed text survives the read, an emptied field included.
- dom: `notification-list.dom.test.tsx`, "Quiet" is a level-2 heading.
- e2e (fixture's own, `a11y.spec.ts`): an asserted-only state is checked and
  a failed expect is not; the end checks wait for a late hydration. Only a
  real browser runs the fixture.
- e2e (conformance, M spec): a test ending on S2b. Only the fixture can read
  the state, and no spec reached it.
- Each of the three specs `--repeat-each=20` on both servers.

## Issues

- Closes: #566, #364.
- Opens: anything the expect hook newly finds that this PR does not fix.

## Open questions

- "Quiet" as `<h2>` changes what a screen reader announces (a heading, same
  word), not the wording or the drawing. Proceeding; veto if S2b's
  "confirmed verbatim" was meant to cover the element.
