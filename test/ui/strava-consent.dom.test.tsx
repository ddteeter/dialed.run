import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STRAVA_CONSENT } from "../../src/lib/copy";
import { StravaConsent } from "../../src/ui";
import { expectConsentBeforeButton } from "./strava-consent";

/**
 * The consent in front of Strava's official button (Strava API Policy
 * §2.1, 1 June 2026; owner, 2026-10-18).
 */
async function renderConsent() {
  const rootRoute = createRootRoute({ component: () => <StravaConsent /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("StravaConsent", () => {
  it("shows the disclosure, then the official button to the OAuth redirect", async () => {
    await renderConsent();

    expectConsentBeforeButton();
    // Strava's asset, unchanged.
    expect(
      screen.getByRole("img", { name: "Connect with Strava" }),
    ).toHaveAttribute("src", "/strava/btn_strava_connect_with_orange.svg");
  });

  it("draws one paragraph per entry, in order, in one block", async () => {
    await renderConsent();

    const block = document.querySelector("[data-slot='strava-consent']");
    expect(
      [...(block?.querySelectorAll("p") ?? [])].map((p) => p.textContent),
    ).toEqual([...STRAVA_CONSENT]);
  });
});

describe("STRAVA_CONSENT", () => {
  it("is the owner's approved wording, verbatim", () => {
    // Pinned word for word on purpose: this is the disclosure Strava's
    // policy requires, approved by the owner on 2026-10-18. A change to it
    // is a change to what runners consent to, so it should fail loudly
    // here and be made deliberately.
    expect(STRAVA_CONSENT).toEqual([
      "Connecting Strava lets us remind you to log a kit after each run.",
      "What we collect: your Strava athlete id, a token we use only to disconnect, and, for 7 days, the id, type and time of each new activity so we remind you once. How: through Strava's sign-in and its activity notifications. Never: your activity details, route, pace or anything else about the run.",
      "To stop: Disconnect in Settings, or remove dialed.run under Strava › Settings › My Apps. Either deletes what we hold from Strava, apart from what we need to finish disconnecting, and we email you to confirm it.",
    ]);
  });
});
