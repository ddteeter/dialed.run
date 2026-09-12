import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../src/lib/contracts";
import { NowGoRun } from "../../src/modules/onboarding/components/NowGoRun";

/**
 * Screen P3, the close.
 *
 * Design's note under the artboard is the specification: *"No history
 * seeding, no first call — so the honest ending is an instruction plus a
 * promise, not a payoff."* So the assertions are about what it says and
 * what it carefully does not.
 */
async function renderScreen() {
  const rootRoute = createRootRoute({ component: () => <NowGoRun /> });
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

    expect(
      screen.getByRole("heading", { name: "Now go run." }),
    ).toBeVisible();
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

    expect(screen.getByRole("link", { name: "Connect" })).toHaveAttribute(
      "href",
      "/runs/strava",
    );
    expect(
      screen.getByText("We read that a run happened. Nothing else."),
    ).toBeVisible();
    expect(screen.getByText("So we can remind you. Optional.")).toBeVisible();
  });

  it("promises nothing it has not earned", async () => {
    // The screen a user reaches with an empty history. Nothing here may
    // congratulate, and nothing may read as a recommendation — the call is
    // the next epic and this screen is the reason it is not shipped yet.
    await renderScreen();

    const page = screen.getByRole("heading", { name: "Now go run." })
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
