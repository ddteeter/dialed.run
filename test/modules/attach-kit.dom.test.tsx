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
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AttachKit,
  pickerQueryFor,
} from "../../src/modules/feed/components/AttachKit";
import type { PickerGroup } from "../../src/modules/feed/picker";
import type { PrefillCandidate } from "../../src/modules/feed/prefill";

/**
 * Attach the kit (screen A2) — and the prefill idea, which is the feature.
 *
 * Before the picker opens there are three resting states: waiting on a
 * location, a most-likely kit to accept in one tap, or nothing to suggest.
 * Which one a runner sees is what the screen is for, and none of them
 * could be reached while this was markup in a route.
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
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, verdictRoute]),
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

function withLocation(coords?: { latitude: number; longitude: number }) {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (
        onSuccess: (position: { coords: unknown }) => void,
        onError: () => void,
      ) => {
        if (coords === undefined) onError();
        else onSuccess({ coords });
      },
    },
  });
}

function withoutGeolocation() {
  // A plain object rather than a copy of the real navigator: spreading a
  // class instance loses its prototype, and all this needs to be is
  // "something without geolocation on it".
  vi.stubGlobal("navigator", {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const conditions = {
  tempC: 10,
  feelsLikeC: 8,
  precipMm: 0,
  condition: "Clear",
  windKph: 5,
  source: "visualcrossing" as const,
};

function candidate(overrides: Partial<PrefillCandidate> = {}): PrefillCandidate {
  return {
    entryId: "01PREV",
    itemIds: ["01A", "01B"],
    conditions,
    createdAt: 1_755_000_000,
    feelsLikeDeltaC: 1.4,
    ...overrides,
  };
}

function group(overrides: Partial<PickerGroup> = {}): PickerGroup {
  return {
    group: "tops",
    items: [
      {
        id: "01A",
        name: "Houdini",
        brand: "Patagonia",
        category: "top",
        layer: NOTHING,
        matches: true,
        untested: false,
      },
    ],
    matchCount: 1,
    hiddenByFilterCount: 0,
    ...overrides,
  };
}

function attach(
  overrides: {
    prefillFor?: () => Promise<PrefillCandidate | undefined>;
    pickerGroupsFor?: () => Promise<PickerGroup[]>;
    attachKit?: (input: {
      data: { runId: string; itemIds: string[] };
    }) => Promise<{ entryId: string }>;
  } = {},
) {
  return (
    <AttachKit
      runId="01RUN"
      prefillFor={overrides.prefillFor ?? (() => Promise.resolve(undefined))}
      pickerGroupsFor={overrides.pickerGroupsFor ?? (() => Promise.resolve([]))}
      attachKit={
        overrides.attachKit ?? (() => Promise.resolve({ entryId: "01NEW" }))
      }
    />
  );
}

describe("pickerQueryFor", () => {
  it("passes the position through when there is one", () => {
    expect(
      pickerQueryFor({
        latitude: 44.98,
        longitude: -93.27,
      } as GeolocationCoordinates),
    ).toStrictEqual({ lat: 44.98, lng: -93.27 });
  });

  it("asks for nothing when there is no position, and while still asking", () => {
    // Both cases mean the same thing to the query: no condition filter.
    expect(pickerQueryFor("none")).toStrictEqual({});
    expect(pickerQueryFor(undefined)).toStrictEqual({});
  });
});

describe("AttachKit: before the picker opens", () => {
  it("offers the picker when the runner denies the location prompt", async () => {
    // The bug this replaced: a denied prompt left `coords` undefined
    // forever, which is also what "still asking" looked like — so the
    // screen sat on its skeleton and there was no way to attach a kit at
    // all.
    withLocation();
    const prefillFor = vi.fn(() => Promise.resolve(candidate()));
    await renderWithRouter(attach({ prefillFor }));

    expect(
      await screen.findByRole("button", { name: "Choose your kit" }),
    ).toBeVisible();
    // And no suggestion is asked for: there is no position to match a
    // previous run against, so the query could only answer nothing.
    expect(prefillFor).not.toHaveBeenCalled();
  });

  it("shows a skeleton while it waits on a location", async () => {
    // No spinner, per §System states.
    withLocation({ latitude: 1, longitude: 2 });
    const { container } = await renderWithRouter(
      attach({ prefillFor: neverSettles }),
    );

    expect(screen.getByRole("heading", { name: "Attach the kit" })).toBeVisible();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("asks for a prefill at the coordinates it was given", async () => {
    withLocation({ latitude: 44.98, longitude: -93.27 });
    const prefillFor = vi.fn(() => Promise.resolve(undefined));
    await renderWithRouter(attach({ prefillFor }));

    await waitFor(() => {
      expect(prefillFor).toHaveBeenCalledWith({
        data: { lat: 44.98, lng: -93.27 },
      });
    });
  });

  it("offers the most likely kit, and says why it thinks so", async () => {
    withLocation({ latitude: 44.98, longitude: -93.27 });
    await renderWithRouter(
      attach({ prefillFor: () => Promise.resolve(candidate()) }),
    );

    // The reason is the conditions it matched and how far off they were —
    // a suggestion with no reason is a guess the runner cannot check.
    expect(await screen.findByText(/Most likely/)).toHaveTextContent(
      "[Most likely · from 50°, 1° off]",
    );
    expect(screen.getByRole("button", { name: "That’s it" })).toBeVisible();
  });

  it("attaches the suggested kit in one tap, and moves to the verdict", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const attachKit = vi.fn(() => Promise.resolve({ entryId: "01NEW" }));
    const { router } = await renderWithRouter(
      attach({
        prefillFor: () => Promise.resolve(candidate({ itemIds: ["01A", "01B"] })),
        attachKit,
      }),
    );

    await screen.findByRole("button", { name: "That’s it" });
    await userEvent.setup().click(screen.getByRole("button", { name: "That’s it" }));

    await waitFor(() => {
      expect(attachKit).toHaveBeenCalledWith({
        data: { runId: "01RUN", itemIds: ["01A", "01B"] },
      });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/feed/verdict/01NEW");
    });
  });

  it("offers the picker straight away when there is nothing to suggest", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(attach());

    expect(
      await screen.findByRole("button", { name: "Choose your kit" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "That’s it" })).toBeNull();
  });

  it("does the same when the browser will not give a location", async () => {
    // Degrades to the condition-filtered picker rather than blocking —
    // and asks for nothing it cannot answer. An exception in the effect
    // would surface as an uncaught error rather than a failed assertion,
    // so it is listened for.
    const raised: string[] = [];
    const watch = (event: ErrorEvent) => {
      raised.push(event.message);
    };
    globalThis.addEventListener("error", watch);
    try {
      withoutGeolocation();
      const prefillFor = vi.fn(() => Promise.resolve(candidate()));
      await renderWithRouter(attach({ prefillFor }));

      expect(prefillFor).not.toHaveBeenCalled();
      expect(raised).toStrictEqual([]);
    } finally {
      globalThis.removeEventListener("error", watch);
    }
  });

  it("waits, rather than offering the picker, until it knows", async () => {
    // The skeleton is the "we might have a suggestion" state. Showing
    // "choose your kit" first and replacing it a beat later would be a
    // flash of the wrong screen.
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(
      attach({ prefillFor: neverSettles }),
    );

    expect(
      screen.queryByRole("button", { name: "Choose your kit" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "That’s it" })).toBeNull();
  });

  it("stops waiting once a suggestion arrives", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const { container } = await renderWithRouter(
      attach({ prefillFor: () => Promise.resolve(candidate()) }),
    );

    await screen.findByRole("button", { name: "That’s it" });
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });
});

async function openPicker(groups: PickerGroup[]) {
  withLocation({ latitude: 1, longitude: 2 });
  const user = userEvent.setup();
  const rendered = await renderWithRouter(
    attach({ pickerGroupsFor: () => Promise.resolve(groups) }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Choose your kit" }),
  );
  return { user, ...rendered };
}

describe("AttachKit: the picker", () => {
  it("lists each group with its match count", async () => {
    await openPicker([group({ matchCount: 1 })]);

    const legend = await screen.findByText(/Tops/);
    // The space between the label and the count is a deliberate `{" "}`.
    expect(legend).toHaveTextContent("Tops [1 of 1]");
    expect(screen.getByLabelText(/Houdini/)).toBeInTheDocument();
  });

  it("asks for the closet at the runner's coordinates", async () => {
    withLocation({ latitude: 44.98, longitude: -93.27 });
    const pickerGroupsFor = vi.fn(() => Promise.resolve([group()]));
    const user = userEvent.setup();
    await renderWithRouter(attach({ pickerGroupsFor }));
    await user.click(
      await screen.findByRole("button", { name: "Choose your kit" }),
    );

    await waitFor(() => {
      expect(pickerGroupsFor).toHaveBeenCalledWith({
        data: { lat: 44.98, lng: -93.27 },
      });
    });
  });

  it("asks for it without coordinates when there are none", async () => {
    // The picker still works with no location — it just cannot filter by
    // conditions.
    withoutGeolocation();
    const pickerGroupsFor = vi.fn(() => Promise.resolve([group()]));
    const user = userEvent.setup();
    await renderWithRouter(attach({ pickerGroupsFor }));
    await user.click(
      await screen.findByRole("button", { name: "Choose your kit" }),
    );

    await waitFor(() => {
      expect(pickerGroupsFor).toHaveBeenCalledWith({ data: {} });
    });
  });

  it("asks for the closet once, not on every keystroke", async () => {
    // `groups !== undefined` is the guard: without it, every re-render —
    // and typing is one per character — would refetch the whole closet.
    withLocation({ latitude: 1, longitude: 2 });
    const pickerGroupsFor = vi.fn(() => Promise.resolve([group()]));
    const user = userEvent.setup();
    await renderWithRouter(attach({ pickerGroupsFor }));
    await user.click(
      await screen.findByRole("button", { name: "Choose your kit" }),
    );
    await screen.findByText(/Tops/);
    expect(pickerGroupsFor).toHaveBeenCalledTimes(1);

    await user.type(screen.getByPlaceholderText("Search your closet"), "hou");

    expect(pickerGroupsFor).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Houdini/)).toBeInTheDocument();
  });

  it("asks for nothing until the picker is opened", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const pickerGroupsFor = vi.fn(() => Promise.resolve([group()]));
    await renderWithRouter(
      attach({
        prefillFor: () => Promise.resolve(candidate()),
        pickerGroupsFor,
      }),
    );
    await screen.findByRole("button", { name: "That’s it" });

    expect(pickerGroupsFor).not.toHaveBeenCalled();
  });

  it("names an item with its brand, and marks an untested one", async () => {
    await openPicker([
      group({
        items: [
          {
            id: "01A",
            name: "Houdini",
            brand: "Patagonia",
            category: "top",
            layer: NOTHING,
            matches: true,
            untested: true,
          },
        ],
      }),
    ]);

    expect(await screen.findByText("Patagonia Houdini")).toBeVisible();
    expect(screen.getByText("[untested]")).toBeVisible();
  });

  it("names an item with no brand without a leading space", async () => {
    await openPicker([
      group({
        items: [
          {
            id: "01A",
            name: "Long sleeve top",
            brand: NOTHING,
            category: "top",
            layer: NOTHING,
            matches: true,
            untested: false,
          },
        ],
      }),
    ]);

    const label = await screen.findByText("Long sleeve top");
    expect(label.textContent).toBe("Long sleeve top");
  });

  it("marks a tested item by leaving it unmarked", async () => {
    await openPicker([group()]);
    await screen.findByText(/Tops/);
    expect(screen.queryByText("[untested]")).toBeNull();
  });

  it("says how many the conditions filter hid", async () => {
    // The count is the honest half of a filtered list: a closet that looks
    // half empty is alarming without it.
    await openPicker([group({ hiddenByFilterCount: 3 })]);
    expect(await screen.findByText("3 hidden by conditions")).toBeVisible();
  });

  it("says nothing about hidden items when none were", async () => {
    await openPicker([group({ hiddenByFilterCount: 0 })]);
    await screen.findByText("Tops");
    expect(screen.queryByText(/hidden by conditions/)).toBeNull();
  });

  it("filters what is shown as the runner searches", async () => {
    const { user } = await openPicker([
      group({
        items: [
          {
            id: "01A",
            name: "Houdini",
            brand: NOTHING,
            category: "top",
            layer: NOTHING,
            matches: true,
            untested: false,
          },
          {
            id: "01B",
            name: "Merino base",
            brand: NOTHING,
            category: "top",
            layer: NOTHING,
            matches: true,
            untested: false,
          },
        ],
      }),
    ]);
    await screen.findByText("Tops");

    await user.type(screen.getByPlaceholderText("Search your closet"), "merino");

    expect(screen.getByLabelText(/Merino base/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Houdini/)).toBeNull();
  });

  it("drops a group entirely when nothing in it matches the search", async () => {
    const { user } = await openPicker([group()]);
    await screen.findByText("Tops");

    await user.type(screen.getByPlaceholderText("Search your closet"), "zzz");

    expect(screen.queryByText("Tops")).toBeNull();
  });

  it("will not attach nothing", async () => {
    await openPicker([group()]);
    expect(
      await screen.findByRole("button", { name: /Attach 0 items/ }),
    ).toBeDisabled();
  });

  it("counts the selection, in the singular at one", async () => {
    const { user } = await openPicker([
      group({
        items: [
          {
            id: "01A",
            name: "Houdini",
            brand: NOTHING,
            category: "top",
            layer: NOTHING,
            matches: true,
            untested: false,
          },
          {
            id: "01B",
            name: "Tights",
            brand: NOTHING,
            category: "top",
            layer: NOTHING,
            matches: true,
            untested: false,
          },
        ],
      }),
    ]);
    await screen.findByText("Tops");

    await user.click(screen.getByLabelText(/Houdini/));
    expect(screen.getByRole("button", { name: "Attach 1 item" })).toBeEnabled();

    await user.click(screen.getByLabelText(/Tights/));
    expect(screen.getByRole("button", { name: "Attach 2 items" })).toBeVisible();
  });

  it("takes a selection back when it is tapped again", async () => {
    const { user } = await openPicker([group()]);
    await screen.findByText("Tops");

    await user.click(screen.getByLabelText(/Houdini/));
    await user.click(screen.getByLabelText(/Houdini/));

    expect(screen.getByRole("button", { name: /Attach 0 items/ })).toBeDisabled();
  });

  it("attaches what was chosen", async () => {
    const attachKit = vi.fn(() => Promise.resolve({ entryId: "01NEW" }));
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    await renderWithRouter(
      attach({
        pickerGroupsFor: () => Promise.resolve([group()]),
        attachKit,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Choose your kit" }),
    );
    await screen.findByText("Tops");
    await user.click(screen.getByLabelText(/Houdini/));

    await user.click(screen.getByRole("button", { name: "Attach 1 item" }));

    await waitFor(() => {
      expect(attachKit).toHaveBeenCalledWith({
        data: { runId: "01RUN", itemIds: ["01A"] },
      });
    });
  });

  it("can be reached from the suggestion, when the suggestion is wrong", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    await renderWithRouter(
      attach({
        prefillFor: () => Promise.resolve(candidate()),
        pickerGroupsFor: () => Promise.resolve([group()]),
      }),
    );
    await screen.findByRole("button", { name: "That’s it" });

    await user.click(
      screen.getByRole("button", { name: "Choose different items" }),
    );

    expect(await screen.findByText("Tops")).toBeVisible();
    expect(screen.queryByRole("button", { name: "That’s it" })).toBeNull();
  });

  it("shows a skeleton while the closet loads", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    const { container } = await renderWithRouter(
      attach({ pickerGroupsFor: neverSettles }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Choose your kit" }),
    );

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

describe("AttachKit: when it cannot save", () => {
  it("says so, and leaves the choice intact", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    await renderWithRouter(
      attach({
        prefillFor: () => Promise.resolve(candidate()),
        attachKit: () => Promise.reject(new Error("D1 unavailable")),
      }),
    );
    await user.click(await screen.findByRole("button", { name: "That’s it" }));

    expect(await screen.findByText("Couldn't save that. Try again.")).toBeVisible();
    expect(screen.getByRole("button", { name: "That’s it" })).toBeVisible();
  });

  it("says nothing at rest — no empty line reserved for it", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const { container } = await renderWithRouter(attach());
    await screen.findByRole("button", { name: "Choose your kit" });
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("clears the last failure when the runner tries again", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ entryId: string }>();
    const attachKit = vi
      .fn<() => Promise<{ entryId: string }>>()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(
      attach({ prefillFor: () => Promise.resolve(candidate()), attachKit }),
    );
    const button = await screen.findByRole("button", { name: "That’s it" });

    await user.click(button);
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeVisible();

    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByText("Couldn't save that. Try again.")).toBeNull();
    });
    pending.resolve({ entryId: "01NEW" });
  });
});
