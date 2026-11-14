import { expect } from "vitest";

import { COLUMN } from "../../src/ui";

/**
 * Round 54 · 168.1: a screen that writes its own column takes `COLUMN`,
 * the one centred measure, rather than a left-aligned copy. Read from the
 * rendered screen, so a wrapper that lost its classes fails here.
 */
export function expectTheColumn(): void {
  const column = document.querySelector(".max-w-column");
  expect(column).toHaveClass(...COLUMN.split(" "), "flex", "flex-col");
}
