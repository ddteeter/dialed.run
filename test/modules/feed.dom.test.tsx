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
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Feed } from "../../src/modules/feed/components/Feed";
import type { ConsensusResult } from "../../src/modules/feed/consensus";
import type { FeedItem } from "../../src/modules/feed/feed";
import { pointConditions } from "../feed/conditions-fixture";

/**
 * The feed's two tabs (E1 and E2-lite).
 *
 * "Your conditions" is loaded on demand and needs the browser's location,
 * which is stubbed here rather than driven — its three states (waiting,
 * no location, an answer) are the whole of that tab.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const entryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/entry/$entryId",
    component: () => <p>An entry</p>,
  });
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/search",
    component: () => <p>Search</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, entryRoute, searchRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    entryId: "01ENTRY",
    userId: "01USER",
    authorDisplayName: undefined,
    runId: "01RUN",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: 1_755_000_000,
    verdict: undefined,
    caption: undefined,
    createdAt: 1_755_000_000,
    itemNames: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    conditions: undefined,
    ...overrides,
  };
}

/**
Geolocation is a browser capability, not something a test can grant.
*/
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

const noConditions = () => Promise.resolve(undefined);

describe("Feed: the queue", () => {
  it("offers to clear the queue once there are two runs waiting", async () => {
    // DS2's entry point — "reached from 'Clear the queue ›' on X". The
    // count is in the link because a number is what makes it worth the
    // trip; the link itself is what the contract names.
    await renderWithRouter(
      <Feed
        unjudgedCount={4}
        items={[]}
        units={{ temp: "f", distance: "mi" }}
        conditionsFor={() => Promise.resolve(undefined)}
      />,
    );

    const link = screen.getByRole("link", { name: /Clear the queue/ });
    expect(link).toHaveAttribute("href", "/runs/backlog");
    expect(link.textContent).toContain("4");
  });

  it("says nothing when one run is waiting, because one is a sheet", async () => {
    // "Only reachable when ≥2 runs lack a verdict; with one, the S1 prompt
    // opens A3 in the panel like the phone." A table of one row is a table
    // pretending to be a sheet.
    await renderWithRouter(
      <Feed
        unjudgedCount={1}
        items={[]}
        units={{ temp: "f", distance: "mi" }}
        conditionsFor={() => Promise.resolve(undefined)}
      />,
    );

    expect(screen.queryByRole("link", { name: /Clear the queue/ })).toBeNull();
  });
});

describe("Feed: the following tab", () => {
  it("opens on Following, and offers a way to find runners", async () => {
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[feedItem()]}
        conditionsFor={noConditions}
      />,
    );

    expect(screen.getByRole("heading", { name: "Feed" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Find runners" })).toHaveAttribute(
      "href",
      "/feed/search",
    );
    expect(screen.getByRole("button", { name: "Following" })).toHaveClass(
      "border-cold-text",
    );
  });

  it("sends someone with an empty feed to look for runners", async () => {
    // An empty feed is a new account, not a broken one — the way out is
    // the whole content of the state.
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={noConditions}
      />,
    );

    expect(screen.getByText("Nobody you follow has posted yet.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Search for runners to follow" }),
    ).toHaveAttribute("href", "/feed/search");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders one card per entry, linked to it", async () => {
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[
          feedItem({ entryId: "01A", authorDisplayName: "Drew" }),
          feedItem({ entryId: "01B" }),
        ]}
        conditionsFor={noConditions}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("link")[1]).toHaveAttribute(
      "href",
      "/feed/entry/01A",
    );
    expect(screen.getByText("Drew")).toBeVisible();
    // And a fallback for a runner with no display name.
    expect(screen.getByText("A runner")).toBeVisible();
  });

  it("shows the distance, the useful count, and a caption where there is one", async () => {
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[feedItem({ caption: "Perfect morning", usefulCount: 3 })]}
        conditionsFor={noConditions}
      />,
    );

    expect(screen.getByText("5.0mi")).toBeVisible();
    expect(screen.getByText("useful [3]")).toBeVisible();
    expect(screen.getByText("Perfect morning")).toBeVisible();
  });

  it("omits the caption line entirely when there is none", async () => {
    const { container } = await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[feedItem()]}
        conditionsFor={noConditions}
      />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("shows the temperature on an entry that has conditions", async () => {
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[
          feedItem({
            conditions: pointConditions({
              tempC: 10,
              feelsLikeC: 8,
              condition: "Clear",
            }),
          }),
        ]}
        conditionsFor={noConditions}
      />,
    );
    expect(screen.getByText("50°")).toBeVisible();
  });
});

const result: ConsensusResult = {
  total: 4,
  groups: { tops: 3, shoes: 1 },
  widened: false,
};

async function openConditions() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Your conditions" }));
}

describe("Feed: your conditions", () => {
  it("asks for location only once the tab is opened", async () => {
    // Prompting every visitor for a permission most never use is the
    // reason this is not in the route's loader.
    withLocation({ latitude: 44.98, longitude: -93.27 });
    const conditionsFor = vi.fn(() => Promise.resolve(result));
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={conditionsFor}
      />,
    );

    expect(conditionsFor).not.toHaveBeenCalled();

    await openConditions();

    await waitFor(() => {
      expect(conditionsFor).toHaveBeenCalledWith({
        data: { lat: 44.98, lng: -93.27 },
      });
    });
  });

  it("counts the runners, and each group against that total", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={() => Promise.resolve(result)}
      />,
    );

    await openConditions();

    expect(await screen.findByText("[4 runners logged]")).toBeVisible();
    expect(screen.getByText("3/4")).toBeVisible();
    expect(screen.getByText("1/4")).toBeVisible();
    // Only the groups anyone logged.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says runner, singular, for one", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={() =>
          Promise.resolve({ total: 1, groups: { tops: 1 }, widened: false })
        }
      />,
    );

    await openConditions();

    expect(await screen.findByText("[1 runner logged]")).toBeVisible();
  });

  it("says so when the window had to be widened", async () => {
    // The ±3°C / 72h window being empty is worth admitting: the answer is
    // about neighbouring conditions, not these ones.
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={() =>
          Promise.resolve({ total: 2, groups: { tops: 2 }, widened: true })
        }
      />,
    );

    await openConditions();

    expect(
      await screen.findByText("[2 runners logged (widened window)]"),
    ).toBeVisible();
  });

  it("says nobody has logged these conditions when the answer is empty", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={() =>
          Promise.resolve({ total: 0, groups: {}, widened: false })
        }
      />,
    );

    await openConditions();

    expect(await screen.findByText(/You’ll be the first/)).toBeVisible();
  });

  it("asks for location when the browser refuses to give it", async () => {
    withLocation();
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={noConditions}
      />,
    );

    await openConditions();

    expect(
      await screen.findByText(/Enable location to see what other runners/),
    ).toBeVisible();
  });

  it("says the same on a browser with no geolocation at all", async () => {
    withoutGeolocation();
    const conditionsFor = vi.fn(noConditions);
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={conditionsFor}
      />,
    );

    await openConditions();

    expect(
      await screen.findByText(/Enable location to see what other runners/),
    ).toBeVisible();
    expect(conditionsFor).not.toHaveBeenCalled();
  });

  it("says the same when the server has no consensus to give", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={noConditions}
      />,
    );

    await openConditions();

    expect(
      await screen.findByText(/Enable location to see what other runners/),
    ).toBeVisible();
  });

  it("shows a skeleton while it waits, never a spinner", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const pending = Promise.withResolvers<ConsensusResult | undefined>();
    const { container } = await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={() => pending.promise}
      />,
    );

    await openConditions();

    expect(container.querySelectorAll(".breathe").length).toBeGreaterThan(0);
    pending.resolve(result);
  });

  it("marks the open tab and dims the other", async () => {
    // Which tab you are on is carried by weight and a pink underline, not
    // by hue alone.
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[]}
        conditionsFor={noConditions}
      />,
    );

    const following = screen.getByRole("button", { name: "Following" });
    const conditions = screen.getByRole("button", { name: "Your conditions" });
    expect(following).toHaveClass("border-cold-text");
    expect(following).toHaveAttribute("aria-current", "page");
    // `--label` (#6E6E64, 4.64:1), not `--muted` (3.90:1): an inactive
    // tab label is a control's only label, which T1's round-13 row bans
    // --muted from being on paper.
    expect(conditions).toHaveClass("text-label");
    expect(conditions).not.toHaveAttribute("aria-current");
    // Both sides carry the 90ms colour flip (design/motion.js, "Tab
    // switch"): it is the half of the move that survives reduced motion,
    // so it cannot live only on the tab that happens to be active.
    expect(following).toHaveClass("tab-label");
    expect(conditions).toHaveClass("tab-label");

    await user.click(conditions);

    expect(screen.getByRole("button", { name: "Your conditions" })).toHaveClass(
      "border-cold-text",
    );
    expect(
      screen.getByRole("button", { name: "Your conditions" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Following" })).toHaveClass(
      "text-label",
    );
    expect(
      screen.getByRole("button", { name: "Following" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("presses a feed row to ink", async () => {
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[feedItem()]}
        conditionsFor={noConditions}
      />,
    );

    const row = screen.getByRole("link", { name: /A runner/ }).closest("li");
    expect(row).toHaveClass("row-press");
    expect(row?.className).not.toContain("scale");
  });

  it("asks again when the query changes underneath it", async () => {
    // The effect depends on `conditionsFor`; with a constant dependency
    // list a route that swapped the query would keep the first answer
    // forever.
    const user = userEvent.setup();
    withLocation({ latitude: 1, longitude: 2 });
    const second = vi.fn(() =>
      Promise.resolve({ total: 9, groups: { tops: 9 }, widened: false }),
    );

    function SwappingFeed() {
      const [query, setQuery] = useState(() => () => Promise.resolve(result));
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setQuery(() => second);
            }}
          >
            Swap the query
          </button>
          <Feed
            unjudgedCount={0}
            units={{ temp: "f", distance: "mi" }}
            items={[]}
            conditionsFor={query}
          />
        </>
      );
    }

    await renderWithRouter(<SwappingFeed />);
    await openConditions();
    await screen.findByText("[4 runners logged]");

    await user.click(screen.getByRole("button", { name: "Swap the query" }));

    expect(await screen.findByText("[9 runners logged]")).toBeVisible();
  });

  it("goes back to Following when asked", async () => {
    withLocation({ latitude: 1, longitude: 2 });
    const user = userEvent.setup();
    await renderWithRouter(
      <Feed
        unjudgedCount={0}
        units={{ temp: "f", distance: "mi" }}
        items={[feedItem()]}
        conditionsFor={() => Promise.resolve(result)}
      />,
    );

    await openConditions();
    await screen.findByText("[4 runners logged]");

    await user.click(screen.getByRole("button", { name: "Following" }));

    expect(screen.getByRole("listitem")).toBeVisible();
    expect(screen.queryByText("[4 runners logged]")).toBeNull();
  });
});
