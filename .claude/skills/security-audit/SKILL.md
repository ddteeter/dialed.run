---
name: security-audit
description: Use when the owner asks for a whole-app security audit of dialed.run, a follow-up round on an audit's coverage gaps, or a re-check of an audit's findings after dependencies change. Covers pinning the code and the libraries, the reviewer workflow and its second pass, keeping findings in the private home, the index, and tracking by id.
---

# Security audit

Reviewers read the whole app at one pinned commit, each asking how its area
could be misused. A finding **counts** only when a second, independent
reader confirms it against the code. Every area leaves a coverage note, and
a gap check then lists what nobody read. The first audit was issue #693, on
2026-11-14.

**Nothing is run.** Reviewers are read-only in the repo: no dev server, no
tests, no installs. So every finding comes from reading, and each failing
test is a sketch in its finding file. Say so wherever you report results.

**Where findings go.** `.claude/rules/publishing.md` (never-list 3) and
`SECURITY.md`: an unfixed finding is described nowhere public. Everything
the audit writes goes to the private home, in one folder per audit. A
session that cannot see the private home stops and asks. The briefs for a
gap round describe unread, possibly weak code, so they are written at run
time and passed as `args`, never committed.

**Cost.** The first round ran 64 agents for about 90 minutes and used about
13.4M subagent tokens, enough to reach a weekly usage limit partway through
the round after it. Run a round only when the owner has asked for it, and
tell them the size before a second one.

## Steps

### 1 · Pin the code, the libraries and the output folder

```sh
git fetch origin main
SHA=$(git rev-parse origin/main)
git worktree add --detach .claude/worktrees/security-audit "$SHA"

LIBS="<your scratchpad>/libs-$SHA"
mkdir -p "$LIBS" && cd "$LIBS"
git -C <repo> show "$SHA":package.json > package.json
git -C <repo> show "$SHA":package-lock.json > package-lock.json
npm ci --ignore-scripts --no-audit --no-fund
```

- **The worktree** keeps every reviewer on one commit while main moves.
  Later rounds of the same audit stay on it, so every round describes the
  same code.
- **The clean install** is the only place reviewers read library source.
  The primary checkout's `node_modules` drifts behind the lockfile (18
  packages on 2026-11-14, Better Auth among them), and a finding that
  cites the wrong version has to be re-checked. The install takes seconds
  and runs no install scripts.
- **The output folder** is `security-audit-<date>/` in the private home,
  with `findings/`, `coverage/` and `scratch/`.

Done when the worktree's `HEAD` is `$SHA`, `npm ci` exited 0, and the three
folders exist.

### 2 · Set the briefs

**First round.** The script's `AREAS` holds the briefs: the ten areas of
#693, with authorisation split by module. Check them against the code
before launching:

- `git grep -c createServerFn "$SHA" -- 'src/modules/*/functions.ts'`.
  Re-split the authorisation briefs so no reviewer has more than about
  fifty server functions.
- Every path in a brief's `start` list exists at `$SHA`. Fix the ones that
  have moved.

**Gap round.** Group the items in `coverage/00-gaps.md` into at most twelve
briefs. Each names its files, with line ranges where only part was unread,
and the open questions, worded as questions. Pass them as `args.areas` with
`prefix: "r2-"` and `known: true`.

**Re-check.** When libraries changed under existing findings, list the
finding files that cite a changed package (`grep -l` in `findings/`), and
group them, at most eleven to a group, keeping write-ups of the same
problem together. Pass the groups as `args.rechecks` with `args.stale`.

### 3 · Check what the launching message gives away

The Workflow harness relays the owner's launching message, word for word,
to every agent. Anything it names, every reviewer has seen. If the owner
wants something kept from the reviewers (an earlier finding, to test their
independence) and the message names it, say so before launching and ask for
a launching message without it.

### 4 · Run it

````sh
awk '/^```js$/{f=1;next} /^```$/{f=0} f' .claude/skills/security-audit/workflow.md \
  > "<your scratchpad>/security-audit.workflow.js"
````

The file should start with `export const meta` and end with the script's
`return`. Call `Workflow` with `scriptPath` set to it and `args` as
`workflow.md` describes. It runs in the background: end the turn, and tell
the owner in a few lines what is running and under which rules.

### 5 · Check the run before believing it

Read the result from the task's output file with `jq`. Then:

- **Complete.** `missing_reviews` is empty, no area has `write_failures`,
  and `grep -L '^## Second pass' "$OUT"/findings/*.md` prints nothing.
- **Blind.** If something was withheld, search the run's transcript folder
  for a phrase from inside it. No transcript should hold one.
- **Independent.** Read `gaps.independence_problems`. A reviewer who read
  another's files is weaker evidence; say which findings that touches.
- **Sceptical.** Count the verdicts. The first round refuted none of 75
  write-ups, which is a sign the second pass may be soft. Report the
  counts, including a zero.
- **Low findings** had a batched second pass. Report that too.

### 6 · Write `INDEX.md`

Several areas find the same thing. Group the write-ups into distinct
findings and write `INDEX.md` in the audit folder:

- the limits on the results (nothing run, anything from step 5);
- one table per severity. A finding's severity is the highest any second
  pass gave it; name a disagreement, do not average it;
- each row lists its finding files by full name;
- the coverage notes, and what has not been done.

Done when every finding file is named in the index exactly once:

```sh
for f in "$OUT"/findings/*.md; do
  n=$(grep -c "$(basename "$f" .md)" "$OUT/INDEX.md" || true)
  [ "$n" = 1 ] || echo "$n times: $f"
done
```

### 7 · Decide on another round

`coverage/00-gaps.md` lists what nobody read. Read it to the owner by
weight, not by count, and ask whether to run a round on it (steps 2 to 6
again, with the gap briefs). A later round appends to the same `INDEX.md`:
new findings, and what changed in old ones ("bears on known findings").

When a gap shows a question the first-round briefs should have asked, add
it to `AREAS`, once any finding it led to is fixed.

### 8 · Track by id

Do this when the owner asks, after they have seen the index.

- **A draft item per finding in the private Project**, never an issue.
  Give each an id with a prefix no earlier audit used (`SA-H1`, `SA-M4`;
  one draft per area for the lows, `SA-L03`). The body gives the severity,
  the stage, the finding files' names and any correction the second pass
  made to the fix. `npm run track` has no draft command; use
  `gh project item-create` and set Status with `gh project item-edit`.
  Build each body with `jq -f`, not shell interpolation, and check
  afterwards that no draft's body is empty.
- **One public issue that lists the ids as a checklist and nothing else**
  (#756 is the pattern). File it with `npm run track -- create`. The ids
  show how many findings each severity has; tell the owner that when you
  file it.
- A fix lands as an ordinary PR whose text describes the change, not the
  gap, with its test. Then its id is ticked, and a one-line description
  may be added.

### 9 · Report, and clean up

Tell the owner: the counts by severity, each high finding in a sentence,
where reviewers disagreed, the limits from step 5, and what is not done.
Lead with anything that went wrong in the run.

When the audit's issue closes, remove the pinned worktree
(`git worktree remove .claude/worktrees/security-audit`).

## A run that is cut off

A usage limit or a stopped run leaves reviewers that wrote files and never
reported. Resume the same run (`Workflow` with `scriptPath` and
`resumeFromRunId`), adding the failed reviewers' keys as `args.cut_off`.
Finished agents replay from cache; a cut-off reviewer is told to treat any
file at its paths as unchecked work, to re-check it against the code, and
to keep, correct or delete it. A cut-off verifier just runs again.

## Files

- `workflow.md`: the workflow script, its `args`, and what it returns. The
  reviewer rules, the severity scale, the finding and coverage formats and
  every prompt are in the script, and only there.
