import { screen } from "@testing-library/react";
import { expect } from "vitest";

import { STRAVA_CONSENT } from "../../src/lib/copy";

/**
 * Asserts the Strava consent (API Policy §2.1; owner, 2026-10-18) is on
 * screen and comes before the official Connect button, which still leaves
 * for the OAuth redirect. Every screen that draws the button calls this,
 * so an entry point without the disclosure fails its own test.
 */
export function expectConsentBeforeButton(): void {
  const button = screen.getByRole("link", { name: "Connect with Strava" });
  expect(button).toHaveAttribute("href", "/runs/strava-connect");
  expect(STRAVA_CONSENT).toHaveLength(3);
  for (const paragraph of STRAVA_CONSENT) {
    const shown = screen.getByText(paragraph);
    expect(shown).toBeVisible();
    expect(shown.tagName).toBe("P");
    // Before the button in reading order, so it is read before the click.
    expect(
      shown.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
}
