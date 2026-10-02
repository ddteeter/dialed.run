/**
 * Starter dependency-cruiser configuration, seeded once by `guardrails init`.
 * guardrails never rewrites this file — tune it freely.
 *
 * `guardrails verify` runs `depcruise --output-type json .` from the repo
 * root with no --config, so this file's own `exclude`/`doNotFollow` and each
 * rule's from/to matchers are what scope the cruise.
 *
 * Module-boundary rules encode docs/architecture.md ("Module dependency
 * graph") and CLAUDE.md ("Architecture rules"). Most src/ directories they
 * reference (env/, db/, lib/, ui/, modules/) don't exist yet; the rules are
 * inert until they do.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies within the module graph.",
      from: {},
      to: { circular: true },
    },
    {
      name: "only-env-touches-cloudflare",
      severity: "error",
      comment:
        "src/env/ is the only module that may import cloudflare:workers or read bindings. " +
        "Everything else gets its environment via src/env/.",
      from: { pathNot: "^src/env/" },
      to: { path: "^cloudflare:workers$" },
    },
    {
      name: "no-cross-module-deep-imports",
      severity: "error",
      comment:
        "Cross-module imports go through the target module's index.ts barrel only. " +
        "Never deep-import another module's internals.",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/(?!$1/)[^/]+/",
        pathNot: "^src/modules/[^/]+/index\\.tsx?$",
      },
    },
    {
      name: "no-importing-routes",
      severity: "error",
      comment:
        "Route files import modules and are imported by nothing — not even by other " +
        "route files. Sole exceptions: the TanStack-generated route tree and the router " +
        "that mounts it.",
      from: { pathNot: "^src/(routeTree\\.gen\\.ts|router\\.tsx)$" },
      to: { path: "^src/routes/" },
    },
    {
      name: "foundation-stays-foundation",
      severity: "error",
      comment:
        "src/ui/ and src/lib/ are foundation: they must not import from modules, " +
        "routes, db, or env. (src/lib/ is further split by where code may run — see " +
        "lib-sql-is-server-only and lib-browser-is-client-only below.)",
      from: { path: "^src/(ui|lib)/" },
      to: { path: "^src/(modules|routes|db|env)/" },
    },
    {
      name: "lib-sql-is-server-only",
      severity: "error",
      comment:
        "src/lib/sql/ holds the drizzle/D1 helpers and the server plumbing they serve " +
        "(outbox, queue batches, R2 paging). A route file or any .tsx component is in the " +
        "client bundle, so it may not import it: server code reaching the browser chunk is " +
        "the R-50 bug class that tsc, eslint and the test suite cannot see (only " +
        "`npm run check:bundle` can, after a build). Server functions reach lib/sql through " +
        "their handler bodies, which the Start plugin strips; this rule is about a plain " +
        "top-level import. Added with the lib-by-constraint restructure (owner-approved " +
        "one-time edit, 2026-09-30).",
      from: { path: "^src/routes/|^src/.+\\.tsx$" },
      to: { path: "^src/lib/sql/" },
    },
    {
      name: "lib-browser-is-client-only",
      severity: "error",
      comment:
        "src/lib/browser/ holds code that only means something in the browser (localStorage, " +
        "the inline head script). A server-side entry point may not import it — the mirror " +
        "of lib-sql-is-server-only, and the other half of R-50's lesson that which side of " +
        "the build a file runs on must be visible in where it lives. Added with the " +
        "lib-by-constraint restructure (owner-approved one-time edit, 2026-09-30). " +
        "APPROXIMATION: dependency-cruiser has no notion of an entry point, so 'server-side " +
        "entry' is spelled out by path — the Worker entry (src/server.ts), every server-" +
        "function module (src/modules/*/functions.ts), and the queue consumers and cron " +
        "handlers src/server.ts wires (ops/queues.ts, ops/scheduled.ts, runs/consumer.ts, " +
        "enrichment/consume.ts, account/export-queue.ts, export-build.ts, export-sweep.ts, " +
        "purge.ts). A new consumer or cron handler joins this list by name. 'Module files " +
        "that are not .tsx' was measured and rejected as the approximation: auth/credentials.ts " +
        "and account/route-decisions.ts are plain .ts that run in the browser and legitimately " +
        "import lib/browser/session-memo. The rule checks direct imports only: a server-function " +
        "module reaches session-memo transitively (account/functions.ts -> inputs.ts -> " +
        "route-decisions.ts), which is sound because session-memo remembers nothing outside the " +
        "browser, and SSR renders every route, so reachability cannot be the test.",
      from: {
        path:
          "^src/server\\.ts$" +
          "|^src/modules/[^/]+/functions\\.ts$" +
          "|^src/modules/ops/(queues|scheduled)\\.ts$" +
          "|^src/modules/runs/consumer\\.ts$" +
          "|^src/modules/enrichment/consume\\.ts$" +
          "|^src/modules/account/(export-queue|export-build|export-sweep|purge)\\.ts$",
      },
      to: { path: "^src/lib/browser/" },
    },
    {
      name: "db-imports-lib-only",
      severity: "error",
      comment:
        "src/db/ may import from src/lib/ only (besides its own files and external " +
        "packages) — no reaching into modules, routes, ui, or env.",
      from: { path: "^src/db/" },
      to: { path: "^src/", pathNot: "^src/(db|lib)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // The trailing alternatives exclude whole second copies of the repo.
    // dependency-cruiser does not read .gitignore, so without them it cruises
    // every one.
    //
    // `.claude/worktrees/` is where Claude Code puts nested git worktrees.
    //
    // `.stryker-tmp/` is stryker's sandbox — a full copy of the tree, made
    // per concurrent runner and left behind by an interrupted run. Without
    // this, `npm run mutate` fails the commit gate with
    // `only-env-touches-cloudflare` against a *copied* `src/env/index.ts`:
    // a real architecture rule, naming a file nobody wrote. Verified by
    // planting a sandbox copy and watching the gate flip. Reported upstream
    // as agentic-guardrails-scaffolding#55, since `guardrails init` seeds
    // both this config and stryker's.
    exclude: {
      path: "(^|/)(dist|build|coverage|node_modules)/|^\\.claude/worktrees/|^\\.stryker-tmp/",
    },
  },
};
