# Pre-PR self-review

Run this before opening a PR, after `npm run verify && npm test` are green.

(For comments *received* on a PR, see CLAUDE.md §"Review comments are change
requests" — the default response to a review comment is a commit, not a
reply.)

The guardrails catch what a machine can catch. This list is the residue: the
findings from the four-lane review of PRs #2–#5 that no rule could have caught,
written as questions with a known-wrong answer. Every item here is something an
agent actually shipped, not something one might.

Answer each honestly against your own diff. "I looked and it's fine" is a pass.
Skipping the question is not.

---

## 1. Did you write down a fact the schema already knows?

The most common finding, by a wide margin. Look for:

- a `switch` on a discriminated-union tag that enumerates the same variants
  the union declares
- a `Record<Category, …>` or `CATEGORY_ORDER` array parallel to a zod enum
- a label/display map keyed by values that already exist in a contract
- a second copy of a constant with a comment explaining why it's a copy

A comment explaining the duplication is a **stronger** smell than an
unexplained one: it means you noticed and shipped it anyway. If the reason is
real (a client component must not import server code), the fix is to move the
shared thing to `lib/`, not to copy it. See CLAUDE.md §Derive, don't mirror.

## 2. Is this helper the fourth copy of itself?

Before writing a small utility in your module, grep for its shape across
`src/`. `requireUserId` reached four copies and three incompatible error types
before anyone read two of them side by side. Cheap check:

```sh
grep -rn "function <name>" src/
```

If a copy exists, either import it or — if it genuinely can't be imported —
say why in the PR description so a reviewer can rule on it.

## 3. Are you filtering in memory what SQL could filter?

Every `.filter()`, `.find()`, or `.some()` over query results is a candidate.
Two questions:

- Could a `WHERE` clause have done this? Then it should have.
- Is there a `LIMIT` upstream of the filter? If so this is a **correctness**
  bug, not a performance one — you are limiting before filtering, so the
  result is "survivors of the first N", not "the first N survivors".

Legitimate exception: `DIALED_CORE` and `DIALED_WEATHER` are separate D1
databases and cannot be joined. Comment it when that's the reason.

## 4. Do these writes need to land together?

D1 has no interactive transactions. A run of awaited `insert`/`update`
statements is not atomic, and a failure halfway through leaves a half-written
entity. If two or more writes must be all-or-nothing, they belong in one
`db.batch()`.

## 5. What happens on the second delivery?

Queues redeliver and crons re-fire; both are at-least-once. Re-read your
consumer and cron handlers as though they run twice concurrently on the same
row. Idempotency lives in the database — `UNIQUE`, `INSERT OR IGNORE`, a
status-claim `UPDATE` you check the row count of — never in a variable.

And: could a message enqueued by the *previous* deploy still be in flight? If
your change alters the message shape, it must still parse the old one.

## 6. Does a failure here reach a human?

For every new `catch`: does the error reach Sentry with enough context to act
on (userId, entity id, job id — never tokens or bodies)? When retries are
exhausted, does the user see their own failure, or does it vanish? A silent
permanent failure is a bug, not a degraded mode.

## 7. Is casing, wording, or formatting baked into a string?

`"INDOOR"` in a string literal becomes the accessible name; a screen reader
cannot tell a shouted word from an initialism. Uppercase belongs in CSS —
`<Bracketed>` already applies it. Same instinct for user-facing wording: if
the same sentence appears in two components, it will drift.

## 8. Did you touch a shared file?

`src/lib/`, `src/modules/auth/`, `src/ui/`, `src/db/` and `wrangler.jsonc`
belong to no lane. A change there is a change for all four. Flag it in the PR
description explicitly — schema and binding changes stop for review per
CLAUDE.md, and everything else at least needs to be visible.

## 9. Would a reviewer opening the app see a difference?

If yes, the demo spec must exist, pass, and be re-recorded onto the PR
(`pr-demo-video` skill). This includes a screen whose behaviour changed behind
an unchanged UI — swapping stubbed data for a real backend touches no `.tsx`
and is exactly the demo worth watching.

## 9a. Is anything waiting on an answer you never asked for?

A blocked item the owner has not actually been asked about is dropped, not
deferred. If your diff contains a "flagged for review" note, a
`docs/deferred.md` row marked `blocked`, or a review reply saying "this
stops here" — the question goes to them in the turn, with what you
recommend. See CLAUDE.md §Schema changes: stop means ask.

## 10. What did you leave undone?

Name it in the PR description **and add a row to `docs/deferred.md`**.
Deliberate omissions with a reason are fine; omissions a reviewer has to
discover are not, and neither is a deferral that exists only in a review
thread nobody will re-read.
