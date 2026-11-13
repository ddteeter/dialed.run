import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { drawnText, saidText } from "./spoken-text";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  ClosetGrid,
  closetHeading,
  closetScreen,
} from "../../src/modules/closet/components/ClosetGrid";
import {
  closetSearch,
  type ClosetSearch,
} from "../../src/modules/closet/inputs";
import type { ClosetItemView } from "../../src/modules/closet/service";
import { itemView, listing, wardrobeItem } from "./closet-fixtures";

/**
 * Screen C, driven — round 22, item 16: one flat grid, a heading row of
 * `47 pieces` and a `Show retired` switch, retired tiles last, and the
 * dashed Add tile.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const harrier = itemView({
  item: wardrobeItem({
    id: "01TOP",
    name: "Harrier",
    brand: "Tracksmith",
    estTempLowC: 4,
    estTempHighC: 12,
  }),
  isGeneric: false,
  uiGroup: "tops",
  tempRange: { lowC: 4, highC: 12 },
});

const genericTop = itemView({
  item: wardrobeItem({ id: "01GEN", name: "Long sleeve top" }),
});

const retiredTee = itemView({
  item: wardrobeItem({ id: "01RTD", name: "Old tee", retired: true }),
  isGeneric: false,
  uiGroup: "tops",
});

function gridElement(): HTMLElement {
  const grid = document.querySelector<HTMLElement>("[data-part='grid']");
  if (grid === null) throw new Error("no grid");
  return grid;
}

/**
The grid's cells, as the names they carry, in order.
*/
function cells(): string[] {
  return [...gridElement().children].map(
    (cell) =>
      cell.querySelector("[data-part='tile-name']")?.textContent ??
      cell.textContent,
  );
}

/**
A tile's tags on its photo, or nothing when it carries none.
*/
function tagsOf(link: HTMLElement): Element | null {
  return link.querySelector("[data-part='tile-tags']");
}

const tile = (): HTMLElement =>
  screen.getByRole("link", { name: "Add garment" });

describe("ClosetGrid: the empty closet (ruling 16)", () => {
  it("says so in brackets, asks for three pieces, and offers the Add tile", async () => {
    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([])} />,
    );

    // Drawn in brackets, said without them (D-150).
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Nothing in here yet",
    });
    expect(heading).toBeVisible();
    expect(heading).toHaveTextContent("[Nothing in here yet]");
    expect(
      screen.getByText(
        "Add what you run in most. Three pieces is enough to start.",
      ),
    ).toBeVisible();
    // The dashed tile is the only thing in the grid, and the only link.
    expect(cells()).toStrictEqual(["Add garment"]);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Add garment" })).toHaveAttribute(
      "href",
      "/closet/new",
    );
  });

  it("keeps the Add tile's height only while it is the only cell", async () => {
    // A grid row is as tall as its tallest cell, so a minimum on the Add
    // tile was a minimum on whichever row it landed in — a closet's last
    // row ran to nearly twice every row above it. `only:` keeps the
    // minimum for the empty closet, where there is no tile to match.
    const { unmount } = await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([])} />,
    );
    expect(tile().closest("li")).toHaveClass("only:min-h-40");
    expect(tile()).toHaveClass("h-full");
    expect(tile()).not.toHaveClass("min-h-40");
    unmount();

    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    // Beside a garment, the grid's equal rows size it. happy-dom lays
    // nothing out, so the heights themselves are measured in a real
    // browser at 390 and 1440, alone on a row and sharing one
    // (e2e/conformance/closet-empty.conformance.spec.ts).
    expect(tile().closest("li")).toHaveClass("only:min-h-40");
    expect(tile().closest("ul")).toHaveClass("auto-rows-fr");
  });

  it("has no count and no switch about pieces there are none of", async () => {
    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([])} />,
    );
    expect(screen.queryByText(/pieces?$/)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("counts the closet, not the visible rows", async () => {
    // `totalCount === 0`, not `items.length === 0`: a closet holding only
    // retired items is not empty, and offering "add your first piece" to
    // someone with a full closet reads as data loss.
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={{ items: [retiredTee], totalCount: 1, genericCount: 0 }}
      />,
    );

    expect(screen.queryByText(/Nothing in here yet/)).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "0 pieces" }),
    ).toBeVisible();
  });
});

describe("ClosetGrid: the heading row", () => {
  it("counts the pieces the grid is showing", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, genericTop, retiredTee])}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "2 pieces" }),
    ).toBeVisible();
  });

  it("says one piece, not one pieces", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "1 piece" }),
    ).toBeVisible();
  });

  it("puts the switch opposite the count, and the count follows it", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, retiredTee])}
      />,
    );

    const header = document.querySelector<HTMLElement>(
      "[data-part='grid-header']",
    );
    if (header === null) throw new Error("no heading row");
    const toggle = within(header).getByRole("switch", {
      name: "Show retired (1)",
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(within(header).getByRole("heading")).toHaveTextContent("2 pieces");
  });

  it("offers no switch when nothing is retired — it would change nothing", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("has no Add in the heading: adding is the grid's tile", async () => {
    // §6c.10: "Adding a garment is the grid's dashed tile and the Y route;
    // never a bar action."
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    expect(screen.queryByRole("link", { name: /^Add$/ })).toBeNull();
    expect(cells().at(-1)).toBe("Add garment");
  });
});

describe("ClosetGrid: one flat grid (§6c.10)", () => {
  // The rail's own group labels are R-94's; the grid is still flat.
  it("puts no group headings and no nested list in the grid", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, genericTop, retiredTee])}
      />,
    );
    const grid = within(gridElement());
    expect(grid.queryByRole("heading")).toBeNull();
    expect(grid.queryByRole("list")).toBeNull();
  });

  it("keeps like by like, in screen C's group order, whatever order they arrive in", async () => {
    const groups = [
      ["socks_extras", "Wool socks"],
      ["shoes", "Pegasus"],
      ["hands_head", "Liners"],
      ["outer", "Houdini"],
      ["bottoms", "Half tights"],
      ["tops", "Merino"],
    ] as const;
    const views = groups.map(([group, name], index) =>
      itemView({
        item: wardrobeItem({ id: `01ITEM${String(index)}`, name }),
        uiGroup: group,
        isGeneric: false,
      }),
    );

    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing(views)} />,
    );

    expect(cells()).toStrictEqual([
      "Merino",
      "Half tights",
      "Houdini",
      "Liners",
      "Pegasus",
      "Wool socks",
      "Add garment",
    ]);
  });

  it("sorts retired tiles last, from either side", async () => {
    // Ruling 16: "sorted last". Fed both ways round, so the comparison is
    // checked in both directions.
    const shoe = itemView({
      item: wardrobeItem({ id: "01SHOE", name: "Pegasus" }),
      uiGroup: "shoes",
      isGeneric: false,
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([retiredTee, shoe, harrier])}
        initialShowRetired
      />,
    );
    expect(cells()).toStrictEqual([
      "Tracksmith Harrier",
      "Pegasus",
      "Old tee",
      "Add garment",
    ]);
  });

  it("keeps a retired piece last when it is fed after the active ones", async () => {
    const shoe = itemView({
      item: wardrobeItem({ id: "01SHOE", name: "Pegasus", retired: true }),
      uiGroup: "shoes",
      isGeneric: false,
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([shoe, harrier])}
        initialShowRetired
      />,
    );
    expect(cells()).toStrictEqual([
      "Tracksmith Harrier",
      "Pegasus",
      "Add garment",
    ]);
  });

  it("lets the garment grid fill rather than counting columns", async () => {
    // DS3's reflow rule for a grid of garments: "auto-fill,
    // minmax(180px, 1fr)". One rule instead of a count per breakpoint.
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );

    expect(gridElement()).toHaveClass(
      "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
    );
  });
});

describe("ClosetGrid: a photo being checked (R-69, round 27 #21)", () => {
  it("tags the tile CHECKING, alone on the photo, and says who can't see it (round 38 #64)", async () => {
    const checking = itemView({
      item: wardrobeItem({
        id: "01CHK",
        name: "New jacket",
        brand: "Janji",
        photoKey: "items/u/01CHK/v1",
        visibility: "pending",
      }),
      isGeneric: false,
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([checking])}
      />,
    );

    const link = screen.getByRole("link", { name: /New jacket/ });
    const kicker = tagsOf(link);
    const tag = kicker?.querySelector("[data-part='checking-tag']");
    expect(tag).toHaveClass("text-muted");
    expect(tag?.querySelector("[aria-hidden='true']")).toHaveTextContent(
      /^\[Checking\]$/u,
    );
    expect(tag?.querySelector(".sr-only")).toHaveTextContent(
      /^Being checked, other runners can't see this photo$/u,
    );
    expect(kicker?.children).toHaveLength(1);
    expect(link).toHaveAccessibleName(
      /Being checked, other runners can't see this photo/u,
    );
    expect(link).not.toHaveAccessibleName(/Checking\]/u);
  });

  it("says nothing once the photo is cleared, or when there is no photo", async () => {
    const cleared = itemView({
      item: wardrobeItem({
        id: "01CLR",
        name: "Old jacket",
        brand: "Janji",
        photoKey: "items/u/01CLR/v1",
        visibility: "pass",
      }),
      isGeneric: false,
    });
    const bare = itemView({
      item: wardrobeItem({
        id: "01BAR",
        name: "Bare jacket",
        brand: "Janji",
        visibility: "pending",
      }),
      isGeneric: false,
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([cleared, bare])}
      />,
    );

    for (const name of [/Old jacket/, /Bare jacket/]) {
      const link = screen.getByRole("link", { name });
      expect(tagsOf(link)).toBeNull();
    }
  });
});

/**
A record as the runner's history leaves it on a piece.
*/
function performance(
  summary: Partial<NonNullable<ClosetItemView["performance"]>["summary"]> = {},
): NonNullable<ClosetItemView["performance"]> {
  return {
    summary: {
      runCount: 9,
      verdictCount: 9,
      dialedCount: 8,
      lastWornAt: 1,
      mileageM: 228_526,
      ...summary,
    },
    buckets: [],
    pairsWith: [],
  };
}

function tileOf(name: RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

function partOf(link: HTMLElement, name: string): Element | null {
  return link.querySelector(`[data-part='${CSS.escape(name)}']`);
}

describe("ClosetGrid: the tile's photo and record (board C, round 27 #31b)", () => {
  it("shows the piece's photo at 4:5, full width, under the name in the markup", async () => {
    const pictured = itemView({
      item: wardrobeItem({
        id: "01PIC",
        name: "Shell",
        photoKey: "items/u/01PIC/v7",
        visibility: "pass",
      }),
      isGeneric: false,
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([pictured])}
      />,
    );

    const tile = tileOf(/^Shell/);
    const photo = partOf(tile, "tile-photo");
    expect(photo).toHaveAttribute("data-state", "photo");
    expect(photo).toHaveClass(
      "order-first",
      "aspect-4/5",
      "w-full",
      "bg-photo",
    );
    expect(photo).not.toHaveClass("photo-hatch");
    expect(photo?.querySelector("img")).toHaveAttribute(
      "src",
      "/closet/photo/01PIC/card?v=v7",
    );
    // Decorative: the link already names the piece.
    expect(photo?.querySelector("img")).toHaveAttribute("alt", "");
    expect(tile.lastElementChild).toBe(photo);
  });

  it("hatches the photo's place when there is no photo", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    const photo = partOf(tileOf(/^Tracksmith Harrier/), "tile-photo");
    expect(photo).toHaveAttribute("data-state", "no-photo");
    expect(photo).toHaveClass("photo-hatch");
    expect(photo).not.toHaveClass("bg-photo");
    expect(photo?.querySelector("img")).toBeNull();
  });

  it("draws 8/9 DIALED and says 8 of 9 runs dialed, then the range and the mileage", async () => {
    const worn = itemView({ ...harrier, performance: performance() });
    await renderWithRouter(
      <ClosetGrid tempUnit="f" distanceUnit="mi" listing={listing([worn])} />,
    );

    const tile = tileOf(/^Tracksmith Harrier/);
    const record = partOf(tile, "tile-record");
    expect(record?.querySelector("[aria-hidden='true']")).toHaveTextContent(
      /^8\/9 dialed$/,
    );
    expect(record?.querySelector(".sr-only")).toHaveTextContent(
      /^8 of 9 runs dialed$/,
    );
    expect(drawnText(partOf(tile, "tile-range"))).toMatch(
      /^\[39–54°\] · 142 mi$/,
    );
    // Round 53 · 162.3: a range always takes the spoken form.
    expect(saidText(partOf(tile, "tile-range"))).toBe(
      "39 to 54 degrees · 142 mi",
    );
  });

  it("measures the mileage in the runner's unit, to the whole unit", async () => {
    const worn = itemView({ ...harrier, performance: performance() });
    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([worn])} />,
    );
    const range = partOf(tileOf(/^Tracksmith Harrier/), "tile-range");
    expect(drawnText(range)).toMatch(/^\[4–12°\] · 229 km$/);
  });

  it("says one run, not one runs", async () => {
    const once = itemView({
      ...harrier,
      performance: performance({
        runCount: 1,
        verdictCount: 1,
        dialedCount: 0,
      }),
    });
    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([once])} />,
    );
    expect(
      partOf(tileOf(/^Tracksmith Harrier/), "tile-record")?.querySelector(
        ".sr-only",
      ),
    ).toHaveTextContent(/^0 of 1 run dialed$/);
  });

  it("says No runs yet for a piece never worn, and gives no mileage", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    const tile = tileOf(/^Tracksmith Harrier/);
    expect(partOf(tile, "tile-record")).toHaveTextContent(/^No runs yet$/);
    expect(drawnText(partOf(tile, "tile-range"))).toMatch(/^\[4–12°\]$/);
  });

  it("says No verdict yet for a piece worn but never judged", async () => {
    const unjudged = itemView({
      ...harrier,
      performance: performance({ verdictCount: 0, dialedCount: 0 }),
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([unjudged])}
      />,
    );
    expect(
      partOf(tileOf(/^Tracksmith Harrier/), "tile-record"),
    ).toHaveTextContent(/^No verdict yet$/);
  });

  it("leaves the mileage off until there is a first mile", async () => {
    const indoorsOnly = itemView({
      ...harrier,
      performance: performance({ mileageM: 0 }),
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([indoorsOnly])}
      />,
    );
    const range = partOf(tileOf(/^Tracksmith Harrier/), "tile-range");
    expect(drawnText(range)).toMatch(/^\[4–12°\]$/);
  });

  it("names the piece first, then its record, in the link's name", async () => {
    const worn = itemView({ ...harrier, performance: performance() });
    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([worn])} />,
    );
    expect(tileOf(/^Tracksmith Harrier/)).toHaveAccessibleName(
      /^Tracksmith Harrier 8 of 9 runs dialed/,
    );
  });
});

describe("ClosetGrid: what a tile says", () => {
  it("names a branded piece and links to it, with no tags", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );

    const branded = screen.getByRole("link", { name: /Harrier/ });
    expect(branded).toHaveAttribute("href", "/closet/01TOP");
    expect(branded).toHaveAccessibleName(/^Tracksmith Harrier/);
    expect(branded).not.toHaveTextContent("Generic");
    expect(branded).not.toHaveTextContent("Retired");
    // No tags at all, rather than an empty pill row on the photo.
    expect(tagsOf(branded)).toBeNull();
  });

  it("tags a generic piece on the photo, above the name but after it in the name", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([genericTop])}
      />,
    );

    const generic = screen.getByRole("link", { name: /^Long sleeve top/ });
    const kicker = generic.querySelector(".order-first");
    expect(kicker).toHaveClass("order-first");
    expect(kicker).toHaveTextContent(/^\[Generic\]$/);
  });

  it("tags a retired piece [RETIRED] on the photo, and does not dim it", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([retiredTee])}
        initialShowRetired
      />,
    );

    const tile = screen.getByRole("link", { name: /^Old tee/ });
    expect(tile.querySelector(".order-first")).toHaveTextContent(
      /^\[Retired\]$/,
    );
    expect(tile.className).not.toMatch(/opacity/);
  });

  it("carries both tags when a piece is generic and retired", async () => {
    const both = itemView({
      item: wardrobeItem({ id: "01BOTH", name: "Tee", retired: true }),
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([both])}
        initialShowRetired
      />,
    );
    expect(
      screen.getByRole("link", { name: /^Tee/ }).querySelector(".order-first"),
    ).toHaveTextContent(/^\[Generic\]\[Retired\]$/);
  });

  // R-94: the range used to print the stored Celsius to everyone.
  it("prints the range in the runner's unit", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="f"
        distanceUnit="mi"
        listing={listing([harrier])}
      />,
    );

    expect(drawnText(screen.getByRole("link", { name: /Harrier/ }))).toContain(
      "[39–54°]",
    );
  });

  it("shows the tested range, and says Untested when there is none", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, genericTop])}
      />,
    );

    const harrierTile = screen.getByRole("link", { name: /Harrier/ });
    expect(drawnText(harrierTile)).toContain("[4–12°]");
    expect(harrierTile).toHaveAccessibleName(/4 to 12 degrees/);
    expect(
      screen.getByRole("link", { name: /Long sleeve top/ }),
    ).toHaveTextContent("[Untested]");
  });

  it("wears no hue on the range or on Untested — teal means dialed", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, genericTop])}
      />,
    );

    for (const name of [/Harrier/, /Long sleeve top/]) {
      const label = screen
        .getByRole("link", { name })
        .querySelector("[data-part='tile-range']");
      expect(label).toHaveClass("text-muted");
      expect(label).not.toHaveClass("text-dialed-text");
    }
  });

  it("says Untested for a range with no ends, not an empty bracket", async () => {
    const halfKnown = itemView({
      item: wardrobeItem({ id: "01VOID", name: "Mystery tee" }),
      tempRange: {},
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([halfKnown])}
      />,
    );

    expect(screen.getByRole("link", { name: /Mystery tee/ })).toHaveTextContent(
      "[Untested]",
    );
  });

  it("presses a tile to ink rather than scaling it", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );

    const row = screen.getByRole("link", { name: /Harrier/ });
    expect(row).toHaveClass("row-press");
    expect(row.firstElementChild).not.toHaveClass("text-ink");
  });

  it("rounds a tile, and the Add tile beside it, by RADIUS.tile", async () => {
    // tokens.js gained `tile` in round 28: the closet tile is not a field,
    // and borrowing `rounded-field` tied its corners to the inputs'. The
    // two are both 10 today and stay two names because they are two jobs.
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );

    for (const cell of [
      screen.getByRole("link", { name: /Harrier/ }),
      tile(),
    ]) {
      expect(cell).toHaveClass("rounded-tile");
      expect(cell).not.toHaveClass("rounded-field");
    }
  });
});

describe("ClosetGrid: the enrichment nudge", () => {
  it("counts the generic pieces against the whole closet", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, genericTop])}
      />,
    );
    expect(screen.getByText(/still generic/)).toHaveTextContent(
      "1 of 2 pieces are still generic",
    );
  });

  it("says nothing when every piece is named", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    expect(screen.queryByText(/still generic/)).toBeNull();
  });
});

describe("ClosetGrid: retired pieces behind the switch", () => {
  it("hides them, and shows them on demand", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, retiredTee])}
      />,
    );

    expect(screen.queryByRole("link", { name: /Old tee/ })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Show retired (1)" }));
    expect(screen.getByRole("link", { name: /Old tee/ })).toBeVisible();

    // And back. Awaited, because the tile collapses before it goes.
    await user.click(screen.getByRole("switch", { name: "Show retired (1)" }));
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /Old tee/ })).toBeNull();
    });
  });

  it("marks the tile that is leaving, and only that one", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, retiredTee])}
        initialShowRetired
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Show retired (1)" }));

    const leaving = screen.getByRole("link", { name: /Old tee/ }).closest("li");
    expect(leaving).toHaveClass("collapsing-row");
    expect(leaving).toHaveAttribute("data-leaving", "true");
    const staying = screen.getByRole("link", { name: /Harrier/ }).closest("li");
    expect(staying).not.toHaveAttribute("data-leaving");
  });

  it("opens already showing them when the caller asks", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, retiredTee])}
        initialShowRetired
      />,
    );

    expect(screen.getByRole("link", { name: /Old tee/ })).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "Show retired (1)" }),
    ).toBeChecked();
  });
});

/**
 * A closet that learns of two deletes in turn, without remounting: the
 * only way to see that the grid follows a changed `deleted`.
 */
function TwoDeletes() {
  const [deleted, setDeleted] = useState("Pegasus 40");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDeleted("Vaporfly");
        }}
      >
        Next delete
      </button>
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
        deleted={deleted}
      />
    </>
  );
}

describe("ClosetGrid: round 26's confirms", () => {
  it("counts the retired pieces on the switch", async () => {
    const otherRetired = itemView({
      item: wardrobeItem({ id: "01RT2", name: "Old shorts", retired: true }),
      isGeneric: false,
      uiGroup: "bottoms",
    });
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier, retiredTee, otherRetired])}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "Show retired (2)" }),
    ).toBeVisible();
  });

  it("says which piece a delete took, in the status line", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
        deleted="Pegasus 40"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Pegasus 40 deleted.",
      );
    });
  });

  it("says nothing when nothing was deleted", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([harrier])}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces a second delete without a remount, not just the first", async () => {
    // `deleted` is a prop, not internal state, so the only way to observe
    // the effect's dependency array is to change it on an already-mounted
    // ClosetGrid — a harness that holds it in state and hands down a new
    // value does that; recreating the whole tree would run the effect on
    // mount either way and prove nothing about its deps.
    const user = userEvent.setup();
    await renderWithRouter(<TwoDeletes />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Pegasus 40 deleted.",
      );
    });

    await user.click(screen.getByRole("button", { name: "Next delete" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Vaporfly deleted.");
    });
  });
});

const performed = (verdictCount: number) => ({
  summary: {
    runCount: verdictCount,
    verdictCount,
    dialedCount: 0,
    lastWornAt: undefined,
    mileageM: 0,
  },
  buckets: [],
  pairsWith: [],
});

const rail = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>("nav[data-part='rail']");
  if (found === null) throw new Error("no rail");
  return found;
};

describe("ClosetGrid: the rail (R-94)", () => {
  const tights = itemView({
    item: wardrobeItem({ id: "01BTM", name: "Tights", category: "bottom" }),
    isGeneric: false,
    uiGroup: "bottoms",
    tempRange: { lowC: -10, highC: 4 },
    performance: performed(1),
  });
  const knownHarrier = { ...harrier, performance: performed(9) };
  const closet = listing([knownHarrier, tights, genericTop, retiredTee]);

  function grid(search: ClosetSearch = {}) {
    return renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={closet}
        search={search}
      />,
    );
  }

  it("draws the rail at desk and the chips below it, both whole", async () => {
    await grid();
    expect(rail().parentElement).toHaveClass("hidden", "desk:block");
    const chips = document.querySelector<HTMLElement>("nav[data-part='chips']");
    if (chips === null) throw new Error("no chips");
    expect(chips.parentElement).toHaveClass("desk:hidden");
    // Present in both, whole — the phone's behind its chips (#109b).
    for (const nav of [rail(), chips]) {
      const groups = within(nav);
      for (const name of [/^Group$/u, /^Works at/u, /^Coverage$/u]) {
        expect(
          groups.getByRole("heading", { name, hidden: true }),
        ).toBeInTheDocument();
      }
    }
    expect(
      within(chips)
        .getAllByRole("button", { expanded: false })
        .map((chip) => drawnText(chip)),
    ).toStrictEqual(["Group · All", "Works at · Any", "Coverage · All"]);
  });

  it("puts focus on the heading's count once Clear filters has cleared", async () => {
    const user = userEvent.setup();
    const rootRoute = createRootRoute({
      validateSearch: closetSearch,
      component: function Page() {
        return (
          <ClosetGrid
            tempUnit="c"
            distanceUnit="km"
            listing={closet}
            search={rootRoute.useSearch()}
          />
        );
      },
    });
    const closetRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/closet",
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([closetRoute]),
      history: createMemoryHistory({ initialEntries: ["/closet?group=shoes"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("0 · Shoes");
    expect(heading).not.toHaveFocus();
    // A link to the bare closet is a part of this search, not this page.
    expect(
      screen.getByRole("link", { name: "Clear filters" }),
    ).not.toHaveAttribute("aria-current");
    await user.click(screen.getByRole("link", { name: "Clear filters" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "3 pieces",
      );
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    // Focusable by the clear alone, never a stop in the tab order.
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "tabindex",
      "-1",
    );

    // Spent by that one clear: the next filter leaves focus alone.
    await user.click(within(rail()).getByRole("link", { name: /^Tops/ }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "2 · Tops",
      );
    });
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it("narrows the grid by group and heads it N · Group", async () => {
    await grid({ group: "bottoms" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "1 · Bottoms",
    );
    expect(cells()).toStrictEqual(["Tights", "Add garment"]);
  });

  it("counts what the retired switch admits, not narrowed by the set group", async () => {
    await grid({ group: "bottoms" });
    const counts = within(rail());
    expect(counts.getByRole("link", { name: /^All/ })).toHaveTextContent(
      "All 3",
    );
    expect(counts.getByRole("link", { name: /^Tops/ })).toHaveTextContent(
      "Tops 2",
    );
    expect(counts.getByRole("link", { name: /^Untested/ })).toHaveTextContent(
      "Untested 1",
    );
  });

  it("counts the retired pieces once the switch admits them", async () => {
    const user = userEvent.setup();
    await grid();
    await user.click(screen.getByRole("switch", { name: /Show retired/ }));
    expect(
      within(rail()).getByRole("link", { name: /^All/ }),
    ).toHaveTextContent("All 4");
  });

  it("narrows by WORKS AT and COVERAGE, and says so on the FILTERED line", async () => {
    await grid({ from: 5, to: 10, coverage: "covered" });
    expect(cells()).toStrictEqual(["Tracksmith Harrier", "Add garment"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "1 piece",
    );
    const filtered = document.querySelector("[data-part='filtered']");
    expect(drawnText(filtered)).toBe("Filtered: [5–10°] · Covered");
    expect(saidText(filtered)).toBe("Filtered: 5 to 10 degrees · Covered");
    // Filtered, and something matches: no "nothing matches".
    expect(document.querySelector("[data-part='no-matches']")).toBeNull();
  });

  it("names only what is set on the FILTERED line", async () => {
    await grid({ coverage: "partial" });
    expect(document.querySelector("[data-part='filtered']")).toHaveTextContent(
      /^Filtered: Partial$/,
    );
  });

  it("names an open span by its one end", async () => {
    await grid({ from: 5 });
    const line = document.querySelector("[data-part='filtered']");
    expect(drawnText(line)).toMatch(/^Filtered: \[5°\+\]$/);
    expect(saidText(line)).toBe("Filtered: 5 degrees and up");
    // Nothing drawn for the coverage that is not set, not even empty.
    expect(
      [...(line?.children ?? [])].map((part) => drawnText(part)),
    ).toStrictEqual(["Filtered: ", "[5°+]"]);
  });

  it("has no FILTERED line for a group alone, which the heading says", async () => {
    await grid({ group: "tops" });
    expect(document.querySelector("[data-part='filtered']")).toBeNull();
  });

  it("says nothing matches, with the way back, and keeps the Add tile", async () => {
    await grid({ group: "shoes" });
    const none = document.querySelector("[data-part='no-matches']");
    expect(none).toHaveTextContent(
      "Nothing in your closet matches these filters. Clear filters",
    );
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/closet",
    );
    expect(cells()).toStrictEqual(["Add garment"]);
  });

  it("does not say nothing matches when nothing is filtered", async () => {
    await renderWithRouter(
      <ClosetGrid
        tempUnit="c"
        distanceUnit="km"
        listing={listing([retiredTee])}
      />,
    );
    expect(cells()).toStrictEqual(["Add garment"]);
    expect(document.querySelector("[data-part='no-matches']")).toBeNull();
  });

  it("draws no filters on an empty closet", async () => {
    await renderWithRouter(
      <ClosetGrid tempUnit="c" distanceUnit="km" listing={listing([])} />,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("closetHeading", () => {
  it("counts pieces with no group, and names the group once one is set", () => {
    expect(closetHeading(47, undefined)).toBe("47 pieces");
    expect(closetHeading(1, undefined)).toBe("1 piece");
    expect(closetHeading(8, "hands_head")).toBe("8 · Hands / head");
  });
});

describe("closetScreen", () => {
  it("calls the screen filtered by any one of the rail's filters", () => {
    const one = listing([harrier]);
    expect(closetScreen(one, false, {}).isFiltered).toBe(false);
    expect(closetScreen(one, false, { group: "tops" }).isFiltered).toBe(true);
    expect(closetScreen(one, false, { coverage: "unknown" }).isFiltered).toBe(
      true,
    );
    expect(closetScreen(one, false, { from: 0 }).isFiltered).toBe(true);
    expect(closetScreen(one, false, { to: 0 }).isFiltered).toBe(true);
  });

  it("spans WORKS AT over what the switch admits", () => {
    const hot = itemView({
      item: wardrobeItem({ id: "01HOT", retired: true }),
      tempRange: { lowC: 30, highC: 40 },
    });
    expect(closetScreen(listing([harrier, hot]), false, {}).span).toStrictEqual(
      { lowC: 4, highC: 12 },
    );
    expect(closetScreen(listing([harrier, hot]), true, {}).span).toStrictEqual({
      lowC: 4,
      highC: 40,
    });
  });
});

/**
 * The app's shape: a root with no search of its own and the closet
 * route parsing below it, which is where the router merges the raw
 * query back under the parsed fields.
 */
async function routedAt(url: string) {
  const rootRoute = createRootRoute();
  const closetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    validateSearch: closetSearch,
    component: function Page() {
      return (
        <ClosetGrid
          tempUnit="f"
          distanceUnit="mi"
          listing={listing([harrier])}
          search={closetRoute.useSearch()}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([closetRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

describe("ClosetGrid: the search the router hands it (design 174)", () => {
  it("keeps what WORKS AT's form made and none of the form's own fields", async () => {
    await routedAt("/closet?lowest=40&highest=50&unit=f&group=tops");
    const rail = document.querySelector<HTMLElement>("nav[data-part='rail']");
    if (rail === null) throw new Error("no rail");
    expect(drawnText(document.querySelector("[data-part='filtered']"))).toBe(
      "Filtered: [40–50°]",
    );
    // Any drops the span for good, rather than landing on a URL that
    // brings it back from `lowest`.
    expect(within(rail).getByRole("link", { name: "Any" })).toHaveAttribute(
      "href",
      "/closet?group=tops",
    );
    expect(within(rail).getByRole("link", { name: /^All/ })).toHaveAttribute(
      "href",
      "/closet?from=4.4&to=10",
    );
  });
});
