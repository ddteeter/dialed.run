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
import { z } from "zod";

import { OtherProfile } from "../../src/modules/feed/components/OtherProfile";
import { OwnProfile } from "../../src/modules/feed/components/OwnProfile";
import { RunnerSearch } from "../../src/modules/feed/components/RunnerSearch";
import type {
  OtherProfile as OtherProfileData,
  OwnProfile as OwnProfileData,
} from "../../src/modules/feed/profiles";

/**
 * The three social screens (G, H and find-a-runner). Every section on a
 * profile is conditional on having something to show, and none of those
 * forks could be reached while they were markup in a route.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

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
  const userRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/u/$userId",
    component: () => <p>A runner</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, entryRoute, userRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function ownProfile(overrides: Partial<OwnProfileData> = {}): OwnProfileData {
  return {
    userId: "01USER",
    displayName: undefined,
    cityLabel: undefined,
    thermalLevel: undefined,
    followerCount: 0,
    followingCount: 0,
    entryCount: 0,
    coverage: [],
    mostWornItems: [],
    recentEntries: [],
    ...overrides,
  };
}

describe("OwnProfile: who you are", () => {
  it("falls back to You when there is no display name", async () => {
    await renderWithRouter(<OwnProfile profile={ownProfile()} />);
    expect(screen.getByRole("heading", { name: "You" })).toBeVisible();
  });

  it("uses the display name when there is one", async () => {
    await renderWithRouter(
      <OwnProfile profile={ownProfile({ displayName: "Drew" })} />,
    );
    expect(screen.getByRole("heading", { name: "Drew" })).toBeVisible();
  });

  it("omits the city line entirely when there is no city", async () => {
    // Not an empty paragraph: a blank line under the name reads as a
    // rendering bug.
    const { container } = await renderWithRouter(
      <OwnProfile profile={ownProfile()} />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("shows the city when there is one", async () => {
    await renderWithRouter(
      <OwnProfile profile={ownProfile({ cityLabel: "Minneapolis" })} />,
    );
    expect(screen.getByText("Minneapolis")).toBeVisible();
  });

  it.each([
    [-2, "Runs hot — sweating in a t-shirt at 40°"],
    [-1, "Runs warm"],
    [0, "Runs average"],
    [1, "Runs cold"],
    [2, "Runs cold — always freezing"],
  ])("reads thermal level %s as %s", async (level, blurb) => {
    // 0 is a real level — "runs average" — not the absence of one, so the
    // check has to be `=== undefined` rather than truthiness.
    await renderWithRouter(
      <OwnProfile profile={ownProfile({ thermalLevel: level })} />,
    );
    expect(screen.getByText(blurb)).toBeVisible();
  });

  it("says nothing about a level it does not recognise", async () => {
    await renderWithRouter(
      <OwnProfile profile={ownProfile({ thermalLevel: 7 })} />,
    );
    expect(screen.getByText("Runs average")).toBeVisible();
  });

  it("shows all three counts", async () => {
    await renderWithRouter(
      <OwnProfile
        profile={ownProfile({
          followerCount: 12,
          followingCount: 34,
          entryCount: 56,
        })}
      />,
    );
    expect(screen.getByText("12 followers")).toBeVisible();
    expect(screen.getByText("34 following")).toBeVisible();
    expect(screen.getByText("56 entries")).toBeVisible();
  });
});

describe("OwnProfile: the sections that only appear when there is something in them", () => {
  it("omits every one on a new account", async () => {
    // A profile listing "Most worn" over nothing reads as a broken app
    // rather than as a new account.
    await renderWithRouter(<OwnProfile profile={ownProfile()} />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("draws the coverage bands as dots by verdict", async () => {
    await renderWithRouter(
      <OwnProfile
        profile={ownProfile({
          coverage: [
            { bandFloorC: 0, label: "0–5°", cold: 2, dialed: 3, warm: 1 },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Temperature coverage" }),
    ).toBeVisible();
    expect(screen.getByText("[0–5°]")).toBeVisible();
    expect(screen.getByText("●●")).toHaveClass("text-pink");
    expect(screen.getByText("●●●")).toHaveClass("text-teal");
    expect(screen.getByText("●")).toHaveClass("text-night/30");
  });

  it("lists most-worn items with their counts", async () => {
    await renderWithRouter(
      <OwnProfile
        profile={ownProfile({
          mostWornItems: [{ itemId: "01A", name: "Houdini", wearCount: 9 }],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Most worn" })).toBeVisible();
    expect(screen.getByText("Houdini")).toBeVisible();
    expect(screen.getByText("[9]")).toBeVisible();
  });

  it("links recent entries, and says which have no verdict yet", async () => {
    await renderWithRouter(
      <OwnProfile
        profile={ownProfile({
          recentEntries: [
            { entryId: "01A", createdAt: 1, verdict: NOTHING },
            { entryId: "01B", createdAt: 2, verdict: 0 },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("link", { name: "No verdict yet" }),
    ).toHaveAttribute("href", "/feed/entry/01A");
    expect(screen.getByRole("link", { name: "Entry" })).toHaveAttribute(
      "href",
      "/feed/entry/01B",
    );
  });
});

function otherProfile(
  overrides: Partial<OtherProfileData> = {},
): OtherProfileData {
  return {
    userId: "01THEM",
    displayName: NOTHING,
    cityLabel: NOTHING,
    recentPublicEntries: [],
    ...overrides,
  };
}

const nothing = () => Promise.resolve();

describe("OtherProfile", () => {
  it("falls back to A runner, and omits an absent city", async () => {
    const { container } = await renderWithRouter(
      <OtherProfile
        profile={otherProfile()}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );
    expect(screen.getByRole("heading", { name: "A runner" })).toBeVisible();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("shows a city when there is one", async () => {
    const { container } = await renderWithRouter(
      <OtherProfile
        profile={otherProfile({ cityLabel: "Minneapolis" })}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );
    expect(screen.getByText("Minneapolis")).toBeVisible();
    // The city and the empty-entries line, and nothing else.
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("marks Follow as the primary action", () => {
    // The night fill is the primary CTA in this palette.
    render(
      <OtherProfile
        profile={otherProfile()}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );
    expect(screen.getByRole("button", { name: "Follow" })).toHaveClass(
      "bg-night",
    );
  });

  it("drops Following to an outline, because following again is not the thing to do next", () => {
    render(
      <OtherProfile
        profile={otherProfile()}
        isFollowing
        follow={nothing}
        unfollow={nothing}
      />,
    );
    const following = screen.getByRole("button", { name: "Following" });
    expect(following).toHaveClass("border");
    expect(following).not.toHaveClass("bg-night");
  });

  it("dates each entry from its epoch-second timestamp", async () => {
    // Stored in seconds, rendered from milliseconds — the factor of a
    // thousand puts a 2026 run in 1970.
    await renderWithRouter(
      <OtherProfile
        profile={otherProfile({
          recentPublicEntries: [
            {
              entryId: "01A",
              createdAt: 1_755_000_000,
              verdict: NOTHING,
              caption: NOTHING,
            },
          ],
        })}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );

    expect(
      screen.getByText(new Date(1_755_000_000 * 1000).toLocaleDateString()),
    ).toBeVisible();
  });

  it("omits an absent caption rather than rendering an empty line", async () => {
    const { container } = await renderWithRouter(
      <OtherProfile
        profile={otherProfile({
          recentPublicEntries: [
            {
              entryId: "01A",
              createdAt: 1,
              verdict: NOTHING,
              caption: NOTHING,
            },
          ],
        })}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("says there are no public entries yet, rather than showing an empty list", async () => {
    await renderWithRouter(
      <OtherProfile
        profile={otherProfile()}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );
    expect(screen.getByText("No public entries yet.")).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists the public entries it was given, captions and all", async () => {
    await renderWithRouter(
      <OtherProfile
        profile={otherProfile({
          recentPublicEntries: [
            {
              entryId: "01A",
              createdAt: 1_755_000_000,
              verdict: 0,
              caption: "Perfect morning",
            },
            { entryId: "01B", createdAt: 1_755_000_001, verdict: NOTHING, caption: NOTHING },
          ],
        })}
        isFollowing={false}
        follow={nothing}
        unfollow={nothing}
      />,
    );

    expect(screen.getByText("Perfect morning")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("link")[0]).toHaveAttribute(
      "href",
      "/feed/entry/01A",
    );
  });

  it("follows, and flips the label", async () => {
    const user = userEvent.setup();
    const follow = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <OtherProfile
        profile={otherProfile()}
        isFollowing={false}
        follow={follow}
        unfollow={nothing}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() => {
      expect(follow).toHaveBeenCalledWith({ data: { userId: "01THEM" } });
    });
    expect(screen.getByRole("button", { name: "Following" })).toBeVisible();
  });

  it("unfollows, and flips back", async () => {
    // The pair is per-direction: crossing the two would leave the label
    // telling the opposite of the truth.
    const user = userEvent.setup();
    const unfollow = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <OtherProfile
        profile={otherProfile()}
        isFollowing
        follow={nothing}
        unfollow={unfollow}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Following" }));

    await waitFor(() => {
      expect(unfollow).toHaveBeenCalledWith({ data: { userId: "01THEM" } });
    });
    expect(screen.getByRole("button", { name: "Follow" })).toBeVisible();
  });

  it("locks the button while it works", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderWithRouter(
      <OtherProfile
        profile={otherProfile()}
        isFollowing={false}
        follow={() => pending.promise}
        unfollow={nothing}
      />,
    );
    const button = screen.getByRole("button", { name: "Follow" });

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});

describe("RunnerSearch", () => {
  it("says nothing at rest — not that there are no runners", async () => {
    // The empty state is not the resting state: an empty box would accuse
    // the user of having no friends before they typed.
    await renderWithRouter(
      <RunnerSearch search={() => Promise.resolve([])} />,
    );
    expect(screen.queryByText("No runners found.")).toBeNull();
  });

  it("starts with nothing listed at all", async () => {
    const { container } = await renderWithRouter(
      <RunnerSearch search={() => Promise.resolve([])} />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("keeps quiet while a search is still running", async () => {
    // `searched` flips only once an answer is back: showing "no runners
    // found" against an in-flight query is a wrong answer, briefly.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ userId: string; displayName: string }[]>();
    await renderWithRouter(<RunnerSearch search={() => pending.promise} />);

    await user.type(screen.getByLabelText("Search by name"), "d");
    expect(screen.queryByText("No runners found.")).toBeNull();

    pending.resolve([]);
    expect(await screen.findByText("No runners found.")).toBeVisible();
  });

  it("searches on what is typed, trimmed", async () => {
    const user = userEvent.setup();
    const search = vi.fn(() => Promise.resolve([]));
    await renderWithRouter(<RunnerSearch search={search} />);

    await user.type(screen.getByLabelText("Search by name"), "  dre  ");

    await waitFor(() => {
      expect(search).toHaveBeenLastCalledWith({ data: { prefix: "dre" } });
    });
  });

  it("links each result to their profile", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <RunnerSearch
        search={() =>
          Promise.resolve([{ userId: "01THEM", displayName: "Drew" }])
        }
      />,
    );

    await user.type(screen.getByLabelText("Search by name"), "d");

    const link = await screen.findByRole("link", { name: "Drew" });
    expect(link).toHaveAttribute("href", "/feed/u/01THEM");
    // And no "no runners found" beside the runner it just found.
    expect(screen.queryByText("No runners found.")).toBeNull();
  });

  it("says no runners found once a search has actually happened", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <RunnerSearch search={() => Promise.resolve([])} />,
    );

    await user.type(screen.getByLabelText("Search by name"), "zzz");

    expect(await screen.findByText("No runners found.")).toBeVisible();
  });

  it("goes quiet again when the box is cleared", async () => {
    // Clearing is not a search for nothing — it is the resting state
    // returning, so the results and the empty message both go.
    const user = userEvent.setup();
    const search = vi.fn(() =>
      Promise.resolve([{ userId: "01THEM", displayName: "Drew" }]),
    );
    await renderWithRouter(<RunnerSearch search={search} />);
    const box = screen.getByLabelText("Search by name");

    await user.type(box, "d");
    await screen.findByRole("link", { name: "Drew" });

    await user.clear(box);

    await waitFor(() => {
      expect(screen.queryByRole("link")).toBeNull();
    });
    expect(screen.queryByText("No runners found.")).toBeNull();
    // And an empty box costs no query.
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("treats whitespace as empty", async () => {
    const user = userEvent.setup();
    const search = vi.fn(() => Promise.resolve([]));
    await renderWithRouter(<RunnerSearch search={search} />);

    await user.type(screen.getByLabelText("Search by name"), " ".repeat(3));

    expect(search).not.toHaveBeenCalled();
  });
});
