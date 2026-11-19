/**
 * `npm run e2e:ci` against the real `.github/workflows/ci.yml` (#877): the
 * planner still understands every line of CI's e2e job, and the plan is
 * still the job a lane expects. A workflow edit the planner cannot read
 * fails here, in `npm test`, rather than in a lane's pre-ship run.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { planLeg, readE2eJob } from "../../scripts/e2e-ci/ci-e2e";

const job = readE2eJob(readFileSync(".github/workflows/ci.yml", "utf8"));

function commands(leg: string): string[] {
  return planLeg(job, leg, 4123)
    .filter((step) => step.kind === "run")
    .map((step) => step.script);
}

describe("CI's e2e job, as e2e:ci plans it", () => {
  it("has the dev and preview legs", () => {
    expect(job.legs).toEqual(["dev", "preview"]);
  });

  it("plans every leg without meeting a condition or expression it cannot read", () => {
    for (const leg of job.legs)
      expect(planLeg(job, leg, 4123).length).toBeGreaterThan(0);
  });

  it("writes CI's .dev.vars, applies the three migrations, then runs Playwright", () => {
    for (const leg of job.legs) {
      const planned = commands(leg);
      const vars = planned.findIndex((script) =>
        script.includes("> .dev.vars"),
      );
      const test = planned.indexOf("npx playwright test");
      expect(vars).toBeGreaterThanOrEqual(0);
      expect(planned[vars]).toContain("BETTER_AUTH_URL=http://localhost:4123");
      for (const database of ["dialed-core", "dialed-weather", "dialed-ops"]) {
        const apply = planned.indexOf(
          `npx wrangler d1 migrations apply ${database} --local`,
        );
        expect(apply).toBeGreaterThan(vars);
        expect(apply).toBeLessThan(test);
      }
    }
  });

  it("builds before the preview leg's Playwright run, and only there", () => {
    expect(commands("dev")).not.toContain("npm run build");
    const preview = commands("preview");
    expect(preview.indexOf("npm run build")).toBeLessThan(
      preview.indexOf("npx playwright test"),
    );
  });

  it("points each leg's Playwright run at its own server", () => {
    for (const leg of job.legs) {
      const test = planLeg(job, leg, 4123).at(-1);
      expect(test?.kind === "run" && test.env.E2E_SERVER).toBe(leg);
    }
  });
});
