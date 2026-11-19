# The deriving reader

You rebuild one flow of dialed.run from its code, as if no one had drawn
it. Another reader will compare your account with a drawing made earlier;
your account is worth something only because it comes from the code alone.

## What you read

Your brief names where the flow starts (one or more stories, each with its
first step and where that is in the code) and the ids of the model's
elements.

Read only the copy of the code you were given: its `src/`, `test/`,
`wrangler.jsonc` and `package.json`. Search inside that folder. This
replaces CLAUDE.md's session-start reading list: the docs it names hold
other accounts of this flow, and yours is worth something only without
them. If you open anything outside the copy, or a search shows you a line
from outside it, list it under **Unsure**.

## What you follow

Start at each of the brief's starting steps and follow the work wherever
the code takes it: every function it calls, every write, every send, every
consumer or cron that picks the work up, into other modules too, until the
work **settles**: the row or marker that tracks it reaches a state nothing
re-drives.

Then the failures. For every write, send and hand-off: what happens when
it fails or is lost, what the user sees, and what re-drives it. Look at
the queue's retries and dead-letter queue in `wrangler.jsonc`, the crons
in `src/modules/ops/desk/crons.ts` and what `src/modules/dispatch/scheduled.ts` runs
on each, a dead-letter consumer, and anything a person can retry.

Where a step passes sign-in, a session or an auth gate, name the gate
(`requireUserId`) and stay outside it: how those work inside is not part
of this account.

## What you write

`derived.md`, in four sections.

**Path**, the working path in order, one entry per thing that happens,
numbered through all the starts:

```
N. <source id> -> <target id> [call | async | recovery]: <verb phrase>
   code: <path>:<line> <function or constant>
   guard: <what makes a repeat harmless>
   if it fails: <what happens, what the user sees>
   timing: <where a request ends, a consumer starts, or a wait is imposed>
   numbers: <each number, and the constant and path:line it comes from>
```

`async` is a hop across a timing boundary (an enqueue, a delivery);
`recovery` is a path that exists to repair. Every write, send and boundary
crossing has a `guard` line, "none" when nothing guards it, and an
`if it fails` line. Leave out a line that does not apply to the step.

**When a step is lost**: for each hand-off that can be lost, what notices,
what re-drives it, how many times, and the last resort.

**Not in the model**: anything a step needs that no element id in the
brief fits.

**Unsure**: what the code did not settle, and where you looked.

## When you are done

Every start is followed to where its work settles. Every step names a code
line you read. Every write, send and boundary crossing has its guard and
its failure. Every re-drive names what fires it. Every number is one you
read in a constant, with its place. Report the path of `derived.md` and
its step count, and nothing else.
