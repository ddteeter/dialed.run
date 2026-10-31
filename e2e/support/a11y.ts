import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { Finding } from "./a11y-findings";
import { findingOf, keyOf, loadBaseline, RULES } from "./a11y-findings";
import type { CheckReport } from "./a11y-page";
import { installChecker } from "./a11y-page";

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
}

/**
 * What a spec gets from the fixture. Most never ask: it is automatic.
 * The fixture's own spec uses it to check a page on demand and read what
 * was found.
 */
export interface A11y {
  readonly checkNow: () => Promise<void>;
  readonly findings: () => readonly Finding[];
}

/**
 * Per worker: whether the prototypes are wrapped yet, and the page the
 * current test drives, which is what a wrapped action checks.
 */
const worker: { current: Page | undefined; isWrapped: boolean } = {
  current: undefined,
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
  await page.exposeBinding(
    "__a11yReport",
    (_source, report: CheckReport) => {
      collected.checks += 1;
      collected.checkMs += report.ms;
      for (const raw of report.findings) {
        collected.findings.push(findingOf(report.url, raw));
      }
    },
  );
  await page.addInitScript({ content: AXE_SOURCE });
  await page.addInitScript(installChecker, {
    origin: new URL(baseURL).origin,
    rules: RULES,
    minTarget: MIN_TARGET,
  });
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
      };
      await arm(page, baseURL ?? "", collected);
      wrapActions(page);
      worker.current = page;
      try {
        await use({
          checkNow: () => checkNow(page),
          findings: () => distinct(collected.findings),
        });
        await checkNow(page);
      } finally {
        worker.current = undefined;
      }
      record(testInfo.titlePath.join(" › "), collected);
      if (a11yMode === "enforce" && !IS_RECORDING) failOnNew(collected);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
