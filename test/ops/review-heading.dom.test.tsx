import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReviewHeading } from "../../src/modules/ops/components/ReviewHeading";

/**
 * Review's header on the Desk (round 44 #106): the rail's word, and D1's
 * bracketed counts beside it, never hidden.
 */
describe("ReviewHeading", () => {
  it("names the page as the rail does, with what waits and what was decided", () => {
    render(<ReviewHeading counts={{ waiting: 4, decidedToday: 2 }} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/^Review$/u);
    expect(heading).toHaveClass(
      "m-0",
      "font-display",
      "text-title",
      "uppercase",
    );
    const counts = screen.getByText("4 waiting · 2 decided today");
    expect(counts).toHaveTextContent(/^\[4 waiting · 2 decided today\]$/u);
    expect(counts).toHaveClass("text-muted", "uppercase");
    expect(heading.parentElement).toHaveClass(
      "flex",
      "flex-wrap",
      "items-baseline",
      "gap-3",
    );
  });

  it("still shows the counts when nothing is waiting", () => {
    render(<ReviewHeading counts={{ waiting: 0, decidedToday: 0 }} />);
    expect(screen.getByText("0 waiting · 0 decided today")).toBeInTheDocument();
  });
});
