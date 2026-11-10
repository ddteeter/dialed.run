# Design: 192 legal text fixes (wave 5)

> Text work only: three owner-answered edits to the legal and compliance
> drafts. Nothing is published yet.

## Problem

The privacy policy and terms still describe the per-item kit note cut by
D-160 (#554). The record of processing still says inbound email is not in
the policy (#422). And the policy says nothing about backups, though D1
Time Travel and the photo backup (#420) both keep deleted data for 30 days
(#529).

## Approach

- **#554:** cut "notes and" from the three sentences the issue lists
  (`privacy-policy.md` §Your kits and the never-shown list, `terms.md`'s
  never-shown bullet). Their sources rows (`privacy-policy-sources.md`
  "Per-garment flags…", `terms-sources.md` "Owner-only fields") drop the
  `note` field too: the column is gone and `getEntryDetail` returns only
  `flag` to the owner. General "notes" mentions stay.
- **#422:** ROPA row 21's data column points at the policy's LB row
  "Email you send us", instead of "Not in the policy".
- **#529:** the owner-approved wording, verbatim: one new row in "How long
  we keep it" (Backups, 30 days) and one sentence after the account
  deletion list in "Your choices". A new sources row maps the claim to
  `ops/media-backup.ts` `GONE_RETENTION_S` and D1 Time Travel
  (`docs/deployment.md` §9–§10). ROPA rows 6, 7, 8 and 19 (the activities
  whose deletes a backup outlives) add RT "Backups".
- **Rendered pages and versions:** `/privacy` and `/terms` render these
  files only once they carry `published: true`; neither does, so no page,
  transcript or terms version changes. Terms stay version 1 (never
  published); the effective date is still an `[OWNER]` marker.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens implemented: none

## Test plan

- No code changes. Full `npm test` (the legal pages' parse tests read
  these files), `npm run build`, and the CI-style e2e per the wave brief.

## Issues

- Closes: #554, #422, #529
- Opens: none expected

## Open questions

- None. All wording is the owner's (#554, #529 comments); the ROPA and
  sources edits are pointers, not policy text.
