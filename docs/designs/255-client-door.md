# Design: 255 a client-safe door

> A decision doc for #888: no code lands until the owner rules on the
> questions at the end.

## Problem

A route is in the client bundle, so it cannot import a module's
`index.ts`, which reaches `env`. When a route needs a module's client-side
helper, it imports the file directly. The set of files routes import is
therefore a module's client-side interface, and nothing lists or limits
it. Whether each of those files stays clear of server code is checked only
by `npm run check:bundle`, after a build, and only for the four markers it
knows. Design 240's ratchet leaves these imports uncounted because, so
far, they have nowhere else to go.

## What main measures today

At `24399a0f`, read from dependency-cruiser's graph (value imports only:
the cruise does not follow type-only ones). Routes import **41 service
files past a module's door, in 82 imports**. They fall into two kinds:

| kind                                                                                                                                                                                                         | files | reaches `env`, `lib/sql`, `db`, `drizzle-orm` or `cloudflare:` by value |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------- |
| client-side helpers: search schemas, redirects, gates, hooks (`account/route-decisions.ts` in 8 routes, `auth/credentials.ts` in 9, `feed/redirect.ts` in 8)                                                 | 32    | none                                                                    |
| server-route code used only inside `server.handlers`, which Start strips from the client bundle (`feed/photos.ts`, `closet/photos.ts`, `account/data/data-exports.ts`, `runs/strava/oauth.ts` and four more) | 9     | all                                                                     |

Of all `components/` folders, none reaches server code by value either.
Those 32 helpers and the components are kept clear of server code by
convention only.

## Approach

1. **A module whose helpers routes import gets a second door,
   `client.ts`**, beside its `index.ts`. It re-exports only what a route
   may use at module scope, and it reaches no server code. Nine modules
   have one today (`account`, `auth`, `closet`, `feed`, `notifications`,
   `onboarding`, `ops`, `runs`, `safety`). The helpers stay where they live,
   so the door lists them without moving them. One per top-level module:
   a sub-module's helper is re-exported by its parent's `client.ts`.
2. **A dependency-cruiser rule keeps it client-safe, before any build.**
   `client-side-reaches-no-server`: from every `client.ts` and every
   `components/` folder, nothing `reachable` in `src/env/`, `src/lib/sql/`,
   `src/db/`, `drizzle-orm` or `cloudflare:`. I tried it from a scratch
   config against today's tree: no `components/` folder fails, and a
   server file planted in its `from` list fails at once, with the import
   chain named. The cruise takes about 3 s, so it fits the commit gate.
   Two patterns, not one optional group: dependency-cruiser refuses that
   as unsafe.
3. **Routes reach a module through four entries only**: `functions.ts`,
   `components/`, `client.ts` and a door (`index.ts`, or a sub-module's).
   A second rule, `routes-enter-through-doors`, refuses the rest. The nine
   server-route imports go through a door, which is safe because the
   handler body never reaches the client. Each needs its door to export
   one or two more names: `closet` goes from 43 to about 45 (its budget),
   and design 240 already leaves `closet`'s 26 test-only names to be
   trimmed when next touched.
4. **The ratchet counts routes too.** Once every route enters through the
   four entries, past the door counts routes (budget 0), and door width
   counts each `client.ts`.
5. **`check:bundle` stays.** It is the only check that sees where an
   import is used: a route that calls a door's export in client code
   passes both rules and still ships server code. The rules move the
   common case (a helper or component that reaches `env`) from the build
   to the commit.

Not chosen:

- **Status quo.** It costs nothing until a helper picks up a server
  import, and then only the build says so, after the fact.
- **The reachability rule over a hand-kept list of today's helper files.**
  The list lives in the owner's file, so every new helper is a grant, and
  it still says nothing about which files a route may import.
- **Moving the helpers to `src/lib/`.** They are each module's own
  vocabulary (a gate's answer, a search schema), and `lib/` may not import
  modules.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden zone: `.dependency-cruiser.cjs` (the two rules), with the
  owner's grant.
- The build: nine `client.ts` files, about 60 route import paths, the
  ratchet's two counts, and `docs/contracts.md` §Component convention.
  It lands after the wave-16 moves (`feed` is in flight) and #887 (`runs`),
  so it never moves under a move lane.

## Test plan (for the build, once ruled on)

- The two rules: planted imports run against the real config, then
  removed, as design 240 did. A `client.ts` re-exporting a `db/` reader
  fails; a component importing `env` through a helper fails; a route
  importing a service file directly fails; a route importing `client.ts`,
  a door, a component or `functions.ts` passes.
- `test/scripts/module-shape.test.ts`: a route's import past the door
  counts, and a `client.ts` counts toward door width.
- `npm run build`: `check:bundle` still clean, and the entry under budget.

## Issues

- Closes #888 when built. Opens: none yet.

## Questions for the owner

1. **A second, client-safe door per module?** Recommended: yes.
2. **Its name**: `client.ts` (recommended), `browser.ts` or `routes.ts`.
3. **Server-route imports go through a door**, widening `closet`'s
   barrel to its budget: recommended yes. The alternative leaves them
   allowed past the door and keeps routes out of the ratchet.
4. **`components/` folders under the same rule**: recommended yes. Today
   it fails nothing and it closes the trap only `npm run build` sees now.
5. **The grant for `.dependency-cruiser.cjs`**, for the two rules.
6. **When**: as its own lane after the `feed` move and #887, recommended.
