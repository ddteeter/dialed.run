import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../src/lib/contracts";
import { NowGoRun } from "../../src/modules/onboarding/components/NowGoRun";
import { expectConsentBeforeButton } from "../ui/strava-consent";

/**
 * Screen P3, the close.
 *
 * Design's note under the artboard is the specification: *"No history
 * seeding, no first call — so the honest ending is an instruction plus a
 * promise, not a payoff."* So the assertions are about what it says and
 * what it carefully does not.
 */
async function renderScreen(again?: boolean) {
  const rootRoute = createRootRoute({
    component: () => <NowGoRun again={again} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("NowGoRun", () => {
  it("ends on an instruction", async () => {
    await renderScreen();

    expect(screen.getByRole("heading", { name: "Now go run." })).toBeVisible();
  });

  it("states the call promise in the threshold's own terms", async () => {
    // Derived, not typed: `CALL_VERDICT_THRESHOLD` is a number the owner is
    // expected to move, and a sentence with 15 written into it would keep
    // promising the old one after they did.
    await renderScreen();

    expect(
      screen.getByText(
        `After ${String(CALL_VERDICT_THRESHOLD)} verdicts we start making the call for you.`,
      ),
    ).toBeVisible();
  });

  it("says what logging buys, in design's own three lines", async () => {
    // The first two are fixed copy and the third is derived; all three are
    // the screen's only content besides the instruction, so a blank one is
    // a promise silently withdrawn.
    await renderScreen();

    // The section is found by its heading, drawn as the mono kicker.
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "What happens as you log",
    });
    expect(heading).toHaveClass("m-0", "text-hiviz-text");
    expect(within(heading).getByText("What happens as you log")).toHaveClass(
      "text-mono-xs",
    );

    expect(
      screen.getByText(
        "Weather comes with each run, fetched for when and where you ran.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Each piece learns the range it actually works in, for you.",
      ),
    ).toBeVisible();
  });

  it("numbers them 01, 02, 03", async () => {
    // Mono two-digit numbering, as the artboard draws it. One-based: "00"
    // would be the array index leaking onto the screen, and an unpadded
    // "1" is a different typographic object in this system.
    await renderScreen();

    const numbers = screen
      .getAllByRole("listitem")
      .map((row) => row.firstElementChild?.textContent);

    expect(numbers).toEqual(["01", "02", "03"]);
  });

  it("draws four completed steps, one per onboarding screen", async () => {
    // O1, O3, P2.5, P3. All filled, because arriving here is the end —
    // which is also why it is decoration rather than a progressbar.
    await renderScreen();

    const marker = document.querySelector("[aria-hidden='true']");

    expect(marker?.childElementCount).toBe(4);
  });

  it("offers both ways out, and neither is a dead end", async () => {
    await renderScreen();

    expect(
      screen.getByRole("link", { name: "I have a run to upload" }),
    ).toHaveAttribute("href", "/runs/new");
    expect(screen.getByRole("link", { name: "Done for now" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("says what connecting Strava does, next to the offer", async () => {
    // The product rule is that Strava activity data is never stored,
    // displayed or used — the webhook's only effect is a notification row.
    // An OAuth offer that explained that only in a privacy policy would be
    // asking for the grant on trust.
    await renderScreen();

    // Strava's official button in the slot (round 26, item 21), which
    // leaves straight for Strava's consent screen.
    // The Strava consent (API Policy §2.1) is read before the button.
    // It names P3, so a refused receipt's Try again comes back here.
    expectConsentBeforeButton("/runs/strava-connect?from=onboarding");
    expect(
      screen.getByRole("heading", { level: 2, name: "Connect Strava" }),
    ).toHaveClass("m-0", "text-body", "font-semibold");
    expect(screen.getByText("So we can remind you. Optional.")).toBeVisible();
    // Round 39 #66: retired here — the consent says it in full.
    expect(
      screen.queryByText("We read that a run happened. Nothing else."),
    ).toBeNull();
  });

  it("heads the offer, and leaves focus alone on an ordinary visit", async () => {
    await renderScreen();

    const offer = screen.getByRole("heading", {
      level: 2,
      name: "Connect Strava",
    });
    expect(offer).not.toHaveAttribute("tabindex");
    expect(offer).not.toHaveFocus();
  });

  it("lands focus on the offer's heading when back from Try again (round 39 #66)", async () => {
    await renderScreen(true);

    const offer = screen.getByRole("heading", {
      level: 2,
      name: "Connect Strava",
    });
    expect(offer).toHaveAttribute("tabindex", "-1");
    expect(offer).toHaveFocus();
  });

  it("promises nothing it has not earned", async () => {
    // The screen a user reaches with an empty history. Nothing here may
    // congratulate, and nothing may read as a recommendation — the call is
    // the next epic and this screen is the reason it is not shipped yet.
    await renderScreen();

    const page = screen
      .getByRole("heading", { name: "Now go run." })
      .closest("div")?.parentElement;

    expect(page?.textContent).not.toMatch(/congrat|all set|you're ready|nice/i);
  });

  it("keeps the four-step marker out of the accessible tree", async () => {
    // It restates the heading, and a progress bar that is always complete
    // reports nothing. So it is decoration, and announced as none.
    await renderScreen();

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
