import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import { CoverageReport } from "monocart-coverage-reports";
import type { CoverageReportOptions } from "monocart-coverage-reports";
import { z } from "zod";

/**
 * Plan 161, step 3: what the a11y fixture's checks reached
 * (`docs/designs/161-a11y-coverage.md` §3). The fixture collects each
 * test's coverage and visited paths here; `a11y-coverage-teardown.ts`
 * reads them once the run is over.
 */

const COVERAGE_DIR = "test-results/a11y/coverage";

const VISITS_PATH = "test-results/a11y/visits.jsonl";

/**
 * On the dev leg, where Vite serves source maps, and only for a whole
 * run: CI's, or a local one that asks. One folder's run would fail both
 * checks.
 */
export const IS_MEASURING =
  process.env.E2E_SERVER !== "preview" &&
  (process.env.CI === "true" || process.env.A11Y_COVERAGE === "1");

/**
 * The app's components, by the path Vite serves each one at.
 */
const APP_COMPONENT = /^\/src\/(?:ui|modules)\/.+\.tsx$/u;

/**
 * One report over a cache on disk: each test adds to it, and the
 * teardown generates from it. The spec points it elsewhere.
 */
export function coverageReport(
  options: Partial<CoverageReportOptions> = {},
): CoverageReport {
  return new CoverageReport({
    name: "a11y coverage",
    outputDir: COVERAGE_DIR,
    reports: [["console-summary", { metrics: ["branches"] }]],
    // Vite's dev maps name a module's source by its bare file name
    // (`index.tsx`), so two of them would merge: name each by the file
    // it was served as, less the host (`localhost-3000/`).
    sourcePath: (filePath, info) =>
      (typeof info.distFile === "string" ? info.distFile : filePath).replace(
        /^[^/]*localhost[^/]*\//u,
        "",
      ),
    logging: "error",
    ...options,
  });
}

/**
 * Every component counts, loaded or not. Counting only what a run
 * loaded let the figure's denominator move: a component one run
 * preloaded and the next never fetched (`LinkLanding`) swung it by a
 * tenth of a point, and a component no spec loads never lowered it.
 * Files no test loaded are compiled as Vite would and count as 0%.
 */
export function allComponents(
  isCounted: (filePath: string) => boolean = (filePath) =>
    filePath.endsWith(".tsx"),
): NonNullable<CoverageReportOptions["all"]> {
  return {
    dir: ["./src/ui", "./src/modules"],
    filter: isCounted,
    transformer: async (entry: {
      url: string;
      source: string;
      sourceMap?: unknown;
    }) => {
      const { transformWithOxc } = await import("vite");
      const result = await transformWithOxc(
        entry.source,
        fileURLToPath(entry.url),
        { sourcemap: true, jsx: { runtime: "automatic" } },
      );
      entry.source = result.code;
      entry.sourceMap = result.map;
    },
  };
}

/**
 * What one test's page covered, kept to the app's components. Dev
 * serves one module per file, so the entry's URL names the source;
 * the dependencies Vite pre-bundles are megabytes per test and dropped
 * here, before they reach the disk.
 */
export function ownEntries<Entry extends { url: string }>(
  entries: readonly Entry[],
  origin: string,
): Entry[] {
  return entries.filter((entry) => {
    const url = new URL(entry.url);
    return url.origin === origin && APP_COMPONENT.test(url.pathname);
  });
}

/**
 * One test's measurement: its page, the app's origin, and the paths the
 * page landed on.
 */
export type Measure = Readonly<{
  page: Page;
  origin: string;
  visits: Set<string>;
  outputDir: string;
}>;

/**
 * Starts measuring a test's page: its coverage, and every path its main
 * frame asks for or lands on.
 */
export async function startMeasuring(
  page: Page,
  origin: string,
  outputDir = COVERAGE_DIR,
): Promise<Measure> {
  const measure: Measure = { page, origin, visits: new Set(), outputDir };
  const visit = (href: string) => {
    const url = new URL(href);
    if (url.origin === origin) measure.visits.add(url.pathname);
  };
  // Where the page landed, client-side navigations included…
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visit(frame.url());
  });
  // …and what it asked for: a route that redirects on the server
  // (`/join`) never lands.
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      visit(request.url());
    }
  });
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  return measure;
}

async function addCoverage(measure: Measure): Promise<void> {
  const entries = ownEntries(
    await measure.page.coverage.stopJSCoverage(),
    measure.origin,
  );
  // A page that loaded none of the app's components (a 404, another
  // origin) adds nothing, and the report refuses an empty list.
  if (entries.length === 0) return;
  await coverageReport({ outputDir: measure.outputDir }).add(entries);
}

/**
 * Adds what the page covered so far and starts again. Chromium reports
 * only the scripts of the document still loaded, so a full page load
 * would drop the one before it: the fixture calls this before each
 * navigation it drives (`goto`, `reload`, `goBack`, `goForward`).
 */
export async function flushCoverage(measure: Measure): Promise<void> {
  if (measure.page.isClosed()) return;
  await addCoverage(measure);
  await measure.page.coverage.startJSCoverage({ resetOnNavigation: false });
}

/**
 * Stops it and adds the test's last share, and its visits, to the run's.
 */
export async function stopMeasuring(measure: Measure): Promise<void> {
  mkdirSync("test-results/a11y", { recursive: true });
  appendFileSync(VISITS_PATH, `${JSON.stringify([...measure.visits])}\n`);
  if (!measure.page.isClosed()) await addCoverage(measure);
}

/**
 * Every path any test visited.
 */
export function readVisits(path = VISITS_PATH): Set<string> {
  if (!existsSync(path)) return new Set();
  const lines = readFileSync(path, "utf8").split("\n");
  return new Set(
    lines
      .filter((line) => line !== "")
      .flatMap((line) => z.array(z.string()).parse(JSON.parse(line))),
  );
}

/**
 * The routes a URL can land on: `routeTree.gen.ts`'s `FileRoutesByTo`,
 * read rather than listed, so a new route is checked the day it lands.
 */
export function routesOf(routeTree: string): string[] {
  const block = /export interface FileRoutesByTo \{(?<body>[\s\S]*?)\n\}/u.exec(
    routeTree,
  )?.groups?.body;
  if (block === undefined) {
    throw new Error("routeTree.gen.ts has no FileRoutesByTo");
  }
  return Array.from(
    block.matchAll(/^ {2}'(?<route>[^']+)':/gmu),
    (match) => match.groups?.route ?? "",
  );
}

/**
 * A route as a pattern: `$param` is one segment, a bare `$` the rest of
 * the path, and `{$param}` the rest of its segment (`/@{$handle}`).
 */
export function patternOf(route: string): RegExp {
  const segments = route.split("/").map((segment) => {
    if (segment === "$") return ".+";
    if (segment.startsWith("$")) return "[^/]+";
    return segment
      .split(/\{\$[^}]+\}/u)
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
      .join("[^/]+");
  });
  return new RegExp(`^${segments.join("/")}/?$`, "u");
}

const baselineSchema = z.object({
  branches: z.number(),
  unvisited: z.record(z.string(), z.string().min(1)),
});

export type CoverageBaseline = z.infer<typeof baselineSchema>;

export const BASELINE_PATH = new URL("../a11y-coverage.json", import.meta.url);

export function loadCoverageBaseline(): CoverageBaseline {
  return baselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
}

/**
 * How far the figure moves between two runs of the same code, in
 * points. Two fresh-database runs (2026-11-03) differed by four
 * branches of about 2,200: one component preloaded or not, and one
 * branch that reads the shared data. A screen no spec reaches any more
 * is tens of branches, well past this.
 */
export const FIGURE_NOISE = 0.25;

/**
 * What the run reached, against the baseline: each line is a failure.
 */
export function judge(
  reached: Readonly<{
    branches: number;
    routes: readonly string[];
    visits: ReadonlySet<string>;
  }>,
  baseline: CoverageBaseline,
): string[] {
  const isVisited = (route: string): boolean => {
    const pattern = patternOf(route);
    return [...reached.visits].some((path) => pattern.test(path));
  };
  const problems: string[] = [];
  if (reached.branches < baseline.branches - FIGURE_NOISE) {
    problems.push(
      `branch coverage fell to ${String(reached.branches)}%, more than ${String(FIGURE_NOISE)} below the baseline's ${String(baseline.branches)}%`,
    );
  }
  for (const route of reached.routes) {
    const reason = baseline.unvisited[route];
    if (reason === undefined && !isVisited(route)) {
      problems.push(`${route}: no spec visits it, and it is not listed`);
    }
    if (reason !== undefined && isVisited(route)) {
      problems.push(
        `${route}: listed as unvisited ("${reason}"), but a spec visits it`,
      );
    }
  }
  for (const route of Object.keys(baseline.unvisited)) {
    if (!reached.routes.includes(route)) {
      problems.push(
        `${route}: listed as unvisited, but there is no such route`,
      );
    }
  }
  return problems;
}
