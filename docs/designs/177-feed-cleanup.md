# Design: 177 feed-cleanup

## Problem

Wave 2 lane 177 clears four items from the 2026-11-05 Plan-vs-Build survey
that sit in feed and runs: a server path for a per-item note that the owner
cut for v1 (D-160, R-8), a console error in A1's upload poll, dead feed
exports, and a stale fallback in the verdict demo. It changes code only and
adds no copy.

## Approach

Each item was checked again on main at 7a160a1a before any work started.

1. **R-8 / D-160: the per-item note is cut.** No screen ever showed it, so
   only the server path goes. `itemFlagInput` (`feed/inputs.ts`) loses
   `note`, and zod's default strip drops a stray `note` from a client.
   `submitVerdict` (`feed/entries.ts`) stops writing it, and
   `EntryDetailItem` stops reading it back. The `outfit_entry_items.note`
   column stays (law 8, expand→contract). `docs/contracts.md` §outfit
   entry items says the column is unused in v1. Flags are unchanged.
   - **The account export keeps its `note` column** in
     `account/export-sheets.ts`. While the column exists, anything in it is
     the runner's data. Until this PR the server accepted a note from a
     hand-made request, so some rows could hold one, and a data export
     must include it. The column leaves the export when the column itself
     is dropped.
2. **PR#288-2: UploadForm logs "Query data cannot be undefined".**
   `getImportOutcome` returns `undefined` for a row this runner cannot see
   yet, and TanStack Query rejects `undefined` data, so the poll counts the
   answer as an error. The `queryFn` now wraps the answer
   (`{ answer }`), and `select` unwraps it, so the form sees `undefined`
   and treats it as "still waiting", as it already did. The poll budget is
   unchanged, because it counts answers and errors alike.
3. **PR#103-1: dead `prefillAt` and `pickerGroupsInput`.** Delete both and
   their tests. `nearestPriorEntry` stays, because A2 uses it.
4. **PR#103-2: the verdict demo's badge fallback.** Remove the
   `.or(getByText("[A bit cold]"))` fallback and its comment from
   `e2e/verdict/verdict.demo.spec.ts`, and assert the exact badge text.

**Dropped: markers-feed-weather-seam.** This was already fixed by f8985fff
(design 173, #344, 2026-11-05). `feed/conditions.ts` and `account/purge.ts`
now reach `dialed-weather` only through `modules/weather`'s `index.ts`.

## Contract touches

- Schema changes needed: **none** (the column stays).
- New route files: none.
- New bindings/queues/crons: **none**.
- Screens: none change visibly. A1 only stops logging a console error.

## Test plan

- worker: `entries-edges` ("records a per-item flag, and clears it again")
  shows a submitted `note` is neither stored nor read back.
- worker: `authz` ("never shows another viewer a public entry's per-item
  flags") keeps the flag assertions, and the note assertions go.
- worker: `inputs` shows that `itemFlagInput` strips `note`.
- ui: `upload-form` dom test checks that an unknown import (`undefined`
  from `getOutcome`) leaves the well waiting, polls again, and logs no
  query error.
- e2e: the verdict demo passes without its fallback.
- Gates: full `npm test`, CI-style e2e, one Stryker run over the touched
  production files, `npm run build`, `sanctions-check`.

## Register changes for the coordinator

- R-8: resolved by D-160 and this PR (read path removed, column kept for
  a later contract step).
- PR#288-2, PR#103-1, PR#103-2: done in this PR. markers-feed-weather-seam:
  done in #344.
- New row for the contract step: drop `outfit_entry_items.note` and the
  export's `note` column together.

## Open questions

None. One judgement call for the reviewer to veto: keeping the export
column (item 1).
