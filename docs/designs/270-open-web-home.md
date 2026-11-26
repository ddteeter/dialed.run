# Design: 270 the open web in one place

> Design 261 §D, row D6 (#1053), from ruling 14. A design and one question
> for the owner. Nothing is built until the owner rules. Behaviour-neutral:
> no page, header, purge or read changes. Over one page because the file
> table is the deliverable. Measured at `740f4f85`.

## Problem

What a signed-out visitor can reach sits in three modules (design 260,
finding 7.6): `feed/public-web`, `ops/public-web` and
`src/modules/closet/public-rotation.ts`. A reader looking for "what does
the open web show, and what keeps the edge in step with it" has to know
all three. The owner asked for one place.

## What the open web is

Two pages, their cards, and what keeps the edge's copies honest (design
163, D-151 to D-154):

- **The pages.** `/kit/<id>` (a PUBLIC kit) and `/@handle` (a public
  profile, with its rotation when "Show my closet" is on). Their reads,
  their shapes, their components and the not-public page.
- **The cards.** The share card for a PUBLIC kit and the generic card for
  every other link (`/og/kit/<id>`, `/og/default`).
- **The edge.** The cache headers and tags a public response leaves with;
  the purge by tag that every take-back sends; the copies of screened
  photos in `dialed-public-photos` and their reconcile.
- **The rule.** `worldVisibleEntry()` in `safety/rules/visibility.ts`
  decides which entries the open web may show (only `world`, PUBLIC on
  screen). `publicPhotoStatus` decides which photos. Not moved by any
  option here.

Already in their right homes and not moved: `src/lib/open-web.ts` (the
paths, read by the root route and the CSP), `src/lib/cache-tags.ts` (the
tag names every writer shares), `src/lib/public-photos.ts`,
`src/lib/public-origin.ts`, `ops/edge/secure-response.ts` (asks
`isPubliclyStorable` of every response), `onboarding/public-profile.ts`
(the switch, a runner's setting), and the four route files.

## Where each piece lives today

| piece                              | files                                                                                                | called by                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kit page: read, shape, card answer | `feed/public-web/public-kit.ts`, `public-kit-shape.ts`                                               | `feed/functions.ts` `publicKitQuery`; `routes/og/kit.$entryId.ts`; `feed/client.ts`                                                                                                |
| profile page: read, shape          | `feed/public-web/public-profile.ts`, `public-profile-shape.ts`                                       | `feed/functions.ts` `publicProfileQuery`; `feed/client.ts`                                                                                                                         |
| components                         | `feed/public-web/components/PublicFrame.tsx`, `PublicKit.tsx`, `PublicProfile.tsx`                   | `routes/kit/$entryId.tsx`, `routes/@{$handle}.tsx`                                                                                                                                 |
| the rotation                       | `closet/public-rotation.ts`, on `closet`'s door (3 names)                                            | `feed/public-web/public-profile.ts` only                                                                                                                                           |
| the cards                          | `ops/public-web/og/cards.tsx`, `render.ts`, `respond.ts`, `palette.ts`, `fonts/`, `bin-modules.d.ts` | `feed/public-web/public-kit.ts` (through `ops`' door); `routes/og/default.ts`                                                                                                      |
| the site's head                    | `ops/public-web/og/site-head.ts`                                                                     | `routes/__root.tsx` (through `ops/client.ts`): every page, not only the open web                                                                                                   |
| cache headers and tags             | `ops/public-web/public-cache.ts`                                                                     | the two reads, `og/respond.ts`, `src/server.ts`, `ops/edge/secure-response.ts`                                                                                                     |
| purge by tag                       | `ops/public-web/edge-purge.ts`                                                                       | `feed/entries` (3 files), `feed/moderation/moderation.ts`, `account/data/deletion.ts`, `account/handles/username.ts`, and the wiring of `feed`, `safety`, `onboarding`, `dispatch` |
| public photo copies                | `ops/public-web/public-photos.ts`                                                                    | the two reads, `feed/entries/photos.ts`, `edge-purge.ts`, `dispatch/scheduled.ts`                                                                                                  |

## The line no layout can remove

The pages import `feed/conditions`, `feed/judged-conditions`, `account`
(`lookUpHandle`) and `closet`. The edge is imported by writers in `feed`
and `account`. So a folder holding both would be imported by the modules
it imports: `feed` and `account` would each reach themselves, and ruling 4
says the direction number only falls. The edge belongs below the features,
on the floor, with `ops/sentry` and `ops/outbox`. Only the pages and cards
can move freely; they are imported by routes and `feed/functions.ts`
alone.

## The candidate homes

**A. The pages and cards in `feed/public-web`, the edge in
`ops/public-web` (recommended).** Moves the rotation and the cards into
`feed/public-web`. `site-head.ts` stays in `ops`, at
`ops/public-web/site-head.ts`, since every page's head reads it.
`og/respond.ts` then imports `PUBLIC_PAGE_TTL_SECONDS` and
`publicCacheHeaders` through `ops/public-web`'s door (the narrowest door,
ruling 2). Each folder then has one sentence: `feed/public-web` is what a
signed-out request renders; `ops/public-web` is what every writer calls to
keep the edge in step.

**B. The pages and cards in a new top-level module.** The same contents
as A, as a fifteenth module (D-201 amended: today `dispatch` is the only
new one). `publicKitQuery` and `publicProfileQuery` move to its own
`functions.ts`, with their rows in `verification-class.test.ts`.
`PhotoPager` (`feed/entries/components`) moves to `src/ui`, since a
component cannot cross a door. `judgedFeelsLikeC` joins `feed`'s door.
The edge stays in `ops`, for the reason above.

**C. Everything in one folder, the edge included.** Only possible if no
module the pages import also imports the edge. The six writer files above
would each take the purge as a parameter from their module's
`functions.ts` (the `PurgeTags` type in `lib/cache-tags.ts` already serves
two), and `ops/edge` would need `isPubliclyStorable` from a module that
imports `ops`.

| number (measured today)                   | today    | A               | B                                  | C                                                   |
| ----------------------------------------- | -------- | --------------- | ---------------------------------- | --------------------------------------------------- |
| modules                                   | 14       | 14              | 15                                 | 14 or 15                                            |
| fan-out `feed`, `closet`, `ops`           | 10, 7, 6 | 10, 7, 6        | 10, 7, 6; new module 5             | depends on host; six writers change                 |
| door `closet` (budget 45)                 | 45       | 42              | 42                                 | 42                                                  |
| door `ops`                                | 24       | 22              | 22                                 | about 15                                            |
| door `ops/public-web`                     | 16       | 14              | 14                                 | gone                                                |
| door `feed/public-web`                    | 4        | 5 (4 after B10) | moved; `feed` door 16 → 17         | larger                                              |
| door `feed/client.ts`                     | 18       | 18              | 14; the new module's `client.ts` 4 | 14 or 18                                            |
| files `feed/public-web`, `ops/public-web` | 8, 10    | 14, 5           | 0, 5; new module about 17          | one folder, about 19                                |
| direction (ruling 4)                      | —        | no new cycle    | no new cycle                       | a new cycle unless every writer is handed the purge |
| size                                      | —        | S, one lane     | M                                  | L                                                   |

No pin in `test/architecture/module-shape.json` changes under A or B.
`closet`'s door goes from exactly its budget to three under it.

## The audience check stays one gate

Every option leaves `worldVisibleEntry()` and `publicPhotoStatus` in
`safety/rules`, and adds no read of `outfit_entries`. The three reads that
use the rule (`public-kit.ts`, `public-profile.ts`, `public-photos.ts`)
keep calling it. The rotation reads only the closet; its caller decides
whether it is shown. Under A that caller is in the same folder, so the
contract in its comment ("the caller decides") is local. A is held by
`test/safety/visibility.test.ts` ("the open-web rule"), and the source
scan in `test/ops/public-cache.test.ts` that only the open web sets public
headers; that scan's list changes one path (`og/respond.ts`).

## Diagrams

`npm run diagrams:generate` redraws the structure in every option. No flow
cites `og/` or `public-rotation.ts`, so A changes no story. B changes one
`source:` path (`public-photos.c4`, the `public-kit.ts` step) and adds the
module's line to `structure.words.json`. C changes every path in
`public-photos.c4` (21 lines), `removals.c4` (5) and `deletion.c4` (1),
and the steps where a writer is handed the purge.

## Build plan for A (one lane, S)

1. Move `closet/public-rotation.ts` to `feed/public-web/`. Drop its three
   names from `closet`'s door. Test moves with it
   (`test/feed/public-profile.test.ts` already holds it). Done: worker
   tests green, `closet` door 42.
2. Move `og/` (but `site-head.ts`) to `feed/public-web/og/`;
   `site-head.ts` to `ops/public-web/`; repoint `ops/client.ts`,
   `routes/og/default.ts` and the `test/ops/og*` imports. Done: the card
   tests and `check:bundle` green.
3. `npm run modules:pin -- --print` matches the table; regenerate the
   structure; `diagrams:stale` lists nothing.
4. Paths in docs: `docs/legal/terms-sources.md`,
   `docs/legal/privacy-policy-sources.md`, design 163's note on the
   rotation, comments in `src/modules/email/palette.ts` and
   `test/email/palette.dom.test.tsx`.

Protected paths (the `owner-approved` label): `stryker.conf.json`
(`closet`'s explicit list names `public-rotation.ts`; the `feed` and
`.tsx` globs pick up the rest). `eslint.config.js` names
`src/modules/ops/public-web/og/cards.tsx` for the brackets exception: a
forbidden zone, so a one-line grant. Order: after B10 (`runDayOf` leaves
`public-kit.ts`); not beside B4, C1, C3, C4 or C7, which edit the same
doors.

## Contract touches

- Schema changes: **none**. New routes: **none**. New bindings: **none**.
- Screens: none changed.

## Test plan

No new tests: the move is held by the existing suite, the module ratchet
and the mutation ratchet at 100%. The `og` card shard moves from the
`ops/public-web` entry to the `feed` entry; the lane checks that shard's
time on its first CI run.

## Issues

- Refs #1053, #850. Closes nothing until built.

## Open questions

**Where should the open web live?**

1. **A (recommended): the pages and cards in `feed/public-web`, the edge
   stays in `ops/public-web`.** Everything a signed-out request renders is
   in one folder, for one S lane, with no new module and no door growing.
   The edge has to stay on the floor in every option, because writers in
   `feed` and `account` call it.
2. **B: the pages and cards in a new top-level module.** The name says
   "open web", at the cost of a fifteenth module, moving two server
   functions and `PhotoPager`, and `feed`'s door growing by one.
3. **C: everything in one folder, the edge included.** Truly one place,
   but only by handing the purge to six writer files as a parameter;
   otherwise `feed` and `account` reach themselves and ruling 4's number
   rises.
