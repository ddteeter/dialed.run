import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Plan 161, step 0: axe on every state an e2e spec acts on.
 *
 * **Report-only, for the spike.** The plan's step 0 measures what the
 * checks cost and how many violations exist before anything enforces
 * them, so this records and never fails a test, and it does nothing at
 * all unless `A11Y_SPIKE=1` — CI runs the specs exactly as before. A spec
 * opts in by importing `test` from here instead of `@playwright/test`;
 * the results land in `test-results/a11y/report.jsonl`, one line a test.
 *
 * **When it checks: before every action, and once at the end.** A spec
 * waits for a state and then acts on it, so the moment before a click,
 * fill, navigation or resize is a state the spec meant to reach. The
 * first version waited instead for the DOM to go quiet for 150ms, and at
 * machine speed it never did: the closet journey made ~900 mutations in
 * ten seconds and got one check, at the end. So the action methods of
 * `Locator`, `Page`, `Keyboard` and `Mouse` are wrapped, once per worker,
 * to run the check first.
 *
 * Each state is checked once: the key is a hash of the body's markup and
 * the viewport width, kept here in node because a binding survives a
 * navigation and the page's own state does not. Pages on another origin
 * — the design boards `openBoard` loads — are not the app and are skipped.
 *
 * All rules in the AA tags run, `color-contrast` and `region` included:
 * this is a real browser with the real stylesheet, which is the reason
 * `test/ui/axe.ts` had to switch them off.
 */

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The slice of axe-core's API the in-page checker calls.
 */
interface Axe {
  run: (
    context: Document,
    runOptions: unknown,
  ) => Promise<{
    violations: { id: string; nodes: { html: string }[] }[];
  }>;
}

/**
 * The bindings and hooks the in-page checker sets up on the global object. Types
 * only: nothing here is emitted, so `installChecker` serializes unchanged.
 */
declare global {
  var hasA11yChecked: (key: string) => Promise<boolean>;
  var __a11yReport: (report: unknown) => Promise<void>;
  var __a11yError: (message: string) => Promise<void>;
  var __a11yCheck: (() => Promise<void>) | undefined;
  var axe: Axe | undefined;
}

/**
 * WCAG 2.5.5's 44 CSS pixels: the contract's floor, not axe's 24.
 */
const MIN_TARGET = 44;

const REPORT_DIR = "test-results/a11y";

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
 * One check's findings, as the page reports them.
 */
interface CheckReport {
  readonly key: string;
  readonly url: string;
  readonly width: number;
  readonly ms: number;
  readonly violations: readonly { id: string; nodes: string[] }[];
  readonly smallTargets: readonly string[];
}

/**
 * Everything a test's checks found, appended as one JSON line.
 */
interface TestReport {
  readonly test: string;
  readonly file: string;
  readonly durationMs: number;
  readonly checks: number;
  readonly skippedSeen: number;
  readonly checkMs: number;
  readonly reports: readonly CheckReport[];
  readonly errors: readonly string[];
}

/**
 * What one test's page hands back over the bindings.
 */
interface Collected {
  readonly seen: Set<string>;
  readonly reports: CheckReport[];
  readonly errors: string[];
  skippedSeen: number;
}

/**
 * The in-page half, serialized by `addInitScript`. Everything it uses must
 * be inside it.
 */
function installChecker(options: {
  origin: string;
  tags: string[];
  minTarget: number;
}): void {
  if (location.origin !== options.origin) return;

  const bridge = globalThis;

  const INTERACTIVE =
    "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [tabindex]:not([tabindex='-1'])";

  function smallTargets(): string[] {
    const found: string[] = [];
    for (const element of document.querySelectorAll(INTERACTIVE)) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < options.minTarget || box.height < options.minTarget) {
        found.push(
          `${element.outerHTML.slice(0, 120)} (${String(Math.round(box.width))}×${String(Math.round(box.height))})`,
        );
      }
    }
    return found;
  }

  async function check(): Promise<void> {
    const axe = bridge.axe;
    if (axe === undefined) return;
    // SHA-1 of the markup: a dedupe key, not a security boundary.
    const digest = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(document.body.getHTML()),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const key = `${String(innerWidth)}:${hex}`;
    if (await bridge.hasA11yChecked(key)) return;
    const started = performance.now();
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: options.tags },
    });
    await bridge.__a11yReport({
      key,
      url: location.pathname + location.search,
      width: innerWidth,
      ms: Math.round(performance.now() - started),
      violations: result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.html.slice(0, 200)),
      })),
      smallTargets: smallTargets(),
    });
  }

  /*
   * axe refuses to start while it is running, and a spec can fire two
   * actions at once (`Promise.all([waitForURL, click])`), so a second
   * check waits for the first.
   */
  let running: Promise<void> = Promise.resolve();
  bridge.__a11yCheck = async () => {
    const previous = running;
    running = (async () => {
      await previous;
      try {
        await check();
      } catch (error) {
        await bridge.__a11yError(String(error));
      }
    })();
    await running;
  };
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
    // The page navigated away or closed mid-check. The spike only
    // reports, and the next action checks whatever replaced it.
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
  const { seen, reports, errors } = collected;
  await page.exposeBinding("hasA11yChecked", (_source, key: string) => {
    if (seen.has(key)) {
      collected.skippedSeen += 1;
      return true;
    }
    seen.add(key);
    return false;
  });
  await page.exposeBinding("__a11yError", (_source, message: string) => {
    errors.push(message);
  });
  await page.exposeBinding("__a11yReport", (_source, report: CheckReport) => {
    reports.push(report);
  });
  await page.addInitScript({ content: AXE_SOURCE });
  await page.addInitScript(installChecker, {
    origin: new URL(baseURL).origin,
    tags: TAGS,
    minTarget: MIN_TARGET,
  });
}

function record(report: TestReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  appendFileSync(`${REPORT_DIR}/report.jsonl`, `${JSON.stringify(report)}\n`);
}

export const test = base.extend<{ a11y: undefined }>({
  a11y: [
    async ({ page, baseURL }, use, testInfo) => {
      if (process.env.A11Y_SPIKE !== "1") {
        await use(undefined);
        return;
      }
      const collected: Collected = {
        seen: new Set(),
        reports: [],
        errors: [],
        skippedSeen: 0,
      };
      await arm(page, baseURL ?? "", collected);
      wrapActions(page);
      worker.current = page;
      const started = Date.now();
      try {
        await use(undefined);
        await checkNow(page);
      } finally {
        worker.current = undefined;
      }
      const { reports } = collected;
      record({
        test: testInfo.titlePath.join(" › "),
        file: testInfo.file,
        durationMs: Date.now() - started,
        checks: reports.length,
        skippedSeen: collected.skippedSeen,
        checkMs: reports.reduce((sum, report) => sum + report.ms, 0),
        reports,
        errors: collected.errors,
      });
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
