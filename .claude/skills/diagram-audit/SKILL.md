---
name: diagram-audit
description: Use when auditing a dialed.run flow's story in `docs/diagrams/` against the code — in a wave's docs pass, when `npm run diagrams:audit -- due` lists a flow, or when the owner asks for one. Covers choosing the flows, the deriving reader who rebuilds the flow from the code without the story, the comparing reader who rules on each difference, what counts as one, and filing each as an issue under an audit record.
---

# Diagram audit

A story in `docs/diagrams/flows/` is a claim about the code, and only its
names are tested: `diagram-sources.node.test.ts` checks that each source
comment still resolves, not that the step says what the code does. An
agent who answers `diagrams:stale` with "re-read, still holds" has just
changed the code and reads the story looking for agreement. An audit gets
a **fresh derivation** instead: one reader rebuilds the flow from the code
without seeing the story, a second compares the two accounts and rules on
each difference against the code, and each difference that holds becomes
an issue.

The audit changes nothing in the repo. Its output is issues; the fixes are
ordinary work for whoever picks them up (skill `architecture-diagrams`).

## 1 · Choose the flows

Work in a clean checkout at `origin/main` (the coordinator's primary
checkout, after `git merge --ff-only origin/main`), and note its SHA: the
audit is of that commit.

```sh
npm run diagrams:audit -- due
```

A flow (a file in `docs/diagrams/flows/`) is **due** when it has never
been audited, or when merged PR bodies answered one of its views "re-read"
under **Diagrams** in `DUE_AFTER_REREADS` or more PRs since its last audit
(`scripts/diagrams/audit.ts`). Each flow due comes with the exact title
of its record issue (step 6). Fix any record the report lists as
unreadable before you go on.

**An open record** means an audit that did not finish: resume it from the
step its comments reach, rather than starting another.

Audit the flows it lists as due, plus any the owner names. Take at most
four per run, since each costs two agents that read a module's worth of
code. The report lists the never-audited first, then the oldest audit, so
take from the top; the rest wait for the next run.

Done when you have a list of flow files and the SHA.

## 2 · Prepare each flow

Make a scratch folder per flow, outside the repo, holding the brief and a
copy of the code at the SHA:

```sh
dir=<scratchpad>/diagram-audit-<date>/<flow>
mkdir -p "$dir/code"
git archive HEAD src test wrangler.jsonc package.json | tar -x -C "$dir/code"
npm run -s diagrams:audit -- brief docs/diagrams/flows/<flow>.c4 > "$dir/brief.txt"
```

The copy holds no `docs/`, so a search in it cannot turn up the story's
source comments. The brief gives each story's title, its first step and
where that step is in the code, and the model's element ids. It gives no
recovery view, nothing past each first step, and no element's
description, since those are the story's claims too.

Done when `brief.txt` starts with `The flow starts at` and `code/src`
exists.

## 3 · The deriving reader

One fresh agent per flow (Agent tool, `general-purpose`), flows in
parallel. Its whole prompt is the lines below. Write nothing about the
story into it: no step, no guard, no suspicion of your own. An independent
account is the point, and a hint in the prompt makes it the story's
account again.

> You are the deriving reader of a diagram audit. Follow
> `.claude/skills/diagram-audit/derive.md`. Your brief is `<dir>/brief.txt`,
> the code is `<dir>/code/`; write `<dir>/derived.md`.

Done when every flow's `derived.md` exists and its reader has reported.

## 4 · The comparing reader

Only now write the story, so it was never beside the brief:

```sh
npm run -s diagrams:audit -- story docs/diagrams/flows/<flow>.c4 > "$dir/story.txt"
```

It holds every arrow of every view in the file, numbered per view, with
its frames, notes, source comment and link; the words each view gives its
elements; and the other flows' stories, which bound this one's scope.
Check it starts with `## `.

Then a second fresh agent, never the deriving one:

> You are the comparing reader of a diagram audit. Follow
> `.claude/skills/diagram-audit/compare.md`. The story is `<dir>/story.txt`,
> the derived account `<dir>/derived.md`, the code `<dir>/code/`. Write
> `<dir>/differences.md`.

Done when every flow's `differences.md` exists.

## 5 · Check each difference yourself

**A thin derivation is a re-run.** When `reader-missed` entries are more
than a third of the story's steps, or `derived.md` stops before the
story's last hand-off, run step 3 again once with a fresh reader, then
step 4. If it is thin again, say so in the record: the flow is hard to
derive from its code, which is a reason to split its story.

Then read `differences.md` and open every code line a difference cites.
The readers can both be wrong, and a ruling you file is yours. For each
difference: keep it, change its kind, severity or fix, or drop it, with
the reason. Hold a difference that turns on a number to the constant
itself.

**Already filed?** Search the open issues for each kept difference
(`gh issue list --state open --search "<view> in:title"`). Where one
matches, comment on it with what this audit found instead of filing again.

Route each one you keep:

- **A code bug that bears on security** is never public, whatever anyone
  approves (never-list item 3, `.claude/rules/publishing.md`). Write it up
  in the private home, add a draft item to the private Project, and tell
  the owner in the turn. It is not proposed for filing.
- **A difference about how sign-in, sessions or the auth gates work
  inside** is not filed and not drawn without the owner's answer. Stop and
  ask in the turn: what it is, why it may not be public, what you
  recommend. On "no", it goes to the private home.
- **Everything else is public.**

Neither the record nor its comments mention a private difference, not even
as a count.

Show the owner the public differences before filing: one line each, with
its kind, the view and step, and the fix. File what they pass. With none
to show, go straight to the record.

Done when every difference is kept, changed or dropped, the private ones
are routed, and the owner has seen the list.

## 6 · File the record, then the differences

**The record** comes first, even when nothing differs: it is what `due`
counts from. One issue per flow (`npm run track -- create`,
`docs/agents/issue-tracker.md`):

- the title `due` printed for it, exactly:
  `Diagram audit: docs/diagrams/flows/<flow>.c4 (<YYYY-MM-DD>)`;
- labels `area:docs`, `kind:watch`, `sev:minor`; no milestone, no status;
- body: `**Trigger:** none. A record.`, the SHA audited, the views, and
  `**Links:** design 229 · skill diagram-audit`.

**The story's differences are one issue per view** (owner, 2026-11-17):
one audit can find thirty, and one lane fixes a view's together. Each has
`--parent <record>`, the title `<view>: <n> differences with the code`,
and a body in the tracker's shape, one checklist line per difference:

```md
**Trigger:** none. Ready now.

What the audit of <flow>.c4 at <SHA> found in `<view>`. Fix each in the
story (skill `architecture-diagrams`), and tick it.

- [ ] **D<n>** `<kind>` · step <n> · <sev>. The story says "<quote>"; the
      code does <what>, at `<path>:<line>`. Fix: <what it should say>.

**Where:** docs/diagrams/flows/<flow>.c4
**Links:** #<record> · design 229
```

An element's words go under the view that draws it first. Its labels are
`area:docs`, `kind:build`, the highest severity in its list; status Ready.

**Each `code-suspect` is an issue of its own**, under the record, titled by
what the code gets wrong, with `**Why the story is the intent:** <the law,
rule, D-row or test>` from the comparing reader's ruling and `The code
does: … at <path>:<line>, at <SHA>`. Its labels are `kind:build`, the
severity as marked, and the `area:` the module's other issues carry (none
fits: ask); no status, so it lands in the owner's inbox. The view's story
issue names it in one line, since the story cannot be fixed past it.

No milestone: the stage is the owner's. Then close the record with a
comment listing the issues it filed and how many the comparing reader
counted as the deriving reader's misses, or "No differences."

Done when every flow has a closed record, every passed difference is a
line in its view's issue or an issue of its own, or a comment on the one
it matched.

## Report

To whoever asked: per flow, the record issue, the issues filed with their
kinds, the differences you dropped and why, whether anything was routed
private (in the turn only), and the deriving reader's misses.
