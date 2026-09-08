import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { ClosetGrid } from "../../src/modules/closet/components/ClosetGrid";
import { GarmentForm } from "../../src/modules/closet/components/GarmentForm";
import { createItem } from "../../src/modules/closet/service";
import type { ClosetListing } from "../../src/modules/closet/service";

function db() {
  return drizzle(env.DIALED_CORE);
}

/** ClosetGrid renders typed <Link>s, which need router context (mirrors
 * test/ui.test.tsx's TabBar/Layout pattern). */
async function renderWithRouter(element: ReactElement): Promise<string> {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

describe("ClosetGrid", () => {
  it("renders the empty state with a CTA when there are no items", async () => {
    const listing: ClosetListing = { items: [], totalCount: 0, genericCount: 0 };
    const html = await renderWithRouter(<ClosetGrid listing={listing} />);
    expect(html).toContain("Nothing in here yet");
    expect(html).toContain("Add a piece");
  });

  it("renders a brand+model item and a generic item with the [Generic] tag", async () => {
    const userId = newUlid();
    const client = db();
    // Real rows (not hand-built literals): WardrobeItemRow's nullable
    // columns are `T | null` (drizzle's SQLite shape), and the project lint
    // rule forbids writing the `null` literal — createItem gives us genuine
    // rows without ever typing `null` in this file.
    const branded = await createItem(client, userId, {
      category: "top",
      name: "Harrier",
      brand: "Tracksmith",
      weight: "mid",
    });
    const generic = await createItem(client, userId, {
      category: "top",
      name: "Long sleeve top",
    });
    const tempRange =
      branded.estTempLowC !== null && branded.estTempHighC !== null
        ? { lowC: branded.estTempLowC, highC: branded.estTempHighC }
        : undefined;
    const listing: ClosetListing = {
      items: [
        {
          item: branded,
          isGeneric: false,
          uiGroup: "tops",
          effective: {
            weight: "mid",
            fabric: undefined,
            windResistant: undefined,
            waterResistant: undefined,
          },
          tempRange,
          performance: undefined,
        },
        {
          item: generic,
          isGeneric: true,
          uiGroup: "tops",
          effective: {
            weight: undefined,
            fabric: undefined,
            windResistant: undefined,
            waterResistant: undefined,
          },
          tempRange: undefined,
          performance: undefined,
        },
      ],
      totalCount: 2,
      genericCount: 1,
    };
    const html = await renderWithRouter(<ClosetGrid listing={listing} />);
    // React SSR inserts `<!-- -->` markers between adjacent interpolated
    // expressions (hydration boundaries) — strip them before checking text
    // that spans more than one JSX expression.
    const text = html.replaceAll("<!-- -->", "");
    expect(html).toContain("Tracksmith Harrier");
    expect(html).toContain("Long sleeve top");
    // Bracket tags read in normal case in the markup and are uppercased by
    // CSS, so the accessible name stays "Generic" rather than being spelled
    // out letter by letter by a screen reader.
    expect(html).toContain("Generic");
    expect(html).not.toContain("GENERIC");
    expect(html).toContain("uppercase");
    expect(text).toContain("1 of 2");
    expect(html).toContain("Untested");
  });
});

describe("GarmentForm", () => {
  it("renders top-appropriate attribute fields by default (layer, weight, fabric, wind/water)", () => {
    const html = renderToString(
      <GarmentForm
        onSubmit={() => {
          // not exercised in a render-only test
        }}
      />,
    );
    expect(html).toContain("What is it?");
    expect(html).toContain("Layer");
    expect(html).toContain("Weight");
    expect(html).toContain("Fabric");
    expect(html).toContain("Wind resistant");
    expect(html).toContain("Water resistant");
  });

  it("renders only the shoes-appropriate fields when pre-filled with category shoes", () => {
    const html = renderToString(
      <GarmentForm
        initial={{ category: "shoes", name: "Speedland" }}
        onSubmit={() => {
          // not exercised in a render-only test
        }}
      />,
    );
    expect(html).toContain("Water resistant");
    expect(html).not.toContain("Layer");
    expect(html).not.toContain("Wind resistant");
  });

  it("renders the accessory category with no attribute fields", () => {
    const html = renderToString(
      <GarmentForm
        initial={{ category: "accessory", name: "Sunglasses" }}
        onSubmit={() => {
          // not exercised in a render-only test
        }}
      />,
    );
    expect(html).not.toContain("Wind resistant");
    expect(html).not.toContain("Water resistant");
    expect(html).not.toContain(">Layer<");
  });
});
