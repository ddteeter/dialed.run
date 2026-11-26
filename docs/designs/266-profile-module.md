# Design: 266 a profile module

> Design 261 §D, row D2 (#1049), from the owner's ruling 13. A design and
> one question. Nothing is built until the owner rules. Behaviour-neutral:
> no screen, column or server function's behaviour changes. Over the
> template's page by its measurement tables. Measured at `740f4f852`.

## Problem

A runner's profile row (`user_profiles`) is written from four modules, and
its handle history (`username_history`) from one. The settings a runner
chooses are in `onboarding`, whatever screen they belong to; the handle and
the theme are in `account`. Design 260 (strain 2, question 6) named this.
The owner asked for a profile module, and for this design to settle
whether it is top-level, which amends D-201, or a sub-module of `account`.

## Who writes the two tables

Read from every `insert`, `update` and `delete` on the two tables in
`src` (`ast-grep -p '$X.update(userProfiles)'`, and so on), plus the
purge's array (`purge.ts:681`), which the parser misses.

| module       | file (statement lines)                                                                                                                    | columns                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboarding` | `profile.ts` (54, 228, 252, 298), `public-profile.ts` (49, 77), `aggregate-prefs.ts` (47), `privacy-review.ts` (65), `time-zone.ts` (204) | calibration and units, the place and its zone, the sharing default, the public switches, `count_in_totals`, `privacy_seen_at`, `onboarding_complete` |
| `account`    | `handles/username.ts` (410, 510, 703, 920), `handles/handle-rescreen.ts` (110, 141), `handles/handle-review.ts` (73), `theme.ts` (41)     | the `username*` columns, `theme`                                                                                                                     |
| `account`    | `purge/purge.ts` (681, the row's delete)                                                                                                  | the whole row                                                                                                                                        |
| `safety`     | `runners/bans.ts` (89, 198)                                                                                                               | `banned_at`, `ban_reason`                                                                                                                            |
| `auth`       | `d1-bookmark.ts` (50)                                                                                                                     | `d1_bookmark`, `d1_bookmark_at`                                                                                                                      |

`username_history` is written only in `account`: `handles/username.ts`
(397, 519, 631, 688, 697) and `purge/purge.ts` (743). `system_account` has
no writer in `src`. About 45 other files read `user_profiles`; reads stay where
they are, since ruling 5 (lane A2) governs writes.

Two writers stay out of any profile module under every option. Ruling 6
gives `banned_at` and `ban_reason` to `safety` in the owner map. The D1
bookmark is `auth`'s read-your-writes plumbing (`docs/architecture.md`),
not a runner's choice. The purge stays in `account/purge` (D-201) until
design 261's D1 hands each module its own forget step.

## What moves

The same set under every option. The service files and their components
move together (D-201).

- **From `onboarding`:** `profile.ts`, `public-profile.ts`,
  `aggregate-prefs.ts`, `privacy-review.ts`, `time-zone.ts`, `place.ts`,
  `place-stamp.ts`, `place-stamp-env.ts`, `units-from-locale.ts`,
  `geolocate.ts`, and nine components: `Settings`, `SettingsSubPage`,
  `PublicProfileSwitches`, `TotalsSwitch`, `PrivateRunLine`, `UnitFields`,
  `CalibrateForm`, `PickUsername`, `saved-switch`.
- **Split:** `onboarding/inputs.ts` (the profile's schemas move; naming's
  three stay) and `onboarding/route-decisions.ts`
  (`settingsSectionOrNotFound` moves).
- **From `account`:** `theme.ts`, `theme-answer.ts`. Under options 2 and
  3, `account/handles/` too.
- **Server functions:** 11 of `onboarding/functions.ts`'s 18 (settings,
  units, sharing, public profile, totals, privacy, city lookup,
  calibration, locale units) move to the new home's wiring file. Under
  options 3 and 4 `setOwnTheme`'s leaves `account/functions.ts` too.
- **`onboarding`'s door** exports nine names today, and all nine are the
  profile's (the place writer, the zone fill, the zone read). They move.
  `completeOnboarding` and `requiresOnboarding` join them, so the new door
  is 11 names.

**What `onboarding` keeps:** the first-run flow. `climate.ts`,
`ladder.ts`, `naming.ts`, `starter-list.ts`, the rest of `inputs.ts` and
`route-decisions.ts`, `CallLadder`, `MoreDisclosure`, `NamePieces`,
`NameRowForm`, `NowGoRun`, `TapListForm`, and 7 server functions. 34 files
become 15. It writes no profile column: P3's `completeOnboarding` moves
with the row and is called from `onboarding/functions.ts`.
`starter-list.ts` still reads the place, a read. Its door is left with no
names; routes reach it through `functions.ts`, `client.ts` and
`components/`.

## The options

1. **`account/profile`, a sub-module; `account/handles` stays its
   sibling.** No D-201 amendment.
2. **`account/profile` with the handle inside it as
   `account/profile/handles`.** One folder for both tables.
3. **A top-level `profile`, with the handle and the theme.** D-201
   amended.
4. **A top-level `profile` without the handle.** D-201 amended; the handle
   stays in `account`.

## The numbers

Measured by a scratch copy of `scripts/modules/shape.ts`'s counts over
`readShapeFacts()`, with each option's moves applied to the import rows.
"Direction" is A1's fifth number, read as design 261 defines it (each
`functions.ts`, `account/purge` and `dispatch` outside it). Today it reads
4, or 3 with the floor units counted apart, as design 261 says.

| number (today)                     | 1 and 2                                    | 3                                                 | 4                                         |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------- | ----------------------------------------- |
| fan-out `account` (9, pinned)      | 9                                          | **10: over its pin**                              | 9                                         |
| fan-out `safety` (8, pinned)       | 8                                          | **9: over its pin**                               | 8                                         |
| fan-out `feed` (10, pinned)        | **9: the pin falls**                       | 10                                                | 10                                        |
| fan-out `onboarding` (7)           | 6                                          | 6                                                 | 6                                         |
| fan-out `dispatch` (11)            | 10                                         | 11                                                | 11                                        |
| fan-out `profile` (new)            | none                                       | 6                                                 | 4                                         |
| direction (4; 3 floor apart)       | 3; 2                                       | 3; 2                                              | 3; 2                                      |
| parent door `account` (35)         | 35: importers take the sub-door (ruling 2) | 26: the handle's 9 names leave                    | 35                                        |
| new door                           | `account/profile` 11                       | `profile` 11, `profile/handles` 10                | `profile` 11                              |
| door `onboarding` (9)              | 0                                          | 0                                                 | 0                                         |
| client door `account` (18)         | 20                                         | 17, and `profile`'s is 3                          | 17, and `profile`'s 3                     |
| files `onboarding` (34)            | 15                                         | 15                                                | 15                                        |
| files of the new unit              | 24 (budget 50)                             | 26, and 9 in `profile/handles`                    | 26                                        |
| modules writing `user_profiles`    | 3: `account`, `safety`, `auth`             | 4: `profile`, `account` (purge), `safety`, `auth` | 4: `profile`, `account`, `safety`, `auth` |
| modules writing `username_history` | 1: `account`                               | **2: `profile`, `account` (purge)**               | 1: `account`                              |

The direction falls by one under every option. The cut it loses is
`feed → onboarding`: `feed` calls the place writer, and `onboarding`
imports `feed` for the call ladder. Once the writer leaves `onboarding`,
nothing in that pair points both ways.

Option 3's two rises are real imports, not counting artefacts.
`account/data/account-view.ts` reads the handle (`usernameOf`), and
`safety/functions.ts` wires the Desk's rename and handle review
(`forceRename`, `reviewFlaggedHandle`). A pin is never raised (`account`'s is
9, and 8 after lane B1; `safety`'s 8 falls to the budget of 7 after B3),
so option 3 cannot land until those two imports go another way. The Desk's is design 261's D4. It
also needs `handleGate`, which reads the terms and the leaving flag
beside the handle, to stay in `account`, or `profile` would import
`account/terms` and make a new pair that points both ways.

## The owner map (ruling 5, lane A2)

Under option 1 or 2, A2's map lists `user_profiles` as `account`'s, with
two column groups apart: `banned_at` and `ban_reason` to `safety`, and
`d1_bookmark` and `d1_bookmark_at` to `auth`. `username_history` is
`account`'s alone, the purge included. `onboarding` leaves the map. The
lane edits the map, so it joins the list of lanes in design 261 that do.
A2 maps tables to modules, so the line between `account/profile` and
`account/handles` is held by the sub-module doors (D-201), not by the
lint. Under option 3, the purge stays a second writer of both tables
until D1.

## Contract touches

- Schema, bindings, queues, crons: **none**. Screens and wording: none.
  `docs/contracts.md:80` names `modules/account/theme.ts`; the path
  changes.
- **Protected paths** (the `owner-approved` label): `stryker.conf.json`
  (lines 46, 47, 49 and 57 follow the files; option 1 adds
  `src/modules/account/profile/**/*.ts` to `onboarding`'s entry and drops
  `theme.ts` and `theme-answer.ts` from line 49, so the `account` shard
  does not grow, and moves the nine components from the
  `feed`, `runs`, `onboarding` shard to the `closet`, `account`, `email`
  shard unless line 46 negates them); `test/architecture/`
  (`verification-class.test.ts` re-keys 11 rows from
  `onboarding/functions.ts` to `account/functions.ts`, with no class
  changed; `system-account.test.ts` 7 paths; `server-functions-are-glue`
  1); `test/architecture/module-shape.json` (`feed` falls to 9).
- **Diagrams.** No `// source:` line in `docs/diagrams/flows` cites a
  moved file. The importers whose import lines change are cited:
  `dispatch/scheduled.ts` (42 lines, 8 flows), `dispatch/queues.ts` (10;
  import, enrichment, export), `feed/functions.ts` (10; desk-review,
  screening, feed, public-photos, removals), `account/functions.ts` (3;
  export, deletion). `diagrams:stale` lists them; each is re-read, and no
  story should change, since none names the zone fill or a setting. Option
  3 adds `safety/functions.ts` (6; desk-review, public-photos, removals).
  `npm run diagrams:generate` draws the new unit and `onboarding`'s fewer
  arrows; `structure.words.json` gains its line if the generator asks.
- `docs/architecture.md`'s time-zone paragraph (lines 85 to 96) names
  `onboarding` as the zone's home; it is rewritten.

## Build plan (option 1: one lane, M, after A1 and A2)

Not beside B12 (`handles/username.ts` imports the counters), C2 (it trims
`account`'s and `onboarding`'s doors) or C6 (`account`'s narrowest door).

1. `account/profile/` with the ten service files, the split `inputs.ts`
   and `route-decisions.ts`, and its door. `onboarding`'s door empties.
   `dispatch`, `feed` and the tests import the new door. Done: tsc and
   `npm test` green; `modules:pin -- --print` shows the table's column.
2. The nine components and the two theme files; the 10 route files'
   imports; `account/client.ts` gains two names. Done: the dom tests green,
   `npm run build` (for `check:bundle`).
3. The 11 server functions into `account/functions.ts` (34 become 45;
   `setOwnTheme` is there already). `completeOnboarding` is called
   from `onboarding/functions.ts`. Done: the verification-class and glue
   tests green with re-keyed rows only.
4. The ratchet, the mutation config, A2's map, the diagram, the docs.
   Done: `feed`'s pin lowered, `diagrams:check` green, the full suite and
   the push gate green.

## Test plan

Behaviour-neutral, so no new test. The existing suite, the module ratchet,
the mutation ratchet at 100% and the e2e journeys are the proof. 29 test files
import a moved file; those under `test/onboarding` move to `test/account`,
beside the handle's.

## Issues

- Refs #1049. The build is a new issue once the owner rules. Opens
  nothing else.

## Open questions

**For the owner: where does the profile module live?**

1. **(Recommended) `account/profile`, beside `account/handles`.** Reason:
   it lowers numbers and raises none, with the fewest files moved. `feed`'s
   pin falls, the direction falls, `account`'s fan-out and parent door
   hold, and both tables end with the fewest writing modules (3 and 1). No
   D-201 amendment, and D1 then hands `account` one forget step for both
   tables. The handle stays where it is, so nothing that works moves.
2. **`account/profile` with the handle nested inside it.** The same
   numbers, and one folder for both tables. Cost: 13 more test files and
   five importers move, and a sub-module two levels deep has not been
   tried by the ratchet or the diagram generator.
3. **A top-level `profile`, with the handle.** The cleanest name, and
   `account`'s parent door falls by 9. But `account` and `safety` rise
   over their pins, so it waits on D4 and a new seam for the account
   view, and the purge becomes a second module writing both tables until
   D1. D-201 amended.
4. **A top-level `profile`, without the handle.** No pin rises, but the
   handle's columns and all of `username_history` stay in `account`, so
   it is not a module for both tables, and `user_profiles` keeps four
   writing modules. D-201 amended.

## Not checked

- The numbers come from import rows with each option's moves applied by
  hand, not from a build of the moved tree. The edges added or dropped
  for option 3's `handleGate` were reasoned, not simulated.
- Mutation shard times after the move were not run.
- Whether TanStack Start keys a server function by its file, so that a
  tab left open across the deploy refetches. Every deploy that moves a
  server function has the same effect.
- Of the 36 merges that changed one of the files that move from
  `onboarding`, 23 also changed `account` and 14 changed the rest of
  `onboarding`, counted by today's paths with no size cut. A hint that the
  settings change with the account more often than with the first run,
  not a measurement in design 260's form.
