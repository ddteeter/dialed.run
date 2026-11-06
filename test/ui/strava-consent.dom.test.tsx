import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  STRAVA_CONSENT,
  consentRunText,
  stravaConsentText,
} from "../../src/lib/copy";
import { StravaConsent } from "../../src/ui";
import { expectConsentBeforeButton } from "./strava-consent";

/**
 * The consent in front of Strava's official button (Strava API Policy
 * §2.1, 1 June 2026; owner, 2026-10-18).
 */
async function renderConsent(from?: "onboarding") {
  const rootRoute = createRootRoute({
    component: () => <StravaConsent from={from} />,
  });
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
    ).toEqual(STRAVA_CONSENT.map((paragraph) => stravaConsentText(paragraph)));
  });

  it("runs each lead-in in, semibold, at the paragraph's own size (round 39 #66)", async () => {
    await renderConsent();

    const leads = [
      ...document.querySelectorAll(
        "[data-slot='strava-consent'] [data-part='consent-lead']",
      ),
    ];
    expect(leads.map((lead) => lead.textContent)).toEqual([
      "What we collect:",
      "How:",
      "Never:",
      "To stop:",
    ]);
    for (const lead of leads) {
      // Inside its paragraph, not a label over it, and no size of its own.
      expect(lead.parentElement?.tagName).toBe("P");
      expect(lead.className).toBe("font-semibold");
    }
    // Nothing but paragraphs and their lead-ins: no label over a paragraph,
    // and no `strong`, which a screen reader announces around each lead-in.
    expect(
      new Set(
        [...document.querySelectorAll("[data-slot='strava-consent'] *")].map(
          (element) => element.tagName,
        ),
      ),
    ).toEqual(new Set(["P", "SPAN"]));
  });

  it("names where the trip started on the button's link", async () => {
    await renderConsent("onboarding");

    expectConsentBeforeButton("/runs/strava-connect?from=onboarding");
  });
});

describe("stravaConsentText", () => {
  it("reads a lead-in and its text with one space between, and runs likewise", () => {
    expect(consentRunText({ text: "Plain." })).toBe("Plain.");
    expect(consentRunText({ lead: "How:", text: "this way." })).toBe(
      "How: this way.",
    );
    expect(
      stravaConsentText([
        { lead: "A:", text: "one." },
        { lead: "B:", text: "two." },
      ]),
    ).toBe("A: one. B: two.");
  });
});

describe("STRAVA_CONSENT", () => {
  it("is the owner's approved wording, verbatim", () => {
    // Pinned word for word on purpose: this is the disclosure Strava's
    // policy requires, approved by the owner on 2026-10-18. A change to it
    // is a change to what runners consent to, so it should fail loudly
    // here and be made deliberately.
    expect(
      STRAVA_CONSENT.map((paragraph) => stravaConsentText(paragraph)),
    ).toEqual([
      "Connecting Strava lets us remind you to log a kit after each run.",
      "What we collect: your Strava athlete id, a token we use only to disconnect, and, for 7 days, the id, type and time of each new activity so we remind you once. How: through Strava's sign-in and its activity notifications. Never: your activity details, route, pace or anything else about the run.",
      "To stop: Disconnect in Settings, or remove dialed.run under Strava › Settings › My Apps. Either deletes what we hold from Strava, apart from what we need to finish disconnecting, and we email you to confirm it.",
    ]);
  });
});
