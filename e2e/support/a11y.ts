import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { z } from "zod";

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
// Design 182: D1 queries per request, recorded under every a11y-checked spec.
import { test as base } from "./query-record";
import { audit, auditShot } from "./audit-shot";

/**
 * Plan 161, step 1: accessibility checks on every state an e2e spec acts
 * on, in a real browser with the real stylesheet.
 *
 * **When it checks: before every action, after every web-first `expect`
 * that passed, and once at the end.** A spec
 * waits for a state and then acts on it, so the moment before a click,
 * fill, navigation or resize is a state the spec meant to reach; a state
 * it only asserts on (a pending label, a band that clears) is the moment
 * its `expect` passes (R-189, design 195). Waiting
 * for the DOM to go quiet does not work at machine speed: the closet
 * journey makes ~900 mutations in ten seconds and never settles (step 0).
 * So the action methods of `Locator`, `Page`, `Keyboard` and `Mouse` are
 * wrapped, once per worker, to run the check first, and `Locator`'s
 * `_expect`, which every web-first matcher on a locator ends in, to run
 * it after. A state is checked
 * once per test, keyed by a hash of its markup and the viewport width.
 *
 * **Then, at the end of a test that passed** (step 2, `a11y-end.ts`): a
 * Tab walk, the other width, and reflow at 320px, on the hydrated page
 * (`hydrated` below). The action wrapper is
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
  origin: string;
} = {
  origin: "",
  current: undefined,
  measure: undefined,
  isWrapped: false,
};

async function checkNow(page: Page): Promise<void> {
  if (page.isClosed() || audit.isShooting) return;
  try {
    await page.evaluate(async () => {
      await globalThis.__a11yCheck?.();
    });
  } catch {
    // The page navigated away or closed mid-check; the next action
    // checks whatever replaced it.
  }
  await auditShot(page, worker.origin);
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

/**
 * `Locator._expect`'s answer and its options, as far as the fixture
 * reads them: whether the matcher matched, and whether it was a `.not`.
 */
const expectAnswerSchema = z.object({ matches: z.boolean() });
const expectOptionsSchema = z.object({ isNot: z.boolean().optional() });

const EXPECT_MOVED =
  "a11y fixture: Locator._expect is not what it was; Playwright changed it, so asserted states would go unchecked (design 195)";

/**
 * Whether the matcher passed. An answer or options of another shape is
 * a Playwright that changed under the fixture, and throws: the check
 * after an `expect` must never turn itself off in silence.
 */
function hasPassed(answer: unknown, options: unknown): boolean {
  const parsed = expectAnswerSchema.safeParse(answer);
  const asked = expectOptionsSchema.safeParse(options);
  if (!parsed.success || !asked.success) throw new TypeError(EXPECT_MOVED);
  return parsed.data.matches !== (asked.data.isNot ?? false);
}

/**
 * R-189: a state a spec asserts on and never acts on is checked when its
 * `expect` passes. Every web-first matcher on a locator (`toBeVisible`,
 * `toHaveText`, `toHaveCount`, and their `.not`, `.soft` and
 * `expect.configure` forms) ends in the locator's `_expect`, so wrapping
 * that one method reaches them all with no proxy over `expect`. A matcher
 * that failed or timed out is not a state the spec reached, and is not
 * checked. `expect.poll`, `toPass` and `toHaveURL` poll a value, not a
 * locator, and are not covered.
 *
 * `_expect` is Playwright's own, not its API: an upgrade that moves it
 * must fail here, not stop checking in silence.
 */
function wrapExpect(prototype: object): void {
  const original: unknown = Reflect.get(prototype, "_expect");
  if (typeof original !== "function") throw new TypeError(EXPECT_MOVED);
  Reflect.set(
    prototype,
    "_expect",
    async function checkedExpect(this: unknown, ...args: unknown[]) {
      const answer: unknown = await Reflect.apply(original, this, args);
      const isPassed = hasPassed(answer, args[1]);
      if (isPassed && worker.current !== undefined) {
        await checkNow(worker.current);
      }
      return answer;
    },
  );
}

function wrapActions(page: Page): void {
  if (worker.isWrapped) return;
  worker.isWrapped = true;
  wrapExpect(Object.getPrototypeOf(page.locator("html")) as object);
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
 * How long a page may take to hydrate once its test is over. A cold dev
 * server compiles a route's client code on first visit, which CI has
 * seen take seconds.
 */
const HYDRATION_CAP_MS = 15_000;

/**
 * Waits until the app has hydrated the page a test ended on, before
 * anything reads its final state (#566, design 195).
 *
 * A spec that ends on an `expect` the server's HTML already satisfies
 * ends before hydration, and on the dev server the client code is not
 * even fetched until after `load`. Hydration then lands under the end
 * checks: the router restores scroll to the top, so the stop the Tab
 * walk had just scrolled to is off screen when it is measured, and
 * reads as `focus-obscured`.
 *
 * The app's documents load a module script and stamp
 * `html[data-hydrated]` (`src/ui/use-hydrated.ts`); a document with no
 * module script (the fixture's probes, a raw endpoint) has nothing to
 * wait for. An app page that never hydrates is a checker error.
 */
async function hydrated(
  page: Page,
  baseURL: string,
  collected: Collected,
): Promise<void> {
  if (
    page.isClosed() ||
    new URL(page.url()).origin !== new URL(baseURL).origin
  ) {
    return;
  }
  try {
    await onSettledPage(page, () =>
      page.waitForFunction(
        () =>
          document.documentElement.dataset.hydrated === "true" ||
          document.querySelector('script[type="module"]') === null,
        undefined,
        { timeout: HYDRATION_CAP_MS },
      ),
    );
  } catch (error) {
    collected.errors.push(`hydration: ${String(error)}`);
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
  await hydrated(page, baseURL, collected);
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
    async ({ page, baseURL: appURL = "", a11yMode }, use, testInfo) => {
      const collected: Collected = {
        seen: new Set(),
        findings: [],
        errors: [],
        checks: 0,
        checkMs: 0,
        endMs: 0,
      };
      const measure = IS_MEASURING
        ? await startMeasuring(page, new URL(appURL).origin)
        : undefined;
      await arm(page, appURL, collected);
      wrapActions(page);
      worker.current = page;
      worker.measure = measure;
      worker.origin = new URL(appURL).origin;
      audit.title = testInfo.titlePath.join(" > ");
      try {
        await use({
          checkNow: () => checkNow(page),
          endOfTest: () => runEndOfTest(page, appURL, collected),
          findings: () => distinct(collected.findings),
        });
        if (testInfo.status === testInfo.expectedStatus) {
          await hydrated(page, appURL, collected);
        }
        await checkNow(page);
      } finally {
        worker.current = undefined;
        worker.measure = undefined;
      }
      let transcript: string | undefined;
      if (testInfo.status === testInfo.expectedStatus) {
        if (a11yMode === "enforce") {
          transcript = await readTranscript(page, appURL, collected);
        }
        await runEndOfTest(page, appURL, collected);
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
