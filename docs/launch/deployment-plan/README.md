# Deployment plan: pending additions

A lane that adds something to deploy (a secret, a var, a bucket, a
dashboard setting, an owner step at a rollout stage) writes it here, in a
file of its own, instead of editing `docs/launch/deployment-plan.md`
(#875). Lanes editing the plan at the same time made each merge conflict
the next PR, mostly in §2's table, which Prettier re-pads whenever a row
widens it.

**These files are part of the plan until they are folded in.** At each
wave's docs pass, the coordinator moves every file's contents into the
plan, in one commit, and deletes the file (skill `coordinating-a-wave`).
Before any deploy sweep, this folder holds nothing but this README.

## What goes in a file

- Name it `<design number>-<slug>.md`, after the lane's design doc
  (`docs/designs/<number>-…`).
- Head each addition with the plan heading it extends, word for word:
  `## 2. Vars and secrets`, `## 5. Third-party accounts`,
  `### Stage 1 — invited friends`, and so on. Under it, write the lines as
  they will read in the plan.
- A §2 addition is a table with §2's header
  (`| name | kind | required | read by / written by | without it |`) and
  the new rows. `test/ops/deployment-config.node.test.ts` reads it with
  the plan's own table, so the row and its entry in
  `src/modules/ops/deployment-config.ts` still land in the same PR.

An owner step that waits on the owner is also a `kind:owner-question`
issue in Needs owner (`docs/agents/issue-tracker.md`).
