import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import type { Measure } from "./a11y-coverage";
import {
  flushCoverage,
  IS_MEASURING,
  startMeasuring,
  stopMeasuring,
} from "./a11y-coverage";
import type { Finding } from "./a11y-findings";
import { findingOf, keyOf, loadBaseline, RULES } from "./a11y-findings";
import { endOfTest } from "./a11y-end";
import type { CheckReport } from "./a11y-page";
import { installChecker } from "./a11y-page";
import { transcriptOf } from "./a11y-transcript";
import type { PageReport } from "./a11y-walk";
import { installWalk } from "./a11y-walk";

/**
 * Plan 161, step 1: accessibility checks on every state an e2e spec acts
 * on, in a real browser with the real stylesheet.
 *
 * **When it checks: before every action, and once at the end.** A spec
 * waits for a state and then acts on it, so the moment before a click,
 * fill, navigation or resize is a state the spec meant to reach. Waiting
 * for the DOM to go quiet does not work at machine speed: the closet
 * journey makes ~900 mutations in ten seconds and never settles (step 0).
 * So the action methods of `Locator`, `Page`, `Keyboard` and `Mouse` are
 * wrapped, once per worker, to run the check first. A state is checked
 * once per test, keyed by a hash of its markup and the viewport width.
 *
 * **Then, at the end of a test that passed** (step 2, `a11y-end.ts`): a
 * Tab walk, the other width, and reflow at 320px. The action wrapper is
 * off by then, so the walk's own presses are not states.
 *
 * **What it checks** (`a11y-page.ts`): every axe rule tagged WCAG A or AA,
 * plus `region`; a 44×44 hit area, counting a control's labels; and a
 * space Chromium would leave out of an accessible name.
 *
 * **What fails.** A finding in `e2e/a11y-baseline.json` predates the
 * fixture and passes; any other fails the test at its end, listing each
 * one. `A11Y_RECORD=1` fails nothing and writes every finding to
 * `test-results/a11y/findings.jsonl`, which is how the baseline is made.
 * Pages on another origin, such as the design boards `openBoard` loads,
 * are not the app and are not checked.
 *
 * **What it says** (step 4, `a11y-transcript.ts`): the final state's
 * screen-reader transcript, compared with the one checked in.
 *
 * **What it reached** (step 3, `a11y-coverage.ts`): on a measured run,
 * each test's page coverage and visited paths, read once the run ends.
 */

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

/**
 * WCAG 2.5.5's 44 CSS pixels: the contract's floor, not axe's 24.
 */
const MIN_TARGET = 44;

const REPORT_DIR = "test-results/a11y";

const IS_RECORDING = process.env.A11Y_RECORD === "1";

const BASELINE = loadBaseline();

const LOCATOR_ACTIONS = [
  "blur",
  "check",
  "clear",
  "click",
  "dblclick",
  "dragTo",
  "fill",
  "focus",
  "hover",
  "press",
  "pressSequentially",
  "selectOption",
  "selectText",
  "setChecked",
  "setInputFiles",
  "tap",
  "type",
  "uncheck",
] as const;

const PAGE_ACTIONS = [
  "check",
  "click",
  "dblclick",
  "dragAndDrop",
  "fill",
  "focus",
  "goBack",
  "goForward",
  "goto",
  "hover",
  "press",
  "reload",
  "selectOption",
  "setInputFiles",
  "setViewportSize",
  "tap",
  "type",
  "uncheck",
] as const;

/**
 * The page actions that load a new document, which drops the last one's
 * coverage unless it is taken first (`flushCoverage`).
 */
const NAVIGATIONS = new Set<string>(["goBack", "goForward", "goto", "reload"]);

const KEYBOARD_ACTIONS = ["down", "insertText", "press", "type"] as const;

const MOUSE_ACTIONS = ["click", "dblclick", "down", "wheel"] as const;

/**
 * What one test's page hands back over the bindings.
 */
interface Collected {
  readonly seen: Set<string>;
  readonly findings: Finding[];
  readonly errors: string[];
  checks: number;
  checkMs: number;
  endMs: number;
}

/**
 * What a spec gets from the fixture. Most never ask: it is automatic.
 * The fixture's own spec uses it to check a page on demand and read what
 * was found.
 */
export interface A11y {
  readonly checkNow: () => Promise<void>;
  /**
   * The end-of-test checks, now: the fixture's spec runs them on a probe.
   */
  readonly endOfTest: () => Promise<void>;
  readonly findings: () => readonly Finding[];
}

/**
 * Per worker: whether the prototypes are wrapped yet, and the page the
 * current test drives, which is what a wrapped action checks.
 */
const worker: {
  current: Page | undefined;
  measure: Measure | undefined;
  isWrapped: boolean;
} = {
  current: undefined,
  measure: undefined,
  isWrapped: false,
};

async function checkNow(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    await page.evaluate(async () => {
      await globalThis.__a11yCheck?.();
    });
  } catch {
    // The page navigated away or closed mid-check; the next action
    // checks whatever replaced it.
  }
}

function wrap(prototype: object, names: readonly string[]): void {
  for (const name of names) {
    const original: unknown = Reflect.get(prototype, name);
    if (typeof original !== "function") continue;
    Reflect.set(
      prototype,
      name,
      async function checked(this: unknown, ...args: unknown[]) {
        if (worker.current !== undefined) await checkNow(worker.current);
        if (worker.measure !== undefined && NAVIGATIONS.has(name)) {
          await flushCoverage(worker.measure);
        }
        const result: unknown = await Reflect.apply(original, this, args);
        return result;
      },
    );
  }
}

function wrapActions(page: Page): void {
  if (worker.isWrapped) return;
  worker.isWrapped = true;
  wrap(Object.getPrototypeOf(page.locator("html")) as object, LOCATOR_ACTIONS);
  wrap(Object.getPrototypeOf(page) as object, PAGE_ACTIONS);
  wrap(Object.getPrototypeOf(page.keyboard) as object, KEYBOARD_ACTIONS);
  wrap(Object.getPrototypeOf(page.mouse) as object, MOUSE_ACTIONS);
}

async function arm(
  page: Page,
  baseURL: string,
  collected: Collected,
): Promise<void> {
  await page.exposeBinding("hasA11yChecked", (_source, key: string) => {
    if (collected.seen.has(key)) return true;
    collected.seen.add(key);
    return false;
  });
  await page.exposeBinding("__a11yError", (_source, message: string) => {
    collected.errors.push(message);
  });
  await page.exposeBinding("__a11yReport", (_source, report: CheckReport) => {
    collected.checks += 1;
    collected.checkMs += report.ms;
    for (const raw of report.findings) {
      collected.findings.push(findingOf(report.url, raw));
    }
  });
  await page.addInitScript({ content: AXE_SOURCE });
  await page.addInitScript(installChecker, {
    origin: new URL(baseURL).origin,
    rules: RULES,
    minTarget: MIN_TARGET,
  });
  await page.addInitScript(installWalk, new URL(baseURL).origin);
}

/**
 * Runs a read of the final state, and once more if the document went away
 * under it. The dev server reloads a page when it has just optimized a
 * dependency, which on a fresh run lands right after the first test that
 * loads it (`home.spec.ts`, 2026-11-03); the state that matters is the
 * reloaded one. Any other error, or a second one, is the caller's.
 */
async function onSettledPage<T>(
  page: Page,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!String(error).includes("Execution context was destroyed")) throw error;
    await page.waitForLoadState("load");
    return read();
  }
}

/**
 * Step 2's checks, timed. A page that navigates or closes under them is
 * a checker error, which fails the test like a finding: a check that
 * did not run must not read as one that passed.
 */
async function runEndOfTest(
  page: Page,
  baseURL: string,
  collected: Collected,
): Promise<void> {
  const started = performance.now();
  try {
    await onSettledPage(page, () =>
      endOfTest(page, new URL(baseURL).origin, {
        check: () => checkNow(page),
        report: (report: PageReport) => {
          for (const raw of report.findings) {
            collected.findings.push(findingOf(report.url, raw));
          }
        },
      }),
    );
  } catch (error) {
    collected.errors.push(`end of test: ${String(error)}`);
  }
  collected.endMs += Math.round(performance.now() - started);
}

/**
 * Step 4's transcript of the final state, at the test's own width (the
 * end-of-test checks resize after it). A page that fails under it is a
 * checker error, like step 2's.
 */
async function readTranscript(
  page: Page,
  baseURL: string,
  collected: Collected,
): Promise<string | undefined> {
  if (
    page.isClosed() ||
    new URL(page.url()).origin !== new URL(baseURL).origin
  ) {
    return undefined;
  }
  try {
    const phrases = await onSettledPage(page, () => transcriptOf(page));
    return `${phrases.join("\n")}\n`;
  } catch (error) {
    collected.errors.push(`transcript: ${String(error)}`);
    return undefined;
  }
}

/**
 * One transcript per test, named by its title: the file is
 * `e2e/transcripts/<spec>/<title>.txt` (`snapshotPathTemplate`).
 */
function transcriptName(testInfo: TestInfo): string {
  return `${testInfo.titlePath.slice(1).join(" ")}.txt`;
}

/**
 * Each distinct finding once, in the order first seen.
 */
function distinct(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = keyOf(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function record(test: string, collected: Collected): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const line = {
    test,
    checks: collected.checks,
    checkMs: collected.checkMs,
    endMs: collected.endMs,
    errors: collected.errors,
    findings: distinct(collected.findings),
  };
  appendFileSync(`${REPORT_DIR}/findings.jsonl`, `${JSON.stringify(line)}\n`);
}

function failOnNew(collected: Collected): void {
  const fresh = distinct(collected.findings).filter(
    (finding) => !BASELINE.has(keyOf(finding)),
  );
  if (fresh.length === 0 && collected.errors.length === 0) return;
  const lines = [
    ...fresh.map((finding) => `  ${keyOf(finding)}`),
    ...collected.errors.map((error) => `  checker error: ${error}`),
  ];
  throw new Error(
    `Accessibility: ${String(lines.length)} new finding(s), not in e2e/a11y-baseline.json:\n${lines.join("\n")}`,
  );
}

export const test = base.extend<{
  a11yMode: "enforce" | "collect";
  a11y: A11y;
}>({
  a11yMode: ["enforce", { option: true }],
  a11y: [
    async ({ page, baseURL, a11yMode }, use, testInfo) => {
      const collected: Collected = {
        seen: new Set(),
        findings: [],
        errors: [],
        checks: 0,
        checkMs: 0,
        endMs: 0,
      };
      const measure = IS_MEASURING
        ? await startMeasuring(page, new URL(baseURL ?? "").origin)
        : undefined;
      await arm(page, baseURL ?? "", collected);
      wrapActions(page);
      worker.current = page;
      worker.measure = measure;
      try {
        await use({
          checkNow: () => checkNow(page),
          endOfTest: () => runEndOfTest(page, baseURL ?? "", collected),
          findings: () => distinct(collected.findings),
        });
        await checkNow(page);
      } finally {
        worker.current = undefined;
        worker.measure = undefined;
      }
      let transcript: string | undefined;
      if (testInfo.status === testInfo.expectedStatus) {
        if (a11yMode === "enforce") {
          transcript = await readTranscript(page, baseURL ?? "", collected);
        }
        await runEndOfTest(page, baseURL ?? "", collected);
      }
      if (measure !== undefined) await stopMeasuring(measure);
      record(testInfo.titlePath.join(" › "), collected);
      if (a11yMode === "enforce" && !IS_RECORDING) failOnNew(collected);
      if (transcript !== undefined) {
        expect(transcript).toMatchSnapshot(transcriptName(testInfo));
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
