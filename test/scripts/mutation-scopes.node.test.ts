/**
 * What `.github/workflows/mutation.yml`'s "Choose the shards" step hands
 * the shard selector on a PR: the PR's changed files, and the files main
 * changed after the commit its reports measured. Each case is a real git
 * history: a bare `origin` whose main is A, then M (the measured commit),
 * then B (a later merge), and a PR on top of B. A stub `gh` answers for
 * main's runs, and a stub `npx` stands in for the selector, keeping the
 * changes file it was given.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { parseNameStatus } from "../../scripts/mutation-shards/select";
import { withoutGitEnv } from "./git-env";
import { FAILS, runStep, scriptOf } from "./workflow-step";

const GIT = "/usr/bin/git";
const WORKFLOW = readFileSync(
  path.resolve(".github/workflows/mutation.yml"),
  "utf8",
);
const STEP = "Choose the shards";
const DEPS = "digest-1";
const RUN = 5;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...withoutGitEnv(process.env),
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
}

function commitFile(cwd: string, file: string, message: string): string {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), `${message}\n`);
  git(cwd, "add", "--", file);
  git(cwd, "commit", "--quiet", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

const root = mkdtempSync(path.join(tmpdir(), "mutation-scopes-"));
const seen = path.join(root, "seen.bin");

const { checkout, measured } = (() => {
  const work = path.join(root, "work");
  const origin = path.join(root, "origin.git");
  mkdirSync(work);
  git(root, "init", "--quiet", "--bare", origin);
  git(work, "init", "--quiet", "--initial-branch=main");
  commitFile(work, "src/a.ts", "A");
  const m = commitFile(work, "src/measured.ts", "M");
  commitFile(work, "src/later.ts", "B");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "--quiet", "origin", "refs/heads/main");
  const pr = path.join(root, "checkout");
  git(root, "clone", "--quiet", "--no-tags", origin, pr);
  // Beside the PR's tree, untracked, as the step's checkout has them.
  mkdirSync(path.join(pr, "scripts"));
  for (const script of ["main-mutation-runs.sh", "main-mutation-reports.sh"])
    copyFileSync(
      path.resolve("scripts", script),
      path.join(pr, "scripts", script),
    );
  commitFile(pr, 'src/café "x".ts', "the PR");
  return { checkout: pr, measured: m };
})();

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(seen, { force: true });
});

/**
The selector's stand-in: given the changes and the reports, it keeps a copy
of the changes and prints one shard; given nothing, every shard.
*/
const NPX = `
if [ "$#" -ge 4 ]; then
  cp "$3" "$SEEN"
  echo '[{"name":"some"}]'
else
  echo '[{"name":"every"}]'
fi
`;

/**
One run on main, at the measured commit, with one shard's report.
*/
function routes(): Record<string, unknown> {
  return {
    "run list": [{ databaseId: RUN, headSha: measured }],
    [`run download ${String(RUN)}`]: {
      files: {
        "stryker-incremental-lib-ts/stryker-incremental.json": JSON.stringify({
          files: {},
          testFiles: {},
        }),
        "stryker-incremental-lib-ts/stryker-deps.txt": `${DEPS}\n`,
      },
    },
    [`run view ${String(RUN)}`]: { headSha: measured },
  };
}

function chooseShards(answers: Record<string, unknown>) {
  return runStep(scriptOf(WORKFLOW, STEP), {
    cwd: checkout,
    routes: answers,
    commands: { npx: NPX },
    env: {
      GITHUB_EVENT_NAME: "pull_request",
      BASE: "main",
      DEPS,
      SEEN: seen,
      GH_TOKEN: "",
      GH_REPO: "owner/repo",
    },
  });
}

function changes() {
  return parseNameStatus(readFileSync(seen, "utf8"));
}

describe("the shards a PR runs are chosen from", () => {
  it("the PR's own files by their real names, however git would quote them", () => {
    const run = chooseShards(routes());
    expect(run.status).toBe(0);
    expect(changes()).toContainEqual({
      path: 'src/café "x".ts',
      deleted: false,
    });
  });

  it("the files main changed after the commit its reports measured", () => {
    const run = chooseShards(routes());
    expect(run.status).toBe(0);
    expect(run.output).toContain('list=[{"name":"some"}]');
    const paths = changes().map((change) => change.path);
    expect(paths).toContain("src/later.ts");
    expect(paths).not.toContain("src/measured.ts");
    expect(paths).not.toContain("src/a.ts");
  });

  it("the PR's own files alone when main has no report to read", () => {
    const run = chooseShards({ ...routes(), "run list": [] });
    expect(run.status).toBe(0);
    expect(run.calls.some((call) => call.startsWith("run view"))).toBe(false);
    expect(changes().map((change) => change.path)).not.toContain(
      "src/later.ts",
    );
  });

  it("every shard when the measured commit cannot be read", () => {
    const run = chooseShards({
      ...routes(),
      [`run view ${String(RUN)}`]: FAILS,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "::warning::could not read the commit main's reports measured; running every shard",
    );
    expect(run.output).toContain('list=[{"name":"every"}]');
    expect(existsSync(seen)).toBe(false);
  });
});
