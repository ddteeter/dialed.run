import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ClosetGrid } from "../../src/modules/closet/components/ClosetGrid";
import { itemView, listing, wardrobeItem } from "./closet-fixtures";

/**
 * Screen C, driven.
 *
 * The grid's decisions — which groups appear, in what order, what a
 * retired item does to the count, whether the enrichment nudge shows —
 * are all conditional rendering, and the SSR tests could only look at the
 * first paint of one arrangement.
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

describe("ClosetGrid: the empty closet", () => {
  it("asks for five things rather than showing an empty grid", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([])} />);

    expect(screen.getByText(/Nothing in here yet/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Add a piece" })).toHaveAttribute(
      "href",
      "/closet/new",
    );
    // No group headings, no toggle — the empty state is the whole screen.
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("counts the closet, not the visible rows", async () => {
    // `totalCount === 0`, not `items.length === 0`: a closet holding only
    // retired items is not empty, and offering "add your first piece" to
    // someone with a full closet reads as data loss.
    const retired = itemView({
      item: wardrobeItem({ id: "01RET", retired: true }),
    });
    await renderWithRouter(
      <ClosetGrid listing={{ items: [retired], totalCount: 1, genericCount: 0 }} />,
    );

    expect(screen.queryByText(/Nothing in here yet/)).toBeNull();
  });
});

describe("ClosetGrid: what a piece says about itself", () => {
  it("names a branded piece, tags a generic one, and links to each", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier, genericTop])} />);

    const branded = screen.getByRole("link", { name: /Harrier/ });
    expect(branded).toHaveAttribute("href", "/closet/01TOP");
    expect(branded).toHaveTextContent("Tracksmith Harrier");
    // The tag reads in normal case and is uppercased in CSS, so a screen
    // reader announces "Generic" rather than spelling it out.
    expect(branded).not.toHaveTextContent("Generic");

    // The space before the tag is a deliberate `{" "}` — JSX drops
    // whitespace between elements, so without it the tile reads
    // "Long sleeve top[Generic]".
    const generic = screen.getByRole("link", { name: /Long sleeve top/ });
    expect(generic.firstElementChild).toHaveTextContent(
      /^Long sleeve top \[Generic\]$/,
    );
  });

  it("shows the tested range, and says Untested when there is none", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier, genericTop])} />);

    expect(
      screen.getByRole("link", { name: /Harrier/ }),
    ).toHaveTextContent("[4–12°]");
    expect(
      screen.getByRole("link", { name: /Long sleeve top/ }),
    ).toHaveTextContent("[Untested]");
  });

  it("says Untested for a range with no ends, not an empty bracket", async () => {
    // A `tempRange` object whose bounds are both undefined is a range in
    // name only, and `formatTempRange` answers undefined for it. Without
    // the fallback the tile would render `[]`.
    const halfKnown = itemView({
      item: wardrobeItem({ id: "01VOID", name: "Mystery tee" }),
      // Both ends absent, which `TempRange` allows: a garment can be
      // half-tested, or in this case tested at neither end.
      tempRange: {},
    });
    await renderWithRouter(<ClosetGrid listing={listing([halfKnown])} />);

    expect(
      screen.getByRole("link", { name: /Mystery tee/ }),
    ).toHaveTextContent("[Untested]");
  });

  it("marks a retired piece as retired", async () => {
    // Named, so the only tag on it is the retirement one.
    const retired = itemView({
      item: wardrobeItem({
        id: "01RET",
        name: "Old tee",
        brand: "Nike",
        retired: true,
      }),
      isGeneric: false,
    });
    await renderWithRouter(
      <ClosetGrid listing={listing([retired])} initialShowRetired />,
    );

    expect(
      screen.getByRole("link", { name: /Old tee/ }).firstElementChild,
    ).toHaveTextContent(/^Nike Old tee \[Retired\]$/);
  });
});

describe("ClosetGrid: the groups", () => {
  it("renders all six in the contract's order, whatever order the items arrive in", async () => {
    // The headings are what a user navigates by, and the order is the
    // derived-UI-groups table's rather than the items'. Deliberately fed
    // in reverse.
    const groups = [
      ["socks_extras", "Wool socks"],
      ["shoes", "Pegasus"],
      ["hands_head", "Liners"],
      ["outer", "Houdini"],
      ["bottoms", "Half tights"],
      ["tops", "Harrier"],
    ] as const;
    const views = groups.map(([group, name], index) =>
      itemView({
        item: wardrobeItem({ id: `01ITEM${String(index)}`, name }),
        uiGroup: group,
      }),
    );

    await renderWithRouter(<ClosetGrid listing={listing(views)} />);

    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toStrictEqual([
      "Tops",
      "Bottoms",
      "Outer",
      "Hands / head",
      "Shoes",
      "Socks / extras",
    ]);
  });

  it("omits a group with nothing in it", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toStrictEqual(["Tops"]);
  });
});

describe("ClosetGrid: the enrichment nudge", () => {
  it("counts the generic pieces against the whole closet", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier, genericTop])} />);
    expect(screen.getByText(/still generic/)).toHaveTextContent(
      "1 of 2 pieces are still generic",
    );
  });

  it("says nothing when every piece is named", async () => {
    // Quiet by design (D-27/D-28): a nudge that is always there is
    // furniture, not a nudge.
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(screen.queryByText(/still generic/)).toBeNull();
  });
});

describe("ClosetGrid: retired items behind a toggle", () => {
  const retired = itemView({
    item: wardrobeItem({ id: "01RET", name: "Old tee", retired: true }),
  });

  it("hides them, offers the count, and shows them on demand", async () => {
    const user = userEvent.setup();
    await renderWithRouter(<ClosetGrid listing={listing([harrier, retired])} />);

    expect(screen.queryByRole("link", { name: /Old tee/ })).toBeNull();
    const toggle = screen.getByRole("button", { name: /Show retired \(1\)/ });

    await user.click(toggle);

    expect(screen.getByRole("link", { name: /Old tee/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Hide retired \(1\)/ })).toBeVisible();

    // And back — the toggle is a toggle, not a one-way reveal.
    await user.click(screen.getByRole("button", { name: /Hide retired/ }));
    expect(screen.queryByRole("link", { name: /Old tee/ })).toBeNull();
  });

  it("opens already showing them when the caller asks", async () => {
    // Set after retiring one, so the user lands on the item still present
    // and marked rather than on a grid it has just vanished from.
    await renderWithRouter(
      <ClosetGrid listing={listing([harrier, retired])} initialShowRetired />,
    );

    expect(screen.getByRole("link", { name: /Old tee/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Hide retired/ })).toBeVisible();
  });

  it("offers no toggle when nothing is retired", async () => {
    await renderWithRouter(<ClosetGrid listing={listing([harrier])} />);
    expect(screen.queryByRole("button", { name: /retired/ })).toBeNull();
  });
});
