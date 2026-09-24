import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { GarmentDetail } from "../../src/modules/closet/components/GarmentDetail";
import type { WardrobeItemRow } from "../../src/modules/closet/service";

/**
 * Garment detail against a fully populated row — every column carrying a
 * real value, a stored product link and a photo among them.
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

function populated(uploadPhoto = vi.fn()): ReactElement {
  return (
    <GarmentDetail
      detail={detail}
      retire={vi.fn()}
      unretire={vi.fn()}
      remove={vi.fn()}
      uploadPhoto={uploadPhoto}
      removePhoto={vi.fn()}
    />
  );
}

describe("GarmentDetail: no product link (round 22)", () => {
  it("draws no link for a garment that has one stored", async () => {
    // Round 22's Y: "Order is fixed" — identity, photo, stats,
    // composition, pairs with, actions. A product link is none of them;
    // F2a/F2b bring links back with enrichment.
    await renderWithRouter(populated());

    expect(screen.queryByText("janji.com")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="https://"]')).toBeNull();
  });
});

describe("GarmentDetail: the photo well at width", () => {
  it("goes to solid ink while a replacement is over the photo", async () => {
    // Bend 1's "one state change", as round 22 draws it — on the filled
    // well too, because Replace is a drop target at desk.
    await renderWithRouter(populated());

    const well = document.querySelector<HTMLElement>(
      "[data-part='photo-well']",
    );
    expect(well).toHaveAttribute("data-state", "filled");

    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])], "kit.png"));
    fireEvent.dragOver(well ?? document.body, { dataTransfer: transfer });

    expect(well).toHaveAttribute("data-state", "drag-over");
  });

  it("takes a dropped file down the same path as a chosen one", async () => {
    // "Face-blur runs the same WASM path on the dropped file — do not
    // fork it." The upload callback is the proof: one handler, reached
    // either way.
    const uploadPhoto = vi.fn().mockResolvedValue({ ok: true, photoKey: "k" });
    await renderWithRouter(populated(uploadPhoto));

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
