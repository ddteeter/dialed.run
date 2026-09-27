import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeskSplit, RailCard } from "../../src/ui";

/**
 * DS1's two columns for a log step at the desk (round 25): the primary
 * column in phone order, and a read-only rail the phone never draws.
 */
describe("DeskSplit", () => {
  it("puts the step first and the rail after it, in the rail's own part", () => {
    render(
      <DeskSplit rail={<p>Context</p>}>
        <form aria-label="The step" />
      </DeskSplit>,
    );

    const step = screen.getByRole("form", { name: "The step" });
    const rail = document.querySelector<HTMLElement>("[data-part='rail']");
    if (rail === null) throw new Error("no rail");
    expect(within(rail).getByText("Context")).toBeInTheDocument();
    // Phone order: the step, then the rail.
    expect(
      step.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The rail is the desk's alone.
    expect(rail).toHaveClass("hidden", "desk:flex");
    // Two columns from 1040, the primary one the 620 measure.
    expect(step.parentElement).toHaveClass(
      "desk:grid",
      "desk:max-w-page",
      "desk:grid-cols-[minmax(0,var(--container-column))_minmax(0,1fr)]",
    );
  });
});

describe("RailCard", () => {
  it("is a card titled in mono, holding what it is given", () => {
    render(
      <RailCard title="This run">
        <p>6.2 mi</p>
      </RailCard>,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "This run" });
    const card = heading.closest("section");
    expect(card).toHaveClass("border-hairline");
    expect(within(card ?? document.body).getByText("6.2 mi")).toBeVisible();
  });
});
