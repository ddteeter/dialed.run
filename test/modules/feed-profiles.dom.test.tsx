import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Avatar, initialOf } from "../../src/modules/feed/components/Avatar";
import { OtherProfile } from "../../src/modules/feed/components/OtherProfile";
import { OwnProfile } from "../../src/modules/feed/components/OwnProfile";
import { RunnerSearch } from "../../src/modules/feed/components/RunnerSearch";
import type {
  OtherProfile as OtherProfileData,
  OwnProfile as OwnProfileData,
} from "../../src/modules/feed/profiles";
import type { SearchResult } from "../../src/modules/feed/search";
import { renderFeedScreen } from "./feed-fixtures";

/**
 * G, H and runner search, as round 22 draws them with only what v1
 * stores ("G New account", "H No public entries", item 15's ruling) —
 * and Follow on the control-failure pattern wherever it appears.
 */
const NOTHING = z.null().parse(JSON.parse("null"));
const done = () => Promise.resolve();

function ownProfile(overrides: Partial<OwnProfileData> = {}): OwnProfileData {
  return {
    userId: "01USER",
    displayName: "Dana Kim",
    cityLabel: undefined,
    thermalLevel: undefined,
    followerCount: 0,
    followingCount: 0,
    entryCount: 0,
    runCount: 0,
    coverage: [],
    mostWornItems: [],
    recentEntries: [],
    ...overrides,
  };
}

function otherProfile(
  overrides: Partial<OtherProfileData> = {},
): OtherProfileData {
  return {
    userId: "01RAVI",
    displayName: "Ravi K",
    cityLabel: NOTHING,
    recentPublicEntries: [],
    ...overrides,
  };
}

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-part="${CSS.escape(name)}"]`,
  );
}

function otherScreen(
  overrides: Partial<OtherProfileData> = {},
  options: {
    isFollowing?: boolean;
    follow?: () => Promise<unknown>;
    unfollow?: () => Promise<unknown>;
  } = {},
) {
  return (
    <OtherProfile
      profile={otherProfile(overrides)}
      isFollowing={options.isFollowing ?? false}
      follow={options.follow ?? done}
      unfollow={options.unfollow ?? done}
      reportAffordance={<button type="button">Report</button>}
    />
  );
}

function followScreen(options: {
  isFollowing?: boolean;
  follow?: () => Promise<unknown>;
  unfollow?: () => Promise<unknown>;
}) {
  return (
    <OtherProfile
      profile={otherProfile()}
      isFollowing={options.isFollowing ?? false}
      follow={options.follow ?? done}
      unfollow={options.unfollow ?? done}
    />
  );
}

function results(...names: string[]): SearchResult[] {
  return names.map((displayName, index) => ({
    userId: `01R${String(index)}`,
    displayName,
    following: index === 1,
  }));
}

function searchScreen(
  found: (prefix: string) => Promise<SearchResult[]> = () =>
    Promise.resolve([]),
) {
  return (
    <RunnerSearch
      search={({ data }) => found(data.prefix)}
      follow={done}
      unfollow={done}
    />
  );
}

describe("Avatar", () => {
  it("is the runner's initial, upper-cased, and decorative", async () => {
    expect(initialOf("dana")).toBe("D");
    const { container } = await renderFeedScreen(
      <Avatar name="dana" size="large" />,
    );
    const avatar = container.querySelector('[aria-hidden="true"]');
    expect(avatar).toHaveTextContent("D");
    expect(avatar).toHaveClass("size-14", "bg-hairline");
  });

  it("comes small for a row", async () => {
    const { container } = await renderFeedScreen(
      <Avatar name="dana" size="small" />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
      "size-9",
    );
  });
});

describe("OwnProfile (G): day one", () => {
  it("shows its counts at zero, never hidden", async () => {
    await renderFeedScreen(<OwnProfile profile={ownProfile()} />);

    expect(part("counts")).toHaveTextContent("0 Runs0 Following0 Followers");
  });

  it("offers one next step: [ NO RUNS YET ], a line, Log a run — and Settings", async () => {
    await renderFeedScreen(<OwnProfile profile={ownProfile()} />);

    expect(part("entries")).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("No runs yet")).toBeVisible();
    expect(
      screen.getByText(
        "Your runs land here once you log one. Shared runs are what other people see.",
      ),
    ).toBeVisible();
    const log = screen.getByRole("link", { name: "Log a run" });
    expect(log).toHaveAttribute("href", "/runs/new");
    expect(log).toHaveClass("bg-action");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/onboarding/settings",
    );
  });

  it("names the runner, or You, and shows a city only when O1 got one", async () => {
    await renderFeedScreen(
      <OwnProfile profile={ownProfile({ displayName: undefined })} />,
    );
    expect(screen.getByRole("heading", { name: "You" })).toBeVisible();
    expect(part("header")?.querySelectorAll(".font-mono")).toHaveLength(3);
  });

  it("shows the city in mono under the name", async () => {
    await renderFeedScreen(
      <OwnProfile profile={ownProfile({ cityLabel: "Portland" })} />,
    );
    expect(screen.getByText("Portland")).toHaveClass("font-mono");
  });
});

describe("OwnProfile (G): past day one", () => {
  const band = {
    bandFloorC: 5,
    label: "41–50°",
    cold: 1,
    dialed: 2,
    warm: 0,
  };

  it("drops the next step and shows the counts it has", async () => {
    await renderFeedScreen(
      <OwnProfile
        profile={ownProfile({
          runCount: 12,
          followingCount: 3,
          followerCount: 4,
        })}
      />,
    );

    expect(part("counts")).toHaveTextContent("12 Runs3 Following4 Followers");
    expect(screen.queryByText("No runs yet")).toBeNull();
    expect(screen.getByText("12")).toHaveClass("text-ink");
  });

  it("draws each section only once there is something in it", async () => {
    await renderFeedScreen(
      <OwnProfile profile={ownProfile({ runCount: 1 })} />,
    );
    expect(screen.queryByText("How you call it, by band")).toBeNull();
    expect(screen.queryByText("Most worn")).toBeNull();
    expect(screen.queryByText("Recent entries")).toBeNull();
  });

  it("names how each band was called", async () => {
    await renderFeedScreen(
      <OwnProfile profile={ownProfile({ runCount: 3, coverage: [band] })} />,
    );
    const row = screen.getByText("Dialed").closest("li");
    expect(row).toHaveTextContent("[41–50°]Dialed3 runs");
  });

  it("counts every run in a band, whichever way it went", async () => {
    await renderFeedScreen(
      <OwnProfile
        profile={ownProfile({
          runCount: 4,
          coverage: [{ ...band, cold: 1, dialed: 2, warm: 1 }],
        })}
      />,
    );
    expect(screen.getByText("Dialed").closest("li")).toHaveTextContent(
      "4 runs",
    );
  });

  it("names a band called cold as under-dressed and warm as over-dressed", async () => {
    await renderFeedScreen(
      <OwnProfile
        profile={ownProfile({
          runCount: 3,
          coverage: [
            { ...band, cold: 3, dialed: 0 },
            { ...band, bandFloorC: 10, cold: 0, dialed: 0, warm: 2 },
          ],
        })}
      />,
    );
    expect(screen.getByText("Under-dressed")).toBeVisible();
    expect(screen.getByText("Over-dressed")).toBeVisible();
  });

  it("lists the most-worn pieces and links the recent entries", async () => {
    await renderFeedScreen(
      <OwnProfile
        profile={ownProfile({
          runCount: 2,
          mostWornItems: [{ itemId: "01A", name: "Houdini", wearCount: 4 }],
          recentEntries: [
            { entryId: "01E", createdAt: 1, verdict: NOTHING },
            { entryId: "01F", createdAt: 2, verdict: 0 },
          ],
        })}
      />,
    );
    expect(screen.getByText("Houdini").closest("li")).toHaveTextContent(
      "Houdini[4]",
    );
    expect(
      screen.getByRole("link", { name: "No verdict yet" }),
    ).toHaveAttribute("href", "/feed/entry/01E");
    expect(screen.getByRole("link", { name: "Entry" })).toHaveAttribute(
      "href",
      "/feed/entry/01F",
    );
  });
});

describe("OtherProfile (H)", () => {
  it("keeps its header and Follow with nothing public, and says so plainly", async () => {
    await renderFeedScreen(otherScreen());

    expect(screen.getByRole("heading", { name: "Ravi K" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Follow" })).toBeVisible();
    expect(part("entries")).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("No public entries yet.")).toBeVisible();
    expect(
      screen.getByText(
        "Follow Ravi K and their shared runs will show in your feed.",
      ),
    ).toBeVisible();
    // Their silence, not a next step: no brackets.
    expect(part("entries")?.textContent).not.toMatch(/\[/u);
  });

  it("shows no counts — a stranger's follower count is a status number", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("counts")).toBeNull();
  });

  it("puts Report at the foot, after what is there — nothing, here", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("entries")?.lastElementChild).toBe(part("report"));
    expect(
      within(part("report") ?? document.body).getByRole("button"),
    ).toHaveTextContent("Report");
  });

  it("falls back to A runner and shows a city only when there is one", async () => {
    await renderFeedScreen(
      otherScreen({ displayName: NOTHING, cityLabel: "St. Paul" }),
    );
    expect(screen.getByRole("heading", { name: "A runner" })).toBeVisible();
    expect(screen.getByText("St. Paul")).toHaveClass("font-mono");
  });

  it("badges every verdict an entry has, not only dialed", async () => {
    await renderFeedScreen(
      otherScreen({
        recentPublicEntries: [
          {
            entryId: "01A",
            createdAt: 1_755_000_000,
            verdict: -1,
            caption: NOTHING,
          },
        ],
      }),
    );
    expect(part("verdict-badge")).toHaveTextContent("A bit cold");
  });

  it("draws no city line, not an empty one, when there is no city", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("header")?.querySelectorAll(".font-mono")).toHaveLength(0);
  });

  it("says nothing in its status region until something happens", async () => {
    await renderFeedScreen(otherScreen());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("lists public entries by date, with the verdict and caption each has", async () => {
    await renderFeedScreen(
      otherScreen({
        recentPublicEntries: [
          {
            entryId: "01A",
            createdAt: 1_755_000_000,
            verdict: 0,
            caption: "Rain stopped at mile 2.",
          },
          {
            entryId: "01B",
            createdAt: 1_755_000_000,
            verdict: NOTHING,
            caption: NOTHING,
          },
        ],
      }),
    );

    const [first, second] = screen.getAllByRole("link", {
      name: /Tue 12 Aug/u,
    });
    expect(first).toHaveAttribute("href", "/feed/entry/01A");
    expect(first).toHaveTextContent(
      /^Tue 12 AugDialedRain stopped at mile 2\.$/u,
    );
    // No verdict, no badge; no caption, no line.
    expect(second).toHaveAttribute("href", "/feed/entry/01B");
    expect(second).toHaveTextContent(/^Tue 12 Aug$/u);
    expect(second?.children).toHaveLength(1);
    // And Report still closes the list.
    expect(part("entries")?.lastElementChild).toBe(part("report"));
    expect(screen.getAllByText("Tue 12 Aug")[0]).toHaveClass("font-mono");
  });

  it("goes back to the feed", async () => {
    await renderFeedScreen(otherScreen());
    expect(screen.getByRole("link", { name: "Back to feed" })).toHaveAttribute(
      "href",
      "/feed",
    );
  });
});

describe("Follow, on the control-failure pattern", () => {
  it("is the pink primary until followed, then a hairline", async () => {
    const user = userEvent.setup();
    const follow = vi.fn(done);
    await renderFeedScreen(followScreen({ follow }));
    const button = screen.getByRole("button", { name: "Follow" });
    expect(button).toHaveClass("bg-action");

    await user.click(button);

    expect(follow).toHaveBeenCalledWith({ data: { userId: "01RAVI" } });
    await waitFor(() => {
      expect(button).toHaveAccessibleName("Following");
    });
    expect(button).toHaveClass("border-hairline");
    expect(button).not.toHaveClass("bg-action");
  });

  it("waits behind [ Following ] without flipping first", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderFeedScreen(followScreen({ follow: () => pending.promise }));
    const button = screen.getByRole("button", { name: "Follow" });

    await user.click(button);

    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("bg-action");
    expect(within(button).getByText("Following")).toBeVisible();
    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("says [ Unfollowing ] while it takes a follow back", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderFeedScreen(
      followScreen({ isFollowing: true, unfollow: () => pending.promise }),
    );
    const button = screen.getByRole("button", { name: "Following" });

    await user.click(button);

    expect(within(button).getByText("Unfollowing")).toBeVisible();
    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("unfollows behind [ Unfollowing ], calling the other endpoint", async () => {
    const user = userEvent.setup();
    const follow = vi.fn(done);
    const unfollow = vi.fn(done);
    await renderFeedScreen(
      followScreen({ isFollowing: true, follow, unfollow }),
    );
    const button = screen.getByRole("button", { name: "Following" });

    await user.click(button);

    await waitFor(() => {
      expect(button).toHaveAccessibleName("Follow");
    });
    expect(unfollow).toHaveBeenCalledWith({ data: { userId: "01RAVI" } });
    expect(follow).not.toHaveBeenCalled();
  });

  it("says NOT FOLLOWING under it when following fails, and keeps the label", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      followScreen({ follow: () => Promise.reject(new TypeError("offline")) }),
    );

    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByText("Not following")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not following. Your connection dropped.",
    );
    expect(screen.getByRole("button", { name: "Follow" })).toBeVisible();
  });

  it("says STILL FOLLOWING when unfollowing fails", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      followScreen({
        isFollowing: true,
        unfollow: () => Promise.reject(new Error("D1 went away")),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Following" }));

    expect(await screen.findByText("Still following")).toBeVisible();
    expect(screen.getByText("Our end failed.")).toBeVisible();
  });
});

describe("RunnerSearch", () => {
  it("says nothing at rest, and lists nothing", async () => {
    await renderFeedScreen(searchScreen());
    expect(screen.queryByText(/No runner called/u)).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("searches on what is typed, trimmed, and lists avatar, name and a Follow pill", async () => {
    const user = userEvent.setup();
    const found = vi.fn(() => Promise.resolve(results("Ana", "Andy")));
    await renderFeedScreen(searchScreen(found));

    await user.type(screen.getByLabelText("Search by name"), " An");

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    expect(found).toHaveBeenLastCalledWith("An");
    const [ana, andy] = screen.getAllByRole("listitem");
    expect(
      within(ana ?? document.body).getByRole("link", { name: "Ana" }),
    ).toHaveAttribute("href", "/feed/u/01R0");
    expect(
      within(ana ?? document.body).getByRole("button", { name: "Follow" }),
    ).toBeVisible();
    // Each row knows whether the viewer already follows them.
    expect(
      within(andy ?? document.body).getByRole("button", { name: "Following" }),
    ).toBeVisible();
    expect(ana).toHaveTextContent(/^AAnaFollow/u);
  });

  it("breathes its trailing label while a search is out, and only then", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(searchScreen(() => pending.promise));
    const label = screen.getByText("Searching").parentElement;
    expect(label).toHaveStyle({ visibility: "hidden" });

    await user.type(screen.getByLabelText("Search by name"), "A");
    expect(label).not.toHaveStyle({ visibility: "hidden" });
    expect(label?.querySelectorAll(".breathe")).toHaveLength(2);

    pending.resolve([]);
    await waitFor(() => {
      expect(label).toHaveStyle({ visibility: "hidden" });
    });
  });

  it("says nothing in its status region until something happens", async () => {
    await renderFeedScreen(searchScreen());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("stops breathing when the box is cleared mid-search", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(searchScreen(() => pending.promise));
    const box = screen.getByLabelText("Search by name");
    const label = screen.getByText("Searching").parentElement;

    await user.type(box, "A");
    expect(label).not.toHaveStyle({ visibility: "hidden" });
    await user.clear(box);

    expect(label).toHaveStyle({ visibility: "hidden" });
    pending.resolve([]);
  });

  it("drops a slower failure to an older prefix", async () => {
    const user = userEvent.setup();
    const slow = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(
      searchScreen((prefix) =>
        prefix === "A" ? slow.promise : Promise.resolve(results("Ana")),
      ),
    );

    await user.type(screen.getByLabelText("Search by name"), "An");
    await screen.findByRole("link", { name: "Ana" });
    slow.reject(new TypeError("offline"));

    await waitFor(() => {
      expect(screen.queryByText("Didn't load")).toBeNull();
    });
    expect(screen.getByRole("link", { name: "Ana" })).toBeVisible();
  });

  it("does not say No runner called over a search that then failed", async () => {
    const user = userEvent.setup();
    const found = vi
      .fn<(prefix: string) => Promise<SearchResult[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new TypeError("offline"));
    await renderFeedScreen(searchScreen(found));
    const box = screen.getByLabelText("Search by name");

    await user.type(box, "z");
    expect(await screen.findByText("No runner called @z.")).toBeVisible();
    await user.type(box, "e");

    expect(await screen.findByText("Didn't load")).toBeVisible();
    expect(screen.queryByText(/No runner called/u)).toBeNull();
  });

  it("does not say No runner called when there are runners", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(searchScreen(() => Promise.resolve(results("Ana"))));

    await user.type(screen.getByLabelText("Search by name"), "A");

    expect(await screen.findByRole("link", { name: "Ana" })).toBeVisible();
    expect(screen.queryByText(/No runner called/u)).toBeNull();
  });

  it("says No runner called @x once a search has come back empty", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(searchScreen());

    await user.type(screen.getByLabelText("Search by name"), "zed ");

    expect(await screen.findByText("No runner called @zed.")).toBeVisible();
  });

  it("goes quiet again when the box is cleared, whitespace and all", async () => {
    const user = userEvent.setup();
    const found = vi.fn(() => Promise.resolve(results("Ana")));
    await renderFeedScreen(searchScreen(found));
    const box = screen.getByLabelText("Search by name");

    await user.type(box, "A");
    await screen.findByRole("listitem");
    await user.clear(box);
    await user.type(box, "  ");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(/No runner called/u)).toBeNull();
    expect(found).toHaveBeenCalledTimes(1);
  });

  it("drops a slower answer to an older prefix", async () => {
    const user = userEvent.setup();
    const slow = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(
      searchScreen((prefix) =>
        prefix === "A" ? slow.promise : Promise.resolve(results("Ana")),
      ),
    );

    await user.type(screen.getByLabelText("Search by name"), "An");
    await screen.findByRole("link", { name: "Ana" });
    slow.resolve(results("Old answer"));

    await waitFor(() => {
      expect(screen.queryByText("Old answer")).toBeNull();
    });
    expect(screen.getByRole("link", { name: "Ana" })).toBeVisible();
  });

  it("says Didn't load when the search fails, and tries the same one again", async () => {
    const user = userEvent.setup();
    const found = vi
      .fn<(prefix: string) => Promise<SearchResult[]>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(results("Ana"));
    await renderFeedScreen(searchScreen(found));

    await user.type(screen.getByLabelText("Search by name"), "A");
    expect(await screen.findByText("Didn't load")).toBeVisible();
    expect(screen.queryByText(/No runner called/u)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "Ana" })).toBeVisible();
    expect(found).toHaveBeenLastCalledWith("A");
    expect(screen.queryByText("Didn't load")).toBeNull();
  });

  it("puts a failed follow's band under the whole row", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      <RunnerSearch
        search={() => Promise.resolve(results("Ana"))}
        follow={() => Promise.reject(new TypeError("offline"))}
        unfollow={done}
      />,
    );
    await user.type(screen.getByLabelText("Search by name"), "A");
    await user.click(await screen.findByRole("button", { name: "Follow" }));

    const band = await screen.findByText("Not following");
    const row = screen.getByRole("listitem");
    expect(row).toContainElement(band);
    expect(row.lastElementChild).toContainElement(band);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not following. Your connection dropped.",
    );
  });
});
