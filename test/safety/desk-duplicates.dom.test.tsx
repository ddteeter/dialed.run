import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeskDuplicates } from "../../src/modules/safety/components/DeskDuplicates";
import type { DuplicateCandidate } from "../../src/modules/safety/duplicates";
import { duplicatesReport } from "../../src/modules/safety/duplicates-report";
import { bracketed } from "../ui/bracketed";

/**
 * Operator Screens D2 (task 110): a heading and its variants per probable
 * product, read-only (D-30).
 */

function candidate(
  brand: string,
  variants: readonly (readonly [string, number])[],
): DuplicateCandidate {
  return {
    brand,
    products: variants.map(([name, pieces]) => ({
      id: `${brand}:${name}`,
      name,
      normalizedName: name.toLowerCase(),
      pieces,
    })),
  };
}

const BOARD = duplicatesReport([
  candidate("Nike", [
    ["Pegasus 41", 14],
    ["Air Zoom Pegasus 41", 5],
  ]),
  candidate("Tracksmith", [
    ["Harrier Long Sleeve", 29],
    ["Harrier LS", 6],
    ["Harrier long-sleeve tee", 3],
  ]),
]);

function renderReport(report = BOARD) {
  return render(<DeskDuplicates report={report} />);
}

function cards(): HTMLElement[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.closest("li") ?? heading);
}

describe("the header", () => {
  it("names the page", () => {
    renderReport();
    expect(
      screen.getByRole("heading", { level: 1, name: "Duplicates" }),
    ).toBeTruthy();
  });

  it("counts names, probable products and pieces affected", () => {
    renderReport();
    expect(
      screen.getByText(
        bracketed("5 names → become 2 probable products · 57 pieces affected"),
      ),
    ).toBeTruthy();
  });

  it("says the arrow as a word and hides the glyph", () => {
    renderReport();
    const arrow = screen.getByText("→");
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.nextElementSibling?.textContent).toBe("become ");
    expect(arrow.nextElementSibling?.className).toContain("sr-only");
  });

  it("counts one of each in the singular", () => {
    // Not a state the query can produce (a group has two names at
    // least), but it is the one input where every noun is singular.
    renderReport(duplicatesReport([candidate("Ciele", [["GoCap", 1]])]));
    expect(
      screen.getByText(
        bracketed("1 name → become 1 probable product · 1 piece affected"),
      ),
    ).toBeTruthy();
    expect(screen.getByText(bracketed("1 piece"))).toBeTruthy();
  });

  it("states that nothing here acts", () => {
    renderReport();
    expect(screen.getByText(/^Nothing here does anything\./u)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("the groups", () => {
  it("draws one card per probable product, most pieces first", () => {
    renderReport();
    expect(
      cards().map((card) => within(card).getByRole("heading").textContent),
    ).toEqual(["Tracksmith[38 pieces]", "Nike[19 pieces]"]);
  });

  it("puts the probable name first, in bold", () => {
    renderReport();
    const [tracksmith] = cards();
    const rows = within(tracksmith ?? document.body).getAllByRole("listitem");
    expect(rows[0]?.querySelector("strong")?.textContent).toBe(
      "Harrier Long Sleeve",
    );
    expect(rows[1]?.querySelector("strong")).toBeNull();
    expect(rows[1]?.textContent).toBe("Harrier LS6 pieces");
  });

  it("names each count as pieces for a screen reader", () => {
    renderReport(
      duplicatesReport([
        candidate("Janji", [
          ["Thermal Tights", 2],
          ["Thermal Tight", 1],
        ]),
      ]),
    );
    const rows = within(cards()[0] ?? document.body).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Thermal Tights2 pieces",
      "Thermal Tight1 piece",
    ]);
  });

  it("renders a runner-typed name as text, never markup", () => {
    renderReport(
      duplicatesReport([
        candidate("<b>Acme</b>", [
          ["<img src=x onerror=alert(1)>", 2],
          ["Plain", 1],
        ]),
      ]),
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(screen.getByText("<b>Acme</b>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("a clean catalogue", () => {
  it("says so under a zeroed count, and draws no cards", () => {
    renderReport(duplicatesReport([]));
    expect(
      screen.getByText(
        "No near-misses. Every product name under each brand is distinct.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        bracketed("0 names · 0 probable products · 0 pieces affected"),
      ),
    ).toBeTruthy();
    // Round 46, 110a: nothing becomes anything at zero, so no arrow.
    expect(screen.queryByText("→")).toBeNull();
    expect(screen.queryByText(/become/u)).toBeNull();
    // Body text on the column, not the intro's small size.
    const clean = screen.getByText(/^No near-misses\./u);
    expect(clean.className).toContain("text-body");
    expect(clean.className).toContain("max-w-column");
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
  });

  it("does not show the clean line beside groups", () => {
    renderReport();
    expect(screen.queryByText(/^No near-misses\./u)).toBeNull();
  });
});
