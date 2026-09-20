import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CompositionBlock,
  type Composition,
} from "../../src/modules/closet/components/Composition";

const arcteryx: Composition = {
  verbatim: "Body: 100% nylon, GORE-TEX. Underarm: 87% polyester, 13% elastane",
  parts: [
    { part: "Body", materials: [{ material: "nylon, GORE-TEX", pct: 100 }] },
    {
      part: "Underarm",
      materials: [
        { material: "polyester", pct: 87 },
        { material: "elastane", pct: 13 },
      ],
    },
    { part: "Lining", materials: [{ material: "polyester", pct: 100 }] },
  ],
  brand: "Arc'teryx",
};

describe("CompositionBlock (design round 10 §AG)", () => {
  it("labels each part, in the brand's order and never by percentage", () => {
    // Rule 02: no reordering. Body is 100% and Underarm is a split, so a
    // sort by anything would move them — the order on screen is the order
    // on the label.
    render(<CompositionBlock composition={arcteryx} />);

    const labels = screen.getAllByRole("term").map((el) => el.textContent);
    expect(labels).toEqual(["Body", "Underarm", "Lining"]);
    expect(screen.getByText("87% polyester · 13% elastane")).toBeVisible();
    expect(screen.getByText("100% nylon, GORE-TEX")).toBeVisible();
  });

  it("does not normalise a material, sum to 100, or invent a percentage", () => {
    // The parser round 5 refused. "elastane" stays elastane, the two parts
    // that do not reach 100 together are not reconciled, and a material
    // with no percentage prints alone rather than gaining one.
    render(
      <CompositionBlock
        composition={{
          verbatim: "wool",
          parts: [
            { part: "Shell", materials: [{ material: "elastane", pct: 13 }] },
            { part: "Trim", materials: [{ material: "merino wool" }] },
          ],
          brand: "Tracksmith",
        }}
      />,
    );

    expect(screen.getByText("13% elastane")).toBeVisible();
    expect(screen.getByText("merino wool")).toBeVisible();
    expect(screen.queryByText(/spandex/i)).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });

  it("falls back to the verbatim line when the label gave one part", () => {
    // Rule 01's middle branch. One part is not a table of one row — it is
    // the sentence the brand published, which `verbatim` already holds
    // better than a reassembled version would.
    render(
      <CompositionBlock
        composition={{
          verbatim: "100% merino wool",
          parts: [{ materials: [{ material: "merino wool", pct: 100 }] }],
          brand: "Tracksmith",
        }}
      />,
    );

    expect(screen.getByText("100% merino wool")).toBeVisible();
    expect(screen.queryAllByRole("term")).toEqual([]);
  });

  it("renders nothing at all when both are absent", () => {
    // Rule 01's third branch, and the one worth asserting hardest: "no
    // block" is not an "Unknown" row. Nothing on the screen has to know
    // the field was nullable.
    const { container } = render(
      <CompositionBlock
        composition={{ verbatim: undefined, parts: [], brand: "Janji" }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("omits the attribution rather than guessing whose label it is", () => {
    render(
      <CompositionBlock
        composition={{ verbatim: "100% merino", parts: [], brand: undefined }}
      />,
    );

    expect(screen.getByText("100% merino")).toBeVisible();
    expect(screen.queryByText(/as labelled/i)).toBeNull();
  });

  it("credits the brand when there is one", () => {
    render(<CompositionBlock composition={arcteryx} />);
    expect(screen.getByText("As labelled by Arc'teryx")).toBeVisible();
  });

  it("keeps the percentages out of mono — a claim is not a measurement", () => {
    // §AG says so outright, and it is the one place this screen departs
    // from the brand's usual tell. Mono means a sensor or a clock measured
    // it; a hang tag did not. The part *labels* are mono, because those
    // are the brand's own shouted words.
    render(<CompositionBlock composition={arcteryx} />);

    expect(screen.getByText("87% polyester · 13% elastane")).not.toHaveClass(
      "font-mono",
    );
    expect(screen.getByText("Body")).toHaveClass("font-mono");
    expect(screen.getByText("Body")).toHaveClass("text-mono-xs");
  });

  it("keeps two parts sharing a label as two rows", () => {
    // The brand's order is the order, so position is part of a row's
    // identity. Keying on the label alone would drop the second.
    render(
      <CompositionBlock
        composition={{
          verbatim: "panels",
          parts: [
            { part: "Panels", materials: [{ material: "nylon", pct: 100 }] },
            { part: "Panels", materials: [{ material: "mesh", pct: 100 }] },
          ],
          brand: "Janji",
        }}
      />,
    );

    expect(screen.getAllByRole("term")).toHaveLength(2);
    expect(screen.getByText("100% nylon")).toBeVisible();
    expect(screen.getByText("100% mesh")).toBeVisible();
  });
});

describe("CompositionBlock: the branch boundary", () => {
  it("treats exactly two parts as labelled, and exactly one as the line", () => {
    // `parts.length > 1` is the whole rule, and off-by-one in either
    // direction is a different screen: `>= 1` turns every one-line
    // composition into a table, `> 2` buries a two-part shell.
    const two = {
      verbatim: "Body 100% nylon. Trim 100% nylon",
      parts: [
        { part: "Body", materials: [{ material: "nylon", pct: 100 }] },
        { part: "Trim", materials: [{ material: "nylon", pct: 100 }] },
      ],
      brand: "Janji",
    };
    const { unmount } = render(<CompositionBlock composition={two} />);
    expect(screen.getAllByRole("term")).toHaveLength(2);
    unmount();

    render(
      <CompositionBlock
        composition={{ ...two, parts: two.parts.slice(0, 1) }}
      />,
    );
    // One part is the verbatim line, not a one-row table.
    expect(screen.queryAllByRole("term")).toEqual([]);
    expect(screen.getByText("Body 100% nylon. Trim 100% nylon")).toBeVisible();
  });

  it("omits the label row for an unlabelled part rather than printing a blank", () => {
    // A brand can publish two splits without naming them. An empty <dt>
    // is a line the reader has to account for.
    render(
      <CompositionBlock
        composition={{
          verbatim: "60% nylon, 40% elastane",
          parts: [
            { materials: [{ material: "nylon", pct: 60 }] },
            { part: "Cuff", materials: [{ material: "elastane", pct: 40 }] },
          ],
          brand: "Janji",
        }}
      />,
    );

    expect(screen.getAllByRole("term")).toHaveLength(1);
    expect(screen.getByText("Cuff")).toBeVisible();
    expect(screen.getByText("60% nylon")).toBeVisible();
  });
});
