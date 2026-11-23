/**
 * The `Mutation` gate's step that holds a self-merging Dependabot PR to
 * the answer for its head (`.github/workflows/mutation.yml`), run from the
 * file against a stub `gh` (`./workflow-step.ts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runStep, scriptOf, type StepRun } from "./workflow-step";

const WORKFLOW = readFileSync(
  path.resolve(".github/workflows/mutation.yml"),
  "utf8",
);
const STEP = "Check a self-merging Dependabot PR was cleared for its head";
const REPO = "owner/repo";
const HEAD = "head000";
const RUNS = `repos/${REPO}/actions/workflows/dependabot-pr.yml/runs?head_sha=${HEAD}&per_page=1`;

interface Job {
  readonly name: string;
  readonly status: string;
  readonly conclusion?: string;
}

const done = (name: string, conclusion: string): Job => ({
  name,
  status: "completed",
  conclusion,
});

function check(pr: {
  readonly author?: string;
  readonly armed?: boolean;
  readonly jobs?: readonly Job[];
  readonly hasRun?: boolean;
}): StepRun {
  const routes: Record<string, unknown> = {
    [`repos/${REPO}/pulls/7`]: {
      user: { login: pr.author ?? "dependabot[bot]" },
      ...((pr.armed ?? true) && { auto_merge: { merge_method: "merge" } }),
    },
    [RUNS]: { workflow_runs: (pr.hasRun ?? true) ? [{ id: 42 }] : [] },
    [`repos/${REPO}/actions/runs/42/jobs?per_page=100`]: {
      jobs: pr.jobs ?? [],
    },
  };
  return runStep(scriptOf(WORKFLOW, STEP), {
    env: { GH_TOKEN: "token", REPO, PR_NUMBER: "7", HEAD_SHA: HEAD },
    routes,
  });
}

describe("a Dependabot PR set to merge itself", () => {
  it("passes when its head's run answered yes", () => {
    const run = check({
      jobs: [
        done("classify", "success"),
        done("auto-merge", "success"),
        done("disarm", "skipped"),
      ],
    });
    expect(run.stdout).toContain("Cleared for its head by run 42.");
    expect(run.status).toBe(0);
  });

  it("passes on a head whose run skipped classify", () => {
    const run = check({
      jobs: [done("classify", "skipped"), done("disarm", "skipped")],
    });
    expect(run.status).toBe(0);
  });

  it.each([
    ["held it and turned auto-merge off late", "success"],
    ["failed to turn auto-merge off", "failure"],
    ["was cancelled", "cancelled"],
  ])("fails when disarm %s", (_, conclusion) => {
    const run = check({
      jobs: [done("classify", "success"), done("disarm", conclusion)],
    });
    expect(run.stdout).toContain(`disarm: ${conclusion}`);
    expect(run.status).toBe(1);
  });

  it("fails while disarm has yet to run", () => {
    const run = check({
      jobs: [done("classify", "success"), { name: "disarm", status: "queued" }],
    });
    expect(run.stdout).toContain("disarm: absent");
    expect(run.status).toBe(1);
  });

  it("fails while classify has yet to answer", () => {
    const run = check({
      jobs: [{ name: "classify", status: "in_progress" }],
    });
    expect(run.stdout).toContain("classify: in_progress null");
    expect(run.status).toBe(1);
  });

  it("fails when no run has answered for its head", () => {
    const run = check({ hasRun: false });
    expect(run.stdout).toContain("no Dependabot run has answered");
    expect(run.status).toBe(1);
  });
});

describe("any other PR", () => {
  it.each([
    ["a Dependabot PR not set to merge itself", { armed: false }],
    ["a person's PR set to merge itself", { author: "someone" }],
  ])("passes: %s", (_, pr) => {
    const run = check({ ...pr, hasRun: false });
    expect(run.stdout).toContain("Not a Dependabot PR set to merge itself.");
    expect(run.status).toBe(0);
  });
});
