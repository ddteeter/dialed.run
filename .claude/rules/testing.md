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

`vitest run ""` runs the whole suite including Chromium — use `--project`
and real paths.

## Which kind of test, and when

Decide this in the design doc's test plan, before writing any test. Vitest
is the default; a Playwright spec has to name what only a real browser and
server can show. The e2e suite runs on one worker in CI (11 minutes at 125
tests, 2026-11-06), so every spec costs every PR.

| kind                          | file                                               | write or update it when                                                                                                                                                                                                                                       | not for                                                                 |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| unit / dom / browser (vitest) | `*.test.ts`, `*.dom.test.tsx`, `*.browser.test.ts` | the default: logic, every state of a component, every branch                                                                                                                                                                                                  | anything that needs the server hop or a real page                       |
| journey                       | `e2e/<feature>/*.journey.spec.ts`                  | a flow crosses the server boundary: a new route, a new auth gate, a server function wired to a screen. Update it in the PR that changes the flow. A new route behind an existing gate adds no redirect spec: `test/auth/` and `e2e/auth/` test the gates once | a state space, an edge case, a look                                     |
| edge case                     | `e2e/<feature>/*.spec.ts`, beside the journey      | a case only a real browser shows (a redirect, a real upload, focus after navigation) and the journey would bloat carrying it                                                                                                                                  | anything a dom test can reach                                           |
| conformance                   | `e2e/conformance/*.conformance.spec.ts`            | a screen with a board is built or changes shape                                                                                                                                                                                                               | values: tokens and sizes are the contracts' job (`.claude/rules/ui.md`) |
| PR demo                       | `e2e/scratch/*.spec.ts`, gitignored                | a PR changes what a user sees. Seeded straight to the state, scoped to the change, real `expect`s, recorded and attached                                                                                                                                      | proof: it is never committed and never runs in CI                       |
| accessibility                 | none of its own                                    | never as a spec. The a11y fixture rides on every e2e test (axe, Tab walk, reflow, transcript)                                                                                                                                                                 | —                                                                       |

What to do about accessibility instead: review your screens' transcript
diff under `e2e/transcripts/` with the `a11y-judgment` skill. When CI's
coverage teardown fails with "no spec visits it", the fix is a step in the
journey that owns that flow, or, for an endpoint with no page, a line in
`e2e/a11y-coverage.json`'s `unvisited` with the reason.

A PR that changes what a user sees records its video from a throwaway
spec in `e2e/scratch/` (gitignored), never from the journey (skill
`pr-demo-video`). The video is for the reviewer; the table above carries
the proof. Specs are organized by product feature, never by lane: grep
`Covers:` before you create one. A journey that keeps growing should shed
its edge cases into a sibling `*.spec.ts`. A flow that grows does not
need a second journey.

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
  requires each such file to be glue. Route negations ride on the first
  `src/modules/<module>/**/*.tsx` entry (`modules/safety (tsx)`) because a
  negation-only entry makes stryker exit non-zero. A negation may use only
  `*` and `**` as glob syntax: guardrails-core treats a negation with any
  other glob character (`{}[]()?+:!@`) as matching every file, which runs
  every push gate cold (agentic-guardrails-scaffolding#168).
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
mutates the _changed production_ `.ts/.tsx` files on the branch, not the
whole `mutate` array, which it reads only for its scope and its negations.
Its cost is a fixed dry run of the whole suite, so it sits at push rather
than commit — commit freely, expect the wait at `git push`. It never sees a weakened test (no production file changed), which
is why the whole-scope `Mutation` CI job is also a required check.

- A changed `.tsx` is mutated: a component you touch has to stay at 100%.
- A changed file that `stryker.conf.json`'s `mutate` array negates (every
  `src/modules/*/functions.ts` among them) is **not** mutated at push:
  guardrails-core appends the array's `!` negations to its own `--mutate`.
  Read the array for the list rather than restating it here. Those files are
  kept honest by `test/architecture/server-functions-are-glue.test.ts`, not by
  Stryker.

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
