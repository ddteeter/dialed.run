import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StravaCallbackResult } from "../../src/modules/runs/components/StravaCallbackResult";
import { renderWithRouter } from "./run-fixtures";

/**
 * The landing after Strava sends the runner back — a receipt in the panel
 * (round 22, item 23), in its shapes: connected, not connected, and full
 * (task 127, STR-6).
 */
function landing(
  result: { ok: true } | { ok: false; reason: string; full: boolean },
  isConfigured = true,
) {
  return <StravaCallbackResult result={result} configured={isConfigured} />;
}

const REFUSED = {
  ok: false as const,
  reason: "The user declined.",
  full: false,
};
const FULL = {
  ok: false as const,
  reason: "Strava is full for now.",
  full: true,
};

describe("StravaCallbackResult", () => {
  it("says it is connected and what that means, and continues to the connection", async () => {
    await renderWithRouter(landing({ ok: true }));

    expect(screen.getByRole("heading", { name: "Strava" })).toBeVisible();
    // Round 25: a run happened, we remind you, you add the file.
    const receipt = document.querySelector("[data-slot='receipt']");
    expect(
      [...(receipt?.children ?? [])].map((line) => line.textContent),
    ).toEqual([
      "Connected",
      "Strava connected.",
      "After each run, we’ll remind you to add it here. You upload the file (GPX, TCX or FIT) from your watch or a Strava export, then add what you wore.",
      "We don’t copy runs from Strava.",
    ]);
    expect(
      screen.getByRole("heading", { name: "Strava connected." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/runs/strava",
    );
    expect(screen.queryByRole("link", { name: "Try again" })).toBeNull();
  });

  it("says nothing changed when it did not connect, with both ways on", async () => {
    await renderWithRouter(landing(REFUSED));

    expect(
      screen.getByText("Strava isn’t connected. Nothing changed."),
    ).toBeVisible();
    // The reason is the server's diagnostic, not the runner's sentence.
    expect(screen.queryByText("The user declined.")).toBeNull();
    // Try again is another trip through the connect redirect.
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/runs/strava-connect",
    );
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute(
      "href",
      "/runs",
    );
    expect(document.querySelector("[data-state='full']")).toBeNull();
  });

  it("tells the eleventh runner Strava is full, and offers no Try again", async () => {
    await renderWithRouter(landing(FULL));

    const receipt = document.querySelector("[data-slot='receipt']");
    expect(receipt).toHaveAttribute("data-state", "full");
    expect(
      [...(receipt?.children ?? [])].map((line) => line.textContent),
    ).toEqual([
      "Strava is full",
      "Strava lets a new app connect only a few runners while it is reviewed, and dialed.run is at that limit. Nothing changed.",
      "You can still add every run by uploading its file.",
    ]);
    // Trying again would only be refused again.
    expect(screen.queryByRole("link", { name: "Try again" })).toBeNull();
    expect(
      screen.queryByText("Strava isn’t connected. Nothing changed."),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Not now" })).toBeVisible();
  });

  it("offers no Try again where Strava is not configured — never a dead control", async () => {
    await renderWithRouter(landing(REFUSED, false));

    expect(
      screen.getByText("Strava isn’t connected. Nothing changed."),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Not now" })).toBeVisible();
  });
});
