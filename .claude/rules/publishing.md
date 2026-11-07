# Publishing boundary

The repo, its issues and its PRs are **public, and permanent**: git history and closed issues don't forget. The dialed.run Project is private, but an issue in it is still a public issue; only the Project's draft items are private. This rule decides what may land there. It loads whenever you write anything that leaves this machine: a commit, a doc, a code comment, a PR body, a review reply, an issue, or a Design prompt.

**The model is an approve-list.** If it's on the list below, write it. If it's on the never-list, don't, whatever the list seems to say. Anything else, stop and ask the owner in the turn (CLAUDE.md, "Stop means ask").

**If you have to argue that something fits a category, it doesn't. Ask.**

## Never: no approval overrides these

1. Secrets, tokens, keys, passwords. Bindings only.
2. Real people's personal data: report and takedown cases, the people who filed them, Desk decisions about a real account, anything a real user wrote or uploaded, Sentry payloads, production logs, the invite list. Demo videos, transcripts and fixtures use seeded data only.
3. How to exploit an unfixed security hole: steps, payloads, or the gap itself. Once it's fixed, a one-line description is fine.

## Approved categories

Each entry has its date and where the approval came from. Add one only when the owner grants a category, never on your own judgement.

| category                   | scope                                                                                                                      | approved         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Code                       | source, tests, configs and migrations, with no secrets                                                                     | seed, 2026-11-06 |
| Product and technical docs | contracts, architecture, product, design docs, task packets, roadmap                                                       | seed, 2026-11-06 |
| Design record              | boards and rulings imported from Claude Design; design-deltas                                                              | seed, 2026-11-06 |
| Decisions                  | D-rows about the product, its tech, or compliance at the level of the policy                                               | seed, 2026-11-06 |
| Legal texts                | the terms, privacy policy and other published policies, and their drafts (`[OWNER]` markers stand in for personal details) | seed, 2026-11-06 |
| Bugs                       | what's wrong and where. A security-relevant bug only once it's fixed                                                       | seed, 2026-11-06 |
| Change narrative           | PR bodies, commit messages, review replies, all describing the change                                                      | seed, 2026-11-06 |
| Work items                 | build, design-ask, watch and owner-question items about the product (the question, not a private answer)                   | seed, 2026-11-06 |
| Seeded media               | demo videos, screen-reader transcripts, screenshots, from seeded data only                                                 | seed, 2026-11-06 |
| Public third-party sources | links to and quotes from public docs, terms and guidelines. Not our reading of them                                        | seed, 2026-11-06 |
| Process                    | CLAUDE.md, skills, rules, guardrails docs, agent docs                                                                      | seed, 2026-11-06 |
| Runbooks                   | deployment and ops checklists, with no credentials                                                                         | seed, 2026-11-06 |

## Not on the list (ask)

These aren't banned, just not approved yet. Examples:

- business strategy: monetization, pricing, partnerships, competitors, growth numbers;
- our reading of a third party's contract, or a compliance-risk call;
- correspondence with partners or vendors;
- the owner's personal details;
- unannounced dates;
- moderation thresholds and signals not already in code.

## How to ask

Ask in the turn. Say what the content is, why it doesn't fit the list, and what you recommend. The owner answers one of three ways:

- **Categorical:** add a row to the table above (category, scope, date, "owner, <date>"), in the same PR as the content.
- **One-time:** publish it, and record "Published with the owner's one-time approval, <date>: <what>" in the PR body or issue. The table doesn't change.
- **No:** it goes to the private home (see below), never to the repo. A work item answered "no" can instead be a draft item in the private Project, never converted to an issue until the owner says so (owner, 2026-11-06: unfixed security items stay drafts until they are fixed).

Private home: `~/dev/private/dialed.run/`, a local folder outside every repo (owner, 2026-11-06). Never copy from it into the repo, a PR, an issue or a Design prompt. Claude memory is never the only copy.
