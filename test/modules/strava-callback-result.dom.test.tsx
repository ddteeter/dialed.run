import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StravaCallbackResult } from "../../src/modules/runs/components/StravaCallbackResult";
import { renderWithRouter } from "./run-fixtures";

/**
 * The landing after Strava sends the runner back — a receipt in the panel
 * (round 22, item 23), in its three shapes.
 */
const location = { assign: vi.fn() };
vi.stubGlobal("location", location);

afterEach(() => {
  location.assign.mockClear();
});

const STRAVA = "https://www.strava.com/oauth/authorize?state=02";

function landing(
  result: { ok: true } | { ok: false; reason: string },
  overrides: {
    configured?: boolean;
    getAuthorizeUrl?: () => Promise<string | undefined>;
  } = {},
) {
  return (
    <StravaCallbackResult
      result={result}
      configured={overrides.configured ?? true}
      getAuthorizeUrl={
        overrides.getAuthorizeUrl ?? (() => Promise.resolve(STRAVA))
      }
    />
  );
}

const REFUSED = { ok: false as const, reason: "The user declined." };

describe("StravaCallbackResult", () => {
  it("says it is connected and what that means, and continues to the connection", async () => {
    await renderWithRouter(landing({ ok: true }));

    expect(screen.getByRole("heading", { name: "Strava" })).toBeVisible();
    expect(
      screen.getByText(
        "Strava connected. After each run, we’ll remind you to add it here.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/runs/strava",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing changed when it did not connect, with both ways on", async () => {
    await renderWithRouter(landing(REFUSED));

    expect(
      screen.getByText("Strava isn’t connected. Nothing changed."),
    ).toBeVisible();
    // The reason is the server's diagnostic, not the runner's sentence.
    expect(screen.queryByText("The user declined.")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute(
      "href",
      "/runs",
    );
  });

  it("tries again by going back to Strava", async () => {
    const user = userEvent.setup();
    await renderWithRouter(landing(REFUSED));

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(STRAVA);
    });
  });

  it("says not connected under the button when trying again fails", async () => {
    const user = userEvent.setup();
    const getAuthorizeUrl = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(STRAVA);
    await renderWithRouter(landing(REFUSED, { getAuthorizeUrl }));

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Not connected")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not connected. Our end failed.",
    );
    const band = document.querySelector<HTMLElement>(
      "[data-part='failure-band']",
    );
    if (band === null) throw new Error("no failure band");
    await user.click(within(band).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(STRAVA);
    });
  });

  it("offers no Try again where Strava is not configured — never a dead control", async () => {
    await renderWithRouter(landing(REFUSED, { configured: false }));

    expect(
      screen.getByText("Strava isn’t connected. Nothing changed."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Not now" })).toBeVisible();
  });
});
