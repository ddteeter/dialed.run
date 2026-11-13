import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeskDetail } from "../../src/ui/DeskDetail";

/**
 * A Desk table and its detail pane (168.3, R55·203): the frame Runners
 * and Codes share.
 */
describe("DeskDetail", () => {
  it("puts the table beside the pane on a 2fr/1fr track from desk, top-aligned", () => {
    const { container } = render(
      <DeskDetail picked={undefined}>
        <p>the table</p>
      </DeskDetail>,
    );
    expect(container.firstElementChild).toHaveClass(
      "grid",
      "items-start",
      "desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
    );
  });

  it("holds the idle line while nothing is picked, and no pane", () => {
    render(
      <DeskDetail picked={undefined} idle={<p>Pick one.</p>}>
        <p>the table</p>
      </DeskDetail>,
    );
    expect(screen.getByText("Pick one.")).toBeVisible();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("draws the picked thing in a named, sticky --panel pane instead", () => {
    render(
      <DeskDetail
        picked={{ name: "@ada", detail: <p>the detail</p> }}
        idle={<p>Pick one.</p>}
      >
        <p>the table</p>
      </DeskDetail>,
    );
    const pane = screen.getByRole("complementary", { name: "@ada" });
    expect(pane).toHaveTextContent("the detail");
    expect(pane).toHaveClass(
      "rounded-card",
      "bg-panel",
      "desk:sticky",
      "desk:top-6",
    );
    expect(screen.queryByText("Pick one.")).toBeNull();
  });
});
