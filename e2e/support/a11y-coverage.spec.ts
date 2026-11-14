import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CoverageResults } from "monocart-coverage-reports";

import {
  allComponents,
  coverageReport,
  flushCoverage,
  FIGURE_NOISE,
  judge,
  ownEntries,
  patternOf,
  routesOf,
  startMeasuring,
} from "./a11y-coverage";

/**
 * Plan 161, step 3: the figure, the route list and the judgement the
 * teardown makes from them (`a11y-coverage.ts`).
 */

const PROBE = "https://probe.test";

/**
 * A component with one branch, served where the app's are, and a page
 * that takes the side its query asks for.
 */
const COMPONENT = `export function side(n) {
  if (n > 0) {
    return "up";
  }
  return "down";
}
`;

async function serveProbe(page: Page): Promise<void> {
  await page.route(`${PROBE}/src/ui/Probe.tsx`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: COMPONENT }),
  );
  await page.route(`${PROBE}/?**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>probe</title><main><script type="module">
        import { side } from "/src/ui/Probe.tsx";
        document.querySelector("main").textContent = side(Number(location.search.slice(3)));
      </script></main>`,
    }),
  );
}

/**
 * The branch figure for a run that visited each of `visits`.
 */
async function figureFor(
  page: Page,
  outputDir: string,
  visits: readonly number[],
): Promise<number> {
  await serveProbe(page);
  // As the fixture does: flushed before each load, and once at the end.
  const measure = await startMeasuring(page, PROBE, outputDir);
  for (const n of visits) {
    await flushCoverage(measure);
    await page.goto(`${PROBE}/?n=${String(n)}`);
    await expect(page.getByRole("main")).toHaveText(n > 0 ? "up" : "down");
  }
  await flushCoverage(measure);
  const results: CoverageResults | undefined = await coverageReport({
    outputDir,
    reports: [],
  }).generate();
  const pct = results?.summary.branches.pct;
  return typeof pct === "number" ? pct : -1;
}

test("two loads in one test both count, and a visit taken away drops the figure", async ({
  browser,
}, testInfo) => {
  const figure = async (name: string, visits: readonly number[]) => {
    const page = await browser.newPage();
    try {
      return await figureFor(page, testInfo.outputPath(name), visits);
    } finally {
      await page.close();
    }
  };
  const both = await figure("both", [1, -1]);
  const one = await figure("one", [1]);
  expect(both).toBe(100);
  expect(one).toBeGreaterThan(0);
  expect(one).toBeLessThan(both);
});

test("a component no test loaded counts, at 0%", async ({
  browser,
}, testInfo) => {
  const page = await browser.newPage();
  try {
    await serveProbe(page);
    const outputDir = testInfo.outputPath("all");
    const measure = await startMeasuring(page, PROBE, outputDir);
    // As the fixture does: flushed before each load, and once at the end.
    for (const n of [1, -1]) {
      await flushCoverage(measure);
      await page.goto(`${PROBE}/?n=${String(n)}`);
      await expect(page.getByRole("main")).toHaveText(n > 0 ? "up" : "down");
    }
    await flushCoverage(measure);
    const results: CoverageResults | undefined = await coverageReport({
      outputDir,
      reports: [],
      all: allComponents((filePath) => filePath.endsWith("/src/ui/Mono.tsx")),
    }).generate();
    const files = results?.files.map((file) => file.sourcePath) ?? [];
    expect(files).toContain("src/ui/Mono.tsx");
    expect(results?.summary.branches.pct).toBeLessThan(100);
  } finally {
    await page.close();
  }
});

test("only the app's components count", () => {
  const entries = [
    { url: `${PROBE}/src/ui/Bar.tsx` },
    { url: `${PROBE}/src/modules/closet/components/Grid.tsx` },
    { url: `${PROBE}/src/modules/closet/grid.ts` },
    { url: `${PROBE}/src/routes/closet/index.tsx` },
    { url: `${PROBE}/node_modules/.vite/deps/react.js?v=1` },
    { url: "https://elsewhere.test/src/ui/Bar.tsx" },
  ];
  expect(ownEntries(entries, PROBE).map((entry) => entry.url)).toEqual([
    `${PROBE}/src/ui/Bar.tsx`,
    `${PROBE}/src/modules/closet/components/Grid.tsx`,
  ]);
});

test("the routes are read from the route tree", () => {
  const routes = routesOf(readFileSync("src/routeTree.gen.ts", "utf8"));
  expect(routes).toContain("/");
  expect(routes).toContain("/@{$handle}");
  expect(routes).toContain("/feed/entry/$entryId");
  expect(routes).toContain("/closet");
  expect(routes).not.toContain("/desk/");
  expect(() => routesOf("export const x = 1;")).toThrow(/FileRoutesByTo/u);
});

test("a route matches the paths it serves", () => {
  const cases: [string, string, boolean][] = [
    ["/", "/", true],
    ["/", "/closet", false],
    ["/closet", "/closet", true],
    ["/closet", "/closet/", true],
    ["/closet", "/closet/new", false],
    ["/feed/entry/$entryId", "/feed/entry/01ABC", true],
    ["/feed/entry/$entryId", "/feed/entry", false],
    ["/feed/entry/$entryId", "/feed/entry/01ABC/x", false],
    ["/api/auth/$", "/api/auth/callback/google", true],
    ["/@{$handle}", "/@ana", true],
    ["/@{$handle}", "/ana", false],
    ["/@{$handle}", "/@ana/kits", false],
    ["/open-source", "/open-sourcex", false],
  ];
  for (const [route, path, matches] of cases) {
    expect(patternOf(route).test(path), `${route} ~ ${path}`).toBe(matches);
  }
});

test("the judgement names each gap", () => {
  const routes = ["/", "/closet", "/api/health", "/feed/entry/$entryId"];
  const baseline = {
    branches: 50,
    unvisited: { "/api/health": "an endpoint, not a page" },
  };
  expect(
    judge(
      {
        // Inside the noise: the same code measured again.
        branches: 50 - FIGURE_NOISE,
        routes,
        visits: new Set(["/", "/closet", "/feed/entry/01A"]),
      },
      baseline,
    ),
  ).toEqual([]);
  expect(
    judge(
      { branches: 49.5, routes, visits: new Set(["/", "/api/health"]) },
      {
        ...baseline,
        unvisited: { ...baseline.unvisited, "/gone": "a route since removed" },
      },
    ),
  ).toEqual([
    "branch coverage fell to 49.5%, more than 0.4 below the baseline's 50%",
    "/closet: no spec visits it, and it is not listed",
    '/api/health: listed as unvisited ("an endpoint, not a page"), but a spec visits it',
    "/feed/entry/$entryId: no spec visits it, and it is not listed",
    "/gone: listed as unvisited, but there is no such route",
  ]);
});
