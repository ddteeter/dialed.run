import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The base test for `*.demo.spec.ts`. Recording is configured by the `demo`
 * Playwright project; this adds the parts a project cannot express:
 *
 * - a synthetic cursor (dot + click ripple) is drawn where the mouse acts,
 *   because otherwise a click reads as content mutating for no visible
 *   reason — animated from rAF, independent of page CSS;
 * - `goto` resolves only after `document.fonts.ready`, so a recording never
 *   opens on fallback-font frames mid-swap (the FOUT window);
 * - `scene()` captions and paces the recording (see below).
 *
 * Motion is deliberately NOT stripped: demos are a primary review surface
 * and must show the Motion Doctrine's real behavior (owner decision,
 * 2026-09-06 — see docs/design-deltas.md). Doctrine moves cap at 320ms,
 * well inside the demo project's slowMo gaps, and Playwright's
 * actionability checks wait out moving targets. If a demo flakes on
 * timing, fix its waits — do not re-add a motion-strip stylesheet.
 */
/**
 * Milliseconds of pacing per Playwright action, and the switch that decides
 * whether anything is recorded at all. Mirrors `playwright.config.ts`, which
 * owns the `slowMo` and `video` options this cannot reach.
 */
const demoSlowMo = Number(process.env.DEMO_SLOWMO ?? 0);

/**
 * How long a caption holds, from how long it takes to read.
 *
 * ~230 words/minute is unhurried; the floor keeps a three-word caption on
 * screen long enough to register and the ceiling stops a long one stalling
 * the recording. These are the only pacing numbers left that a human tunes.
 */
const SCENE_MIN_MS = 1400;
const SCENE_PER_WORD_MS = 260;
const SCENE_MAX_MS = 4200;

function holdFor(text: string): number {
  const words = text.trim().split(/\s+/u).length;
  return Math.min(
    Math.max(SCENE_MIN_MS, words * SCENE_PER_WORD_MS),
    SCENE_MAX_MS,
  );
}

/**
 * Caption the recording and hold a beat, so a viewer can see what is being
 * demonstrated before it happens.
 *
 * **This narrates; the `expect` beside it proves.** A caption is a claim
 * about what the next few actions show, and it is checked by the assertion
 * that follows — never instead of one. Write it in the spec, where a
 * reviewer reads it in the diff; nothing here generates text at record
 * time, which is how a video ends up describing intent rather than
 * behaviour.
 *
 * **Inert without `DEMO_SLOWMO`.** CI runs these journeys as assertions and
 * has no use for the pause, so this returns immediately and costs nothing.
 *
 * **The text never enters the DOM.** It is the `content` of an `html::after`
 * rule, so it is painted without existing in the document and no locator
 * can match it — `getByText("Closet: 6 pieces")` cannot be satisfied by a
 * caption that happens to say the same words. A caption rendered as a real
 * element would make every narrated assertion vacuous, which is the one way
 * this helper could quietly destroy the suite it decorates.
 *
 * **A stylesheet rather than `page.evaluate`**, which cannot be used here:
 * `unicorn/isolated-functions` rejects a callback that reaches `document`,
 * and rightly — the callback runs in the browser, where this file's scope
 * does not exist. `addStyleTag` takes a plain string from Node instead.
 *
 * **Each tag carries the whole rule**, rather than a shared box in the init
 * script that scenes only fill the `content` of. The init script runs before
 * the document is parsed, so inserting an element there throws on a null
 * `documentElement` — and an init script that throws takes everything after
 * it down, which silently killed the `data-fonts-ready` poller below and
 * hung every `goto` in the suite. Nothing in the init script is worth that.
 * Superseded tags simply lose to the next by document order.
 */
export async function scene(page: Page, text: string): Promise<void> {
  if (demoSlowMo === 0) return;
  await page.addStyleTag({ content: captionRule(text) });
  await page.waitForTimeout(holdFor(text));
}

/**
 * The whole caption, as one CSS rule.
 *
 * Mono, uppercase and pinned to the top edge: it has to read as
 * instrumentation laid over the app, never as product chrome a reviewer
 * might take for a real surface. Same pink as the synthetic cursor, which
 * is the other thing in this file that is not the product.
 *
 * **Top, because the bottom is the tab bar.** `Layout` puts five tabs
 * there and the demos click them, so a caption pinned to the bottom hid
 * the navigation a viewer is watching the cursor use — visible in a
 * recorded frame, not in any assertion. The top edge carries only the
 * notification bell, which no demo drives.
 *
 * Exported so `scene.spec.ts` can pin the property everything above rests
 * on — that the text is painted without entering the document.
 */
export function captionRule(text: string): string {
  // JSON.stringify is the escaping: a CSS string literal and a JS one agree
  // on quotes and backslashes, which is all a caption can contain.
  return `html::after {
    content: ${JSON.stringify(text)};
    position: fixed; inset: 0 0 auto 0; z-index: 2147483646;
    pointer-events: none;
    background: rgba(12,12,12,0.92); color: #f5f5f0;
    font: 500 13px/1.4 "IBM Plex Mono", ui-monospace, monospace;
    letter-spacing: 0.09em; text-transform: uppercase;
    padding: 14px 20px; border-bottom: 2px solid rgba(255,45,135,0.9);
  }`;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const layer = "pointer-events:none;z-index:2147483647;position:fixed;";

      const pink = "255,45,135";
      let dot: HTMLDivElement | undefined;
      let targetX = -100;
      let targetY = -100;
      let x = -100;
      let y = -100;

      const track = (): void => {
        x += (targetX - x) * 0.3;
        y += (targetY - y) * 0.3;
        if (dot !== undefined) {
          dot.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
        }
        requestAnimationFrame(track);
      };

      const ensureDot = (): void => {
        if (dot !== undefined) return;
        dot = document.createElement("div");
        dot.style.cssText = `${layer}left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;background:rgba(${pink},0.25);border:2px solid rgba(${pink},0.9);`;
        document.documentElement.insertAdjacentElement("beforeend", dot);
        requestAnimationFrame(track);
      };

      const ripple = (clickX: number, clickY: number): void => {
        const ring = document.createElement("div");
        ring.style.cssText = `${layer}left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;border:3px solid rgba(${pink},0.9);`;
        document.documentElement.insertAdjacentElement("beforeend", ring);
        const started = performance.now();
        const grow = (now: number): void => {
          const progress = Math.min((now - started) / 450, 1);
          ring.style.transform = `translate(${String(clickX)}px, ${String(clickY)}px) scale(${String(1 + progress * 1.6)})`;
          ring.style.opacity = String(1 - progress);
          if (progress < 1) {
            requestAnimationFrame(grow);
          } else {
            ring.remove();
          }
        };
        requestAnimationFrame(grow);
      };

      globalThis.addEventListener(
        "mousemove",
        (event) => {
          ensureDot();
          targetX = event.clientX;
          targetY = event.clientY;
        },
        { capture: true, passive: true },
      );
      globalThis.addEventListener(
        "mousedown",
        (event) => {
          ensureDot();
          ripple(event.clientX, event.clientY);
        },
        { capture: true, passive: true },
      );

      // Reflected into the DOM so the Node side can wait on a selector —
      // `page.evaluate` callbacks may not touch browser globals (lint).
      // Polled rather than awaited: the `document.fonts.ready` promise
      // captured at init-script time is replaced once a loading cycle starts
      // and never resolves, and React's document-level hydration can wipe
      // the attribute — the interval self-heals both.
      setInterval(() => {
        const isAnyFaceLoaded = [...document.fonts].some(
          (face) => face.status === "loaded",
        );
        if (isAnyFaceLoaded && document.fonts.status === "loaded") {
          document.documentElement.dataset.fontsReady = "true";
        }
      }, 100);
    });

    const rawGoto = page.goto.bind(page);
    page.goto = async (...args: Parameters<Page["goto"]>) => {
      const response = await rawGoto(...args);
      await page
        .locator('html[data-fonts-ready="true"]')
        .waitFor({ state: "attached" });
      return response;
    };

    await use(page);
  },
});

export { expect } from "@playwright/test";
