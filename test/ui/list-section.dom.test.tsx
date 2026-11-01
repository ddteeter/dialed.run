import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListSection } from "../../src/ui/ListSection";

/**
 * One primitive, two behaviours, and the difference is the whole point.
 *
 * A profile section with nothing in it should close up — these sit in a
 * `flex flex-col gap-*` column, so an empty `<ul>` would still take its
 * gap and leave a blank band under a heading. W2's blocked list and the
 * review queue are the other way round: there the empty state IS the
 * screen, and "Nobody. That's normal." is the artboard's own point.
 */

describe("with nothing to show and no empty node", () => {
  it("renders nothing at all, heading included", () => {
    const { container } = render(
      <ListSection title="Most worn" items={[]}>
        {(item: string) => <li key={item}>{item}</li>}
      </ListSection>,
    );

    // Not "an empty list": absent. A heading with a gap under it is what
    // this guard exists to prevent.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Most worn")).not.toBeInTheDocument();
  });
});

describe("with nothing to show and an empty node", () => {
  it("keeps the heading and shows the message instead of a list", () => {
    render(
      <ListSection
        title="Blocked"
        items={[]}
        whenEmpty={<p>Nobody. That&apos;s normal.</p>}
      >
        {(item: string) => <li key={item}>{item}</li>}
      </ListSection>,
    );

    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Nobody. That's normal.")).toBeInTheDocument();
    // No empty <ul>, or the message would sit under a phantom list.
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("with items", () => {
  it("renders the rows and not the empty node", () => {
    render(
      <ListSection
        title="Blocked"
        items={["j_holloway", "gearfiend22"]}
        whenEmpty={<p>Nobody.</p>}
      >
        {(item) => <li key={item}>{item}</li>}
      </ListSection>,
    );

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("j_holloway")).toBeInTheDocument();
    // The empty node must not leak in beside a populated list.
    expect(screen.queryByText("Nobody.")).not.toBeInTheDocument();
  });

  it("renders rows the same way whether or not an empty node was given", () => {
    const { rerender } = render(
      <ListSection title="Kit" items={["cap"]}>
        {(item) => <li key={item}>{item}</li>}
      </ListSection>,
    );
    expect(screen.getByText("cap")).toBeInTheDocument();

    rerender(
      <ListSection title="Kit" items={["cap"]} whenEmpty={<p>None.</p>}>
        {(item) => <li key={item}>{item}</li>}
      </ListSection>,
    );
    expect(screen.getByText("cap")).toBeInTheDocument();
    expect(screen.queryByText("None.")).not.toBeInTheDocument();
  });
});

describe("the counted heading", () => {
  it("hands its count and title to Bracketed as one text node", () => {
    // Chromium drops a whitespace-only text node from an accessible name,
    // so `{count} {title}` is announced "2waiting" while it draws "2
    // waiting". happy-dom computes the name with the space either way, so
    // this pins the shape that reads right in a real browser.
    render(
      <ListSection title="waiting" items={["a", "b"]} count>
        {(item) => <li key={item}>{item}</li>}
      </ListSection>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    const texts = Array.from(
      heading.querySelectorAll("span:not([aria-hidden])"),
      (span) =>
        [...span.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent),
    ).flat();
    expect(texts).toStrictEqual(["2 waiting"]);
  });
});
