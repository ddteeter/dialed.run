---
paths:
  - "test/**"
  - "e2e/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "vitest.config.ts"
  - "stryker.conf.json"
---

# Tests and the mutation ratchet

Loaded when you touch a test, the vitest config or the stryker config. For
working through surviving mutants, the `crushing-mutants` skill and
`docs/guardrails/crushing-mutants.md` are the procedure.

## Three vitest projects

`vitest.config.ts` defines them; a test opts in by filename
(`docs/designs/036-ui-unit-testing.md`):

- **`worker`** — workerd via `@cloudflare/vitest-pool-workers`. Everything
  touching D1, R2, queues and bindings. No DOM (only `renderToString`) and no
  real filesystem: read source as text with `import.meta.glob(…, { query:
"?raw" })` — but **a `.css` file comes back as an empty string**, so a test
  that reads CSS goes in `ui` and uses `node:fs` (`test/ui/tokens.dom.test.tsx`).
- **`ui`** (`*.dom.test.tsx`) — happy-dom + `@testing-library/react`, for
  component _behaviour_. **It has a real canvas and a real `<dialog>` — read
  `test/dom-setup.ts` before stubbing either.** That file installs a
  node-canvas 2d context, and happy-dom was picked because it implements
  `showModal`. A stub fighting a real implementation cost a round of mutation
  testing once.
- **`browser`** (`*.browser.test.ts`) — real Chromium, for code that fetches
  (MediaPipe's WASM and model). A fresh worktree needs `npm run build` (or
  `pretest`) to stage that WASM first.

Playwright smoke tests run in CI only and cover journeys, never a state
space. `vitest run ""` runs the whole suite including Chromium — use
`--project` and real paths.

## `stryker.conf.json`'s `mutate` array is the ratchet

Every glob in it is at 100% and `break: 100` keeps it there. **Everything the
app ships is in it except `src/routes/`** — read the array for the scopes.
Adding code under those globs means adding tests that _observe_ its
behaviour, not tests that merely execute it.

- **Components are mutation tested like anything else.** Stryker does
  **not** mutate a plain `className="..."` attribute — only class strings in a
  const or an expression. Where one survives, ask whether it carries a
  documented rule before granting it; in `src/ui` every one did, so
  `toHaveClass` asserts the contract rather than pinning a look.
- **A `!<path>` negation is not an exemption you may copy.** It is for two
  things only: a file that **cannot be imported by a test** (it pulls
  `@tanstack/react-start`, directly or through a barrel), and **every file
  under `src/routes/`**. `test/architecture/server-functions-are-glue.test.ts`
  checks the config's negations against that set in both directions and
  requires each such file to be glue. Route negations ride on the
  `src/modules/**/*.tsx` entry because a negation-only entry makes stryker
  exit non-zero.
- **CI runs one shard per entry** (`.github/workflows/mutation.yml` reads the
  array — never restate it there). A module joins the array in the PR that
  finishes it.
- **Run it per entry, never bare.** An entry is one glob, so a bare
  `stryker run` reads `"a/**/*.ts,!a/functions.ts"` as one path with a comma
  in it and silently measures a fraction of the scope. `npm run mutate` loops
  over the array exactly as CI does — and takes hours, so leave the full run
  to CI. While iterating: `npx stryker run --mutate "<the entry>"`, or a file
  list (`--mutate "src/ui/form.tsx,src/ui/Mono.tsx"`, ~30s). Neither takes
  the push-gate machine lock, so do not start one while a push gate runs.
  The report it leaves is only true of the scope that produced it.
- **npm scripts that need logic are inline `node -e`**, as `mutate` and
  `db:generate:*` are. A `scripts/*.mjs` file fails `npm run lint` on
  `process` and `console` (no Node globals in `eslint.config.js`), and a
  shell `while read` loop fails knip, which reads `read` as a binary.
- **Two lines in `vitest.config.ts` make it work** and are easy to delete:
  forwarding `__STRYKER_ACTIVE_MUTANT__` into the workers pool as a binding
  (without it every mutant survives and the score is `0.00`), and
  `assetsInclude: ["**/*.bin"]` (without it stryker's vitest cannot parse the
  photo fixture and will not start).

## The push-gate analyzer is not the ratchet

`"stryker"` is required in `guardrails.config.json` at the **`push`** rung: it
ignores the `mutate` array and mutates the _changed production_ `.ts/.tsx`
files on the branch. Its cost is a fixed dry run of the whole suite, so it
sits at push rather than commit — commit freely, expect the wait at
`git push`. It never sees a weakened test (no production file changed), which
is why the whole-scope `Mutation` CI job is also a required check.

- A changed `.tsx` is mutated: a component you touch has to stay at 100%.
- A changed `src/modules/*/functions.ts` is mutated, and those cannot be
  tested — every mutant survives. There is no grant for this. Say so in the
  PR and let the owner decide; never write an assertion you do not believe in.

## Equivalent mutants

When no possible input distinguishes a survivor, write the proof at the site,
use a **mutator-scoped** `// Stryker disable next-line <Mutator>`, and add a
keyed grant to `guardrails.config.json`. The pre-push hook runs
`sanctions-check`, which fails a directive with no grant. Two placement
traps: a directive does **not** attach inside a JSX comment (`{/* … */}`), so
hoist the expression to a named constant; and `next-line` does not attach
when the mutant's line begins with a closing brace (`} catch`, `}, [deps]`) —
use the block `disable`/`restore` pair. Prefer restructuring so the mutant
cannot exist. Measure before calling a mutant equivalent; the default
instinct to dismiss one has usually been wrong.
