import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AttachContext } from "../../src/modules/feed/attach-context";
import { AttachKit } from "../../src/modules/feed/components/AttachKit";
import type { PickerGroup } from "../../src/modules/feed/picker";
import type { PrefillCandidate } from "../../src/modules/feed/prefill";
import type { PhotoStep } from "../../src/ui";
import { expectAvailable, expectBusy } from "../ui/unavailable";

/**
 * Attach the kit (screen A2), to round 22's two frames and round 20's
 * rules: the picker from the first frame, only most-likely waiting, a kit
 * required, the photo here rather than on A3, and a failed attach that
 * says "nothing attached" under the button rather than in a pink line.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const verdictRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/verdict/$entryId",
    component: () => <p>Verdict time</p>,
  });
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs",
    component: () => <p>Runs</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, verdictRoute, runsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

/**
A promise that never settles — the "still waiting" state.
*/
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    // deliberately never resolved
  });
}

const conditions = {
  tempC: 5,
  feelsLikeC: 3,
  precipMm: 1,
  condition: "Rain",
  windKph: 5,
  source: "visualcrossing" as const,
  timeZone: "America/Chicago",
  span: { minTempC: 5, maxTempC: 5, minFeelsLikeC: 3, maxFeelsLikeC: 3 },
};

function piece(
  id: string,
  name: string,
  overrides: Partial<PickerGroup["items"][number]> = {},
): PickerGroup["items"][number] {
  return {
    id,
    name,
    brand: NOTHING,
    category: "top",
    layer: NOTHING,
    matches: true,
    untested: false,
    ...overrides,
  };
}

const HOUDINI = "01HQA00000000000000000000A";
const HARRIER = "01HQA00000000000000000000B";
const SINGLET = "01HQA00000000000000000000C";
const TIGHTS = "01HQA00000000000000000000D";
const GLOVES = "01HQA00000000000000000000E";

const GROUPS: PickerGroup[] = [
  {
    group: "tops",
    items: [
      piece(HOUDINI, "Houdini", { brand: "Patagonia" }),
      piece(HARRIER, "Harrier", { untested: true }),
      piece(SINGLET, "Singlet", { matches: false }),
    ],
    matchCount: 2,
    hiddenByFilterCount: 1,
  },
  {
    group: "bottoms",
    items: [piece(TIGHTS, "Tights", { category: "bottom" })],
    matchCount: 1,
    hiddenByFilterCount: 0,
  },
  {
    group: "hands_head",
    items: [piece(GLOVES, "Gloves", { category: "gloves" })],
    matchCount: 1,
    hiddenByFilterCount: 0,
  },
];

function context(overrides: Partial<AttachContext> = {}): AttachContext {
  return {
    distanceM: 9978,
    conditions,
    groups: GROUPS,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<PrefillCandidate> = {},
): PrefillCandidate {
  return {
    entryId: "01PREV",
    itemIds: [HOUDINI, TIGHTS],
    conditions: { ...conditions, tempC: 6 },
    // 2026-08-14T12:00Z — a Friday in Chicago.
    createdAt: Math.floor(Date.UTC(2026, 7, 14, 12) / 1000),
    feelsLikeDeltaC: 1.4,
    ...overrides,
  };
}

interface Overrides {
  context?: AttachContext;
  prefillFor?: () => Promise<PrefillCandidate | undefined>;
  attachKit?: (input: {
    data: { runId: string; itemIds: string[] };
  }) => Promise<{ entryId: string }>;
  uploadPhoto?: (input: { data: FormData }) => Promise<{ key: string }>;
  renderPhotoStep?: PhotoStep;
  units?: { temp: "f" | "c"; distance: "mi" | "km" };
}

function attach(overrides: Overrides = {}) {
  return (
    <AttachKit
      units={overrides.units ?? { temp: "f", distance: "mi" }}
      runId="01RUN"
      context={overrides.context ?? context()}
      prefillFor={overrides.prefillFor ?? (() => Promise.resolve(undefined))}
      attachKit={
        overrides.attachKit ?? (() => Promise.resolve({ entryId: "01NEW" }))
      }
      uploadPhoto={
        overrides.uploadPhoto ?? (() => Promise.resolve({ key: "k" }))
      }
      renderPhotoStep={overrides.renderPhotoStep}
    />
  );
}

function primary(): HTMLElement {
  return screen.getByRole("button", { name: "Next — did it work?" });
}

function region(slot: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-slot='${CSS.escape(slot)}']`,
  );
  if (found === null) throw new Error(`no ${slot} region`);
  return found;
}

function photoInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    "[data-part='photo-well'] input[type='file']",
  );
  if (input === null) throw new Error("no photo input");
  return input;
}

function jpeg(name = "kit.jpg", bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

/**
 * The preview's object URL, spied rather than stubbed wholesale: the
 * router constructs `URL`s of its own, and a plain object standing in for
 * the class would take the constructor away from it.
 */
const createObjectURL = vi.fn<(file: Blob | MediaSource) => string>(
  () => "blob:preview",
);
const revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AttachKit: the header", () => {
  it("says how far, in what, and how many pieces — none yet", async () => {
    // "6.2 MI · 41°F DAMP · 0 PIECES": a kit is required, and the count
    // is how "nothing yet" is said.
    await renderWithRouter(attach());

    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-ground", "ink");
    expect(
      within(header).getByRole("heading", {
        level: 1,
        name: "What did you wear?",
      }),
    ).toBeVisible();
    expect(
      within(header).getByText("6.2 mi · 41°F damp · 0 pieces"),
    ).toBeVisible();
  });

  it("counts the pieces as they are chosen, one and then many", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(screen.getByRole("button", { name: "Houdini" }));
    expect(screen.getByText("6.2 mi · 41°F damp · 1 piece")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tights" }));
    expect(screen.getByText("6.2 mi · 41°F damp · 2 pieces")).toBeVisible();
  });

  it("loses its temperature cell when the run has no conditions", async () => {
    await renderWithRouter(
      attach({
        context: context({ conditions: undefined }),
        units: { temp: "c", distance: "km" },
      }),
    );

    expect(screen.getByText("10.0 km · 0 pieces")).toBeVisible();
  });

  it("writes the temperature in the runner's own unit", async () => {
    await renderWithRouter(attach({ units: { temp: "c", distance: "km" } }));

    expect(screen.getByText("10.0 km · 5°C damp · 0 pieces")).toBeVisible();
  });
});

describe("AttachKit: most likely", () => {
  it("waits on the suggestion alone, with the picker already live", async () => {
    // Round 22, "A2 Waiting": only most-likely changes. The picker, the
    // photo row and the button are there from the first frame.
    await renderWithRouter(attach({ prefillFor: neverSettles }));

    const waiting = region("most-likely");
    expect(waiting).toHaveAttribute("data-state", "waiting");
    expect(waiting).toHaveAttribute("aria-busy", "true");
    expect(within(waiting).getByText("Most likely")).toBeVisible();
    expect(
      within(waiting).getByText("Checking what you wore at 41°"),
    ).toBeVisible();
    expect(waiting.querySelectorAll(".breathe")).toHaveLength(2);

    expect(screen.getByRole("button", { name: "Houdini" })).toBeVisible();
    expect(primary()).toBeVisible();
    expect(document.querySelector("[data-part='photo-well']")).not.toBeNull();
    // "OR PICK FROM THE CLOSET" while a suggestion may yet come.
    expect(screen.getByText("Or pick from the closet")).toBeVisible();
  });

  it("waits without a temperature to name when the run has none", async () => {
    await renderWithRouter(
      attach({
        context: context({ conditions: undefined }),
        prefillFor: neverSettles,
      }),
    );

    expect(screen.getByText("Checking what you wore")).toBeVisible();
  });

  it("asks for the suggestion by the run, once", async () => {
    const prefillFor = vi.fn(() => Promise.resolve(undefined));
    await renderWithRouter(attach({ prefillFor }));

    await waitFor(() => {
      expect(prefillFor).toHaveBeenCalledTimes(1);
    });
    expect(prefillFor).toHaveBeenCalledWith({ data: { runId: "01RUN" } });
  });

  it("says in one line that there is no usual kit yet — no card", async () => {
    // "One line, no card: an empty card is a promise we're not keeping."
    await renderWithRouter(attach());

    const none = await screen.findByText("No usual kit at 41° yet.");
    const block = region("most-likely");
    expect(block).toHaveAttribute("data-state", "none");
    expect(block).toContainElement(none);
    expect(
      screen.getByText(
        "Pick what you wore. After a few runs here, we’ll suggest it.",
      ),
    ).toBeVisible();
    expect(block).not.toHaveClass("rounded-card");
    // "OR PICK" loses its OR.
    expect(screen.getByText("From the closet")).toBeVisible();
    expect(screen.queryByText("Or pick from the closet")).toBeNull();
  });

  it("names the missing weather, and drops the sub-line, when the run has none", async () => {
    await renderWithRouter(
      attach({ context: context({ conditions: undefined }) }),
    );

    expect(
      await screen.findByText("No weather on this run, so no suggestion."),
    ).toBeVisible();
    expect(screen.queryByText(/After a few runs here/)).toBeNull();
  });

  it("treats a suggestion that failed to load as no suggestion", async () => {
    // Degrade, don't fail: the picker is already the way on.
    await renderWithRouter(
      attach({ prefillFor: () => Promise.reject(new Error("D1 down")) }),
    );

    expect(await screen.findByText("No usual kit at 41° yet.")).toBeVisible();
  });

  it("offers the suggestion: where it is from, the pieces, and one tap", async () => {
    await renderWithRouter(
      attach({ prefillFor: () => Promise.resolve(candidate()) }),
    );

    const card = await screen.findByText(
      "Most likely · from 43° damp, Fri 14 Aug",
    );
    const block = region("most-likely");
    expect(block).toHaveAttribute("data-state", "suggestion");
    expect(block).toContainElement(card);
    expect(block).toHaveClass("bg-hi-viz");
    const pieces = within(block)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(pieces).toEqual(["Houdini", "Tights"]);
  });

  it("leaves out a suggested piece the closet no longer has", async () => {
    // Retired since: it is not in the picker, so it is not named here.
    await renderWithRouter(
      attach({
        prefillFor: () =>
          Promise.resolve(candidate({ itemIds: [HOUDINI, "01GONE"] })),
      }),
    );

    await screen.findByText(/Most likely · from/);
    expect(
      within(region("most-likely"))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Houdini"]);
  });

  it("sends the suggested kit on That's it, and goes on to the verdict", async () => {
    const user = userEvent.setup();
    const attachKit = vi.fn(() => Promise.resolve({ entryId: "01NEW" }));
    const { router } = await renderWithRouter(
      attach({ prefillFor: () => Promise.resolve(candidate()), attachKit }),
    );

    await user.click(await screen.findByRole("button", { name: "That’s it" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/verdict/01NEW");
    });
    expect(attachKit).toHaveBeenCalledWith({
      data: { runId: "01RUN", itemIds: [HOUDINI, TIGHTS] },
    });
  });

  it("takes the suggestion into the picker on Change, and puts the card away", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      attach({ prefillFor: () => Promise.resolve(candidate()) }),
    );

    await user.click(await screen.findByRole("button", { name: "Change" }));

    expect(document.querySelector("[data-slot='most-likely']")).toBeNull();
    expect(screen.getByRole("button", { name: "Houdini" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Tights" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("6.2 mi · 41°F damp · 2 pieces")).toBeVisible();
  });
});

describe("AttachKit: the closet picker", () => {
  it("draws a row of tiles for the pieces a kit is built around, and chips for the rest", async () => {
    await renderWithRouter(attach());

    const list = region("kit-list");
    expect(within(list).getByText("Tops · 2 of 3 match")).toBeVisible();
    expect(within(list).getByText("Bottoms · 1 of 1 match")).toBeVisible();
    // The conditions filter is on: the singlet has no history at 41°.
    expect(within(list).queryByRole("button", { name: "Singlet" })).toBeNull();
    // Hands and head are a chip, not a row.
    expect(within(list).queryByRole("button", { name: "Gloves" })).toBeNull();
    expect(
      within(list).getByRole("button", { name: "+ Hands / head 1" }),
    ).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText("Showing 4 of 5")).toBeVisible();
  });

  it("gives every piece an outer layer a row of its own", async () => {
    const outerOnly = context({
      groups: [
        {
          group: "outer",
          items: [piece(HOUDINI, "Shell")],
          matchCount: 1,
          hiddenByFilterCount: 0,
        },
      ],
    });
    await renderWithRouter(attach({ context: outerOnly }));

    expect(screen.getByRole("button", { name: "Shell" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^\+ / })).toBeNull();
  });

  it("turns the conditions filter off and shows the whole closet", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    const filter = screen.getByRole("button", { name: "41° damp" });
    expect(filter).toHaveAttribute("aria-pressed", "true");
    await user.click(filter);

    expect(filter).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Singlet" })).toBeVisible();
    expect(screen.getByText("Tops · 3")).toBeVisible();
    expect(screen.getByText("Showing 5 of 5")).toBeVisible();
    await user.click(filter);
    expect(screen.queryByRole("button", { name: "Singlet" })).toBeNull();
  });

  it("offers no filter at all without conditions to filter by", async () => {
    await renderWithRouter(
      attach({ context: context({ conditions: undefined }) }),
    );

    expect(screen.getByText("Tops · 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "Singlet" })).toBeVisible();
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it("marks a chosen tile in ink, and unmarks it on a second tap", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    const tile = screen.getByRole("button", { name: "Houdini" });
    expect(tile).toHaveAttribute("aria-pressed", "false");
    expect(tile).toHaveClass("border-hairline", "bg-panel");
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(tile).toHaveClass("border-ink", "bg-ink", "text-ground");
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "false");
  });

  it("draws no chip row when every group is a row", async () => {
    const rowsOnly = context({ groups: GROUPS.slice(0, 2) });
    await renderWithRouter(attach({ context: rowsOnly }));

    expect(
      within(region("kit-list")).queryAllByRole("button", {
        name: /^\+/,
      }),
    ).toHaveLength(0);
    expect(region("kit-list").children).toHaveLength(2);
  });
});

describe("AttachKit: A2b, one category as a sheet", () => {
  it("opens from ALL ›, filtered, and says how much the filter hides", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(screen.getByRole("button", { name: "All Tops" }));
    const sheet = await screen.findByRole("dialog", { name: "Tops" });

    expect(within(sheet).getByRole("heading", { name: "Tops" })).toBeVisible();
    expect(within(sheet).getByText("2 of 3 match 41° damp")).toBeVisible();
    expect(within(sheet).getByText("0 selected")).toBeVisible();
    expect(within(sheet).getByText("Hidden by the filter · 1")).toBeVisible();
    expect(
      within(sheet).getByRole("checkbox", { name: "Patagonia Houdini" }),
    ).not.toBeChecked();
    expect(
      within(sheet).queryByRole("checkbox", { name: "Singlet" }),
    ).toBeNull();
    // An untested piece is shown and said to be untested.
    const harrier = within(sheet).getByRole("checkbox", {
      name: /Harrier/,
    });
    expect(harrier.closest("label")).toHaveTextContent(/untested/i);
  });

  it("edits the same kit the screen does", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(screen.getByRole("button", { name: "All Tops" }));
    const sheet = await screen.findByRole("dialog", { name: "Tops" });
    await user.click(
      within(sheet).getByRole("checkbox", { name: "Patagonia Houdini" }),
    );
    expect(within(sheet).getByText("1 selected")).toBeVisible();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Houdini" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the whole category with the filter off, and hides nothing", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(screen.getByRole("button", { name: "All Tops" }));
    const sheet = await screen.findByRole("dialog", { name: "Tops" });
    const filter = within(sheet).getByRole("button", {
      name: "Matches conditions",
    });
    expect(filter).toHaveAttribute("aria-pressed", "true");
    await user.click(filter);

    expect(filter).toHaveAttribute("aria-pressed", "false");
    expect(
      within(sheet).getByRole("checkbox", { name: "Singlet" }),
    ).toBeVisible();
    expect(within(sheet).queryByText(/Hidden by the filter/)).toBeNull();
  });

  it("searches by brand and name, in any case", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(screen.getByRole("button", { name: "All Tops" }));
    const sheet = await screen.findByRole("dialog", { name: "Tops" });
    const search = within(sheet).getByRole("searchbox", { name: "Search" });
    expect(search).toHaveAttribute("placeholder", "Search tops…");

    // The brand is searched as well as the name.
    await user.type(search, "PATAG");
    expect(
      within(sheet)
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")?.textContent),
    ).toEqual(["Patagonia Houdini"]);
    await user.clear(search);
    // A piece with no brand is still found by its name alone.
    await user.type(search, "harr");
    const [only, ...rest] = within(sheet).getAllByRole("checkbox");
    expect(rest).toHaveLength(0);
    expect(only?.closest("label")).toHaveTextContent(/^Harrier/u);
  });

  it("opens a category with nothing matching with the filter off", async () => {
    // Round 20: "a category with zero matches opens with the filter off".
    const user = userEvent.setup();
    const nothingMatches = context({
      groups: [
        {
          group: "shoes",
          items: [piece(GLOVES, "Spikes", { matches: false })],
          matchCount: 0,
          hiddenByFilterCount: 1,
        },
      ],
    });
    await renderWithRouter(attach({ context: nothingMatches }));

    await user.click(screen.getByRole("button", { name: "+ Shoes 0" }));
    const sheet = await screen.findByRole("dialog", { name: "Shoes" });
    expect(
      within(sheet).getByRole("checkbox", { name: "Spikes" }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole("button", { name: "Matches conditions" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("counts pieces rather than matches, with no filter, when the run has no conditions", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      attach({ context: context({ conditions: undefined }) }),
    );

    await user.click(screen.getByRole("button", { name: "+ Hands / head 1" }));
    const sheet = await screen.findByRole("dialog", { name: "Hands / head" });
    expect(within(sheet).getByText("1 pieces")).toBeVisible();
    expect(
      within(sheet).queryByRole("button", { name: "Matches conditions" }),
    ).toBeNull();
    expect(within(sheet).queryByText(/Hidden by the filter/)).toBeNull();
  });

  it("starts each category's search afresh", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(screen.getByRole("button", { name: "All Tops" }));
    let sheet = await screen.findByRole("dialog", { name: "Tops" });
    await user.type(within(sheet).getByRole("searchbox"), "zzz");
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "All Bottoms" }));
    sheet = await screen.findByRole("dialog", { name: "Bottoms" });
    expect(within(sheet).getByRole("searchbox")).toHaveValue("");
    expect(
      within(sheet).getByRole("checkbox", { name: "Tights" }),
    ).toBeVisible();
  });
});

describe("AttachKit: a kit is required", () => {
  it("never relabels the button, and marks the picker when nothing is chosen", async () => {
    // Round 20: "the button label never changes, and tapping it with none
    // chosen marks the closet-picker group with the message band 'Pick at
    // least one piece.'" The round-13 "Attach 0 items" is superseded.
    const user = userEvent.setup();
    const attachKit = vi.fn(() => Promise.resolve({ entryId: "01NEW" }));
    await renderWithRouter(attach({ attachKit }));

    expectAvailable(primary());
    await user.click(primary());

    const message = screen.getByText("Pick at least one piece.");
    expect(region("closet-picker")).toContainElement(message);
    expect(message).toHaveAttribute("id", "kit-message");
    expect(attachKit).not.toHaveBeenCalled();
    expect(primary()).toBeVisible();
  });

  it("clears the mark as soon as a piece is chosen", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.click(primary());
    expect(screen.getByText("Pick at least one piece.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Houdini" }));
    expect(screen.queryByText("Pick at least one piece.")).toBeNull();
  });

  it("sends what was chosen, and goes on to the verdict", async () => {
    const user = userEvent.setup();
    const attachKit = vi.fn(() => Promise.resolve({ entryId: "01NEW" }));
    const { router } = await renderWithRouter(attach({ attachKit }));

    await user.click(primary());
    await user.click(screen.getByRole("button", { name: "Houdini" }));
    await user.click(screen.getByRole("button", { name: "Tights" }));
    await user.click(primary());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/verdict/01NEW");
    });
    expect(attachKit).toHaveBeenCalledWith({
      data: { runId: "01RUN", itemIds: [HOUDINI, TIGHTS] },
    });
  });

  it("offers the way out: the run stays in the queue", async () => {
    await renderWithRouter(attach());

    const out = screen.getByRole("link", { name: "leave it in the queue" });
    expect(out).toHaveAttribute("href", "/runs");
    expect(out.closest("p")).toHaveTextContent(
      "Not now — leave it in the queue.",
    );
  });
});

describe("AttachKit: a failed attach (round 23, item 9)", () => {
  it("waits behind its in-flight label, and sends once", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ entryId: string }>();
    const attachKit = vi.fn(() => pending.promise);
    await renderWithRouter(attach({ attachKit }));

    await user.click(screen.getByRole("button", { name: "Houdini" }));
    await user.click(primary());

    // Found by its region: while it works, the name it answers to is the
    // in-flight verb, because the rest label is hidden rather than removed.
    const button = region("primary-action");
    await waitFor(() => {
      expectBusy(button);
    });
    expect(button).toHaveAccessibleName("Attaching");
    await user.click(button);
    expect(attachKit).toHaveBeenCalledTimes(1);
    pending.resolve({ entryId: "01NEW" });
  });

  it("says nothing attached under the button, and tries again with the same kit", async () => {
    const user = userEvent.setup();
    const attachKit = vi
      .fn<
        (input: {
          data: { runId: string; itemIds: string[] };
        }) => Promise<{ entryId: string }>
      >()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockResolvedValueOnce({ entryId: "01NEW" });
    const { router } = await renderWithRouter(attach({ attachKit }));

    await user.click(screen.getByRole("button", { name: "Houdini" }));
    await user.click(primary());

    const band = await screen.findByText("Nothing attached");
    expect(band.closest("[data-part='failure-band']")).not.toBeNull();
    expect(screen.getByText("Our end failed.")).toBeVisible();
    // One status region on the screen, and it says the same.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing attached. Our end failed.",
    );
    // Not the pink line it used to be, and still where it was.
    expect(screen.queryByText("Couldn't save that. Try again.")).toBeNull();
    expect(
      band.closest("[data-part='failure-band']")?.previousElementSibling,
    ).toBe(region("primary-action"));
    expect(router.state.location.pathname).toBe("/");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/verdict/01NEW");
    });
    expect(attachKit).toHaveBeenLastCalledWith({
      data: { runId: "01RUN", itemIds: [HOUDINI] },
    });
  });
});

/**
 * A step that records what it was handed and lets the test decide when the
 * blurred bytes come back — W3's contract: the picked file waits, and
 * something else says what is kept.
 */
function recordingStep() {
  const seen: File[] = [];
  let release: ((ready: File) => void) | undefined;
  let say: ((sentence: string) => void) | undefined;
  const step: PhotoStep = (file, onReady, announce) => {
    seen.push(file);
    release = onReady;
    say = announce;
    return <p>step for {file.name}</p>;
  };
  return {
    seen,
    step,
    hand: (ready: File) => release?.(ready),
    announce: (sentence: string) => {
      say?.(sentence);
    },
  };
}

describe("AttachKit: the outfit photo (moved here from A3 by round 20)", () => {
  it("is the one well, with A2's words, from the first frame", async () => {
    await renderWithRouter(attach({ prefillFor: neverSettles }));

    const well = document.querySelector("[data-part='photo-well']");
    expect(well).toHaveAttribute("data-state", "empty");
    expect(well).toHaveTextContent("Outfit photo · optional");
    expect(well).toHaveTextContent("Add a photo");
    expect(well).toHaveTextContent("Flat on the floor works best.");
    expect(photoInput()).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  });

  it("holds the picked file for W3's step, and keeps the bytes it hands back", async () => {
    const user = userEvent.setup();
    const recording = recordingStep();
    await renderWithRouter(attach({ renderPhotoStep: recording.step }));

    await user.upload(photoInput(), jpeg("raw.jpg"));

    expect(screen.getByText("step for raw.jpg")).toBeVisible();
    expect(recording.seen.map((file) => file.name)).toEqual(["raw.jpg"]);
    // While the step is open the well says it is adding.
    expect(document.querySelector("[data-part='photo-well']")).toHaveAttribute(
      "data-state",
      "uploading",
    );

    recording.hand(jpeg("blurred.jpg"));
    await waitFor(() => {
      expect(screen.queryByText("step for raw.jpg")).toBeNull();
    });
    // The preview arrives one effect after the photo is kept.
    await waitFor(() => {
      expect(
        document.querySelector("[data-part='photo-well']"),
      ).toHaveAttribute("data-state", "filled");
    });
    expect(
      within(document.body).getByRole("img", { name: "Your outfit" }),
    ).toHaveAttribute("src", "blob:preview");
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ name: "blurred.jpg" }),
    );
  });

  it("lends the step the screen's one status region", async () => {
    // Rule 08: one `role="status"` per screen.
    const user = userEvent.setup();
    const recording = recordingStep();
    await renderWithRouter(attach({ renderPhotoStep: recording.step }));
    await user.upload(photoInput(), jpeg());

    recording.announce("Blurring 1 face.");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Blurring 1 face.");
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps a picked photo as it is when there is no step", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.upload(photoInput(), jpeg("plain.jpg"));

    await waitFor(() => {
      expect(
        document.querySelector("[data-part='photo-well']"),
      ).toHaveAttribute("data-state", "filled");
    });
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ name: "plain.jpg" }),
    );
  });

  it("refuses a type the server would, on the well's field message", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const recording = recordingStep();
    await renderWithRouter(attach({ renderPhotoStep: recording.step }));

    await user.upload(
      photoInput(),
      new File(["x"], "kit.heic", { type: "image/heic" }),
    );

    expect(screen.getByText("Photos must be JPG, PNG or WebP.")).toBeVisible();
    expect(document.querySelector("[data-part='photo-well']")).toHaveAttribute(
      "data-state",
      "error",
    );
    expect(recording.seen).toHaveLength(0);
  });

  it("refuses a photo over the cap, and clears the mark for the next one", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.upload(photoInput(), jpeg("huge.jpg", 10 * 1024 * 1024 + 1));
    expect(
      screen.getByText("That photo is over 10 MB. Pick a smaller one."),
    ).toBeVisible();

    await user.upload(photoInput(), jpeg("fine.jpg"));
    expect(screen.queryByText(/over 10 MB/)).toBeNull();
  });

  it("does nothing when the picker is dismissed", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());

    await user.upload(photoInput(), []);

    expect(document.querySelector("[data-part='photo-well']")).toHaveAttribute(
      "data-state",
      "empty",
    );
  });

  it("removes the held photo and lets its preview go", async () => {
    const user = userEvent.setup();
    await renderWithRouter(attach());
    await user.upload(photoInput(), jpeg());

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(document.querySelector("[data-part='photo-well']")).toHaveAttribute(
      "data-state",
      "empty",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("uploads the held photo to the entry the attach made, then goes on", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const attachKit = vi.fn(() => {
      order.push("attach");
      return Promise.resolve({ entryId: "01NEW" });
    });
    const uploadPhoto = vi.fn<
      (input: { data: FormData }) => Promise<{ key: string }>
    >(() => {
      order.push("photo");
      return Promise.resolve({ key: "k" });
    });
    const { router } = await renderWithRouter(
      attach({ attachKit, uploadPhoto }),
    );

    await user.upload(photoInput(), jpeg("kit.jpg"));
    await user.click(screen.getByRole("button", { name: "Houdini" }));
    await user.click(primary());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/verdict/01NEW");
    });
    expect(order).toEqual(["attach", "photo"]);
    const sent = uploadPhoto.mock.calls[0]?.[0].data;
    expect(sent?.get("entryId")).toBe("01NEW");
    expect(sent?.get("photo")).toEqual(
      expect.objectContaining({ name: "kit.jpg" }),
    );
    expect(sent?.get("idempotencyKey")).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
  });

  it("retries the photo under the same key, so a retry is one photo", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi
      .fn<(input: { data: FormData }) => Promise<{ key: string }>>()
      .mockRejectedValueOnce(new Error("R2 hiccup"))
      .mockResolvedValueOnce({ key: "k" });
    await renderWithRouter(attach({ uploadPhoto }));

    await user.upload(photoInput(), jpeg());
    await user.click(screen.getByRole("button", { name: "Houdini" }));
    await user.click(primary());
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(2);
    });
    const [first, second] = uploadPhoto.mock.calls.map((call) =>
      call[0].data.get("idempotencyKey"),
    );
    expect(second).toBe(first);
  });

  it("sends no photo when none was kept", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    const { router } = await renderWithRouter(attach({ uploadPhoto }));

    await user.click(screen.getByRole("button", { name: "Houdini" }));
    await user.click(primary());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/verdict/01NEW");
    });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
});
