import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { GarmentDetail } from "../../src/modules/closet/components/GarmentDetail";
import type {
  ItemPerformance,
  WardrobeItemRow,
} from "../../src/modules/closet/service";
import { itemView, wardrobeItem } from "./closet-fixtures";
import { expectAvailable, expectBusy } from "../ui/unavailable";

type Props = ComponentProps<typeof GarmentDetail>;
type Detail = Props["detail"];

/**
 * One garment, in full — round 22's Y.
 *
 * *"Order is fixed; a section with nothing in it is absent."* Most of what
 * is below is that sentence, one section at a time, plus the two sheets
 * and the photo the well now is.
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
      item: wardrobeItem({
        id: "01ITEM",
        name: "Harrier",
        brand: "Tracksmith",
      }),
      isGeneric: false,
    }),
    productDefaults: undefined,
    composition: undefined,
    pairedItems: [],
    ...overrides,
  };
}

function performance(
  summary: Partial<ItemPerformance["summary"]> = {},
): ItemPerformance {
  return {
    summary: {
      runCount: 0,
      verdictCount: 0,
      dialedCount: 0,
      lastWornAt: undefined,
      mileageM: 0,
      ...summary,
    },
    buckets: [],
    pairsWith: [],
  };
}

const nothing = () => Promise.resolve();
const uploads = () => Promise.resolve({ ok: true as const });

function garment(
  overrides: Partial<Detail> = {},
  props: Partial<Props> = {},
): ReactElement {
  return (
    <GarmentDetail
      detail={detail(overrides)}
      retire={nothing}
      unretire={nothing}
      remove={nothing}
      uploadPhoto={uploads}
      removePhoto={nothing}
      {...props}
    />
  );
}

/**
A garment with a stored photo, which is the only kind that has a well here.
*/
function photographed(overrides: Partial<WardrobeItemRow> = {}) {
  return {
    item: wardrobeItem({
      id: "01ITEM",
      name: "Harrier",
      brand: "Tracksmith",
      photoKey: "items/01USER/01ITEM",
      ...overrides,
    }),
  };
}

function part(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-part='${CSS.escape(name)}']`,
  );
  if (element === null) throw new Error(`no ${name} region`);
  return element;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

function jpeg(name = "a.jpg"): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

function isAfter(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function sheet(): HTMLElement {
  return part("sheet");
}

describe("GarmentDetail: the order round 22 fixes", () => {
  it("runs identity, photo, stats, composition, pairs with, actions", async () => {
    await renderWithRouter(
      garment({
        ...photographed(),
        composition: { verbatim: "100% merino", parts: [] },
        pairedItems: [
          { item: wardrobeItem({ id: "01P", name: "Split" }), count: 4 },
        ],
      }),
    );

    const order = [
      "identity",
      "photo-well",
      "stats",
      "composition",
      "pairs-with",
      "actions",
    ].map((name) => part(name));
    for (const [index, region] of order.slice(1).entries()) {
      const before = order[index];
      if (before === undefined) throw new Error("no region before");
      expect(isAfter(before, region)).toBe(true);
    }
  });

  it("puts the heading inside the identity, and leads it with the way back", async () => {
    await renderWithRouter(garment());

    const identity = part("identity");
    expect(
      within(identity).getByRole("heading", { name: "Tracksmith Harrier" }),
    ).toBeVisible();
    expect(within(identity).getByRole("link", { name: "Closet" })).toHaveAttribute(
      "href",
      "/closet",
    );
  });
});

describe("GarmentDetail: identity", () => {
  it("names the category and the size in the kicker", async () => {
    await renderWithRouter(
      garment({ item: wardrobeItem({ category: "top", size: "M" }) }),
    );
    expect(part("identity").querySelector("p")).toHaveTextContent(/^Top · M$/);
  });

  it("leaves out a size nobody gave, whether absent or blank", async () => {
    await renderWithRouter(garment({ item: wardrobeItem({ size: "" }) }));
    expect(part("identity").querySelector("p")).toHaveTextContent(/^Top$/);
  });

  it("tags a generic piece and a retired one in the kicker", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ name: "Long sleeve top", retired: true }),
        isGeneric: true,
      }),
    );

    expect(part("identity").querySelector("p")).toHaveTextContent(
      "Top · [Generic] · [Retired]",
    );
  });

  it("tags neither on a named, active piece", async () => {
    await renderWithRouter(garment());
    expect(screen.queryByText("[Generic]")).toBeNull();
    expect(screen.queryByText("[Retired]")).toBeNull();
  });

  it("carries the name and the colourway as words", async () => {
    // §AH: the structured name, then the runner's own word for it.
    await renderWithRouter(
      garment({
        item: wardrobeItem({ colorName: "navy", color: "Obsidian" }),
      }),
    );
    expect(screen.getByText("navy · Obsidian")).toBeVisible();
  });

  it("shows either one alone", async () => {
    await renderWithRouter(
      garment({ item: wardrobeItem({ colorName: "grey", color: "" }) }),
    );
    expect(screen.getByText("grey")).toBeVisible();
  });

  it("shows the colourway alone when nothing was classified", async () => {
    await renderWithRouter(
      garment({ item: wardrobeItem({ color: "Obsidian" }) }),
    );
    expect(screen.getByText("Obsidian")).toBeVisible();
  });

  it("draws round 22's square only when the exact shade is known", async () => {
    // The square is the runner's own shade, so it is absent rather than
    // guessed when there is none.
    await renderWithRouter(
      garment({
        item: wardrobeItem({ colorName: "navy", colorHex: "#1f2a44" }),
      }),
    );
    const square = part("identity").querySelector("[data-content]");
    expect(square).toHaveAttribute("aria-hidden", "true");
    expect(square).toHaveStyle({ backgroundColor: "#1f2a44" });
  });

  it("draws no square and no line when there is no colour at all", async () => {
    await renderWithRouter(
      garment({ item: wardrobeItem({ colorHex: "#1f2a44" }) }),
    );
    expect(part("identity").querySelector("[data-content]")).toBeNull();
    // Kicker only: the colourway line is absent, not empty.
    expect(part("identity").querySelectorAll("p")).toHaveLength(1);
  });

  it("draws the words without a square when no shade was chosen", async () => {
    await renderWithRouter(
      garment({ item: wardrobeItem({ colorName: "navy" }) }),
    );
    expect(screen.getByText("navy")).toBeVisible();
    expect(part("identity").querySelector("[data-content]")).toBeNull();
  });
});

describe("GarmentDetail: the photo", () => {
  it("has no well at all without a photo — adding one is Edit's job", async () => {
    await renderWithRouter(garment());
    expect(document.querySelector("[data-part='photo-well']")).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByText("Add a photo")).toBeNull();
  });

  it("is the well, with the photo in it under the garment's own name", async () => {
    await renderWithRouter(garment(photographed()));

    expect(part("photo-well")).toHaveAttribute("data-state", "filled");
    expect(
      screen.getByRole("img", { name: "Tracksmith Harrier" }),
    ).toHaveAttribute("src", "/closet/photo/01ITEM/card");
    expect(screen.getByLabelText("Replace")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  it("sends a replacement with the item id, and reloads the screen", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn<Props["uploadPhoto"]>(uploads);
    const { router } = await renderWithRouter(
      garment(photographed(), { uploadPhoto }),
    );
    const invalidate = vi.spyOn(router, "invalidate");

    await user.upload(fileInput(), jpeg("new.jpg"));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    const sent = uploadPhoto.mock.calls[0]?.[0].data;
    expect(sent?.get("itemId")).toBe("01ITEM");
    expect((sent?.get("photo") as File).name).toBe("new.jpg");
  });

  it("does nothing when the picker is dismissed", async () => {
    const uploadPhoto = vi.fn<Props["uploadPhoto"]>(uploads);
    await renderWithRouter(garment(photographed(), { uploadPhoto }));

    fileInput().dispatchEvent(new Event("change", { bubbles: true }));

    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("shows why a photo was refused, and does not reload", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(
      garment(photographed(), {
        uploadPhoto: () =>
          Promise.resolve({ ok: false as const, error: "Photo file is empty." }),
      }),
    );
    const invalidate = vi.spyOn(router, "invalidate");

    await user.upload(fileInput(), jpeg());

    expect(await screen.findByText("Photo file is empty.")).toBeVisible();
    expect(invalidate).not.toHaveBeenCalled();
    expectAvailable(fileInput());
  });

  it("clears the last refusal on the next attempt", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ ok: true }>();
    const uploadPhoto = vi
      .fn<Props["uploadPhoto"]>()
      .mockResolvedValueOnce({ ok: false, error: "Photo file is empty." })
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(garment(photographed(), { uploadPhoto }));

    await user.upload(fileInput(), jpeg());
    expect(await screen.findByText("Photo file is empty.")).toBeVisible();
    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(screen.queryByText("Photo file is empty.")).toBeNull();
    });
    pending.resolve({ ok: true });
  });

  it("is busy while a replacement uploads, and ignores a second", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ ok: true }>();
    const uploadPhoto = vi.fn<Props["uploadPhoto"]>(() => pending.promise);
    await renderWithRouter(garment(photographed(), { uploadPhoto }));

    await user.upload(fileInput(), jpeg());
    await waitFor(() => {
      expectBusy(fileInput());
    });
    await user.upload(fileInput(), jpeg());
    expect(uploadPhoto).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true });
    await waitFor(() => {
      expectAvailable(fileInput());
    });
  });

  it("says nothing was saved when the connection drops", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      garment(photographed(), {
        uploadPhoto: () => Promise.reject(new TypeError("Failed to fetch")),
      }),
    );

    await user.upload(fileInput(), jpeg());

    expect(await screen.findByText("Nothing saved")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. Your connection dropped.",
    );
    expectAvailable(fileInput());
  });

  it("holds a replacement until W3's step hands back the bytes to send", async () => {
    // D-102: a face in a garment photo is somebody's face whatever screen
    // it was taken on.
    const user = userEvent.setup();
    const uploadPhoto = vi.fn<Props["uploadPhoto"]>(uploads);
    let hand: ((ready: File) => void) | undefined;
    await renderWithRouter(
      garment(photographed(), {
        uploadPhoto,
        renderPhotoStep: (file, onReady, announce) => {
          hand = onReady;
          return (
            <button
              type="button"
              onClick={() => {
                announce("Blurred 1 face.");
              }}
            >
              Step for {file.name}
            </button>
          );
        },
      }),
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.upload(fileInput(), jpeg("face.jpg"));
    expectBusy(fileInput());
    await user.click(screen.getByRole("button", { name: "Step for face.jpg" }));

    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Blurred 1 face.");

    const blurred = new File(["blurred"], "face.jpg", { type: "image/jpeg" });
    act(() => {
      hand?.(blurred);
    });

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    expect(uploadPhoto.mock.calls[0]?.[0].data.get("photo")).toBe(blurred);
    expect(screen.queryByRole("button", { name: /Step for/ })).toBeNull();
  });
});

describe("GarmentDetail: Remove photo", () => {
  it("removes this garment's photo and reloads the screen", async () => {
    const user = userEvent.setup();
    const removePhoto = vi.fn<Props["removePhoto"]>(nothing);
    const { router } = await renderWithRouter(
      garment(photographed(), { removePhoto }),
    );
    const invalidate = vi.spyOn(router, "invalidate");

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(removePhoto).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
  });

  it("keeps the photo and says so when the remove fails", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(
      garment(photographed(), {
        removePhoto: () => Promise.reject(new Error("D1 down")),
      }),
    );
    const invalidate = vi.spyOn(router, "invalidate");

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Photo kept")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Photo kept. Our end failed.",
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(part("photo-well")).toHaveAttribute("data-state", "filled");
  });
});

describe("GarmentDetail: stats", () => {
  it("rounds the mileage to whole kilometres and says nothing of a ratio without verdicts", async () => {
    await renderWithRouter(
      garment({ performance: performance({ mileageM: 12_600 }) }),
    );
    expect(part("stats")).toHaveTextContent(/^13 km logged/);
    expect(screen.queryByText(/dialed/)).toBeNull();
  });

  it("shows zero when the piece has never been worn", async () => {
    await renderWithRouter(garment());
    expect(screen.getByText("0 km logged")).toBeVisible();
  });

  it("shows the dialed ratio once there are verdicts", async () => {
    await renderWithRouter(
      garment({
        performance: performance({
          verdictCount: 5,
          dialedCount: 3,
          mileageM: 1000,
        }),
      }),
    );
    expect(screen.getByText("1 km logged · 3/5 dialed")).toBeVisible();
  });

  it("says where it works, in the dialed hue", async () => {
    await renderWithRouter(garment({ tempRange: { lowC: 4, highC: 12 } }));
    const line = within(part("stats")).getByText(/Works at/).closest("p");
    expect(line).toHaveTextContent("Works at [4–12°]");
    expect(line).toHaveClass("text-dialed-text");
  });

  it("says where it worked, once retired", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ retired: true }),
        tempRange: { lowC: 4, highC: 12 },
      }),
    );
    expect(part("stats")).toHaveTextContent("Worked at [4–12°]");
    expect(part("stats")).not.toHaveTextContent("Works at");
  });

  it("says untested when there is no range", async () => {
    await renderWithRouter(garment());
    expect(within(part("stats")).getByText("[Untested]")).toBeVisible();
  });
});

describe("GarmentDetail: composition", () => {
  it("quotes the brand's label, credited to the garment's own brand", async () => {
    await renderWithRouter(
      garment({ composition: { verbatim: "100% merino wool", parts: [] } }),
    );
    expect(within(part("composition")).getByText("Made of")).toBeVisible();
    expect(screen.getByText("100% merino wool")).toBeVisible();
    expect(screen.getByText("As labelled by Tracksmith")).toBeVisible();
  });

  it("omits the attribution for a piece with no brand rather than inventing one", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ name: "Green L/S Crew" }),
        composition: { verbatim: "100% cotton", parts: [] },
      }),
    );
    expect(screen.getByText("100% cotton")).toBeVisible();
    expect(screen.queryByText(/as labelled/i)).toBeNull();
  });

  it("names every attribute it knows, and visibility after them", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ visibilityLevel: "hi_viz" }),
        effective: {
          weight: "heavy",
          fabric: "merino",
          windResistant: true,
          waterResistant: true,
        },
      }),
    );
    expect(
      within(part("composition")).getByText(
        "heavy · merino · wind resistant · water resistant · hi-viz",
      ),
    ).toBeVisible();
  });

  it.each([
    ["weight", { weight: "mid" as const }, "mid"],
    ["fabric", { fabric: "merino" as const }, "merino"],
    ["wind resistance", { windResistant: true }, "wind resistant"],
    ["water resistance", { waterResistant: true }, "water resistant"],
  ])("names %s on its own", async (_label, attribute, words) => {
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
    expect(within(part("composition")).getByText(words)).toBeVisible();
  });

  it("names reflective trim", async () => {
    await renderWithRouter(
      garment({ item: wardrobeItem({ visibilityLevel: "reflective" }) }),
    );
    expect(screen.getByText("reflective trim")).toBeVisible();
  });

  it("says nothing for an attribute that is explicitly false, or a plain garment", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ visibilityLevel: "plain" }),
        effective: {
          weight: undefined,
          fabric: undefined,
          windResistant: false,
          waterResistant: false,
        },
      }),
    );
    // Absent, not empty: the region collapses when it has nothing to say.
    expect(part("composition")).toBeEmptyDOMElement();
    expect(part("composition")).toHaveClass("empty:hidden");
  });
});

describe("GarmentDetail: pairs with", () => {
  it("draws each pair as a chip with its co-dialed count", async () => {
    await renderWithRouter(
      garment({
        pairedItems: [
          { item: wardrobeItem({ id: "01A", name: "Bandit split" }), count: 6 },
          { item: wardrobeItem({ id: "01B", name: "Thin gloves" }), count: 4 },
        ],
      }),
    );

    const pairs = part("pairs-with");
    expect(within(pairs).getByText("Pairs with · when dialed")).toBeVisible();
    expect(
      within(pairs)
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
    ).toStrictEqual(["Bandit split · 6", "Thin gloves · 4"]);
  });

  it("is absent when it pairs with nothing", async () => {
    await renderWithRouter(garment());
    expect(document.querySelector("[data-part='pairs-with']")).toBeNull();
  });

  it("is absent once retired — a pairing is a suggestion", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ retired: true }),
        pairedItems: [
          { item: wardrobeItem({ id: "01A", name: "Bandit split" }), count: 6 },
        ],
      }),
    );
    expect(document.querySelector("[data-part='pairs-with']")).toBeNull();
  });
});

describe("GarmentDetail: actions", () => {
  it("offers Edit and Retire, and Delete apart as a text link", async () => {
    await renderWithRouter(garment());

    const actions = part("actions");
    expect(within(actions).getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/closet/edit/01ITEM",
    );
    expect(within(actions).getByRole("button", { name: "Retire" })).toBeVisible();
    expect(within(actions).getByRole("button", { name: "Delete" })).toHaveClass(
      "ml-auto",
      "underline",
    );
  });

  it("offers Unretire and no Edit once retired", async () => {
    await renderWithRouter(garment({ item: wardrobeItem({ retired: true }) }));

    const actions = part("actions");
    expect(within(actions).queryByRole("link", { name: "Edit" })).toBeNull();
    expect(within(actions).queryByRole("button", { name: "Retire" })).toBeNull();
    expect(
      within(actions).getByRole("button", { name: "Unretire" }),
    ).toBeVisible();
    // No runs, so a real delete is still on offer.
    expect(within(actions).getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("drops Delete from a retired piece with runs: it could only retire it again", async () => {
    await renderWithRouter(
      garment({
        item: wardrobeItem({ retired: true }),
        performance: performance({ runCount: 3 }),
      }),
    );
    expect(
      within(part("actions")).queryByRole("button", { name: "Delete" }),
    ).toBeNull();
  });

  it("un-retires without a confirm and stays put", async () => {
    const user = userEvent.setup();
    const unretire = vi.fn<Props["unretire"]>(nothing);
    const { router } = await renderWithRouter(
      garment({ item: wardrobeItem({ retired: true }) }, { unretire }),
    );
    const invalidate = vi.spyOn(router, "invalidate");

    await user.click(screen.getByRole("button", { name: "Unretire" }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(unretire).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
    expect(router.state.location.pathname).toBe("/");
    expect(sheet().closest("dialog")).not.toHaveAttribute("open");
  });

  it("waits behind its label while un-retiring, and says so when it fails", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderWithRouter(
      garment(
        { item: wardrobeItem({ retired: true }) },
        { unretire: () => pending.promise },
      ),
    );

    await user.click(screen.getByRole("button", { name: "Unretire" }));
    expectBusy(within(part("actions")).getAllByRole("button")[0] ?? part("actions"));
    await act(async () => {
      pending.reject(new Error("D1 down"));
      await expect(pending.promise).rejects.toThrow("D1 down");
    });

    expect(await screen.findByText("Still retired")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Still retired. Our end failed.",
    );
  });
});

describe("GarmentDetail: the retire confirm (round 22)", () => {
  it("asks first, naming the piece and what its runs keep", async () => {
    const user = userEvent.setup();
    const retire = vi.fn<Props["retire"]>(nothing);
    await renderWithRouter(
      garment({ performance: performance({ runCount: 14 }) }, { retire }),
    );

    await user.click(screen.getByRole("button", { name: "Retire" }));

    expect(retire).not.toHaveBeenCalled();
    expect(sheet().closest("dialog")).toHaveAttribute("open");
    expect(sheet()).toHaveAttribute("data-state", "confirm-retire");
    expect(
      within(sheet()).getByRole("heading", { name: "Retire the Harrier?" }),
    ).toBeVisible();
    expect(
      within(sheet()).getByText(
        "It leaves the closet and the picker. Its 14 runs and verdicts stay, and still count. You can bring it back.",
      ),
    ).toBeVisible();
    expect(sheet().closest("dialog")).toHaveAttribute(
      "aria-label",
      "Retire the Harrier?",
    );
  });

  it("says one run, and leaves the runs out when there are none", async () => {
    const user = userEvent.setup();
    const { unmount } = await renderWithRouter(
      garment({ performance: performance({ runCount: 1 }) }),
    );
    await user.click(screen.getByRole("button", { name: "Retire" }));
    expect(
      within(sheet()).getByText(
        "It leaves the closet and the picker. Its 1 run and verdict stay, and still count. You can bring it back.",
      ),
    ).toBeVisible();
    unmount();

    await renderWithRouter(garment());
    await user.click(screen.getByRole("button", { name: "Retire" }));
    expect(
      within(sheet()).getByText(
        "It leaves the closet and the picker. You can bring it back.",
      ),
    ).toBeVisible();
  });

  it("lands focus on Keep it", async () => {
    const user = userEvent.setup();
    await renderWithRouter(garment());

    await user.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => {
      expect(within(sheet()).getByRole("button", { name: "Keep it" })).toHaveFocus();
    });
  });

  it("keeps it, and closes, on Keep it", async () => {
    const user = userEvent.setup();
    const retire = vi.fn<Props["retire"]>(nothing);
    await renderWithRouter(garment({}, { retire }));

    await user.click(screen.getByRole("button", { name: "Retire" }));
    await user.click(within(sheet()).getByRole("button", { name: "Keep it" }));

    expect(sheet().closest("dialog")).not.toHaveAttribute("open");
    expect(retire).not.toHaveBeenCalled();
  });

  it("retires, then lands on the closet with retired pieces shown", async () => {
    const user = userEvent.setup();
    const retire = vi.fn<Props["retire"]>(nothing);
    const { router } = await renderWithRouter(garment({}, { retire }));
    const invalidate = vi.spyOn(router, "invalidate");

    await user.click(screen.getByRole("button", { name: "Retire" }));
    await user.click(within(sheet()).getByRole("button", { name: "Retire" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/closet");
    });
    expect(retire).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
    expect(invalidate).toHaveBeenCalled();
    expect(router.state.location.search).toMatchObject({ retired: true });
  });

  it("says [ Retiring ] while it waits, and leaves the sheet open with a band on failure", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const { router } = await renderWithRouter(
      garment({}, { retire: () => pending.promise }),
    );

    await user.click(screen.getByRole("button", { name: "Retire" }));
    const primary = sheet().querySelector("[data-part='primary-action']");
    if (!(primary instanceof HTMLElement)) throw new Error("no primary");
    await user.click(primary);

    expectBusy(primary);
    expect(within(primary).getByText("Retiring")).toBeVisible();

    await act(async () => {
      pending.reject(new Error("D1 down"));
      await expect(pending.promise).rejects.toThrow("D1 down");
    });

    expect(await within(sheet()).findByText("Not retired")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not retired. Our end failed.",
    );
    expect(sheet().closest("dialog")).toHaveAttribute("open");
    expect(router.state.location.pathname).toBe("/");
  });

  it("tries again from the band", async () => {
    const user = userEvent.setup();
    const retire = vi
      .fn<Props["retire"]>()
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValueOnce(undefined);
    const { router } = await renderWithRouter(garment({}, { retire }));

    await user.click(screen.getByRole("button", { name: "Retire" }));
    await user.click(within(sheet()).getByRole("button", { name: "Retire" }));
    await user.click(
      await within(sheet()).findByRole("button", { name: "Try again" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/closet");
    });
    expect(retire).toHaveBeenCalledTimes(2);
  });
});

describe("GarmentDetail: the delete confirm (round 22)", () => {
  it("deletes a piece with no runs, after asking, and goes back to the closet", async () => {
    const user = userEvent.setup();
    const remove = vi.fn<Props["remove"]>(nothing);
    const retire = vi.fn<Props["retire"]>(nothing);
    const { router } = await renderWithRouter(garment({}, { remove, retire }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(remove).not.toHaveBeenCalled();
    expect(sheet()).toHaveAttribute("data-state", "confirm-delete");
    expect(
      within(sheet()).getByRole("heading", { name: "Delete the Harrier?" }),
    ).toBeVisible();
    expect(
      within(sheet()).getByText(
        "This can't be undone. Retire keeps the history.",
      ),
    ).toBeVisible();

    await user.click(within(sheet()).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/closet");
    });
    expect(remove).toHaveBeenCalledWith({ data: { itemId: "01ITEM" } });
    expect(retire).not.toHaveBeenCalled();
    expect(router.state.location.search).toMatchObject({ retired: false });
  });

  it("opens the retire sheet for a piece with runs, because that is what happens", async () => {
    // Retire, don't delete: `deleteOrRetireItem` retires a piece any entry
    // references, so the sheet says what will actually be done.
    const user = userEvent.setup();
    const remove = vi.fn<Props["remove"]>(nothing);
    await renderWithRouter(
      garment({ performance: performance({ runCount: 2 }) }, { remove }),
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(sheet()).toHaveAttribute("data-state", "confirm-retire");
    expect(
      within(sheet()).getByRole("heading", { name: "Retire the Harrier?" }),
    ).toBeVisible();
  });

  it("says [ Deleting ] while it waits, and Not deleted when it fails", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderWithRouter(garment({}, { remove: () => pending.promise }));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(sheet()).getByRole("button", { name: "Delete" }));
    expect(within(sheet()).getByText("Deleting")).toBeVisible();

    await act(async () => {
      pending.reject(new Error("D1 down"));
      await expect(pending.promise).rejects.toThrow("D1 down");
    });

    expect(await within(sheet()).findByText("Not deleted")).toBeVisible();
  });
});
