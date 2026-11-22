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
  /**
  The label's events, oldest first: when it was added and removed.
  */
  readonly labelEvents?: readonly LabelEvent[];
  /**
  When CI's pull_request runs for the head were created.
  */
  readonly headRuns?: readonly string[];
}

interface LabelEvent {
  readonly event: "labeled" | "unlabeled";
  readonly label: string;
  readonly at: string;
}

const PUSHED = "2026-11-22T10:00:00Z";
const LABELLED = "2026-11-22T10:05:00Z";

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

/**
Each label the PR has, added after the head was pushed.
*/
function defaultEvents(labels: readonly string[]): LabelEvent[] {
  return labels.map((label) => ({ event: "labeled", label, at: LABELLED }));
}

function routesOf(pr: PullRequest): Record<string, unknown> {
  const files = pr.files ?? ["src/app.ts"];
  return {
    [`repos/${REPO}/pulls/${PR}`]: { changed_files: files.length },
    [`repos/${REPO}/pulls/${PR}/files?per_page=100`]: files.map((filename) => ({
      filename,
    })),
    [`repos/${REPO}/git/ref/heads/main`]: { object: { sha: TIP } },
    [`repos/${REPO}/compare/${TIP}...${HEAD}`]: {
      merge_base_commit: { sha: MERGE_BASE },
    },
    ...contents(MERGE_BASE, pr.base ?? MANIFEST),
    ...contents(HEAD, pr.head ?? MANIFEST),
    [`repos/${REPO}/issues/${PR}/labels`]: (pr.labels ?? []).map((name) => ({
      name,
    })),
    [`repos/${REPO}/issues/${PR}/events?per_page=100`]: [
      { event: "renamed", created_at: "2026-11-22T11:00:00Z" },
      ...(pr.labelEvents ?? defaultEvents(pr.labels ?? [])).map(
        ({ event, label, at }) => ({
          event,
          label: { name: label },
          created_at: at,
        }),
      ),
    ],
    [`repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${HEAD}&event=pull_request&per_page=100`]:
      {
        workflow_runs: (pr.headRuns ?? [PUSHED]).map((created_at) => ({
          created_at,
        })),
      },
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
    expect(run.stdout).toContain(`The PR has the ${LABEL} label, added at`);
    expect(run.status).toBe(0);
  });

  it.each([
    "guardrails.config.json",
    "stryker.conf.json",
    "stryker.config.mjs",
    ".stryker.conf.js",
    ".github/workflows/ci.yml",
    ".githooks/pre-push",
    "eslint.config.js",
    "eslint.config.ts",
    ".dependency-cruiser.cjs",
    ".dependency-cruiser.json",
    ".dependency-cruiser.js",
    ".dependency-cruiser.mjs",
    "lockfile-lint.config.mjs",
    ".lockfile-lintrc",
    ".lockfile-lintrc.json",
    "knip.json",
    "knip.jsonc",
    ".knip.json",
    "knip.ts",
    "knip.config.js",
    ".fallowrc.jsonc",
    ".fallowrc.json",
    "fallow.toml",
    ".fallow.toml",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "vitest.config.ts",
    "vitest.config.js",
    "playwright.config.ts",
    "playwright.smoke.config.ts",
    "playwright.config.js",
    "tsconfig.json",
    "tsconfig.build.json",
    ".npmrc",
    "scripts/fetch-mutation-seed.sh",
    "scripts/track/index.ts",
    "test/architecture/workflow-floor.test.ts",
    ".claude/settings.json",
  ])("fails a change to %s without the label", (file) => {
    const run = check({ files: ["src/app.ts", file] });
    expect(run.stdout).toContain(`This PR changes:\n  ${file}\n`);
    expect(run.status).toBe(1);
  });

  it.each([
    "src/vite.config.ts",
    "docs/tsconfig.json",
    "test/scripts/track.test.ts",
    "src/scripts/x.ts",
    "test/architecture.md",
    ".claude/settings.local.json",
    "README.md",
  ])("passes a change to %s, which no check reads as its config", (file) => {
    const run = check({ files: [file] });
    expect(run.stdout).toContain("No protected path changes.");
    expect(run.status).toBe(0);
  });

  it("fails a PR that changes package.json's scripts", () => {
    const run = check({
      head: {
        ...MANIFEST,
        package: { ...MANIFEST.package, scripts: { test: "true" } },
      },
    });
    expect(run.stdout).toContain("package.json outside its dependency lists");
    expect(run.status).toBe(1);
  });

  it("fails a PR that adds a tool's config to package.json", () => {
    const run = check({
      head: {
        ...MANIFEST,
        package: { ...MANIFEST.package, "lockfile-lint": { path: "x" } },
      },
    });
    expect(run.stdout).toContain("package.json outside its dependency lists");
    expect(run.status).toBe(1);
  });

  it("passes a PR that only moves a dependency other than guardrails-core", () => {
    const run = check({
      head: {
        ...MANIFEST,
        package: {
          ...MANIFEST.package,
          devDependencies: { "guardrails-core": "0.15.0", vitest: "4.1.0" },
          dependencies: { react: "19.0.0" },
        },
      },
    });
    expect(run.stdout).toContain("No protected path changes.");
    expect(run.status).toBe(0);
  });

  describe("with a protected change", () => {
    const files = ["guardrails.config.json"];

    it("passes when the label was added after the head was pushed", () => {
      const run = check({ files, labels: [LABEL] });
      expect(run.stdout).toContain(
        `The PR has the ${LABEL} label, added at ${LABELLED}, after this head (${PUSHED}).`,
      );
      expect(run.status).toBe(0);
    });

    it("fails when the label was added before the head was pushed", () => {
      const run = check({
        files,
        labels: [LABEL],
        headRuns: ["2026-11-22T09:00:00Z", "2026-11-22T10:06:00Z"],
      });
      expect(run.stdout).toContain(
        `::error::The ${LABEL} label (added ${LABELLED}) is older than this head (2026-11-22T10:06:00Z).`,
      );
      expect(run.status).toBe(1);
    });

    it("dates the label by its newest addition", () => {
      const run = check({
        files,
        labels: [LABEL],
        labelEvents: [
          { event: "labeled", label: LABEL, at: "2026-11-22T09:00:00Z" },
          { event: "unlabeled", label: LABEL, at: "2026-11-22T09:30:00Z" },
          { event: "labeled", label: LABEL, at: LABELLED },
        ],
      });
      expect(run.status).toBe(0);
    });

    it("does not date the label by another label's events", () => {
      const run = check({
        files,
        labels: [LABEL, "docs"],
        labelEvents: [
          { event: "labeled", label: LABEL, at: "2026-11-22T09:00:00Z" },
          { event: "labeled", label: "docs", at: LABELLED },
          { event: "unlabeled", label: LABEL, at: LABELLED },
        ],
      });
      expect(run.status).toBe(1);
    });

    it("fails when no CI run dates the head", () => {
      const run = check({ files, labels: [LABEL], headRuns: [] });
      expect(run.stdout).toContain("no CI run found yet");
      expect(run.status).toBe(1);
    });

    it("fails when no event dates the label", () => {
      const run = check({ files, labels: [LABEL], labelEvents: [] });
      expect(run.stdout).toContain("at no time found");
      expect(run.status).toBe(1);
    });
  });

  it("fails a protected change without the label", () => {
    const run = check({ files: ["guardrails.config.json"], labels: ["docs"] });
    expect(run.stdout).toContain("  guardrails.config.json");
    expect(run.stdout).toContain(`::error::`);
    expect(run.status).toBe(1);
  });
});
