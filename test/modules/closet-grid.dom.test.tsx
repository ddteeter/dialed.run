import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ClosetGrid } from "../../src/modules/closet/components/ClosetGrid";
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

/**
The grid's cells, as the names they carry, in order.
*/
function cells(): string[] {
  const grid = document.querySelector("[data-part='grid']");
  if (grid === null) throw new Error("no grid");
  return [...grid.children].map((cell) => cell.textContent);
}

const tile = (): HTMLElement =>
  screen.getByRole("link", { name: "Add garment" });

describe("ClosetGrid: the empty closet (ruling 16)", () => {
  it("says so in brackets, asks for three pieces, and offers the Add tile", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([])} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "[Nothing in here yet]" }),
    ).toBeVisible();
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
      <ClosetGrid listing={listing([])} />,
    );
    expect(tile().closest("li")).toHaveClass("only:min-h-40");
    expect(tile()).toHaveClass("h-full");
    expect(tile()).not.toHaveClass("min-h-40");
    unmount();

    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    // Beside a garment, the grid's equal rows size it. happy-dom lays
    // nothing out, so the heights themselves are measured in a real
    // browser at 390 and 1440, alone on a row and sharing one
    // (e2e/conformance/closet-empty.conformance.spec.ts).
    expect(tile().closest("li")).toHaveClass("only:min-h-40");
    expect(tile().closest("ul")).toHaveClass("auto-rows-fr");
  });

  it("has no count and no switch about pieces there are none of", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([])} />);
    expect(screen.queryByText(/pieces?$/)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("counts the closet, not the visible rows", async () => {
    // `totalCount === 0`, not `items.length === 0`: a closet holding only
    // retired items is not empty, and offering "add your first piece" to
    // someone with a full closet reads as data loss.
    await renderWithRouter(
      <ClosetGrid
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
      <ClosetGrid listing={listing([harrier, genericTop, retiredTee])} />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "2 pieces" }),
    ).toBeVisible();
  });

  it("says one piece, not one pieces", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "1 piece" }),
    ).toBeVisible();
  });

  it("puts the switch opposite the count, and the count follows it", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier, retiredTee])} />,
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
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("has no Add in the heading: adding is the grid's tile", async () => {
    // §6c.10: "Adding a garment is the grid's dashed tile and the Y route;
    // never a bar action."
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(screen.queryByRole("link", { name: /^Add$/ })).toBeNull();
    expect(cells().at(-1)).toBe("Add garment");
  });
});

describe("ClosetGrid: one flat grid (§6c.10)", () => {
  it("has no group headings and no rail", async () => {
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier, genericTop, retiredTee])} />,
    );
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(document.querySelector("[data-slot='closet-rail']")).toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(1);
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

    await renderWithRouter(<ClosetGrid listing={listing(views)} />);

    expect(cells().map((cell) => cell.split("[", 1)[0])).toStrictEqual([
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
        listing={listing([retiredTee, shoe, harrier])}
        initialShowRetired
      />,
    );
    expect(cells().map((cell) => cell.split("[", 1)[0])).toStrictEqual([
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
      <ClosetGrid listing={listing([shoe, harrier])} initialShowRetired />,
    );
    expect(cells().map((cell) => cell.split("[", 1)[0])).toStrictEqual([
      "Tracksmith Harrier",
      "Pegasus",
      "Add garment",
    ]);
  });

  it("lets the garment grid fill rather than counting columns", async () => {
    // DS3's reflow rule for a grid of garments: "auto-fill,
    // minmax(180px, 1fr)". One rule instead of a count per breakpoint.
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);

    expect(screen.getByRole("list")).toHaveClass(
      "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
    );
  });
});

describe("ClosetGrid: a photo being checked (R-69, round 27 #21)", () => {
  it("tags the tile ONLY YOU, alone in the kicker", async () => {
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
    await renderWithRouter(<ClosetGrid listing={listing([checking])} />);

    const link = screen.getByRole("link", { name: /New jacket/ });
    const kicker = link.querySelector(".order-first");
    expect(kicker).toHaveTextContent(/^\[Only you\]$/);
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
    await renderWithRouter(<ClosetGrid listing={listing([cleared, bare])} />);

    for (const name of [/Old jacket/, /Bare jacket/]) {
      const link = screen.getByRole("link", { name });
      expect(link.querySelector(".order-first")).toBeNull();
    }
  });
});

describe("ClosetGrid: what a tile says", () => {
  it("names a branded piece and links to it, with no tags", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);

    const branded = screen.getByRole("link", { name: /Harrier/ });
    expect(branded).toHaveAttribute("href", "/closet/01TOP");
    expect(branded.firstElementChild).toHaveTextContent(/^Tracksmith Harrier$/);
    expect(branded).not.toHaveTextContent("Generic");
    expect(branded).not.toHaveTextContent("Retired");
    // No kicker at all, rather than an empty one holding a line's height.
    expect(branded.querySelector(".order-first")).toBeNull();
  });

  it("tags a generic piece in the kicker, above the name but after it in the name", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([genericTop])} />);

    const generic = screen.getByRole("link", { name: /^Long sleeve top/ });
    const kicker = generic.querySelector(".order-first");
    expect(kicker).toHaveClass("order-first");
    expect(kicker).toHaveTextContent(/^\[Generic\]$/);
  });

  it("tags a retired piece [RETIRED] in the kicker, and does not dim it", async () => {
    await renderWithRouter(
      <ClosetGrid listing={listing([retiredTee])} initialShowRetired />,
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
      <ClosetGrid listing={listing([both])} initialShowRetired />,
    );
    expect(
      screen.getByRole("link", { name: /^Tee/ }).querySelector(".order-first"),
    ).toHaveTextContent(/^\[Generic\]\[Retired\]$/);
  });

  it("shows the tested range, and says Untested when there is none", async () => {
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier, genericTop])} />,
    );

    expect(screen.getByRole("link", { name: /Harrier/ })).toHaveTextContent(
      "[4–12°]",
    );
    expect(
      screen.getByRole("link", { name: /Long sleeve top/ }),
    ).toHaveTextContent("[Untested]");
  });

  it("wears no hue on the range or on Untested — teal means dialed", async () => {
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier, genericTop])} />,
    );

    for (const name of [/Harrier/, /Long sleeve top/]) {
      const label = screen.getByRole("link", { name }).lastElementChild;
      expect(label).toHaveClass("text-muted");
      expect(label).not.toHaveClass("text-dialed-text");
    }
  });

  it("says Untested for a range with no ends, not an empty bracket", async () => {
    const halfKnown = itemView({
      item: wardrobeItem({ id: "01VOID", name: "Mystery tee" }),
      tempRange: {},
    });
    await renderWithRouter(<ClosetGrid listing={listing([halfKnown])} />);

    expect(screen.getByRole("link", { name: /Mystery tee/ })).toHaveTextContent(
      "[Untested]",
    );
  });

  it("presses a tile to ink rather than scaling it", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);

    const row = screen.getByRole("link", { name: /Harrier/ });
    expect(row).toHaveClass("row-press");
    expect(row.firstElementChild).not.toHaveClass("text-ink");
  });

  it("rounds a tile, and the Add tile beside it, by RADIUS.tile", async () => {
    // tokens.js gained `tile` in round 28: the closet tile is not a field,
    // and borrowing `rounded-field` tied its corners to the inputs'. The
    // two are both 10 today and stay two names because they are two jobs.
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);

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
      <ClosetGrid listing={listing([harrier, genericTop])} />,
    );
    expect(screen.getByText(/still generic/)).toHaveTextContent(
      "1 of 2 pieces are still generic",
    );
  });

  it("says nothing when every piece is named", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(screen.queryByText(/still generic/)).toBeNull();
  });
});

describe("ClosetGrid: retired pieces behind the switch", () => {
  it("hides them, and shows them on demand", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier, retiredTee])} />,
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
      <ClosetGrid listing={listing([harrier])} deleted={deleted} />
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
      <ClosetGrid listing={listing([harrier, retiredTee, otherRetired])} />,
    );
    expect(
      screen.getByRole("switch", { name: "Show retired (2)" }),
    ).toBeVisible();
  });

  it("says which piece a delete took, in the status line", async () => {
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier])} deleted="Pegasus 40" />,
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Pegasus 40 deleted.",
      );
    });
  });

  it("says nothing when nothing was deleted", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
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
