import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { defaultFeedTab, Feed } from "../../src/modules/feed/components/Feed";
import type { FeedItem } from "../../src/modules/feed/feed";
import { feedItem, MILES, NOW, renderFeedScreen } from "./feed-fixtures";

/**
 * The feed's shell (E1 and E2-lite): which tab it opens on, the queue
 * link, and Following — its cards and its drawn empty state. The cards
 * and Your conditions have files of their own.
 */
const useful = () => Promise.resolve({ useful: true });

function feed(
  overrides: {
    items?: FeedItem[];
    followeeCount?: number;
    unjudgedCount?: number;
    conditionsFor?: () => Promise<undefined>;
  } = {},
) {
  return (
    <Feed
      items={overrides.items ?? []}
      followeeCount={overrides.followeeCount ?? 1}
      now={NOW}
      units={MILES}
      unjudgedCount={overrides.unjudgedCount ?? 0}
      toggleUseful={useful}
      conditions={{
        home: { coords: undefined, cityLabel: undefined },
        locate: () => Promise.resolve(undefined),
        conditionsFor:
          overrides.conditionsFor ?? (() => Promise.resolve(undefined)),
        saveCity: () => Promise.resolve({ lat: 1, lng: 2 }),
      }}
    />
  );
}

describe("defaultFeedTab", () => {
  it("lands a runner with no follows on Your conditions, and anyone else on Following", () => {
    expect(defaultFeedTab(0)).toBe("conditions");
    expect(defaultFeedTab(1)).toBe("following");
  });
});

describe("Feed: the tabs", () => {
  it("opens on Following once the runner follows anyone, marked in the action pink", async () => {
    await renderFeedScreen(feed({ followeeCount: 3 }));

    const following = screen.getByRole("button", { name: "Following" });
    expect(following).toHaveAttribute("aria-current", "page");
    expect(following).toHaveClass("border-action");
    expect(following).not.toHaveClass("border-teal");
    const conditions = screen.getByRole("button", { name: "Your conditions" });
    expect(conditions).not.toHaveAttribute("aria-current");
    expect(conditions).toHaveClass("text-label");
  });

  it("opens on Your conditions with no follows, marked in teal", async () => {
    await renderFeedScreen(feed({ followeeCount: 0 }));

    const conditions = screen.getByRole("button", { name: "Your conditions" });
    expect(conditions).toHaveAttribute("aria-current", "page");
    expect(conditions).toHaveClass("border-teal");
    expect(await screen.findByText("Where do you run?")).toBeVisible();
  });

  it("switches between the two", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(feed({ followeeCount: 2 }));

    await user.click(screen.getByRole("button", { name: "Your conditions" }));
    expect(await screen.findByText("Where do you run?")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Following" }));
    expect(screen.getByText("Nobody you follow has posted yet.")).toBeVisible();
  });

  it("offers a way to find runners from the heading", async () => {
    await renderFeedScreen(feed());

    expect(screen.getByRole("heading", { name: "Feed" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Find runners" })).toHaveAttribute(
      "href",
      "/feed/search",
    );
  });
});

/**
 * A loader can refresh under a mounted screen — a stale page, then the
 * fresh one — so the follow count can change without a remount.
 */
function Refreshing() {
  const [followeeCount, setFolloweeCount] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFolloweeCount(1);
        }}
      >
        Refresh
      </button>
      {feed({ followeeCount })}
    </>
  );
}

describe("Feed: the default follows the data until the runner chooses", () => {
  it("moves to Following when a refresh says the runner follows someone", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(<Refreshing />);
    expect(
      screen.getByRole("button", { name: "Your conditions" }),
    ).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByRole("button", { name: "Following" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps a tab the runner chose, whatever the refresh says", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(<Refreshing />);
    await user.click(screen.getByRole("button", { name: "Your conditions" }));

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(
      screen.getByRole("button", { name: "Your conditions" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

describe("Feed: the queue", () => {
  it("offers to clear the queue once there are two runs waiting", async () => {
    // DS2's entry point — "reached from 'Clear the queue ›' on X".
    await renderFeedScreen(feed({ unjudgedCount: 4 }));

    const link = screen.getByRole("link", { name: /Clear the queue/ });
    expect(link).toHaveAttribute("href", "/runs/backlog");
    expect(link.textContent).toContain("4");
  });

  it("says nothing when one run is waiting, because one is a sheet", async () => {
    await renderFeedScreen(feed({ unjudgedCount: 1 }));
    expect(screen.queryByRole("link", { name: /Clear the queue/ })).toBeNull();
  });
});

describe("Feed: Following", () => {
  it("renders one card per entry, in order, under one status region", async () => {
    await renderFeedScreen(
      feed({
        items: [
          feedItem({ entryId: "01A", authorDisplayName: "Dana" }),
          feedItem({ entryId: "01B", authorDisplayName: "Mark" }),
        ],
      }),
    );

    const posts = document.querySelectorAll('[data-part="post"]');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toHaveTextContent("Dana");
    expect(posts[1]).toHaveTextContent("Mark");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("announces a card's failed Useful in the screen's one region", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      <Feed
        items={[feedItem()]}
        followeeCount={1}
        now={NOW}
        units={MILES}
        unjudgedCount={0}
        toggleUseful={() => Promise.reject(new TypeError("offline"))}
        conditions={{
          home: { coords: undefined, cityLabel: undefined },
          locate: () => Promise.resolve(undefined),
          conditionsFor: () => Promise.resolve(undefined),
          saveCity: () => Promise.resolve({ lat: 1, lng: 2 }),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Useful/u }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Not marked. Your connection dropped.",
      );
    });
  });
});

describe("Feed: Following, empty", () => {
  it("is drawn: the bracketed headline, the lead, and one primary to find a runner", async () => {
    await renderFeedScreen(feed({ followeeCount: 1 }));

    const empty = document.querySelector(
      '[data-part="feed"][data-state="empty"]',
    );
    expect(empty).not.toBeNull();
    expect(screen.getByText("Nobody yet")).toBeVisible();
    expect(screen.getByText("Nobody you follow has posted yet.")).toBeVisible();
    const find = screen.getByRole("link", { name: "Find a runner" });
    expect(find).toHaveAttribute("href", "/feed/search");
    expect(find).toHaveAttribute("data-part", "primary-action");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says the runners followed haven't shared yet, when there are some", async () => {
    await renderFeedScreen(feed({ followeeCount: 2 }));
    expect(
      screen.getByText("The runners you follow haven’t shared a run yet."),
    ).toBeVisible();
    expect(
      screen.queryByText("Follow runners you already know by their username."),
    ).toBeNull();
  });

  it("points a runner who follows nobody at usernames they already know", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(feed({ followeeCount: 0 }));
    // No follows opens on Your conditions; Following is a tab away.
    await user.click(screen.getByRole("button", { name: "Following" }));

    expect(
      screen.getByText("Follow runners you already know by their username."),
    ).toBeVisible();
  });

  it("switches to Your conditions from the foot link, which is not a second primary", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(feed({ followeeCount: 1 }));

    await user.click(
      screen.getByRole("button", {
        name: "what people wore in your conditions",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Your conditions" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("reaches the feed's empty state without a conditions call", async () => {
    const conditionsFor = vi.fn(() => Promise.resolve(undefined));
    await renderFeedScreen(feed({ followeeCount: 1, conditionsFor }));
    expect(conditionsFor).not.toHaveBeenCalled();
  });
});
