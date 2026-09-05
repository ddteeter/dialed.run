/**
 * Starter dependency-cruiser configuration, seeded once by `guardrails init`.
 * guardrails never rewrites this file — tune it freely.
 *
 * `guardrails verify` runs `depcruise --output-type json .` from the repo
 * root with no --config, so this file's own `exclude`/`doNotFollow` and each
 * rule's from/to matchers are what scope the cruise.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'No circular dependencies within the module graph.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // The trailing alternative excludes nested git worktrees. A worktree
    // checked out inside the repository is a whole second checkout of it, and
    // dependency-cruiser does not read .gitignore, so without this it cruises
    // every one of them. `.claude/worktrees/` is where Claude Code puts them
    // by default; add your own vendored or generated trees here too.
    exclude: {
      path: '(^|/)(dist|build|coverage|node_modules)/|^\\.claude/worktrees/',
    },
  },
};
