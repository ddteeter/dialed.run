/**
 * `withoutGitEnv` keeps a test's git calls in the test's own repository
 * when the suite runs inside a git hook. The pre-push hook of a linked
 * worktree exports `GIT_DIR` as that worktree's directory under the main
 * repository's `.git/worktrees/`, and a plain `git init` anywhere then
 * writes `core.bare = true` into the configuration every worktree shares.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withoutGitEnv } from "./git-env";

const GIT = "/usr/bin/git";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const plain = (): NodeJS.ProcessEnv => ({
  ...withoutGitEnv(process.env),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
});

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync(GIT, args, { cwd, env, encoding: "utf8" }).trim();
}

interface Checkout {
  readonly root: string;
  /**
  The main repository's `.git`, whose `config` every worktree shares.
  */
  readonly common: string;
  /**
  The linked worktree a hook runs in.
  */
  readonly worktree: string;
  /**
  What git exports as `GIT_DIR` to that worktree's hooks.
  */
  readonly hookGitDir: string;
}

/**
A main repository with one committed file and a linked worktree.
*/
function checkout(): Checkout {
  const root = mkdtempSync(path.join(tmpdir(), "git-env-"));
  roots.push(root);
  const main = path.join(root, "main");
  mkdirSync(main);
  git(main, plain(), "init", "--quiet");
  writeFileSync(path.join(main, "kept.txt"), "kept\n");
  git(main, plain(), "add", "kept.txt");
  git(main, plain(), "commit", "--quiet", "-m", "kept");
  const worktree = path.join(root, "wt");
  git(main, plain(), "worktree", "add", "--quiet", worktree, "-b", "wt");
  return {
    root,
    common: path.join(main, ".git"),
    worktree,
    hookGitDir: path.join(main, ".git", "worktrees", "wt"),
  };
}

/**
A test's own fixture repository, built with `env`, as the tests do.
*/
function fixture(root: string, env: NodeJS.ProcessEnv): string {
  const work = path.join(root, "fixture");
  mkdirSync(work);
  writeFileSync(path.join(work, "fixture.txt"), "fixture\n");
  git(work, env, "init", "--quiet");
  git(work, env, "add", "-A");
  return work;
}

const coreBare = (common: string): string =>
  git(common, plain(), "config", "--file", "config", "core.bare");

describe("withoutGitEnv", () => {
  it("drops every GIT_ variable and keeps the rest", () => {
    expect(
      withoutGitEnv({
        GIT_DIR: "/repo/.git",
        GIT_INDEX_FILE: "/repo/.git/index",
        GIT_WORK_TREE: "/repo",
        GIT_AUTHOR_NAME: "someone",
        GITHUB_OUTPUT: "/runner/output",
        PATH: "/usr/bin",
        BETTER_AUTH_SECRET: "kept",
      }),
    ).toStrictEqual({
      GITHUB_OUTPUT: "/runner/output",
      PATH: "/usr/bin",
      BETTER_AUTH_SECRET: "kept",
    });
  });

  it("keeps a fixture's git calls out of the hook's repository", () => {
    const { root, common, worktree, hookGitDir } = checkout();
    const hook = { ...plain(), GIT_DIR: hookGitDir };

    const work = fixture(root, { ...withoutGitEnv(hook), ...plain() });

    expect(coreBare(common)).toBe("false");
    expect(git(worktree, plain(), "ls-files")).toBe("kept.txt");
    expect(existsSync(path.join(work, ".git"))).toBe(true);
    expect(git(work, plain(), "ls-files")).toBe("fixture.txt");
  });

  it("is what stands between the hook's GIT_DIR and the shared config", () => {
    const { root, common, worktree, hookGitDir } = checkout();

    const work = fixture(root, { ...plain(), GIT_DIR: hookGitDir });

    expect(coreBare(common)).toBe("true");
    expect(existsSync(path.join(work, ".git"))).toBe(false);
    expect(git(worktree, { ...plain(), GIT_DIR: hookGitDir }, "ls-files")).toBe(
      "fixture.txt",
    );
  });
});

describe("tests that start a child process", () => {
  it("never spread process.env into it whole", () => {
    const spreads = readdirSync("test", { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => path.join("test", file))
      .filter((file) =>
        /\.\.\.process\.env\b/.test(readFileSync(file, "utf8")),
      );
    expect(spreads).toStrictEqual([]);
  });
});
