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
        "routes, db, or env.",
      from: { path: "^src/(ui|lib)/" },
      to: { path: "^src/(modules|routes|db|env)/" },
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
