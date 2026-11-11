# Issue tracker: GitHub Issues and the dialed.run Project

**Open work lives here** (design 181): every build item, Design ask, owner
question and watch item is an issue on ddteeter/dialed.run, and its workflow
state lives in one Project, [dialed.run](https://github.com/users/ddteeter/projects/2).
Law and history stay in the repo: decisions in `docs/decisions.md`, the
design record in `design/` and `docs/design-deltas.md`, procedures in the
launch plans. `docs/deferred.md` is a frozen archive; its open rows point at
their issues.

Everything you write in an issue is public. `.claude/rules/publishing.md`
applies to every title, body and comment.

## Where each fact lives

| fact         | where                                                                                                                      | set with                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| area         | label `area:*`: closet, feed, safety, desk, auth, onboarding, shell, weather, ops, docs, infra, runs, legal, testing, a11y | `gh issue edit N --add-label area:feed` |
| kind         | label `kind:*`: build, decision, design-ask, owner-question, watch                                                         | `gh`                                    |
| severity     | label `sev:*`: launch-blocker (blocks its milestone's stage), important, minor                                             | `gh`                                    |
| stage        | milestone: friends, public, soon-after-launch, post-v1; none while unknown                                                 | `gh issue edit N --milestone friends`   |
| status       | Project field: Inbox, Needs owner, Needs Design, Ready, In lane, In PR, Done                                               | `npm run track -- status N ready`       |
| lane or wave | Project field Lane (text)                                                                                                  | `npm run track -- lane N w3-dark`       |
| trigger      | the body's first line, `**Trigger:** …`                                                                                    |                                         |
| links        | the body (R-, D-, design and board ids, PRs), and `Closes #N` in PR bodies                                                 |                                         |

Exactly one area, one kind and one severity label per issue. A wave or an
epic is a parent issue with sub-issues.

## Filing one

`npm run track -- create` files the issue, checks the title and body
against the never-list's patterns, and sets its status and lane:

```sh
npm run track -- create --title "R-74: the WRONG? link needs a corrections table" \
  --body-file body.md --label area:closet --label kind:build --label sev:important \
  --milestone friends --status ready [--lane w3-x] [--parent 361]
```

The body's shape (see #358 for an example):

```md
**Trigger:** none. Ready now. | the next Design round. | <when to pick it up>

What's wrong or missing, where, and why it matters. Facts from the source.

**Owner's call (YYYY-MM-DD):** … (only when one applies)
**The ask:** … (design asks and owner questions)
**Where:** files
**Links:** R-74 · D-163 · R48·129 · #277
```

- **A title** leads with its alias when it has one (`R-74: …`, `Design 139: …`).
- **A lane may open issues within its own scope** without asking (owner,
  2026-11-06). Closing stays tied to merges: the PR body's `Closes #N`.
- **Stage unknown:** leave the milestone empty and the status unset (the
  inbox). Never guess a stage.
- **Status:** a `kind:owner-question` is Needs owner, a `kind:design-ask` is
  Needs Design, and anything decided and buildable is Ready.

## Filing one on the web (people, not agents)

A person on github.com picks one of three issue forms
(`.github/ISSUE_TEMPLATE/`, design 196): **Bug or build item**, **Owner
question** or **Design ask**. Blank issues are off, and the chooser's
**Report a security problem** link goes to GitHub's private vulnerability
reporting (`SECURITY.md`), so an unfixed hole is never described in a
public issue.

- A form asks for the same fields as the body above, presets its `kind:`
  label and adds the issue to the Project. It renders each field under a
  `###` heading, not as the `**Trigger:**` lines `track create` writes.
  Both are fine; don't rewrite one into the other.
- A form cannot set the area or severity label, the milestone or the
  status. Whoever triages the issue adds them.
- GitHub adds the issue to the Project only when its author can write to
  the Project. Anyone else's lands outside it: add it with
  `npm run track -- status N <status>`.
- `track create` goes through the API, which ignores the forms and the
  blank-issue setting. Agents keep using it.

## The lifecycle

- **Owner questions:** an issue in Needs owner (the _Waiting on me_ view).
  Ask in the turn too (CLAUDE.md, "Stop means ask"). The answer is a comment
  on the issue, plus a D-row if it is law. The issue then moves to Ready, or
  closes if the answer was a cut.
- **Design asks:** an issue in Needs Design (the _Design batch_ view). Each
  round's work order is written from it. The ruling is commented on each
  issue, and the issue moves on (skill `coordinating-a-wave`).
- **Work:** dispatch sets In lane and Lane. Linking a PR sets In PR; merging
  it closes the issue and sets Done. Done items archive after 14 days.
- **Duplicates:** close as a duplicate of the other issue.
- **Private items:** a work item the owner keeps out of public is a draft
  item in the private Project, never an issue (`.claude/rules/publishing.md`).

## The helper, `npm run track`

Only the helper writes Project fields, because they sit behind opaque
GraphQL ids. It uses your own `gh` login, which needs the `project` scope
(`gh auth refresh -h github.com -s project`).

- `track status N <status>`: set Status by slug (`needs-owner`, `ready`, …).
- `track lane N <text>`: set Lane; `""` clears it.
- `track list <status|inbox|all> [--json]`: list the Project's issues.
- `track check <file>…`: the never-list pattern check, on files.
- `track create …`: as above.

Views: _Board_ (by status), _Waiting on me_, _Design batch_, _Friends gate_
(milestone friends, not Done, sliced by label) and _Roadmap_ (by milestone).

## Plain `gh` conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
