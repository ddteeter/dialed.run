import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import {
  allComponents,
  BASELINE_PATH,
  coverageReport,
  FIGURE_NOISE,
  IS_MEASURING,
  judge,
  loadCoverageBaseline,
  readVisits,
  routesOf,
} from "./a11y-coverage";

/**
 * Plan 161, step 3: once the run is over, the figure and the route check
 * (`a11y-coverage.ts`). Playwright fails the run when this throws.
 */
export default async function a11yCoverageTeardown(): Promise<void> {
  if (!IS_MEASURING) return;
  const results = await coverageReport({ all: allComponents() }).generate();
  const pct = results?.summary.branches.pct;
  const branches = typeof pct === "number" ? pct : 0;
  const routes = routesOf(readFileSync("src/routeTree.gen.ts", "utf8"));
  const visits = readVisits();
  const baseline = loadCoverageBaseline();

  const line = `a11y coverage: ${String(branches)}% of branches (baseline ${String(baseline.branches)}%), ${String(visits.size)} paths visited`;
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== "") {
    appendFileSync(summary, `### Accessibility coverage\n\n${line}\n`);
  }

  if (process.env.A11Y_RECORD === "1") {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ ...baseline, branches }, undefined, 2)}\n`,
    );
  } else if (branches > baseline.branches + FIGURE_NOISE) {
    // A rise inside the noise is the next run's fall: only one past it
    // is worth keeping.
    console.log(
      `a11y coverage rose past the noise: set "branches" to ${String(branches)} in e2e/a11y-coverage.json`,
    );
  }

  const problems = judge(
    { branches, routes, visits },
    {
      ...baseline,
      branches: process.env.A11Y_RECORD === "1" ? branches : baseline.branches,
    },
  );
  if (problems.length > 0) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error(`Accessibility coverage:\n${lines.join("\n")}`);
  }
}
