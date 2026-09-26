import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AddRunShell } from "../../src/modules/runs/components/AddRunShell";

/**
 * A1 as a desk page (round 25): the phone column, the 620 reflow from 720,
 * and the 1180 measure from 1040 for the card and its rail.
 */
describe("AddRunShell", () => {
  it("heads the page and widens with the screen", () => {
    render(
      <AddRunShell>
        <p>The well</p>
      </AddRunShell>,
    );

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Add a run",
    });
    expect(heading.parentElement).toHaveClass(
      "max-w-column",
      "wide:mx-0",
      "desk:max-w-page",
    );
    expect(screen.getByText("The well")).toBeVisible();
  });
});
