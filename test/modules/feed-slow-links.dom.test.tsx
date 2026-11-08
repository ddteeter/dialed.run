import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OtherProfile } from "../../src/modules/feed/components/OtherProfile";
import { PostCard } from "../../src/modules/feed/components/PostCard";
import {
  ONLY_TIMERS,
  renderWithSlowRoute,
  tapAndWaitSlow,
} from "../ui/slow-route";
import { feedItem, MILES, NOW } from "./feed-fixtures";

/**
 * Round 47 #122: on a whole-block link to D — a post card, a profile's
 * shared run — X3's brackets go on the date while D is slow, and the
 * handle stays still.
 */
const TO_ENTRY = { at: "/", slowPath: "/feed/entry/$entryId" };

/**
The profile's wire shape: no city is `null`.
*/
const NONE = z.null().parse(JSON.parse("null"));

function item(entryId: string) {
  return feedItem({ entryId, authorUsername: `runner_${entryId}` });
}

function author(post: HTMLElement): HTMLElement | null {
  return post.querySelector<HTMLElement>("[data-part='author']");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a slow post (E1 → D)", () => {
  it("breathes the date, not the handle, and only the card pressed", async () => {
    vi.useFakeTimers(ONLY_TIMERS);
    await renderWithSlowRoute(
      <>
        {["a", "b"].map((id) => (
          <PostCard
            key={id}
            item={item(id)}
            units={MILES}
            now={NOW}
            setUseful={vi.fn()}
            onStatus={vi.fn()}
          />
        ))}
      </>,
      TO_ENTRY,
    );
    const [pressed, other] = screen.getAllByRole("article");
    if (pressed === undefined || other === undefined)
      throw new Error("no posts");
    const link = within(pressed).getAllByRole("link")[0];
    if (link === undefined) throw new Error("no link");

    await tapAndWaitSlow(link);

    // The author row: the handle, and beneath it the date in mono. (The
    // card's Useful button keeps its own hidden "[ Noting ]" elsewhere.)
    const date = author(pressed)?.querySelector(".font-mono");
    expect(date?.querySelectorAll(".breathe")).toHaveLength(2);
    expect(author(pressed)?.querySelectorAll(".breathe")).toHaveLength(2);
    expect(author(other)?.querySelectorAll(".breathe")).toHaveLength(0);
  });
});

describe("a slow shared run on a profile (H → D)", () => {
  it("breathes the pressed row's date alone", async () => {
    vi.useFakeTimers(ONLY_TIMERS);
    await renderWithSlowRoute(
      <OtherProfile
        profile={{
          userId: "01RAVI",
          username: "ravi_k",
          cityLabel: NONE,
          recentPublicEntries: [
            { entryId: "01A", day: "Tue Aug 12", verdict: 0 },
            { entryId: "01B", day: "Mon Aug 11", verdict: 1 },
          ],
        }}
        isFollowing={false}
        follow={vi.fn()}
        unfollow={vi.fn()}
        reportAffordance={undefined}
      />,
      TO_ENTRY,
    );

    await tapAndWaitSlow(screen.getByRole("link", { name: /Tue Aug 12/u }));

    const pressed = screen.getByRole("link", { name: /Tue Aug 12/u });
    const brackets = pressed.querySelectorAll(".breathe");
    expect(brackets).toHaveLength(2);
    for (const bracket of brackets) {
      expect(bracket.closest(".font-mono")).toHaveTextContent("[Tue Aug 12]");
    }
    expect(
      screen
        .getByRole("link", { name: /Mon Aug 11/u })
        .querySelectorAll(".breathe"),
    ).toHaveLength(0);
  });
});
