---
paths:
  - "src/routes/**"
  - "src/routeTree.gen.ts"
  - "src/router.tsx"
  - "src/modules/*/index.ts"
  - "src/modules/*/route-decisions.ts"
---

# Routes and the client bundle

Loaded when you touch a route, the route tree, or a module's public
`index.ts` (which routes import).

## Routes are glue

Each lane owns its `src/routes/<lane>/` directory exclusively. Route files are
thin: loaders/actions call module server functions and render module
components. Nothing imports from `routes/`, and route files never import each
other.

A route cannot be imported by any test, so
`test/architecture/server-functions-are-glue.test.ts` requires it to be glue:
it may import, wire and delegate, and may not branch, loop, throw, declare a
schema, `.map(`, or choose markup with a ternary or an `&&`. Input schemas go
in `inputs.ts` next door, decisions in a plain sibling, and anything a route
used to render in a component under `modules/*/components/`.
`auth/session-user.ts` and `feed/photos.ts`'s `photoResponse` are the worked
examples.

**The three JSX patterns are the ones people push back on.** `{items.map(…)}`
is a list nobody can assert on and `{x ? <A/> : <B/>}` an empty state nobody
can reach. Moving one into a component is what "route files are thin" already
meant — the routes lane found three real bugs hiding in exactly those spots.

## Typed routing

Navigation uses TanStack's typed `Link`/`navigate`. A raw string URL in
`href`, `action`, `fetch` or `window.location` is a lint error. Server functions are imported and
called, never addressed by URL.

## What a route imports must be reachable without `env`

A route is in the client bundle. Server functions and `server.handlers` have
their _handler bodies_ replaced by the Start plugin, so reaching bindings
_through_ those is fine. What is not fine is a plain top-level import of a
module file that reaches `src/env` or `src/db/schema*`.

**What survives the strip is a module-scope call rollup cannot prove pure.**
The handler body goes, and everything only it used goes with it. But
`const x = new XMLParser({…})` and `export const runs = sqliteTable(…)` are
side effects it must keep, and keeping one keeps its whole library (R-50:
two of those were a quarter of the client entry chunk). So **construct on
first use, not at module scope**, and annotate a pure-but-unprovable
constructor `/*#__PURE__*/`.

**Nothing but the production build sees this** — not tsc, eslint,
dependency-cruiser or the suite. A binding import breaks `npm run build`
(`cloudflare:workers` is externalised); anything else is silent, which is why
`postbuild` runs `check:bundle` and `test/architecture/client-bundle.test.ts`
pins the fixes. A decision a route needs goes in a sibling that imports
nothing server-side (`feed/route-decisions.ts`, `runs/not-found.ts`), and the
queries stay behind callbacks the caller owns.

## `routeTree.gen.ts` has two generators, and they disagree

`npm run generate-routes` (`tsr generate`) omits the trailing
`declare module '@tanstack/react-start'` block that the vite plugin writes
during `npm run build`. Run `npm run build` after regenerating;
`test/architecture/route-tree-registration.test.ts` fails if the block is
missing. The file's generator `as any` casts are granted whole in
`guardrails.config.json` — nothing to do.
