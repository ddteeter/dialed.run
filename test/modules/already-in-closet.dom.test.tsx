import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AlreadyInCloset } from "../../src/modules/closet/components/AlreadyInCloset";
import type {
  ClosetItemView,
  ItemPerformance,
} from "../../src/modules/closet/service";
import { itemView, wardrobeItem } from "./closet-fixtures";

/**
 * F at the desk's one rail card (round 26 #10): what is already in the
 * closet in the category being added, read-only.
 */

function record(summary: Partial<ItemPerformance["summary"]>): ItemPerformance {
  return {
    summary: {
      runCount: 0,
      verdictCount: 0,
      dialedCount: 0,
      lastWornAt: undefined,
      mileageM: 0,
      ...summary,
    },
    buckets: [],
    pairsWith: [],
  };
}

const harrier = itemView({
  item: wardrobeItem({ id: "01HAR", name: "Harrier", brand: "Tracksmith" }),
  isGeneric: false,
  tempRange: { lowC: 3, highC: 8 },
  performance: record({ runCount: 41, verdictCount: 9, dialedCount: 8 }),
});

const rover = itemView({
  item: wardrobeItem({
    id: "01ROV",
    name: "Rover Half-zip",
    brand: "Janji",
    retired: true,
    retiredAt: 1_741_000_000,
    photoKey: "items/01USER/01ROV/01V1",
  }),
  isGeneric: false,
  performance: record({ runCount: 12, verdictCount: 4, dialedCount: 2 }),
});

const quarterZip = itemView({
  item: wardrobeItem({ id: "01QZ", name: "Uniqlo quarter-zip" }),
  performance: record({ runCount: 3 }),
});

const NOTHING_TYPED = { brand: "", name: "" };

function card(
  pieces: readonly ClosetItemView[],
  typed: { brand: string; name: string } = NOTHING_TYPED,
) {
  return render(
    <AlreadyInCloset category="top" pieces={pieces} typed={typed} />,
  );
}

function rows(): HTMLElement[] {
  return screen.getAllByRole("listitem");
}

function photoOf(row: HTMLElement | undefined): Element | null | undefined {
  return row?.querySelector("[data-part='thumb']");
}

describe("AlreadyInCloset", () => {
  it("is titled for the category, and says so when it holds nothing yet", () => {
    card([]);

    expect(
      screen.getByRole("heading", { name: "Already in your closet · Top" }),
    ).toBeVisible();
    expect(screen.getByText("No tops yet.")).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("names every category in the plural it reads in", () => {
    const { rerender } = card([]);
    const plurals = {
      bottom: "No bottoms yet.",
      headwear: "No headwear yet.",
      neckwear: "No neckwear yet.",
      gloves: "No gloves yet.",
      socks: "No socks yet.",
      shoes: "No shoes yet.",
      accessory: "No accessories yet.",
    } as const;
    for (const [category, empty] of Object.entries(plurals)) {
      rerender(
        <AlreadyInCloset
          category={category as keyof typeof plurals}
          pieces={[]}
          typed={{ brand: "", name: "" }}
        />,
      );
      expect(screen.getByText(empty)).toBeVisible();
    }
  });

  it("lists each piece with its record, in the order given", () => {
    card([harrier, rover, quarterZip]);

    const [first, second, third] = rows();
    expect(first).toHaveTextContent("Tracksmith Harrier");
    expect(first).toHaveTextContent("41 runs · 8/9 dialed 3–8°");
    expect(second).toHaveTextContent("Janji Rover Half-zip");
    expect(second).toHaveTextContent(/^Janji Rover Half-zip12 runs · Retired/);
    expect(third).toHaveTextContent("Uniqlo quarter-zip");
    expect(third).toHaveTextContent("3 runs · No verdict yet");
  });

  it("says dialed without a range when the piece has none", () => {
    card([
      itemView({
        item: wardrobeItem({ name: "Mystery" }),
        performance: record({ runCount: 1, verdictCount: 1, dialedCount: 1 }),
      }),
    ]);

    const [only] = rows();
    expect(only).toHaveTextContent("Mystery1 run · 1/1 dialed");
    expect(only?.textContent).toMatch(/dialed$/);
  });

  it("counts a piece never worn as none", () => {
    card([itemView({ item: wardrobeItem({ name: "New tee" }) })]);

    expect(rows()[0]).toHaveTextContent("New tee0 runs · No verdict yet");
  });

  it("marks a retired piece RETIRED, and a piece matching what is typed SAME NAME", () => {
    card([harrier, rover], { brand: "janji", name: "  rover half-zip " });

    const [first, second] = rows();
    const flag = screen.getByText("Same name · Retired");
    expect(second?.contains(flag)).toBe(true);
    // Ink, not the cold hue (round 28 #13): a match is not a verdict.
    expect(flag).toHaveClass("text-ink", "text-mono-xs");
    expect(first).not.toHaveTextContent("Same name");
  });

  it("does not match on the name alone when the brand differs", () => {
    card([harrier], { brand: "Janji", name: "Harrier" });

    expect(screen.queryByText("Same name")).toBeNull();
  });

  it("does not match on the brand alone when the name differs", () => {
    // Pairs with the brand-differs case above: brand matches (both
    // empty), but the typed name is a real, non-empty string that does
    // not match the piece's own name. A guard that stopped comparing
    // names once something was typed would call this a match.
    card([quarterZip], { brand: "", name: "something else entirely" });

    expect(screen.queryByText("Same name")).toBeNull();
  });

  it("matches a piece with no brand when none is typed", () => {
    card([quarterZip], { brand: "", name: "uniqlo quarter zip" });

    expect(screen.getByText("Same name")).toBeVisible();
  });

  it("matches nothing before a name is typed", () => {
    card([quarterZip], { brand: "", name: " ".repeat(3) });

    expect(screen.queryByText("Same name")).toBeNull();
  });

  it("matches nothing when the piece itself has no name to compare", () => {
    // Both the typed name and the piece's own name normalise to "" here.
    // The "nothing typed" guard must still block a match on its own,
    // rather than leaning on the name comparison to do it (which this
    // input defeats: "" === "").
    card([itemView({ item: wardrobeItem({ name: "" }) })], NOTHING_TYPED);

    expect(screen.queryByText("Same name")).toBeNull();
  });

  it("shows the photo where there is one, and the hatch where not (round 28 #13)", () => {
    card([harrier, rover]);

    const [first, second] = rows();
    const plain = first?.querySelector("[data-part='thumb']");
    expect(plain?.tagName).toBe("SPAN");
    expect(plain).toHaveAttribute("aria-hidden", "true");
    // The hatch means "no photo"; the plain photo ground means loading.
    expect(plain).toHaveAttribute("data-state", "no-photo");
    expect(plain).toHaveClass("photo-hatch");
    expect(photoOf(second)).not.toHaveAttribute("data-state");
    const photo = second?.querySelector("[data-part='thumb']");
    expect(photo).toHaveAttribute("src", "/closet/photo/01ROV/card?v=01V1");
    expect(photo).toHaveAttribute("alt", "");
  });

  it("renders no flag mono at all when a piece has neither flag", () => {
    // Not just "no flag text" — no element for it. A ternary that always
    // took the flagged branch would render an empty, classed span that no
    // text assertion alone would ever notice.
    card([quarterZip]);

    const [row] = rows();
    expect(row?.querySelector(".text-mono-xs")).toBeNull();
  });

  it("dates a retirement by month and year, in the metadata row's mono (round 28 #13)", () => {
    card([rover]);

    const line = screen.getByText("12 runs · Retired Mar 2025");
    expect(line).toHaveClass("text-mono-sm", "text-label");
  });

  it("is titled for the type once one is picked, and says so in its plural", () => {
    render(
      <AlreadyInCloset
        category="top"
        type="halfZip"
        pieces={[]}
        typed={NOTHING_TYPED}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Already in your closet · Top · Half-zip",
      }),
    ).toBeVisible();
    expect(screen.getByText("No half-zips yet.")).toBeVisible();
  });

  it("links nowhere: a link would lead away from a half-filled form", () => {
    card([harrier, rover, quarterZip]);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
