# Design: 181 tracking restructure

> Brief drafted 2026-11-06 by coordinator-2 and approved by the owner the same
> day. "The owner's calls" at the end override anything earlier in this doc.

## Problem

An open item can live in any of seven places: `docs/deferred.md` (189 R-rows,
~87 open, conflicting on every wave: #350 and #352), the open queue inside the
5,338-line `docs/design-deltas.md` (with colliding numbers, lane 178's "114"),
the launch plans' checklists, design docs' "register changes" sections, Claude
memory (the 13 owner answers of 2026-11-06 exist only there), the "Plan vs.
Build" artifact, and GitHub Issues (6 issues, though `docs/agents/issue-tracker.md`
names them as the tracker). Owner questions get asked late, register passes are
large and conflict-prone, and the survey has to be reconciled by a subagent.

The goal: one place for every open thought, plan item, question and piece of
pending work, where anyone can see what's open, who it waits on and what stage
it blocks, and where closed work retires on its own.

## Approach

**A hybrid.** Open work (build items, design asks, owner questions, watch
items) becomes GitHub issues, with workflow state in one Project. Law and
history stay in the repo: `docs/decisions.md` (D-ids), `design/` and the
answered rounds of `design-deltas.md`, and procedures (`deployment.md` §5, the
deployment plan). `docs/deferred.md` is frozen as an archive; its closed rows
keep resolving the R-id citations in code, and each open row becomes an issue
titled `R-NN: …`.

| fact | where |
|---|---|
| area (closet, feed, safety, desk, auth, onboarding, shell, weather, ops, docs, infra) | label `area:*` |
| kind: build / decision / design-ask / owner-question / watch | label `kind:*` (issue types are org-only) |
| severity: launch-blocker / important / minor | label `sev:*` |
| stage: friends / public / soon-after-launch / post-v1 | milestone |
| status: Inbox → Needs owner → Needs Design → Ready → In lane → In PR → Done | Project field |
| lane / wave | Project field (text) |
| trigger ("when X happens") | issue body, first line |
| links (R-id, D-id, design item, board, PR) | issue body, plus `Closes #N` in PR bodies |

A wave or epic is a parent issue with sub-issues.

**The Project "dialed.run".** Views: *Waiting on me* (Needs owner, by
milestone), *Design batch* (Needs Design; each round's work order is generated
from it), *Board* (by status), *Friends gate* (milestone friends, not Done, by
area), *Roadmap* (by milestone). Workflows: add every new repo issue; item
closed → Done; PR merged → linked issues Done; archive Done after 14 days.

**Lifecycle.** Anyone files an issue with labels and milestone; status starts
at Inbox or straight at Needs owner / Needs Design / Ready. An owner answer is
a comment (plus a D-row if it's law), then Ready, or closed if cut. A Design
ruling is imported into `design/` and the round's section, commented on each
issue, and each moves on. Dispatch sets In lane; the PR carries `Closes #N`;
anything deferred becomes a new issue. Merge closes, and Done archives after
14 days. Duplicates close as GitHub's "duplicate of #N". The plan-survey flags
open issues whose trigger has passed or that have none, and friends items
still open after friends launch.

**For agents.** CLAUDE.md's "Stop means ask" points at Needs owner issues; the
`pr-ready` skill opens issues instead of deferred rows and requires `Closes #N`;
the design-doc template's register section becomes "issues this closes /
opens"; `issue-tracker.md` documents labels, milestones, Project and helper;
the `plan-survey` skill reads issues via `gh` and drops its patching step;
coordinator memory keeps process only. `scripts/track.ts` wraps the Project's
GraphQL (opaque field and option ids): `track status 123 needs-owner`, `track
lane 123 w3-dark`, `track list needs-design --json`. It zod-parses gh's JSON,
uses the user's `gh` auth, and refuses bodies matching never-list patterns
(emails, phone numbers, tokens) as a backstop to `.claude/rules/publishing.md`.

**Steps** (a stop is an owner approval, asked in the turn):
1. This doc, plus an inventory script: every open item across the surfaces as
   JSON with a source each; counts match a hand count of two surfaces.
2. The scheme, built empty: labels, milestones, Project, fields, views,
   workflows. **Stop.**
3. `scripts/track.ts`, tested against recorded gh JSON; round-trips one test
   issue's status.
4. Pilot of 5: an R-row, a survey orphan, a design-deltas open item, an owner
   answer (dark theme), a launch-plan item. **Stop** on the issue shape.
5. Bulk conversion by area in parallel subagents, each body ending `Migrated
   from <path>:<line>`, including the 13 owner answers (Ready or closed, D-rows
   where law). A publishing check runs first; misfits go to the owner as one
   batch (**stop**). Done when the re-run inventory finds an issue for every
   item.
6. Freeze `deferred.md`: archive header, "→ #N" on open rows, a test that no
   new R-id appears.
7. Trim `design-deltas.md`: the open queue becomes issues (numbers as title
   aliases) and a link to the Design batch view; rounds 47–49 imported.
8. Rewrite the instructions (above) and land `.claude/rules/publishing.md`.
   Done when "deferred.md" outside the archive is only historical.
9. Rework the survey to read issues; republish; its open counts equal the
   Project's.
10. Clean memory to process notes only.

**Risks.** A notification flood (~150 issues): offer to mute first. Lost
items: step 5 needs a one-to-one match. Field misuse: only the helper writes
fields. Rate limits: one creation script with backoff. Sensitive content:
`deferred.md` is already public, private notes stay in the private home, and
any unfixed-vulnerability row goes to the owner before posting.

## Contract touches

- Schema changes: **none**. Routes: **none**. Bindings/queues/crons: **none**.
- Screens: none. Outward-facing: labels, milestones, a Project and ~150 issues
  on the public repo (steps 2, 4 and 5 stop for the owner).

## Test plan

- `scripts/track.test.ts` (unit): zod parsing of recorded gh JSON, field and
  option id lookup, the never-list refusal. Whether `scripts/` is in the
  mutation ratchet decides Stryker, not whether it's tested.
- Inventory script (unit): each surface's extractor against a fixture.
- `test/architecture/` (text scan): no R-id in `deferred.md` beyond the frozen
  maximum.

## Open questions

- Creating a Project needs the `project` token scope, which the current `gh`
  login lacks; the owner runs `gh auth refresh -s project` at step 2.

## The owner's calls (2026-11-06)

1. **Hybrid.** Open work goes to GitHub Issues plus one Project. Decisions, the design record and runbooks stay in the repo, and `deferred.md` is frozen as an archive.
2. **Statuses as proposed:** Inbox, Needs owner, Needs Design, Ready, In lane, In PR, Done.
3. **Four milestones:** friends, public, soon-after-launch, post-v1.
4. **Lanes may open issues** within their scope without asking. Closing stays tied to merges.
5. **Launch plans are split.** Unchecked work items become issues; procedures stay in the plans, linking to them.
6. **The private home is a local folder outside every repo**, `~/dev/private/dialed.run/` (already created, with the Garmin agreement notes, the monetization notes and a README). Not a companion repo, and not `private/` inside the checkout. The restructure removes `private/` from the primary checkout and its `.git/info/exclude` line, after confirming the copies match, and the publishing rule names the folder.
7. **Timing:** this lands before wave 3 dispatches.
