# The comparing reader

You hold two accounts of one flow of dialed.run against each other and
against the code. The **story** (`story.txt`) is the drawing in
`docs/diagrams/`, as LikeC4 computes it: every arrow of every view in the
flow's file, numbered per view, with its frames, notes, source comment and
the view it opens; then the words each view gives its elements; then the
other flows' stories. The **derived account** (`derived.md`) was written
from a copy of the code by a reader who never saw the story. Read the code
in the same copy, so both of you read one commit.

Neither account is the truth; the code is. Each can be wrong, so every
difference is settled by reading the code yourself.

## What you compare

**Walk the derived account first.** For each entry in its Path, When a step
is lost, and Not in the model, find the story's version. Then walk the
story for whatever is left: its steps, and the elements' words, which are
claims too (a `technology` line saying "at least once", a description
saying what marks the work owed). This order keeps the story from setting
the terms.

For each claim, compare: the step, its order, who acts on what, its guard,
its failure path and what the user sees, its re-drive, its timing
boundary, and each number. Where they differ, or one has what the other
lacks, open the code and rule.

**The story's scope** runs until the work it starts settles, or enters a
flow listed under "Other flows' stories". A derived step inside that scope
with no story step is `story-missing`, even past the story's last step;
one beyond it is out of scope, with the reason.

Each difference is one of:

- **`story-wrong`**: the story says something the code does not do.
- **`story-missing`**: the code does something within the story's scope
  that the story leaves out: a write, a hand-off, a guard, a failure path,
  a re-drive.
- **`cite-wrong`**: the claim holds, but its source comment points
  somewhere else than where the code does it.
- **`code-suspect`**: the story describes what the code is meant to do and
  the code falls short. It needs a reason the story's version is the
  intended one: a resilience law in the repo's `CLAUDE.md`, a rule in
  `docs/contracts.md`, a D-row in `docs/decisions.md`, or a test's name.
  Without one, it is `story-wrong`.
- **`reader-missed`**: the story is right, and the derived account is
  wrong or silent. Recorded and counted, never filed.

These are agreements, not differences: the same mechanism in other words,
and one story step standing for several calls, unless the merge hides a
write or a timing boundary.

Mark **private** a difference about how sign-in, sessions or the auth
gates work inside, or a `code-suspect` that bears on security. Write it as
fully as the rest; the auditor routes it.

**Severity.** `sev:important` for a guard, a number, a recovery path, a
write or a hand-off a reader would rely on; `sev:minor` for the rest.

## What you write

`differences.md`: one entry per difference.

```
### D<n> · <kind> · <view> step <n> · <sev:important | sev:minor>
Story: "<quote, or 'nothing'>"
Derived: "<quote, or 'nothing'>"
Code: <path>:<line> — <what it does, quoting the line>
Ruling: <which account the code bears out, in a sentence or two>
Fix: <what the story, its comment or the code should say>
Intent: <for code-suspect: the law, rule, D-row or test>
Private: <yes | no>
```

End with a summary: the count of each kind, how many story steps agreed
with no difference, and the derived steps you ruled out of scope.

## When you are done

Every story step and every element's words are agreed or in a difference.
Every entry of the derived account is matched, in a difference, or out of
scope with the reason. Every ruling quotes the code line it rests on.
Report the path of `differences.md` and the counts, and nothing else.
