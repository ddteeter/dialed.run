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
import type { LinkDetail } from "../../src/modules/closet/garment-link";
import type { WardrobeItemRow } from "../../src/modules/closet/service";
import { expectTheColumn } from "../ui/the-column";

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
  photoFingerprint: "0f10c00309a0810f",
  productUrl: "https://janji.com/p/rover-half-zip",
  productId: "prod-1",
  origin: "manual",
  idempotencyKey: "idem-1",
  retired: false,
  retiredAt: 1_700_000_000,
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
  linkDetail: { link: undefined, outcome: undefined, specSource: undefined },
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
      tempUnit="c"
      detail={detail}
      retire={vi.fn()}
      unretire={vi.fn()}
      remove={vi.fn()}
      uploadPhoto={uploadPhoto}
      removePhoto={vi.fn()}
    />
  );
}

function withVisibility(visibility: typeof item.visibility): ReactElement {
  return (
    <GarmentDetail
      tempUnit="c"
      detail={{ ...detail, item: { ...item, visibility } }}
      retire={vi.fn()}
      unretire={vi.fn()}
      remove={vi.fn()}
      uploadPhoto={vi.fn()}
      removePhoto={vi.fn()}
      photoChecking={<p>checking notice</p>}
    />
  );
}

describe("GarmentDetail: a photo being checked (R-69, round 27 #21)", () => {
  it.each(["pending", "flagged", "hidden_pending_review"] as const)(
    "shows the route's notice under the photo while it is %s",
    async (visibility) => {
      await renderWithRouter(withVisibility(visibility));
      expect(screen.getByText("checking notice")).toBeInTheDocument();
    },
  );

  it.each(["ok", "pass"] as const)(
    "says nothing once it is %s",
    async (visibility) => {
      await renderWithRouter(withVisibility(visibility));
      expect(screen.queryByText("checking notice")).not.toBeInTheDocument();
    },
  );
});

type Composition = Parameters<typeof GarmentDetail>[0]["detail"]["composition"];

function linked(
  linkDetail: LinkDetail,
  changes: Readonly<{
    item?: Partial<WardrobeItemRow>;
    composition?: Composition;
  }> = {},
): ReactElement {
  return (
    <GarmentDetail
      tempUnit="c"
      detail={{
        ...detail,
        item: { ...item, ...changes.item },
        composition: changes.composition,
        linkDetail,
      }}
      retire={vi.fn()}
      unretire={vi.fn()}
      remove={vi.fn()}
      uploadPhoto={vi.fn()}
      removePhoto={vi.fn()}
    />
  );
}

const LINK = "https://janji.com/p/rover-half-zip";

/**
A field the runner left empty: the columns are nullable and null is the
value here, parsed rather than written.
*/
function unset(): null {
  return z.null().parse(JSON.parse("null"));
}
const FOUND = { kind: "found", source: "janji.com" } as const;

function outcomeLine(): string | null | undefined {
  return document.querySelector('[data-part="shop-page"] p')?.textContent;
}

describe("GarmentDetail: the shop page and its one line (round 43 #94-95)", () => {
  it("draws no link and no line when closet's one read shows none", async () => {
    // Denied since it was saved, or never https: the row's link is there,
    // and E shows nothing of it (#95).
    await renderWithRouter(populated());

    expectTheColumn();
    expect(screen.queryByText("janji.com")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="https://"]')).toBeNull();
    expect(document.querySelector('[data-part="shop-page"]')).toBeNull();
  });

  it("puts the shop page under the name, as ProductLink with its domain", async () => {
    await renderWithRouter(
      linked({
        link: LINK,
        outcome: { kind: "reading" },
        specSource: undefined,
      }),
    );

    const link = screen.getByRole("link", { name: "Shop page" });
    expect(link).toHaveAttribute("href", LINK);
    expect(link).toHaveAttribute("rel", "ugc nofollow noopener");
    expect(screen.getByText("janji.com")).toHaveClass("text-quiet");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(
      heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    [{ kind: "reading" }, "[Reading the page] · Usually under a minute"],
    [{ kind: "nothing", source: "janji.com" }, "[No specs on janji.com]"],
    [
      { kind: "unread", source: "janji.com", isRetrying: true },
      "[Couldn't read janji.com] · Trying again today",
    ],
    [
      { kind: "unread", source: "janji.com", isRetrying: false },
      "[Couldn't read janji.com]",
    ],
    [{ kind: "noIdentity" }, "[Not read] · Add a brand and model"],
    [{ kind: "unconfirmed" }, "[Not read yet] · Confirm your email to read it"],
  ] as const)("says %o as round 43 words it", async (outcome, words) => {
    await renderWithRouter(
      linked({ link: LINK, outcome, specSource: undefined }),
    );

    // Sentence case in the DOM; the uppercase is CSS (Mono xs).
    expect(outcomeLine()).toBe(words);
  });

  it("names no site it was denied", async () => {
    await renderWithRouter(
      linked({
        link: LINK,
        outcome: { kind: "nothing", source: undefined },
        specSource: undefined,
      }),
    );
    expect(outcomeLine()).toBe("[No specs on the page]");
  });

  it("keeps the site's own case inside the uppercase line", async () => {
    await renderWithRouter(
      linked({
        link: LINK,
        outcome: { kind: "nothing", source: "Rabbit.run" },
        specSource: undefined,
      }),
    );
    expect(screen.getByText("Rabbit.run")).toHaveClass("normal-case");
  });

  it("adds no clause about grey values when every value is the runner's", async () => {
    // The fixture's weight and fabric are the runner's own.
    await renderWithRouter(
      linked({ link: LINK, outcome: FOUND, specSource: "janji.com" }),
    );
    expect(outcomeLine()).toBe("[Specs from janji.com]");
    expect(screen.getByText("midweight")).toHaveClass("text-ink");
  });

  it("draws the link with no line under it before enrichment has an outcome", async () => {
    await renderWithRouter(
      linked({ link: LINK, outcome: undefined, specSource: undefined }),
    );

    expect(screen.getByRole("link", { name: "Shop page" })).toHaveAttribute(
      "href",
      LINK,
    );
    expect(outcomeLine()).toBeUndefined();
  });

  it("says grey values are the page's when one is, and greys exactly that one", async () => {
    // Weight left empty, so the product lent it.
    await renderWithRouter(
      linked(
        { link: LINK, outcome: FOUND, specSource: "janji.com" },
        { item: { weight: unset() } },
      ),
    );
    expect(outcomeLine()).toBe(
      "[Specs from janji.com] · Grey values are from the page",
    );
    expect(screen.getByText("midweight")).toHaveClass("text-quiet");
    expect(screen.getByText("synthetic")).toHaveClass("text-ink");
  });
});

/**
A garment whose words are the subject: the stored row and what it reads as.
*/
function words(
  effective: Partial<typeof detail.effective>,
  own: Partial<WardrobeItemRow>,
): ReactElement {
  return (
    <GarmentDetail
      tempUnit="c"
      detail={{
        ...detail,
        item: { ...item, ...own },
        effective: { ...detail.effective, ...effective },
      }}
      retire={vi.fn()}
      unretire={vi.fn()}
      remove={vi.fn()}
      uploadPhoto={vi.fn()}
      removePhoto={vi.fn()}
    />
  );
}

describe("GarmentDetail: which words the page lent (round 43 #94)", () => {
  it("greys each word the runner left empty, and inks visibility, which is never lent", async () => {
    // Weight is the runner's; fabric, wind and water came from the page.
    await renderWithRouter(
      words(
        { windResistant: true, waterResistant: true },
        {
          fabric: unset(),
          windResistant: unset(),
          waterResistant: unset(),
          visibilityLevel: "hi_viz",
        },
      ),
    );

    expect(screen.getByText("midweight")).toHaveClass("text-ink");
    expect(screen.getByText("synthetic")).toHaveClass("text-quiet");
    expect(screen.getByText("wind resistant")).toHaveClass("text-quiet");
    expect(screen.getByText("water resistant")).toHaveClass("text-quiet");
    expect(screen.getByText("hi-viz")).toHaveClass("text-ink");
  });

  it("inks wind and water the runner answered themselves", async () => {
    await renderWithRouter(
      words(
        { windResistant: true, waterResistant: true },
        { windResistant: true, waterResistant: true },
      ),
    );

    expect(screen.getByText("wind resistant")).toHaveClass("text-ink");
    expect(screen.getByText("water resistant")).toHaveClass("text-ink");
  });

  it("says nothing of wind or water a piece does not resist", async () => {
    await renderWithRouter(words({}, {}));

    expect(screen.getByText("midweight")).toBeInTheDocument();
    expect(screen.queryByText("wind resistant")).toBeNull();
    expect(screen.queryByText("water resistant")).toBeNull();
  });
});

describe("GarmentDetail: composition names its source (round 43 #94)", () => {
  const composition = {
    verbatim: "100% recycled polyester",
    parts: [],
  } as const;

  it("names the site its composition was read from", async () => {
    await renderWithRouter(
      linked(
        { link: undefined, outcome: undefined, specSource: "janji.com" },
        { composition: { ...composition, parts: [] } },
      ),
    );

    const kicker = screen.getByRole("heading", { name: /composition/i });
    expect(kicker).toHaveTextContent("Composition · from janji.com");
    expect(screen.getByText("janji.com")).toHaveClass("normal-case");
  });

  it("keeps the plain kicker for a composition no page gave", async () => {
    await renderWithRouter(
      linked(
        { link: undefined, outcome: undefined, specSource: undefined },
        { composition: { ...composition, parts: [] } },
      ),
    );

    expect(
      screen.getByRole("heading", { name: "Made of" }),
    ).toBeInTheDocument();
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

function withCorrection(
  changes: Readonly<{ productId?: string | null; composition?: Composition }>,
) {
  const actions = {
    loadContext: vi.fn().mockResolvedValue({
      brandName: "Janji",
      productName: "Rover",
      current: {},
      waiting: [],
    }),
    fileCorrection: vi.fn().mockResolvedValue(undefined),
  };
  const element = (
    <GarmentDetail
      tempUnit="c"
      detail={{
        ...detail,
        item: {
          ...item,
          productId:
            changes.productId === undefined
              ? item.productId
              : changes.productId,
        },
        composition: changes.composition,
      }}
      retire={vi.fn()}
      unretire={vi.fn()}
      remove={vi.fn()}
      uploadPhoto={vi.fn()}
      removePhoto={vi.fn()}
      correction={actions}
    />
  );
  return { element, actions };
}

describe("GarmentDetail: WRONG? › (R-74, R48·129)", () => {
  const COMPOSITION = { verbatim: "100% merino", parts: [] };

  it("sits on the composition's labelled line and opens the sheet for this piece's product", async () => {
    const { element, actions } = withCorrection({ composition: COMPOSITION });
    await renderWithRouter(element);
    const wrong = screen.getByRole("button", { name: "Wrong?" });
    expect(wrong.closest("section")).toHaveTextContent("Made of");
    expect(actions.loadContext).not.toHaveBeenCalled();
    fireEvent.click(wrong);
    expect(
      await screen.findByRole("heading", { name: "What's wrong with it?" }),
    ).toBeVisible();
    expect(actions.loadContext).toHaveBeenCalledWith({
      data: { productId: "prod-1" },
    });
  });

  it("stands alone when there is no composition to hang it on", async () => {
    const { element } = withCorrection({});
    await renderWithRouter(element);
    const wrong = screen.getByRole("button", { name: "Wrong?" });
    expect(wrong.closest("section")).toBeNull();
    expect(wrong.closest("[data-part='composition']")).not.toBeNull();
  });

  it("is not offered for a piece with no shared product", async () => {
    const { element } = withCorrection({
      productId: unset(),
      composition: COMPOSITION,
    });
    await renderWithRouter(element);
    expect(screen.queryByRole("button", { name: "Wrong?" })).toBeNull();
  });

  it("is not offered without the route's actions", async () => {
    await renderWithRouter(
      linked(detail.linkDetail, { composition: COMPOSITION }),
    );
    expect(screen.queryByRole("button", { name: "Wrong?" })).toBeNull();
  });

  it("opens a fresh sheet after the last one closed", async () => {
    const { element, actions } = withCorrection({ composition: COMPOSITION });
    await renderWithRouter(element);
    // The page's own confirm sheets, there before WRONG? opens one.
    const shut = document.querySelectorAll("dialog").length;
    fireEvent.click(screen.getByRole("button", { name: "Wrong?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "What's wrong with it?" }),
      ).toBeNull();
    });
    // Closed is gone, not a shut dialog left behind.
    expect(document.querySelectorAll("dialog")).toHaveLength(shut);
    fireEvent.click(screen.getByRole("button", { name: "Wrong?" }));
    expect(
      await screen.findByRole("heading", { name: "What's wrong with it?" }),
    ).toBeVisible();
    expect(actions.loadContext).toHaveBeenCalledTimes(2);
  });
});
