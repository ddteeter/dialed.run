/**
 * The `disarm` job's steps in `.github/workflows/dependabot-pr.yml`, run
 * from the file against a stub `gh` (`./workflow-step.ts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runStep, scriptOf } from "./workflow-step";

const WORKFLOW = readFileSync(
  path.resolve(".github/workflows/dependabot-pr.yml"),
  "utf8",
);
const PR_URL = "https://github.com/owner/repo/pull/7";

function turnOff(isArmed: boolean): ReturnType<typeof runStep> {
  return runStep(scriptOf(WORKFLOW, "Turn auto-merge off"), {
    env: { PR_URL, STUB_STDOUT: isArmed ? "true\n" : "false\n" },
  });
}

function sayWhy(armedOutput: string): string {
  const run = runStep(scriptOf(WORKFLOW, "Say why, on a later push"), {
    env: {
      PR_URL,
      HELD: "- held: a major version",
      WAS_ARMED: armedOutput,
      RUN_URL: "https://example.test/run",
    },
  });
  expect(run.status).toBe(0);
  return run.calls.join("\n");
}

describe("turning auto-merge off on a held push", () => {
  it("disables it when it is on, and records that it was", () => {
    const run = turnOff(true);
    expect(run.status).toBe(0);
    expect(run.calls).toContain(`pr merge --disable-auto ${PR_URL}`);
    expect(run.output).toBe("was_armed=true\n");
  });

  it("leaves a PR that was never armed alone, and records that", () => {
    const run = turnOff(false);
    expect(run.status).toBe(0);
    expect(run.calls.some((call) => call.includes("--disable-auto"))).toBe(
      false,
    );
    expect(run.output).toBe("was_armed=false\n");
  });

  it("says auto-merge is now off only when it was on", () => {
    expect(sayWhy("true")).toContain(
      "This push is held for a person, so auto-merge is now off.",
    );
    const never = sayWhy("false");
    expect(never).toContain(
      "This push is held for a person; the PR does not merge itself.",
    );
    expect(never).not.toContain("auto-merge is");
  });
});
