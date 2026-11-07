import { afterEach, expect, it } from "vitest";

import { THEME_HEAD_SCRIPT, THEME_KEY } from "../../src/lib/browser/theme";

/**
 * The theme's head script, run the way the page runs it: as an inline
 * `<script>` in a real browser, which happy-dom cannot do (design 185).
 */
function runAsTheHeadDoes(): void {
  const script = document.createElement("script");
  script.textContent = THEME_HEAD_SCRIPT;
  // `head.append(script)`, spelled this way for the reason
  // `zod-jitless.browser.test.ts` gives.
  document.head.replaceChildren(...document.head.childNodes, script);
  script.remove();
}

const root = document.documentElement;

afterEach(() => {
  delete root.dataset.theme;
  localStorage.clear();
});

it.each(["light", "dark"])("pins %s from the device before paint", (value) => {
  localStorage.setItem(THEME_KEY, value);

  runAsTheHeadDoes();

  expect(root.dataset.theme).toBe(value);
});

it("follows the system when the device has nothing", () => {
  runAsTheHeadDoes();

  expect(Object.hasOwn(root.dataset, "theme")).toBe(false);
});

it("follows the system for a value it does not know", () => {
  localStorage.setItem(THEME_KEY, "system");
  runAsTheHeadDoes();
  expect(Object.hasOwn(root.dataset, "theme")).toBe(false);

  localStorage.setItem(THEME_KEY, "sepia");
  runAsTheHeadDoes();
  expect(Object.hasOwn(root.dataset, "theme")).toBe(false);
});
