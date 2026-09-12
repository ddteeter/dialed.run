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
import { describe, expect, it, vi } from "vitest";

import { EntryDetail } from "../../src/modules/feed/components/EntryDetail";
import type { entryDetailForViewer } from "../../src/modules/feed/entries";
import { pointConditions } from "../feed/conditions-fixture";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
 * Screen D. Eight of its blocks are conditional on the entry having that
 * thing, and an entry with none of them is perfectly ordinary — so every
 * one of those forks is a state a real user reaches.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const feedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed",
    component: () => <p>The feed</p>,
  });
  const verdictRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/verdict/$entryId",
    component: () => <p>Verdict</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, feedRoute, verdictRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "01ENTRY",
    userId: "01USER",
    authorDisplayName: undefined,
    runId: "01RUN",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: 1_755_000_000,
    indoor: false,
    verdict: undefined,
    isPublic: true,
    caption: undefined,
    createdAt: 1_755_000_000,
    items: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    conditions: undefined,
    viewerHasReacted: false,
    ...overrides,
  };
}

/**
The heading and the badge share a row; the badge is the only other thing
in it.
*/
function badgeRow(): string {
  return (
    screen.getByRole("heading", { name: "Evening run" }).parentElement
      ?.textContent ?? ""
  );
}

const nothing = () => Promise.resolve();
const noReaction = () => Promise.resolve({ useful: true });

function detail(overrides: Partial<Entry> = {}, shouldPrompt = false) {
  return (
    <EntryDetail units={{ temp: "f", distance: "mi" }}
      entry={entry(overrides)}
      entryId="01ENTRY"
      shouldPromptVerdict={shouldPrompt}
      recordPrompted={nothing}
      toggleUseful={noReaction}
    />
  );
}

describe("EntryDetail: the run itself", () => {
  it("names the run and renders the measured values in mono", async () => {
    await renderWithRouter(detail());

    expect(screen.getByRole("heading", { name: "Evening run" })).toBeVisible();
    // 8047 m is 5.0 mi and 1830 s is 30:30.
    const measured = screen.getByText(/5\.0mi/);
    expect(measured).toHaveTextContent("5.0mi · 30:30");
    expect(measured).toHaveClass("font-mono");
  });

  it("falls back to A runner when the author has no display name", async () => {
    await renderWithRouter(detail());
    expect(screen.getByText("A runner")).toBeVisible();
  });

  it("names the author when there is one", async () => {
    await renderWithRouter(detail({ authorDisplayName: "Drew" }));
    expect(screen.getByText("Drew")).toBeVisible();
  });
});

describe("EntryDetail: the verdict badge", () => {
  it("is absent on an entry with no verdict", async () => {
    await renderWithRouter(detail());
    expect(badgeRow()).toBe("Evening run");
  });

  it("reads the verdict through the shared scale", async () => {
    // The words come from `verdictScale` in lib/contracts, so this cannot
    // drift from the picker that wrote them.
    await renderWithRouter(detail({ verdict: -2 }));
    expect(badgeRow()).toMatch(/^Evening run\[.+\]$/);
    expect(badgeRow()).not.toBe("Evening run[Dialed]");
  });

  it("still says something for a verdict outside the scale", async () => {
    // Defensive: the column is an integer, so a value the scale does not
    // know is possible in corrupt data, and an empty badge is worse than
    // a wrong one.
    await renderWithRouter(detail({ verdict: 7 }));
    expect(badgeRow()).toBe("Evening run[Dialed]");
  });

  it("treats a dialed verdict as a verdict, not as nothing", async () => {
    // 0 means dialed. A truthiness check here would hide the badge on
    // exactly the runs that got it right.
    await renderWithRouter(detail({ verdict: 0 }));
    expect(screen.getByText("[Dialed]")).toBeVisible();
  });
});

describe("EntryDetail: conditions", () => {
  it("shows the temperature and the condition when there are any", async () => {
    await renderWithRouter(
      detail({
        conditions: pointConditions({ tempC: 10, feelsLikeC: 8, condition: "Clear" }),
      }),
    );
    expect(screen.getByText(/Clear/)).toBeVisible();
  });

  it("renders the temperature in Fahrenheit, with the condition beside it", async () => {
    // The unit is display-only (D-6 makes it a preference later); the
    // space between the two is a deliberate `{" "}`, because JSX drops
    // whitespace between expressions.
    await renderWithRouter(
      detail({
        conditions: pointConditions({ tempC: 10, feelsLikeC: 8, condition: "Clear" }),
      }),
    );
    expect(screen.getByText(/Clear/)).toHaveTextContent("50° Clear");
  });

  it("shows the range when the run spanned more than one hour", async () => {
    // D-5: a 2->14 run is not a 2 degree run. The reader sees what the run
    // covered, whatever it is banded at.
    await renderWithRouter(
      detail({
        conditions: {
          ...pointConditions({ tempC: 2, feelsLikeC: 2, condition: "Clear" }),
          span: { minTempC: 2, maxTempC: 14, minFeelsLikeC: 2, maxFeelsLikeC: 14 },
        },
      }),
    );
    expect(screen.getByText(/Clear/)).toHaveTextContent("36–57° Clear");
  });

  it("says nothing at all on an entry with none", async () => {
    // An indoor run has no conditions, and an empty weather line reads as
    // a failure to fetch rather than as a treadmill.
    await renderWithRouter(detail());
    expect(screen.queryByText(/°/)).toBeNull();
  });
});

describe("EntryDetail: the optional blocks", () => {
  it("omits photos, caption, kit and tags on a bare entry", async () => {
    // Not merely empty — absent. Each of these is a flex child, so an
    // empty one still costs a row's worth of gap.
    const { container } = await renderWithRouter(detail());

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Kit" })).toBeNull();
    expect(container.querySelectorAll("ul")).toHaveLength(0);
    // One paragraph — the author line. No caption, no tag row.
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelectorAll(".grid")).toHaveLength(0);
    expect(container.querySelectorAll(".flex-wrap")).toHaveLength(0);
  });

  it("renders one image per photo key, pointing at the cached route", async () => {
    const { container } = await renderWithRouter(
      detail({ photoKeys: ["entries/01USER/01ENTRY/a", "entries/01USER/01ENTRY/b"] }),
    );

    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute(
      "src",
      "/feed/photo/entries/01USER/01ENTRY/a",
    );
    // Decorative: the entry's own text is the description.
    expect(images[0]).toHaveAttribute("alt", "");
  });

  it("shows the caption when there is one", async () => {
    await renderWithRouter(detail({ caption: "Perfect morning" }));
    expect(screen.getByText("Perfect morning")).toBeVisible();
  });

  it("lists the kit, with the brand where there is one", async () => {
    await renderWithRouter(
      detail({
        items: [
          {
            itemId: "01A",
            name: "Houdini",
            brand: "Patagonia",
            category: "top",
            layer: undefined,
            flag: undefined,
            note: undefined,
          },
          {
            itemId: "01B",
            name: "Long sleeve top",
            brand: undefined,
            category: "top",
            layer: undefined,
            flag: undefined,
            note: undefined,
          },
        ],
      }),
    );

    expect(screen.getByRole("heading", { name: "Kit" })).toBeVisible();
    expect(screen.getByText("Patagonia Houdini")).toBeVisible();
    // No stray leading space where a brand would have gone.
    expect(screen.getByText("Long sleeve top")).toBeVisible();
  });

  it("shows a per-item flag in words rather than in schema case", async () => {
    // `too_much` is the stored value; a reader should hear "too much".
    await renderWithRouter(
      detail({
        items: [
          {
            itemId: "01A",
            name: "Houdini",
            brand: undefined,
            category: "top",
            layer: undefined,
            flag: "too_much",
            note: undefined,
          },
        ],
      }),
    );
    expect(screen.getByText("[too much]")).toBeVisible();
  });

  it("shows tags the same way", async () => {
    const { container } = await renderWithRouter(
      detail({ tags: ["wind_chill", "rain"] }),
    );
    expect(screen.getByText("[wind chill]")).toBeVisible();
    expect(screen.getByText("[rain]")).toBeVisible();
    expect(container.querySelectorAll(".flex-wrap")).toHaveLength(1);
  });
});

describe("EntryDetail: the useful reaction", () => {
  it("shows the count it was given", async () => {
    await renderWithRouter(detail({ usefulCount: 4 }));
    expect(screen.getByRole("button", { name: /Useful/ })).toHaveTextContent(
      "[4]",
    );
  });

  it("counts up when the viewer marks it useful", async () => {
    const user = userEvent.setup();
    const toggleUseful = vi.fn(() => Promise.resolve({ useful: true }));
    await renderWithRouter(
      <EntryDetail units={{ temp: "f", distance: "mi" }}
        entry={entry({ usefulCount: 4, viewerHasReacted: false })}
        entryId="01ENTRY"
        shouldPromptVerdict={false}
        recordPrompted={nothing}
        toggleUseful={toggleUseful}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Useful/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Useful/ })).toHaveTextContent(
        "[5]",
      );
    });
    expect(toggleUseful).toHaveBeenCalledWith({ data: { entryId: "01ENTRY" } });
  });

  it("counts down when they take it back", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <EntryDetail units={{ temp: "f", distance: "mi" }}
        entry={entry({ usefulCount: 4, viewerHasReacted: true })}
        entryId="01ENTRY"
        shouldPromptVerdict={false}
        recordPrompted={nothing}
        toggleUseful={() => Promise.resolve({ useful: false })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Useful/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Useful/ })).toHaveTextContent(
        "[3]",
      );
    });
  });

  it("marks the button when the viewer has already reacted", async () => {
    await renderWithRouter(detail({ viewerHasReacted: true }));
    const button = screen.getByRole("button", { name: /Useful/ });
    expect(button).toHaveClass("bg-teal");
    expect(button).not.toHaveClass("border");
  });

  it("leaves it an outline when they have not", async () => {
    await renderWithRouter(detail({ viewerHasReacted: false }));
    const button = screen.getByRole("button", { name: /Useful/ });
    expect(button).toHaveClass("border");
    expect(button).not.toHaveClass("bg-teal");
  });

  it("locks the button while it works", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ useful: boolean }>();
    await renderWithRouter(
      <EntryDetail units={{ temp: "f", distance: "mi" }}
        entry={entry()}
        entryId="01ENTRY"
        shouldPromptVerdict={false}
        recordPrompted={nothing}
        toggleUseful={() => pending.promise}
      />,
    );
    const button = screen.getByRole("button", { name: /Useful/ });

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    pending.resolve({ useful: true });
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});

describe("EntryDetail: the verdict prompt", () => {
  it("is absent when the entry is not owed one", async () => {
    await renderWithRouter(detail());
    expect(screen.queryByText(/didn’t log a verdict/)).toBeNull();
  });

  it("offers the prompt, and spends the once-only budget by showing it", async () => {
    // Packet A3: the prompt *showing* — not the user acting on it — is
    // what spends the budget, so the record happens on mount.
    const recordPrompted = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <EntryDetail units={{ temp: "f", distance: "mi" }}
        entry={entry()}
        entryId="01ENTRY"
        shouldPromptVerdict
        recordPrompted={recordPrompted}
        toggleUseful={noReaction}
      />,
    );

    expect(screen.getByRole("link", { name: /didn’t log a verdict/ })).toHaveAttribute(
      "href",
      "/feed/verdict/01ENTRY",
    );
    await waitFor(() => {
      expect(recordPrompted).toHaveBeenCalledWith({
        data: { entryId: "01ENTRY" },
      });
    });
  });

  it("spends the budget once, not on every render", async () => {
    // The effect's dependencies are what stop a re-render spending it
    // again — the budget is one prompt, not one per paint.
    const user = userEvent.setup();
    const recordPrompted = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <EntryDetail units={{ temp: "f", distance: "mi" }}
        entry={entry()}
        entryId="01ENTRY"
        shouldPromptVerdict
        recordPrompted={recordPrompted}
        toggleUseful={noReaction}
      />,
    );
    await waitFor(() => {
      expect(recordPrompted).toHaveBeenCalledTimes(1);
    });

    // A re-render with nothing relevant changed.
    await user.click(screen.getByRole("button", { name: /Useful/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Useful/ })).toHaveTextContent(
        "[1]",
      );
    });

    expect(recordPrompted).toHaveBeenCalledTimes(1);
  });

  it("spends the budget when the prompt appears later", async () => {
    // The dependency list is what makes that work: with a constant one the
    // effect would fire on mount and never again, so an entry whose
    // prompt arrives after the first paint would never record it.
    const user = userEvent.setup();
    const recordPrompted = vi.fn(() => Promise.resolve());

    function LatePrompt() {
      const [prompt, setPrompt] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setPrompt(true);
            }}
          >
            The prompt arrives
          </button>
          <EntryDetail units={{ temp: "f", distance: "mi" }}
            entry={entry()}
            entryId="01ENTRY"
            shouldPromptVerdict={prompt}
            recordPrompted={recordPrompted}
            toggleUseful={noReaction}
          />
        </>
      );
    }

    await renderWithRouter(<LatePrompt />);
    expect(recordPrompted).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "The prompt arrives" }),
    );

    await waitFor(() => {
      expect(recordPrompted).toHaveBeenCalledTimes(1);
    });
  });

  it("spends nothing when there is no prompt to show", async () => {
    const recordPrompted = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <EntryDetail units={{ temp: "f", distance: "mi" }}
        entry={entry()}
        entryId="01ENTRY"
        shouldPromptVerdict={false}
        recordPrompted={recordPrompted}
        toggleUseful={noReaction}
      />,
    );
    expect(recordPrompted).not.toHaveBeenCalled();
  });

  it("offers a way back to the feed", async () => {
    await renderWithRouter(detail());
    expect(screen.getByRole("link", { name: "Back to feed" })).toHaveAttribute(
      "href",
      "/feed",
    );
  });
});
