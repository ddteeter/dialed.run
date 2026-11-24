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

import { FAILS, literalEnvOf, runStep, scriptOf } from "./workflow-step";

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
  for (const script of [
    "main-mutation-runs.sh",
    "main-mutation-reports.sh",
    "fetch-mutation-seed.sh",
  ])
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
A stored report from run `id`: one file whose mutants hold every status a
shard leaves, so the seed's filter shows. The run's id rides in the file's
name, so a test can see which run seeded.
*/
function storedReport(id: number) {
  const statuses = ["Killed", "Survived", "NoCoverage", "Timeout"];
  return {
    files: {
      [`src/run-${String(id)}.ts`]: {
        language: "typescript",
        source: "",
        mutants: statuses.map((status, index) => ({
          id: String(index),
          status,
        })),
      },
    },
  };
}

/**
The artifact run `id` uploads: its report and the digest it was measured under.
*/
function download(id: number) {
  return {
    files: {
      "stryker-incremental.json": JSON.stringify(storedReport(id)),
      "stryker-deps.txt": `${DEPS}\n`,
    },
  };
}

/**
The stub's answers: three runs, newest first, X's the newest, each with a
report measured under this run's digest. Whether each run's shard passed
is not asked: a red shard's kills seed as well as a green one's.
*/
function routes(): Record<string, unknown> {
  const runs = [
    { databaseId: 3, headSha: sha.x },
    { databaseId: 2, headSha: sha.b },
    { databaseId: 1, headSha: sha.a },
  ];
  return {
    "run list": runs,
    "run download 3": download(3),
    "run download 2": download(2),
    "run download 1": download(1),
  };
}

function seeded(): unknown {
  return JSON.parse(
    readFileSync(
      path.join(checkout, "reports/stryker-incremental.json"),
      "utf8",
    ),
  );
}

describe("a PR shard's seed in CI", () => {
  it("comes from the newest run whose commit is in main's history, keeping only what it measured as killed or timed out", () => {
    rmSync(path.join(checkout, "reports"), { recursive: true, force: true });
    const run = seedStep(routes());
    expect(run.stdout).toContain("::notice::seeded from main's run 2");
    expect(run.status).toBe(0);
    expect(seeded()).toStrictEqual({
      files: {
        "src/run-2.ts": {
          language: "typescript",
          source: "",
          mutants: [
            { id: "0", status: "Killed" },
            { id: "3", status: "Timeout" },
          ],
        },
      },
    });
    expect(run.calls.some((call) => call.startsWith("run download 3"))).toBe(
      false,
    );
    expect(run.calls.some((call) => call.startsWith("run view"))).toBe(false);
  });

  it("passes over a run whose report the API would not hand over", () => {
    rmSync(path.join(checkout, "reports"), { recursive: true, force: true });
    const run = seedStep({ ...routes(), "run download 2": FAILS });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("::notice::seeded from main's run 1");
    expect(Object.keys((seeded() as { files: object }).files)).toStrictEqual([
      "src/run-1.ts",
    ]);
  });

  it("runs cold when the API would not list main's runs", () => {
    rmSync(path.join(checkout, "reports"), { recursive: true, force: true });
    const run = seedStep({ ...routes(), "run list": FAILS });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "::notice::could not list main's runs; running cold",
    );
    expect(existsSync(path.join(checkout, "reports"))).toBe(false);
  });

  it("runs cold when no run's report was measured under this run's dependencies", () => {
    rmSync(path.join(checkout, "reports"), { recursive: true, force: true });
    const stale = {
      files: { ...download(2).files, "stryker-deps.txt": "digest-0\n" },
    };
    const run = seedStep({
      ...routes(),
      "run download 2": stale,
      "run download 1": stale,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "::notice::no main run with this dependency digest has a report for this shard; running cold",
    );
    expect(existsSync(path.join(checkout, "reports"))).toBe(false);
  });
});

/**
Run `id`'s artifacts as a pattern download lays them out, one folder per
shard: `lib-ts` measured under this digest, `ui-tsx` under another, and
`ops-ts` with a report jq cannot read.
*/
function everyShard(id: number) {
  const { files } = download(id);
  return {
    files: {
      "stryker-incremental-lib-ts/stryker-incremental.json":
        files["stryker-incremental.json"],
      "stryker-incremental-lib-ts/stryker-deps.txt": files["stryker-deps.txt"],
      "stryker-incremental-ui-tsx/stryker-incremental.json":
        files["stryker-incremental.json"],
      "stryker-incremental-ui-tsx/stryker-deps.txt": "digest-0\n",
      "stryker-incremental-ops-ts/stryker-incremental.json": "{ not json",
      "stryker-incremental-ops-ts/stryker-deps.txt": files["stryker-deps.txt"],
    },
  };
}

function reportsFor(stubRoutes: Record<string, unknown>, into: string) {
  return runStep(`sh scripts/main-mutation-reports.sh ${DEPS} ${into}\n`, {
    cwd: checkout,
    env: {},
    routes: stubRoutes,
  });
}

describe("every shard's report, for the shard selector", () => {
  it("comes from one download of the newest run in main's history, each under this digest and readable", () => {
    const into = path.join(root, "every-shard");
    const run = reportsFor(
      { ...routes(), "run download 2": everyShard(2) },
      into,
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("lib-ts 2\n");
    expect(
      run.calls.filter((call) => call.startsWith("run download")),
    ).toStrictEqual([
      expect.stringMatching(
        /^run download 2 --pattern stryker-incremental-\* --dir /u,
      ),
    ]);
    const copied = readFileSync(
      path.join(into, "lib-ts/stryker-incremental.json"),
      "utf8",
    );
    expect(copied).toBe(download(2).files["stryker-incremental.json"]);
    expect(existsSync(path.join(into, "ui-tsx"))).toBe(false);
    expect(existsSync(path.join(into, "ops-ts"))).toBe(false);
  });

  it("passes over a run whose artifacts would not download", () => {
    const run = reportsFor(
      {
        ...routes(),
        "run download 2": FAILS,
        "run download 1": everyShard(1),
      },
      path.join(root, "older-run"),
    );
    expect(run.stdout).toBe("lib-ts 1\n");
  });

  it("fails only when main's runs cannot be listed", () => {
    const run = reportsFor(
      { ...routes(), "run list": FAILS },
      path.join(root, "no-list"),
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
  });
});

function seedStep(stubRoutes: Record<string, unknown>) {
  return runStep(scriptOf(WORKFLOW, STEP), {
    cwd: checkout,
    env: {
      ...literalEnvOf(WORKFLOW, STEP),
      GH_TOKEN: "token",
      GH_REPO: "owner/repo",
      SHARD,
      SLUG,
      DEPS,
    },
    routes: stubRoutes,
  });
}

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
