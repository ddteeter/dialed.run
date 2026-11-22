/**
 * `.github/workflows/protected-paths.yml`'s script, run from the file
 * against a stub `gh` (`./workflow-step.ts`). Each case is a pull request
 * described as the API would show it: its changed files, the two
 * manifests at the merge-base and the head, and its labels.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { literalEnvOf, runStep, scriptOf, type StepRun } from "./workflow-step";

const WORKFLOW = readFileSync(
  path.resolve(".github/workflows/protected-paths.yml"),
  "utf8",
);
const STEP = "Check the protected paths";
const REPO = "owner/repo";
const PR = "7";
const HEAD = "head000";
const TIP = "tip0000";
const MERGE_BASE = "base000";
const LABEL = literalEnvOf(WORKFLOW, STEP).LABEL ?? "";

interface Manifest {
  readonly package: Record<string, unknown>;
  readonly lock: Record<string, unknown>;
}

const MANIFEST: Manifest = {
  package: {
    name: "app",
    scripts: { test: "vitest run", prepare: "guardrails-core install-hooks" },
    devDependencies: { "guardrails-core": "0.15.0", vitest: "4.0.0" },
  },
  lock: {
    packages: {
      "node_modules/guardrails-core": {
        resolved: "https://registry.example/guardrails-core-0.15.0.tgz",
        integrity: "sha512-same",
      },
    },
  },
};

interface PullRequest {
  readonly files?: readonly string[];
  readonly base?: Manifest;
  readonly head?: Manifest;
  readonly labels?: readonly string[];
}

function contents(sha: string, manifest: Manifest): Record<string, string> {
  return {
    [`repos/${REPO}/contents/package.json?ref=${sha}`]: JSON.stringify(
      manifest.package,
    ),
    [`repos/${REPO}/contents/package-lock.json?ref=${sha}`]: JSON.stringify(
      manifest.lock,
    ),
  };
}

function routesOf(pr: PullRequest): Record<string, unknown> {
  const files = pr.files ?? ["src/app.ts"];
  return {
    [`repos/${REPO}/pulls/${PR}`]: { changed_files: files.length },
    [`repos/${REPO}/pulls/${PR}/files?per_page=100`]: files.map(
      (filename) => ({ filename }),
    ),
    [`repos/${REPO}/git/ref/heads/main`]: { object: { sha: TIP } },
    [`repos/${REPO}/compare/${TIP}...${HEAD}`]: {
      merge_base_commit: { sha: MERGE_BASE },
    },
    ...contents(MERGE_BASE, pr.base ?? MANIFEST),
    ...contents(HEAD, pr.head ?? MANIFEST),
    [`repos/${REPO}/issues/${PR}/labels`]: (pr.labels ?? []).map((name) => ({
      name,
    })),
  };
}

function check(pr: PullRequest): StepRun {
  return runStep(scriptOf(WORKFLOW, STEP), {
    env: {
      ...literalEnvOf(WORKFLOW, STEP),
      GH_TOKEN: "token",
      REPO,
      PR_NUMBER: PR,
      BASE_REF: "main",
      HEAD_SHA: HEAD,
    },
    routes: routesOf(pr),
  });
}

describe("the protected-paths check", () => {
  it("passes a PR that changes nothing it protects", () => {
    const run = check({});
    expect(run.stdout).toContain("No protected path changes.");
    expect(run.status).toBe(0);
  });

  it("reads the pin at the merge-base with the base branch's current tip, by its full ref", () => {
    const run = check({});
    expect(run.calls).toContain(`api repos/${REPO}/git/ref/heads/main`);
    expect(run.calls).toContain(`api repos/${REPO}/compare/${TIP}...${HEAD}`);
  });

  it("fails a PR that moves the guardrails-core pin from the merge-base", () => {
    const run = check({
      base: {
        ...MANIFEST,
        lock: {
          packages: {
            "node_modules/guardrails-core": {
              resolved: "https://registry.example/guardrails-core-0.14.0.tgz",
              integrity: "sha512-older",
            },
          },
        },
      },
    });
    expect(run.stdout).toContain("the guardrails-core pin");
    expect(run.status).toBe(1);
  });

  it("finds the label among many, however long the list", () => {
    const labels = [
      LABEL,
      ...Array.from({ length: 20_000 }, (_, index) => `label-${String(index)}`),
    ];
    const run = check({ files: ["guardrails.config.json"], labels });
    expect(run.stdout).toContain(`The PR has the ${LABEL} label.`);
    expect(run.status).toBe(0);
  });

  it("fails a protected change without the label", () => {
    const run = check({ files: ["guardrails.config.json"], labels: ["docs"] });
    expect(run.stdout).toContain("  guardrails.config.json");
    expect(run.stdout).toContain(`::error::`);
    expect(run.status).toBe(1);
  });
});
