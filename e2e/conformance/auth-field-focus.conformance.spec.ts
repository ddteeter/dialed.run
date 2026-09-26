import { expect, test } from "@playwright/test";

import { hydrated } from "../support/conformance";

/**
 * A focused field draws one ring, on its box — Accessibility Contract §06,
 * and `ui/a11y.css`'s "the ring moves, never removed".
 *
 * **Only a browser can answer this.** The ring rules are unlayered on
 * purpose, so no layered Tailwind utility can remove a ring, and the rule
 * that takes the ring off the input must therefore be unlayered too — an
 * unlayered rule always beats a layered one, whatever the specificity.
 * It was an `@utility`, so it lived in the utilities layer and never
 * applied: every focused field drew a second square ring on the
 * borderless input inside its box (PR #104, Drew's "two borders"). happy-
 * dom does not implement cascade layers, so the unit suite could not see
 * it; this reads the computed style the real cascade produced.
 */
test("a focused field rings its box, and only its box", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/auth/login");
  await hydrated(page);

  const email = page.getByLabel("Email");
  // The keyboard, because `:focus-visible` is the keyboard's: a pointer
  // press does not show the ring at all.
  // After a key press, a focus move shows the ring as a Tab would.
  await page.keyboard.press("Shift");
  await email.focus();
  await expect(email).toBeFocused();

  const input = await email.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle };
  });
  const box = await email.evaluate((element) => {
    const fieldBox = element.closest(".field-box");
    if (fieldBox === null) return;
    const style = getComputedStyle(fieldBox);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
    };
  });

  expect(input.outlineStyle, "the input draws a ring of its own").toBe("none");
  // On the border (decision D-48, round 26 #16): one line, not two.
  expect(box, "the field has no .field-box").toEqual({
    outlineStyle: "solid",
    outlineWidth: "2px",
    outlineOffset: "-1px",
  });
});

test("every other control keeps its ring 2px outside it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/auth/login");
  await hydrated(page);

  const button = page.getByRole("button", { name: "Log in" });
  await page.keyboard.press("Shift");
  await button.focus();
  await expect(button).toBeFocused();

  const ring = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineOffset: style.outlineOffset,
    };
  });

  // Accessibility Contract §06, which D-48 overrides for FormFields only.
  expect(ring).toEqual({ outlineStyle: "solid", outlineOffset: "2px" });
});
