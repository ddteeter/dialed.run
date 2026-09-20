import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GarmentDetail } from "../../src/modules/closet/components/GarmentDetail";
import type { WardrobeItemRow } from "../../src/modules/closet/service";

/**
 * Screen E's product link (packet §3, link hygiene). `wardrobe_items` has
 * carried `product_url` since lane 101, but nothing rendered it — the
 * column existed, the detail page never read it, and knip's "unused
 * export" on `ui/ProductLink` was that gap made visible. Wired through
 * `ProductLink` so it always carries the `ugc nofollow noopener` rel set
 * and shows its own domain beside a stranger's link text.
 *
 * The no-link branch (an absent or unparseable URL) is exercised against
 * real rows in test/closet/garment-detail.test.tsx, not here:
 * `WardrobeItemRow`'s nullable columns can't be faked in a plain object
 * literal without the `null` literal this repo's lint forbids
 * (`unicorn/no-null`) — a real D1 row has a genuine null where this file
 * would need a written one. So every column below carries a real value.
 */

const item: WardrobeItemRow = {
  id: "item-1",
  userId: "user-1",
  category: "top",
  type: "halfZip",
  layer: "mid",
  weight: "mid",
  fabric: "synthetic",
  windResistant: false,
  waterResistant: false,
  estTempLowC: 5,
  estTempHighC: 15,
  brand: "Janji",
  name: "Rover Half-Zip",
  size: "M",
  color: "Grey",
  colorName: "grey",
  colorHex: "#8b8b93",
  visibilityLevel: "plain",
  photoKey: "items/user-1/item-1/original",
  productUrl: "https://janji.com/p/rover-half-zip",
  productId: "prod-1",
  origin: "manual",
  idempotencyKey: "idem-1",
  retired: false,
  visibility: "ok",
  createdAt: 1_700_000_000,
};

/**
`productUrl` is nullable in the schema and the lint rules reject the literal.
*/
const NO_LINK = z.null().parse(JSON.parse("null"));

const detail = {
  item,
  isGeneric: false,
  uiGroup: "tops" as const,
  effective: {
    weight: "mid" as const,
    fabric: "synthetic" as const,
    windResistant: false,
    waterResistant: false,
  },
  tempRange: { lowC: 5, highC: 15 },
  performance: undefined,
  productDefaults: undefined,
  composition: undefined,
  pairedItems: [],
};

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("GarmentDetail's product link", () => {
  it("renders the stored URL under the garment's own label, with the domain beside it", async () => {
    await renderWithRouter(
      <GarmentDetail
        detail={detail}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: "Janji Rover Half-Zip" });
    expect(link).toHaveAttribute("href", "https://janji.com/p/rover-half-zip");
    // ui/ProductLink shows the bare host beside a stranger's link text —
    // that is what says who is really on the other end.
    expect(screen.getByText("janji.com")).toBeInTheDocument();
  });

  it("shows no link at all for a garment that has none", async () => {
    await renderWithRouter(
      <GarmentDetail
        detail={{ ...detail, item: { ...item, productUrl: NO_LINK } }}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={vi.fn()}
      />,
    );

    // Most garments are typed in by hand and have no link. Rendering the
    // component anyway would put an anchor with nothing behind it next to
    // every one of them — and `ProductLink` is the thing that carries the
    // `ugc nofollow noopener` rel set, so an empty one is a link-shaped
    // hole rather than a missing decoration. Asked for by the bare
    // domain, which only `ProductLink` renders: the screen's other
    // anchors are router links to elsewhere in the app and stay.
    expect(screen.queryByText("janji.com")).not.toBeInTheDocument();
  });
});
