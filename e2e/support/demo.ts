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
 *   opens on fallback-font frames mid-swap (the FOUT window).
 *
 * Motion is deliberately NOT stripped: demos are a primary review surface
 * and must show the Motion Doctrine's real behavior (owner decision,
 * 2026-09-06 — see docs/design-deltas.md). Doctrine moves cap at 320ms,
 * well inside the demo project's slowMo gaps, and Playwright's
 * actionability checks wait out moving targets. If a demo flakes on
 * timing, fix its waits — do not re-add a motion-strip stylesheet.
 */
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
