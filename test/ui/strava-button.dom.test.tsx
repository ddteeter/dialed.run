import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StravaButton } from "../../src/ui";

/**
 * Strava's official Connect button (round 26, item 21; task 127, STR-7).
 *
 * The rules under test are Strava's and design's: the asset is used as
 * the image file, unaltered, 48 tall; our `<a>` is named "Connect with
 * Strava" and leads to the OAuth redirect; while OAuth is in flight our
 * brackets show beside it and the asset never changes.
 */
async function renderButton() {
  const rootRoute = createRootRoute({ component: () => <StravaButton /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

/**
 * A full-document navigation is the browser's to make; happy-dom would try
 * to follow it. Stopped at the document, after React has seen the click.
 */
function stayOnPage(event: Event): void {
  event.preventDefault();
}

afterEach(() => {
  document.removeEventListener("click", stayOnPage);
});

describe("StravaButton", () => {
  it("is a link named Connect with Strava, to the OAuth redirect", async () => {
    await renderButton();

    const link = screen.getByRole("link", { name: "Connect with Strava" });
    expect(link).toHaveAttribute("href", "/runs/strava-connect");
    // The one palette exemption besides Google's (round 26, item 21).
    expect(link).toHaveAttribute("data-part", "strava-button");
    // A tappable thing carries the 44px target (Accessibility rule 03).
    expect(link).toHaveClass("target");
  });

  it("uses Strava's orange asset as the image file, 48 tall", async () => {
    await renderButton();

    const image = screen.getByRole("img", { name: "Connect with Strava" });
    expect(image).toHaveAttribute(
      "src",
      "/strava/btn_strava_connect_with_orange.svg",
    );
    expect(image).toHaveAttribute("height", "48");
    expect(image).toHaveAttribute("width", "237");
    expect(image).toHaveClass("h-12");
  });

  it("shows our brackets beside it while OAuth is in flight, and keeps the asset", async () => {
    const user = userEvent.setup();
    await renderButton();
    document.addEventListener("click", stayOnPage);

    const pending = screen.getByText("Connecting");
    expect(pending).toHaveStyle({ visibility: "hidden" });

    await user.click(screen.getByRole("link", { name: "Connect with Strava" }));

    expect(pending).not.toHaveStyle({ visibility: "hidden" });
    expect(pending).toHaveTextContent("[Connecting]");
    // The asset is untouched: same name, same file.
    expect(
      screen.getByRole("img", { name: "Connect with Strava" }),
    ).toHaveAttribute("src", "/strava/btn_strava_connect_with_orange.svg");
  });
});
