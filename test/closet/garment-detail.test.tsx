import { drizzle } from "drizzle-orm/d1";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { GarmentDetail } from "../../src/modules/closet/components/GarmentDetail";
import {
  createItem,
  getItemDetailWithPairs,
} from "../../src/modules/closet/service";

/**
 * Garment detail's first paint, from a real stored row: what the server
 * sends before any script runs. A real D1 row is the only way to get the
 * genuine `null`s a garment with no photo and no link carries, without the
 * literal this repo's lint forbids (`unicorn/no-null`).
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

async function renderedMarkup(): Promise<string> {
  const userId = newUlid();
  const created = await createItem(db(), userId, {
    category: "top",
    name: "Rover Half-Zip",
    productUrl: "https://janji.com/p/rover-half-zip",
  });
  const detail = await getItemDetailWithPairs(db(), userId, created.id);
  const rootRoute = createRootRoute({
    component: () => (
      <GarmentDetail
        detail={detail}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={vi.fn()}
        removePhoto={vi.fn()}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

describe("GarmentDetail's first paint, against a real stored row", () => {
  it("has no photo well and no empty Add box when the garment has no photo", async () => {
    // Round 22: "no photo means no well here; adding one is Edit's job".
    const markup = await renderedMarkup();

    expect(markup).not.toContain('data-part="photo-well"');
    expect(markup).not.toContain("Add a photo");
  });

  it("draws no product link, even for a garment that has one stored", async () => {
    const markup = await renderedMarkup();

    expect(markup).not.toContain("janji.com");
  });
});
