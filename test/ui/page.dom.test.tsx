import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Page } from "../../src/ui/Page";

/**
 * The content column seven authenticated routes sit in.
 *
 * Three things are the props and everything else is fixed: how wide the
 * column is, what the heading says, and whether something sits opposite
 * the heading. The width classes are asserted by name because `width` is
 * a contract — `narrow` is what a short form gets — not because a look is
 * being pinned.
 */
describe("Page", () => {
  it("is the reading column by default", () => {
    const { container } = render(<Page title="Runs">body</Page>);

    const column = container.firstElementChild;
    expect(column).toHaveClass("max-w-xl");
    expect(column).not.toHaveClass("max-w-sm");
  });

  it("narrows for a short form", () => {
    const { container } = render(
      <Page title="Log a run" width="narrow">
        body
      </Page>,
    );

    const column = container.firstElementChild;
    expect(column).toHaveClass("max-w-sm");
    expect(column).not.toHaveClass("max-w-xl");
  });

  it("keeps the column's own layout whichever width it is", () => {
    // The rest of the column is not a prop, and a mutant that emptied the
    // template would take it with the width.
    const { container } = render(<Page title="Runs">body</Page>);

    expect(container.firstElementChild).toHaveClass(
      "mx-auto",
      "flex",
      "w-full",
      "flex-col",
      "gap-6",
      "px-6",
      "py-8",
    );
  });

  it("renders the title as the page's heading", () => {
    render(<Page title="Notifications">body</Page>);

    expect(
      screen.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeInTheDocument();
  });

  it("renders no heading at all when the page owns its own", () => {
    // Run detail is the one: `RunDetail` renders the run's heading, so a
    // second empty `h1` above it would be a second, wrong document
    // outline.
    render(<Page>body</Page>);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("puts an action opposite the heading, in the heading's own row", () => {
    render(
      <Page title="Runs" headingAction={<button type="button">+ Add</button>}>
        body
      </Page>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Runs" });
    const headingAction = screen.getByRole("button", { name: "+ Add" });
    // Siblings, not merely both on the page — the row is what puts the
    // action opposite the heading rather than under it.
    expect(headingAction.parentElement).toBe(heading.parentElement);
    expect(heading.parentElement).toHaveClass("justify-between");
  });

  it("renders the heading row even with no action, so adding one moves nothing", () => {
    render(<Page title="Runs">body</Page>);

    const heading = screen.getByRole("heading", { level: 1, name: "Runs" });
    expect(heading.parentElement).toHaveClass(
      "flex",
      "items-center",
      "justify-between",
    );
  });

  it("renders children below the heading", () => {
    render(
      <Page title="Runs">
        <p>the list</p>
      </Page>,
    );

    expect(screen.getByText("the list")).toBeInTheDocument();
  });

  it("stamps the hydration signal, because onboarding wears no Layout", async () => {
    // O1, O3 and P3 render `Page` with no `Layout`, and they are the three
    // screens that are *entirely* controlled forms — so without this the
    // app's only "React has attached" signal was missing exactly where it
    // matters most. The onboarding demo timed out on it, which is how this
    // was found.
    delete document.documentElement.dataset.hydrated;

    render(<Page title="Settings">body</Page>);

    await waitFor(() => {
      expect(document.documentElement.dataset.hydrated).toBe("true");
    });
  });
});
