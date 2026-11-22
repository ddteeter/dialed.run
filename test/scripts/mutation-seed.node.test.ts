/**
 * Which of main's Mutation runs seed a PR's shard in CI
 * (`.github/workflows/mutation.yml`, "Seed from main's report") and the
 * local gate (`scripts/fetch-mutation-seed.sh`). Both read their runs from
 * `scripts/main-mutation-runs.sh`. Each case is a real git history: a
 * bare `origin` whose main is A then B, a commit X that is not in it, and
 * other refs beside main. A stub `gh` lists runs on all three commits,
 * X's the newest.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { literalEnvOf, runStep, scriptOf } from "./workflow-step";

const GIT = "/usr/bin/git";
const WORKFLOW = readFileSync(
  path.resolve(".github/workflows/mutation.yml"),
  "utf8",
);
const STEP = "Seed from main's report";
const SHARD = "Mutation score: lib (ts)";
const SLUG = "lib-ts";
const DEPS = "digest-1";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

interface History {
  readonly root: string;
  readonly checkout: string;
  readonly sha: Readonly<Record<"a" | "b" | "x", string>>;
}

function makeHistory(): History {
  const root = mkdtempSync(path.join(tmpdir(), "mutation-seed-"));
  const work = path.join(root, "work");
  const origin = path.join(root, "origin.git");
  mkdirSync(work);
  git(root, "init", "--quiet", "--bare", origin);
  git(work, "init", "--quiet", "--initial-branch=main");
  const a = commit(work, "A");
  const b = commit(work, "B");
  git(work, "checkout", "--quiet", "-b", "side", a);
  const x = commit(work, "X");
  git(work, "tag", "main", x);
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "--quiet", "origin", "refs/heads/main", "refs/tags/main");
  // A PR checkout: one commit on top of B, with the scripts beside it, and
  // origin's main not yet fetched.
  const checkout = path.join(root, "checkout");
  git(
    root,
    "clone",
    "--quiet",
    "--no-tags",
    "--branch",
    "main",
    origin,
    checkout,
  );
  git(checkout, "update-ref", "-d", "refs/remotes/origin/main");
  mkdirSync(path.join(checkout, "scripts"));
  for (const script of ["main-mutation-runs.sh", "fetch-mutation-seed.sh"])
    copyFileSync(
      path.resolve("scripts", script),
      path.join(checkout, "scripts", script),
    );
  commit(checkout, "the PR");
  return { root, checkout, sha: { a, b, x } };
}

const { root, checkout, sha } = makeHistory();

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
The stub's answers: three runs, newest first, X's the newest, each with a
passing shard and a report measured under this run's digest.
*/
function report(id: number): { files: Record<string, string> } {
  return {
    files: {
      "stryker-incremental.json": `{"run": ${String(id)}}`,
      "stryker-deps.txt": `${DEPS}\n`,
    },
  };
}

function routes(): Record<string, unknown> {
  const runs = [
    { databaseId: 3, headSha: sha.x },
    { databaseId: 2, headSha: sha.b },
    { databaseId: 1, headSha: sha.a },
  ];
  const passed = { jobs: [{ name: SHARD, conclusion: "success" }] };
  return {
    "run list": runs,
    "run view 3": passed,
    "run view 2": passed,
    "run view 1": passed,
    "run download 3": report(3),
    "run download 2": report(2),
    "run download 1": report(1),
  };
}

describe("a PR shard's seed in CI", () => {
  it("comes from the newest run whose commit is in main's history", () => {
    rmSync(path.join(checkout, "reports"), { recursive: true, force: true });
    const run = runStep(scriptOf(WORKFLOW, STEP), {
      cwd: checkout,
      env: {
        ...literalEnvOf(WORKFLOW, STEP),
        GH_TOKEN: "token",
        GH_REPO: "owner/repo",
        SHARD,
        SLUG,
        DEPS,
      },
      routes: routes(),
    });
    expect(run.stdout).toContain("::notice::seeded from main's run 2");
    expect(run.status).toBe(0);
    expect(
      readFileSync(
        path.join(checkout, "reports/stryker-incremental.json"),
        "utf8",
      ),
    ).toBe('{"run": 2}');
    expect(run.calls.some((call) => call.startsWith("run download 3"))).toBe(
      false,
    );
    expect(run.calls.some((call) => call.startsWith("run view 3"))).toBe(false);
  });
});

function list(reference: string): string {
  return runStep(`sh scripts/main-mutation-runs.sh ${reference} 20\n`, {
    cwd: checkout,
    env: {},
    routes: routes(),
  }).stdout;
}

describe("main's runs a seed may come from", () => {
  it("are the runs on commits in the ref's history, newest first", () => {
    git(
      checkout,
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    );
    expect(list("refs/remotes/origin/main")).toBe("2\n1\n");
    expect(list("HEAD")).toBe("2\n1\n");
  });

  it("asks for completed push runs of Mutation on main, as many as told", () => {
    const run = runStep("sh scripts/main-mutation-runs.sh HEAD 7\n", {
      cwd: checkout,
      env: {},
      routes: routes(),
    });
    expect(run.calls).toContain(
      `run list --workflow mutation.yml --branch main --event push --status completed --limit 7 --json databaseId,headSha --jq .[] | "\\(.databaseId):\\(.headSha)"`,
    );
  });

  it("feed the local seed, which downloads every shard of the newest", () => {
    const into = path.join(root, "local-seed");
    const run = runStep("sh scripts/fetch-mutation-seed.sh\n", {
      cwd: checkout,
      env: { GUARDRAILS_SEED_DIR: into },
      routes: routes(),
    });
    expect(run.status).toBe(0);
    expect(run.calls).toContain(
      `run download 2 --pattern stryker-incremental-* --dir ${into}`,
    );
    expect(existsSync(path.join(into, "stryker-incremental.json"))).toBe(true);
  });

  it("leave the local seed failing when none is in the branch's history", () => {
    const run = runStep("sh scripts/fetch-mutation-seed.sh\n", {
      cwd: checkout,
      env: { GUARDRAILS_SEED_DIR: path.join(root, "none") },
      routes: { "run list": [{ databaseId: 3, headSha: sha.x }] },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no completed mutation run on main");
  });
});
