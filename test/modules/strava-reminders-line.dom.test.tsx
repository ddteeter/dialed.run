import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StravaRemindersLine } from "../../src/modules/runs/components/StravaRemindersLine";
import { renderWithRouter } from "./run-fixtures";

/**
 * "STRAVA REMINDERS · ON ›" under the runs list's title (Round 55 · 235c).
 */
describe("StravaRemindersLine", () => {
  it("says the reminders are on, in mono, as a link to T1", async () => {
    await renderWithRouter(<StravaRemindersLine configured connected />);

    const link = screen.getByRole("link", { name: "Strava reminders · On" });
    expect(link).toHaveAttribute("href", "/runs/strava");
    expect(link).toHaveTextContent("Strava reminders · On ›");
    expect(screen.getByText("›")).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveClass(
      "target",
      "inline-flex",
      "items-center",
      "self-start",
      "font-mono",
      "text-mono-xs",
      "uppercase",
      "underline",
    );
  });

  it("says they are off when Strava is not connected", async () => {
    await renderWithRouter(
      <StravaRemindersLine configured connected={false} />,
    );

    expect(
      screen.getByRole("link", { name: "Strava reminders · Off" }),
    ).toBeVisible();
  });

  it("draws nothing where Strava is not configured", async () => {
    await renderWithRouter(
      <StravaRemindersLine configured={false} connected={false} />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});
