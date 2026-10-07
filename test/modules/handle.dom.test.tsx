import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { EntryDetail } from "../../src/modules/feed/components/EntryDetail";
import { NoticeBand } from "../../src/modules/safety/components/NoticeBand";
import { Handle, handleText } from "../../src/modules/feed/components/Handle";
import { OwnProfile } from "../../src/modules/feed/components/OwnProfile";
import { RunnerAtHandle } from "../../src/modules/feed/components/RunnerAtHandle";
import type { entryDetailForViewer } from "../../src/modules/feed/entries";
import type {
  OtherProfile,
  OwnProfile as OwnProfileData,
} from "../../src/modules/feed/profiles";
import { MILES, renderFeedScreen, unconfirmed } from "./feed-fixtures";

/**
 * Round 26 #7's handle placements (FEED-10), `/@handle`'s two pages, and
 * R-62's under-review marker on D (FEED-6).
 */
const NOTHING = z.null().parse(JSON.parse("null"));
const done = () => Promise.resolve();

describe("Handle", () => {
  it("is the handle with its @, in Archivo 600 and never mono", () => {
    render(<Handle username="maya_runs" />);
    const handle = screen.getByText("@maya_runs");
    expect(handle).toHaveClass("font-sans", "font-semibold");
    expect(handle).not.toHaveClass("font-mono");
  });

  it("keeps the handle as stored — it is lowercase already, so nothing shouts it", () => {
    render(<Handle username="maya_runs" />);
    expect(screen.getByText("@maya_runs")).not.toHaveClass("uppercase");
  });

  it("says A runner, without an @, for an account with no handle", () => {
    expect(handleText(undefined)).toBe("A runner");
    expect(handleText(NOTHING)).toBe("A runner");
    expect(handleText("ana")).toBe("@ana");
  });
});

function ownProfile(overrides: Partial<OwnProfileData> = {}): OwnProfileData {
  return {
    userId: "01USER",
    username: "dana_kim",
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

describe("G's heading", () => {
  it("is the runner's @handle in the handle style", async () => {
    await renderFeedScreen(
      <OwnProfile confirmBand={undefined} profile={ownProfile()} />,
    );
    const heading = screen.getByRole("heading", { name: "@dana_kim" });
    expect(heading.querySelector(".font-semibold")).toHaveTextContent(
      "@dana_kim",
    );
    expect(heading.querySelector(".font-mono")).toBeNull();
  });
});

const ravi: OtherProfile = {
  userId: "01RAVI",
  username: "ravi_k",
  cityLabel: NOTHING,
  recentPublicEntries: [],
};

describe("RunnerAtHandle", () => {
  it("shows the runner holding the handle, with the report control made for them", async () => {
    const reportFor = vi.fn((profile: OtherProfile) => (
      <button type="button">Report {profile.userId}</button>
    ));
    await renderFeedScreen(
      <RunnerAtHandle
        found={{ kind: "runner", profile: ravi, isFollowing: true }}
        follow={done}
        unfollow={done}
        reportAffordanceFor={reportFor}
      />,
    );

    expect(screen.getByRole("heading", { name: "@ravi_k" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Following" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Report 01RAVI" })).toBeVisible();
    expect(reportFor).toHaveBeenCalledOnce();
    expect(reportFor.mock.calls[0]?.[0]).toBe(ravi);
  });

  it("opens the confirm sheet when the server refuses a follow, and stays unfollowed (design 133, D-113)", async () => {
    const user = userEvent.setup();
    const follow = vi.fn(unconfirmed);
    await renderFeedScreen(
      <RunnerAtHandle
        found={{ kind: "runner", profile: ravi, isFollowing: false }}
        follow={follow}
        unfollow={done}
        reportAffordanceFor={() => NOTHING}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(follow).toHaveBeenCalledWith({ data: { userId: "01RAVI" } });
    expect(
      await screen.findByRole("dialog", { name: "Confirm your email first" }),
    ).toHaveTextContent("Opened from follow");
    // Nothing changed, and nothing failed: the pill is as it was, with no
    // band under it.
    expect(screen.getByRole("button", { name: "Follow" })).toBeVisible();
    expect(screen.queryByText("Not following")).toBeNull();
  });

  it("says only that an old handle's runner changed their name, with the way back", async () => {
    const reportFor = vi.fn((): ReactNode => NOTHING);
    await renderFeedScreen(
      <RunnerAtHandle
        found={{ kind: "changed" }}
        follow={done}
        unfollow={done}
        reportAffordanceFor={reportFor}
      />,
    );

    expect(screen.getByText("This runner changed their name.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to feed" })).toHaveAttribute(
      "href",
      "/feed",
    );
    // Nobody to follow, report or name.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(reportFor).not.toHaveBeenCalled();
  });

  it("says only that a deleted account's runner isn't here — not a rename, not a deletion — with the way back", async () => {
    const reportFor = vi.fn((): ReactNode => NOTHING);
    await renderFeedScreen(
      <RunnerAtHandle
        found={{ kind: "gone" }}
        follow={done}
        unfollow={done}
        reportAffordanceFor={reportFor}
      />,
    );

    expect(screen.getByText("This runner isn't here.")).toBeVisible();
    expect(screen.queryByText(/changed their name/u)).toBeNull();
    expect(screen.getByRole("link", { name: "Back to feed" })).toHaveAttribute(
      "href",
      "/feed",
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(reportFor).not.toHaveBeenCalled();
  });
});

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

function entry(isUnderReview: boolean): Entry {
  return {
    id: "01ENTRY",
    userId: "01USER",
    authorUsername: "mark_t",
    runId: "01RUN",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 2600,
    startedAt: 1_755_000_000,
    indoor: false,
    verdict: undefined,
    audience: "runners",
    caption: undefined,
    createdAt: 1_755_000_000,
    items: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    conditions: undefined,
    underReview: isUnderReview,
    viewerHasReacted: false,
  };
}

async function detailFor(isUnderReview: boolean) {
  await renderFeedScreen(
    <EntryDetail
      noticeBand={NoticeBand}
      deletePhoto={() => Promise.resolve()}
      units={MILES}
      entry={entry(isUnderReview)}
      viewerId="01USER"
      shouldPromptVerdict={false}
      recordPrompted={done}
      setUseful={() =>
        Promise.resolve({ status: "set", useful: true, count: 1 })
      }
    />,
  );
}

describe("D's under-review band (R-62; round 28 #6)", () => {
  it("puts HIDDEN WHILE WE CHECK at the top, in the board's words, and no tag", async () => {
    await detailFor(true);
    const band = document.querySelector<HTMLElement>(
      '[data-part="notice-band"]',
    );
    if (band === null) throw new Error("no band");

    expect([...band.children].map((line) => line.textContent)).toStrictEqual([
      "Hidden while we check",
      "Only you can see this while we look at it.",
      "You can still edit or delete it.",
    ]);
    // First under the heading row, before the strip: "the band at the top".
    const heading = screen.getByRole("heading", { name: "Your run" });
    expect(heading.parentElement?.nextElementSibling).toBe(band);
    // Nothing to retry, so no button in it.
    expect(band.querySelector("button")).toBeNull();
    expect(document.querySelector('[data-part="review-tag"]')).toBeNull();
  });

  it("is absent on an entry nobody has hidden", async () => {
    await detailFor(false);
    expect(document.querySelector('[data-part="notice-band"]')).toBeNull();
    expect(screen.queryByText(/while we check/iu)).toBeNull();
  });
});
