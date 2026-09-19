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
import { createItem, getItemDetail } from "../../src/modules/closet/service";

/**
 * The no-anchor branch of screen E's product link, against a real stored
 * item rather than a hand-built one: `wardrobe_items.product_url` is
 * `NULL` when nobody pasted a link, and a real D1 row is the only way to
 * get that `null` without writing the literal this repo's lint forbids
 * (`unicorn/no-null`) — see test/closet/garment-detail.dom.test.tsx for
 * why the DOM-rendered case doesn't attempt it.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

async function detailFor(productUrl?: string) {
  const userId = newUlid();
  const created = await createItem(db(), userId, {
    category: "top",
    name: "Rover Half-Zip",
    ...(productUrl !== undefined && { productUrl }),
  });
  const view = await getItemDetail(db(), userId, created.id);
  return { ...view, pairedItems: [] };
}

async function renderedMarkup(productUrl?: string): Promise<string> {
  const detail = await detailFor(productUrl);
  const rootRoute = createRootRoute({
    component: () => (
      <GarmentDetail
        detail={detail}
        retire={vi.fn()}
        unretire={vi.fn()}
        remove={vi.fn()}
        uploadPhoto={vi.fn()}
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

describe("GarmentDetail's product link, against real stored items", () => {
  it("links to the stored URL, with the rel set and domain link hygiene requires", async () => {
    const markup = await renderedMarkup("https://janji.com/p/rover-half-zip");

    expect(markup).toContain('href="https://janji.com/p/rover-half-zip"');
    expect(markup).toContain('rel="ugc nofollow noopener"');
    expect(markup).toContain("janji.com");
  });

  it("renders no product link at all when the item has none stored", async () => {
    const markup = await renderedMarkup();

    expect(markup).not.toContain("ugc nofollow noopener");
    expect(markup).not.toContain("janji.com");
  });
});
