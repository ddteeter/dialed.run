import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { GarmentDetail } from "../../src/modules/closet/components/GarmentDetail";
import type { getItemDetail, WardrobeItemRow } from "../../src/modules/closet/service";
import { itemView, wardrobeItem } from "./closet-fixtures";

type Detail = Awaited<ReturnType<typeof getItemDetail>> & {
  pairedItems: WardrobeItemRow[];
};

/**
 * One garment, in full (screen E).
 *
 * **Retire, don't delete** is a product rule, and where the user lands
 * afterwards is how the rule becomes visible — which is the decision worth
 * reading twice here.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const closetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    validateSearch: (search: Record<string, unknown>) => ({
      retired: search.retired === true,
    }),
    component: () => <p>The closet</p>,
  });
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet/edit/$itemId",
    component: () => <p>Edit</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, closetRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function detail(overrides: Partial<Detail> = {}): Detail {
  return {
    ...itemView({
      item: wardrobeItem({ id: "01ITEM", name: "Harrier", brand: "Tracksmith" }),
      isGeneric: false,
    }),
    productDefaults: undefined,
    pairedItems: [],
    ...overrides,
  };
}

const nothing = () => Promise.resolve();
const uploads = () => Promise.resolve({ ok: true as const });

function garment(overrides: Partial<Detail> = {}) {
  return (
    <GarmentDetail
      detail={detail(overrides)}
      retire={nothing}
      unretire={nothing}
      remove={nothing}
      uploadPhoto={uploads}
    />
  );
}

describe("GarmentDetail: what it says about the piece", () => {
  it("names it once, for the heading and the photo alike", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({
          id: "01ITEM",
          name: "Harrier",
          brand: "Tracksmith",
          photoKey: "closet/01ITEM/card",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Tracksmith Harrier" }),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "Tracksmith Harrier" })).toHaveAttribute(
      "src",
      "/closet/photo/01ITEM/card",
    );
  });

  it("shows no photo at all when there is none", async () => {
    const { container } = await renderWithRouter(garment());
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("tags a generic piece, and a retired one", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ id: "01ITEM", name: "Long sleeve top", retired: true }),
        isGeneric: true,
      }),
    );

    expect(screen.getByText("[Generic]")).toBeVisible();
    expect(screen.getByText("[Retired]")).toBeVisible();
  });

  it("tags neither on a named, active piece", async () => {
    await renderWithRouter(garment());
    expect(screen.queryByText("[Generic]")).toBeNull();
    expect(screen.queryByText("[Retired]")).toBeNull();
  });

  it("shows the tested range, or says it is untested", async () => {
    await renderWithRouter(garment({ tempRange: { lowC: 4, highC: 12 } }));
    expect(screen.getByText(/Works at/)).toHaveTextContent("Works at [4–12°]");
  });

  it("says untested when there is no range", async () => {
    await renderWithRouter(garment());
    expect(screen.getByText("[Untested]")).toBeVisible();
  });
});

describe("GarmentDetail: the attribute chips", () => {
  it("lists only the attributes it actually knows", async () => {
    await renderWithRouter(
      garment({
        effective: {
          weight: "mid",
          fabric: undefined,
          windResistant: true,
          waterResistant: undefined,
        },
      }),
    );
    expect(screen.getByText("mid · wind resistant")).toBeVisible();
  });

  it("says nothing at all when it knows none", async () => {
    // Not an empty line: a chip row with nothing in it is a gap the reader
    // has to account for.
    const { container } = await renderWithRouter(garment());
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it.each([
    ["weight", { weight: "mid" as const }, "mid"],
    ["fabric", { fabric: "merino" as const }, "merino"],
    ["wind resistance", { windResistant: true }, "wind resistant"],
    ["water resistance", { waterResistant: true }, "water resistant"],
  ])("names %s on its own", async (_label, attribute, chip) => {
    // Each is checked separately, so a single known attribute is still a
    // chip row rather than nothing.
    await renderWithRouter(
      garment({
        effective: {
          weight: undefined,
          fabric: undefined,
          windResistant: undefined,
          waterResistant: undefined,
          ...attribute,
        },
      }),
    );
    expect(screen.getByText(chip)).toBeVisible();
  });

  it("says nothing for an attribute that is explicitly false", async () => {
    // `windResistant: false` is a known answer meaning "no", and a chip
    // saying "wind resistant" for it would be a lie.
    await renderWithRouter(
      garment({
        effective: {
          weight: undefined,
          fabric: undefined,
          windResistant: false,
          waterResistant: false,
        },
      }),
    );
    expect(screen.queryByText(/wind resistant/)).toBeNull();
    expect(screen.queryByText(/water resistant/)).toBeNull();
  });

  it("names every attribute it does know", async () => {
    await renderWithRouter(
      garment({
        effective: {
          weight: "heavy",
          fabric: "merino",
          windResistant: true,
          waterResistant: true,
        },
      }),
    );
    expect(
      screen.getByText("heavy · merino · wind resistant · water resistant"),
    ).toBeVisible();
  });
});

describe("GarmentDetail: the mileage and the verdicts", () => {
  it("rounds the mileage to whole kilometres", async () => {
    await renderWithRouter(
      garment({
        performance: {
          summary: {
            verdictCount: 0,
            dialedCount: 0,
            lastWornAt: undefined,
            mileageM: 12_600,
          },
          buckets: [],
          pairsWith: [],
        },
      }),
    );
    expect(screen.getByText(/logged/)).toHaveTextContent("13 km logged");
  });

  it("shows zero when the piece has never been worn", async () => {
    await renderWithRouter(garment());
    expect(screen.getByText(/logged/)).toHaveTextContent("0 km logged");
    expect(screen.queryByText(/dialed/)).toBeNull();
  });

  it("shows the dialed ratio once there are verdicts", async () => {
    await renderWithRouter(
      garment({
        performance: {
          summary: {
            verdictCount: 5,
            dialedCount: 3,
            lastWornAt: undefined,
            mileageM: 1000,
          },
          buckets: [],
          pairsWith: [],
        },
      }),
    );
    expect(screen.getByText(/logged/)).toHaveTextContent(
      "1 km logged · 3/5 dialed",
    );
  });

  it("says nothing about a ratio with no verdicts to make one from", async () => {
    await renderWithRouter(
      garment({
        performance: {
          summary: {
            verdictCount: 0,
            dialedCount: 0,
            lastWornAt: undefined,
            mileageM: 1000,
          },
          buckets: [],
          pairsWith: [],
        },
      }),
    );
    expect(screen.queryByText(/dialed/)).toBeNull();
  });
});

describe("GarmentDetail: what it pairs with", () => {
  it("lists them, comma separated", async () => {
    await renderWithRouter(
      garment({
        pairedItems: [
          wardrobeItem({ id: "01A", name: "Half tights" }),
          wardrobeItem({ id: "01B", name: "Wool socks" }),
        ],
      }),
    );
    expect(screen.getByText(/Pairs with/)).toHaveTextContent(
      "Pairs with Half tights, Wool socks",
    );
  });

  it("says nothing when it pairs with nothing", async () => {
    await renderWithRouter(garment());
    expect(screen.queryByText(/Pairs with/)).toBeNull();
  });
});

describe("GarmentDetail: retire, don't delete", () => {
  it("retires, then lands on the closet with retired pieces shown", async () => {
    // The filter is the point: the grid hides retired items by default, so
    // navigating without it would make the piece appear to have been
    // deleted by the very action that promises not to.
    const user = userEvent.setup();
    const retire = vi.fn(() => Promise.resolve());
    const { router } = await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={retire}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={uploads}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => {
      expect(retire).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/closet");
    });
    expect(router.state.location.search).toMatchObject({ retired: true });
  });

  it("un-retires and stays put, because the badge going is the confirmation", async () => {
    const user = userEvent.setup();
    const unretire = vi.fn(() => Promise.resolve());
    const { router } = await renderWithRouter(
      <GarmentDetail
        detail={detail({
          item: wardrobeItem({ id: "01ITEM", name: "Harrier", retired: true }),
        })}
        retire={nothing}
        unretire={unretire}
        remove={nothing}
        uploadPhoto={uploads}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unretire" }));

    await waitFor(() => {
      expect(unretire).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
    });
    expect(router.state.location.pathname).toBe("/");
  });

  it("deletes, and goes back to the closet without the filter", async () => {
    const user = userEvent.setup();
    const remove = vi.fn(() => Promise.resolve());
    const { router } = await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={remove}
        uploadPhoto={uploads}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/closet");
    });
  });

  it("offers an edit link for the piece", async () => {
    await renderWithRouter(garment());
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/closet/edit/01ITEM",
    );
  });
});

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

function jpeg(name = "a.jpg"): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("GarmentDetail: the photo upload", () => {


  it("sends the item id alongside the photo", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn<
      (input: { data: FormData }) => Promise<{ ok: true }>
    >(() => Promise.resolve({ ok: true as const }));
    await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={uploadPhoto}
      />,
    );

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    const sent = uploadPhoto.mock.calls[0]?.[0]?.data;
    expect(sent?.get("itemId")).toBe("01ITEM");
    expect(sent?.get("photo")).toBeInstanceOf(File);
  });

  it("does nothing when the picker is dismissed", async () => {
    const uploadPhoto = vi.fn<
      (input: { data: FormData }) => Promise<{ ok: true }>
    >(() => Promise.resolve({ ok: true as const }));
    await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={uploadPhoto}
      />,
    );

    fileInput().dispatchEvent(new Event("change", { bubbles: true }));

    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("uploads whatever the picker hands back, one file", async () => {
    // `files?.[0]` — the optional index is the compiler's, but the first
    // file is the one a single-file input can produce.
    const user = userEvent.setup();
    const uploadPhoto = vi.fn<
      (input: { data: FormData }) => Promise<{ ok: true }>
    >(() => Promise.resolve({ ok: true as const }));
    await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={uploadPhoto}
      />,
    );

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    const sent = uploadPhoto.mock.calls[0]?.[0]?.data;
    expect((sent?.get("photo") as File).name).toBe("a.jpg");
  });

  it("reloads the screen on success, so the new photo appears", async () => {
    // `!result.ok` guards the early return: without it the invalidate is
    // skipped and the piece keeps showing the photo it had before.
    const user = userEvent.setup();
    const { router } = await renderWithRouter(garment());
    const invalidate = vi.spyOn(router, "invalidate");

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(document.querySelectorAll("p.text-pink")).toHaveLength(0);
    invalidate.mockRestore();
  });

  it("does not reload when the photo was refused", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={() =>
          Promise.resolve({ ok: false as const, error: "Photo file is empty." })
        }
      />,
    );
    const invalidate = vi.spyOn(router, "invalidate");

    await user.upload(fileInput(), jpeg());
    await screen.findByText("Photo file is empty.");

    expect(invalidate).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it("shows the reason a photo was refused", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={() =>
          Promise.resolve({ ok: false as const, error: "Photo file is empty." })
        }
      />,
    );

    await user.upload(fileInput(), jpeg());

    expect(await screen.findByText("Photo file is empty.")).toBeVisible();
    // Released, so they can pick another.
    expect(fileInput()).not.toBeDisabled();
  });

  it("locks the input while it uploads", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ ok: true }>();
    await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={() => pending.promise}
      />,
    );

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(fileInput()).toBeDisabled();
    });
    pending.resolve({ ok: true });
    await waitFor(() => {
      expect(fileInput()).not.toBeDisabled();
    });
  });

  it("clears the last refusal on the next attempt", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ ok: true }>();
    const uploadPhoto = vi
      .fn<() => Promise<{ ok: true } | { ok: false; error: string }>>()
      .mockResolvedValueOnce({ ok: false, error: "Photo file is empty." })
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(
      <GarmentDetail
        detail={detail()}
        retire={nothing}
        unretire={nothing}
        remove={nothing}
        uploadPhoto={uploadPhoto}
      />,
    );

    await user.upload(fileInput(), jpeg());
    expect(await screen.findByText("Photo file is empty.")).toBeVisible();

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(screen.queryByText("Photo file is empty.")).toBeNull();
    });
    pending.resolve({ ok: true });
  });

  it("says nothing at rest", async () => {
    const { container } = await renderWithRouter(garment());
    // The temperature line, the chips line and the mileage line — no
    // fourth waiting for an error.
    expect(container.querySelectorAll("p.text-pink")).toHaveLength(0);
  });

  it("takes only the image types the server accepts", async () => {
    await renderWithRouter(garment());
    expect(fileInput()).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  });
});
