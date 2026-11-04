import type { Page } from "@playwright/test";

import type { PageReport } from "./a11y-walk";
import { DESK, PHONE } from "./bars";

/**
 * Plan 161, step 2: what runs once at the end of a test, on its final
 * state (`docs/designs/161-a11y-coverage.md` §2). The in-page half is
 * `a11y-walk.ts`.
 *
 * 1. A Tab walk at the test's own width: every control reached, each
 *    stop's ring drawn and uncovered, focus never stuck.
 * 2. The other width, PHONE or DESK, checked again by step 1's checker.
 * 3. Reflow at 320 CSS pixels (WCAG 1.4.10).
 */

/**
 * WCAG 1.4.10's 320 CSS pixels, at a small phone's height.
 */
export const REFLOW = { width: 320, height: 568 } as const;

type Size = Readonly<{ width: number; height: number }>;

/**
 * Of PHONE and DESK, the one farther from where the test ended: a test
 * at 390 is checked at 1280, and one at 1280 at 390.
 */
export function otherWidth(width: number): Size {
  return Math.abs(width - PHONE.width) > Math.abs(width - DESK.width)
    ? PHONE
    : DESK;
}

export interface EndOfTest {
  /**
  Runs step 1's checker on the page as it stands.
  */
  readonly check: () => Promise<void>;
  /**
  Takes what the page found.
  */
  readonly report: (report: PageReport) => void;
}

/**
 * Two frames, so a resize has been laid out and React has answered the
 * media queries it reads.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        );
      }),
  );
}

async function tabWalk(page: Page, end: EndOfTest): Promise<void> {
  const presses = await page.evaluate(
    () => globalThis.__a11yWalk?.start() ?? 0,
  );
  let isDone = false;
  for (let press = 0; !isDone && press < presses; press += 1) {
    await page.keyboard.press("Tab");
    isDone = await page.evaluate(() => globalThis.__a11yWalk?.step() ?? true);
  }
  const found = await page.evaluate(
    (isCut) => globalThis.__a11yWalk?.finish(isCut),
    !isDone,
  );
  if (found !== undefined) end.report(found);
}

export async function endOfTest(
  page: Page,
  origin: string,
  end: EndOfTest,
): Promise<void> {
  if (page.isClosed() || new URL(page.url()).origin !== origin) return;
  await tabWalk(page, end);
  const own = page.viewportSize() ?? DESK;
  await page.setViewportSize(otherWidth(own.width));
  await settle(page);
  await end.check();
  await page.setViewportSize(REFLOW);
  await settle(page);
  const reflow = await page.evaluate(() => globalThis.__a11yWalk?.reflow());
  if (reflow !== undefined) end.report(reflow);
}
