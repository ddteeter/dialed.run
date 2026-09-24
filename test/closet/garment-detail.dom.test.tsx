import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
`photoKey` is nullable in the schema too, for the same reason as `NO_LINK`.
*/
const NO_PHOTO = z.null().parse(JSON.parse("null"));

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

describe("GarmentDetail: the photo well at width", () => {
  // An empty well: the shared fixture has a photo, which makes the well
  // its preview (round 22) and puts no title in it.
  const noPhoto = { ...detail, item: { ...detail.item, photoKey: NO_PHOTO } };

  it("says Drop at desk, where a file can be dropped", async () => {
    // Round 22, item 8: "The desk title adds 'Drop' because the desk can;
    // the phone's can't." Bend 1's old line — "shoot it on your phone
    // later" — was retired with round 21's bend 2 ruling. happy-dom applies
    // no stylesheet, so what is checkable is the variant that hides each.
    await renderWithRouter(
      <GarmentDetail
        detail={noPhoto}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={vi.fn()}
      />,
    );

    expect(screen.getByText("Drop a photo, or browse")).toHaveClass(
      "hidden",
      "wide:inline",
    );
    expect(screen.getByText("Add a photo")).toHaveClass("wide:hidden");
  });

  it("goes to solid ink while a file is over it, and says to let go", async () => {
    // Bend 1's "one state change", as round 22 draws it.
    await renderWithRouter(
      <GarmentDetail
        detail={noPhoto}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={vi.fn()}
      />,
    );

    const well = document.querySelector<HTMLElement>(
      "[data-part='photo-well']",
    );
    expect(well).toHaveAttribute("data-state", "empty");
    expect(well?.querySelector("input")).toHaveClass("sr-only");

    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], "kit.png"));
    fireEvent.dragOver(well ?? document.body, { dataTransfer: transfer });

    expect(well).toHaveAttribute("data-state", "drag-over");
    expect(screen.getByText("Let go to add it")).toBeInTheDocument();
  });

  it("takes a dropped file down the same path as a chosen one", async () => {
    // "Face-blur runs the same WASM path on the dropped file — do not
    // fork it." The upload callback is the proof: one handler, reached
    // either way.
    const uploadPhoto = vi.fn().mockResolvedValue({ ok: true, photoKey: "k" });
    await renderWithRouter(
      <GarmentDetail
        detail={detail}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={uploadPhoto}
      />,
    );

    const well = document.querySelector<HTMLElement>(
      "[data-part='photo-well']",
    );
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([1])], "kit.png", { type: "image/png" }),
    );
    fireEvent.drop(well ?? document.body, { dataTransfer: transfer });

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
  });
});
