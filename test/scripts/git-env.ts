/**
 * The environment a test hands a child process that may run git.
 *
 * A git hook runs with `GIT_DIR` exported, so that git inside the hook
 * finds the repository being pushed. The pre-push hook runs `npm test`, and
 * a test that spreads `process.env` into a git call meant for its own temp
 * repository reaches the checkout instead. From a linked worktree, a plain
 * `git init` set `core.bare = true` in the shared `.git/config`, and
 * `git add -A` replaced the worktree's index with a fixture's. Every
 * `GIT_*` variable is dropped, so git finds the repository from its working
 * directory, as it does outside a hook. A caller sets any it needs, such as
 * `GIT_AUTHOR_NAME`, after this.
 */
export function withoutGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = { ...env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) Reflect.deleteProperty(kept, name);
  return kept;
}
