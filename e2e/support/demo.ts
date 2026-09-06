import { test as base } from "@playwright/test";

/**
 * The base test for `*.demo.spec.ts`. Recording is configured by the `demo`
 * Playwright project; this adds the part a project cannot express: motion is
 * stripped, so a recording captures settled frames rather than whatever a
 * transition happened to be mid-way through, and re-records stay comparable.
 *
 * The project also sets `reducedMotion: "reduce"`, which is the correct
 * signal but only binds where the app honours the media query. This stylesheet
 * is the belt to that suspenders.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }`;
      // `append` here resolves against the Workers HTMLRewriter types rather
      // than the DOM, and `appendChild` trips unicorn/prefer-dom-node-append;
      // insertAdjacentElement is unambiguous to both.
      document.head.insertAdjacentElement("beforeend", style);
    });
    await use(page);
  },
});

export { expect } from "@playwright/test";
