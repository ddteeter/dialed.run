import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PostCard } from "../../src/modules/feed/components/PostCard";
import { VerdictBadge } from "../../src/modules/feed/components/VerdictBadge";
import type { SetUsefulFn } from "../../src/modules/feed/components/useful-reaction";
import type { FeedItem } from "../../src/modules/feed/feed";
import { pointConditions } from "../feed/conditions-fixture";
import {
  feedItem,
  MILES,
  NOW,
  renderFeedScreen,
  unconfirmed,
} from "./feed-fixtures";

/**
 * The v1 post card (round 22, "E1v1 Following"): author and badge, photo,
 * caption, strip, Useful — in that order, and a missing part absent.
 */
const nothing: Setter = () =>
  Promise.resolve({ status: "set", useful: true, count: 1 });

type Setter = SetUsefulFn;

async function card(
  overrides: Partial<FeedItem> = {},
  setUseful: Setter = nothing,
  onStatus: (status: string) => void = vi.fn(),
) {
  await renderFeedScreen(
    <PostCard
      item={feedItem(overrides)}
      units={MILES}
      now={NOW}
      setUseful={setUseful}
      onStatus={onStatus}
    />,
  );
  const post = document.querySelector<HTMLElement>('[data-part="post"]');
  if (post === null) throw new Error("no post");
  return post;
}

/**
The card's parts, in document order, by round 22's names.
*/
function partsOf(post: HTMLElement): string[] {
  return [...post.querySelectorAll<HTMLElement>("[data-part]")].map(
    (element) => element.dataset.part ?? "",
  );
}

describe("PostCard: order and absence", () => {
  it("puts every part in the drawn order", async () => {
    const post = await card({
      verdict: 0,
      photoKeys: ["user/01/a.jpg", "user/01/b.jpg"],
      caption: "Half-zip was right.",
    });

    expect(post).toHaveAttribute("data-state", "with-photo");
    expect(partsOf(post)).toStrictEqual([
      "author",
      "verdict-badge",
      "photo",
      "caption",
      "run-strip",
      "reactions",
    ]);
    // One photo on the card, the first; the rest are D's pager.
    expect(post.querySelectorAll("img")).toHaveLength(1);
    expect(post.querySelector("img")).toHaveAttribute(
      "src",
      "/feed/photo/user/01/a.jpg",
    );
    // It carries only the counter, in mono, saying how many D has.
    const counter = within(post).getByText("1 / 2");
    expect(counter).toHaveClass("text-mono-xs");
    expect(counter.parentElement).toHaveClass(
      "absolute",
      "right-3",
      "bottom-3",
    );
  });

  it("counts a lone photo as 1 / 1", async () => {
    const post = await card({ photoKeys: ["user/01/a.jpg"] });
    expect(within(post).getByText("1 / 1")).toBeVisible();
  });

  it("is a whole post with no photo, caption or verdict: author, strip, Useful", async () => {
    const post = await card();

    expect(post).toHaveAttribute("data-state", "no-photo");
    expect(partsOf(post)).toStrictEqual(["author", "run-strip", "reactions"]);
  });

  it("links everything but Useful to the entry", async () => {
    const post = await card({ entryId: "01A", caption: "A caption" });

    const link = within(post).getByRole("link");
    expect(link).toHaveAttribute("href", "/feed/entry/01A");
    expect(link).toHaveTextContent("A caption");
    expect(link).not.toContainElement(
      within(post).getByRole("button", { name: /Useful/u }),
    );
  });
});

describe("PostCard: the author row", () => {
  it("names the author, with their initial and when the run was", async () => {
    const post = await card({ authorUsername: "dana_k" });

    const author = post.querySelector('[data-part="author"]');
    expect(author).toHaveTextContent("D@dana_k2h ago · 10:00 AM");
    expect(screen.getByText("2h ago · 10:00 AM")).toHaveClass("font-mono");
  });

  it("says A runner for someone with no handle", async () => {
    const post = await card();
    expect(screen.getByText("A runner")).toBeVisible();
    // The avatar's initial falls back to "A runner" too.
    expect(
      post
        .querySelector('[data-part="author"]')
        ?.querySelector('[aria-hidden="true"]'),
    ).toHaveTextContent("A");
  });

  it("dates the run in its own zone", async () => {
    await card({
      conditions: {
        ...pointConditions({ tempC: 5, feelsLikeC: 3 }),
        timeZone: "America/Chicago",
      },
    });
    expect(screen.getByText("2h ago · 5:00 AM")).toBeVisible();
  });
});

describe("VerdictBadge", () => {
  it("fills dialed with the teal surface, as A3 does", async () => {
    await renderFeedScreen(<VerdictBadge verdict={0} />);
    const badge = screen.getByText("Dialed").parentElement;
    expect(badge).toHaveAttribute("data-part", "verdict-badge");
    expect(badge).toHaveClass("bg-teal");
    expect(badge).not.toHaveClass("border-ink");
    expect(screen.getByText("Dialed")).toHaveClass("font-mono");
  });

  it("draws an off verdict as an ink hairline, unfilled", async () => {
    await renderFeedScreen(<VerdictBadge verdict={1} />);
    const badge = screen.getByText("A bit warm").parentElement;
    expect(badge).toHaveClass("border", "border-ink");
    expect(badge).not.toHaveClass("bg-teal");
  });

  it("draws nothing for a verdict off the scale", async () => {
    const { container } = await renderFeedScreen(<VerdictBadge verdict={7} />);
    expect(container.querySelector('[data-part="verdict-badge"]')).toBeNull();
  });
});

function strip(post: HTMLElement): HTMLElement {
  const element = post.querySelector<HTMLElement>('[data-part="run-strip"]');
  if (element === null) throw new Error("no strip");
  return element;
}

function useful(): HTMLElement {
  return screen.getByRole("button", { name: /Useful/u });
}

const credit = () =>
  screen.queryByRole("link", { name: "Weather by Visual Crossing" });

describe("PostCard: the strip", () => {
  it("reads DIST | TEMP · CONDITION, the conditions in teal", async () => {
    const post = await card({
      conditions: pointConditions({
        tempC: 5,
        feelsLikeC: 3,
        condition: "Rain",
      }),
    });

    expect(strip(post)).toHaveTextContent("5.0mi|41° · Rain");
    expect(screen.getByText("41° · Rain")).toHaveClass("text-dialed-text");
    expect(screen.getByText("5.0mi")).toHaveClass("font-mono");
  });

  it("reads INDOOR when the run was indoors and has no conditions", async () => {
    const post = await card({ indoor: true });

    expect(strip(post)).toHaveTextContent("5.0mi|Indoor");
    expect(screen.getByText("Indoor")).toHaveClass("text-muted", "font-mono");
  });

  it("is one cell otherwise — no divider, no dash", async () => {
    const post = await card();
    expect(strip(post)).toHaveTextContent(/^5\.0mi$/u);
  });

  it("credits Visual Crossing beside its reading, outside the link to D (FEED-8)", async () => {
    const post = await card({
      conditions: pointConditions({ tempC: 5, feelsLikeC: 3 }),
    });

    const link = credit();
    expect(link).toHaveAttribute(
      "href",
      "https://www.visualcrossing.com/weather-data",
    );
    expect(post).toContainElement(link);
    // A link inside a link is not a link: it sits between the strip's
    // link and Useful.
    expect(link?.parentElement?.closest("a")).toBeNull();
  });

  it("credits nobody for a band the runner set, or for no weather", async () => {
    await card({
      conditions: {
        ...pointConditions({ tempC: 5, feelsLikeC: 3 }),
        source: "manual",
      },
    });
    expect(credit()).toBeNull();
  });

  it("credits nobody when there are no conditions", async () => {
    await card({ indoor: true });
    expect(credit()).toBeNull();
  });
});

describe("PostCard: Useful", () => {
  it("reads ♡ USEFUL with no zero when nobody has marked it", async () => {
    await card({ usefulCount: 0 });
    expect(useful()).toHaveTextContent(/^♡Useful\[Noting\]$/u);
    expect(useful()).toHaveAttribute("aria-pressed", "false");
    expect(useful()).toHaveClass("text-quiet");
    expect(useful()).toHaveAttribute("data-part", "reactions");
  });

  it("reads ♡ 11 USEFUL with a count, and ♥ in pink once the viewer has marked it", async () => {
    await card({ usefulCount: 11 });
    expect(useful()).toHaveTextContent(/^♡11Useful\[Noting\]$/u);
  });

  it("wears the viewer's mark", async () => {
    await card({ usefulCount: 24, viewerHasReacted: true });
    expect(useful()).toHaveTextContent(/^♥24Useful\[Noting\]$/u);
    expect(useful()).toHaveAttribute("aria-pressed", "true");
    expect(useful()).toHaveClass("font-semibold", "text-cold-text");
    expect(useful()).not.toHaveClass("text-quiet");
  });

  it("hides the heart from a screen reader — the pressed state says it", async () => {
    await card({ usefulCount: 3 });
    expect(useful()).toHaveAccessibleName("3 Useful");
  });

  it("asks to mark it, waits behind [ Noting ], then shows the server's count", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{
      status: "set";
      useful: boolean;
      count: number;
    }>();
    const set = vi.fn(() => pending.promise);
    await card({ entryId: "01A", usefulCount: 2 }, set);
    const button = useful();

    await user.click(button);
    expect(set).toHaveBeenCalledWith({
      data: { entryId: "01A", useful: true },
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Noting")).toBeVisible();
    expect(button).toHaveAttribute("aria-pressed", "false");

    // The server's count, not the card's 2 + 1: two others marked it
    // while this card sat open.
    pending.resolve({ status: "set", useful: true, count: 5 });
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
    await waitFor(() => {
      expect(button).toHaveTextContent(/^♥5Useful\[Noting\]$/u);
    });
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("asks to take it back, and shows what the server then has", async () => {
    const user = userEvent.setup();
    const set = vi.fn<Setter>(() =>
      Promise.resolve({ status: "set", useful: false, count: 1 }),
    );
    await card({ entryId: "01A", usefulCount: 2, viewerHasReacted: true }, set);

    await user.click(useful());

    expect(set).toHaveBeenCalledWith({
      data: { entryId: "01A", useful: false },
    });
    await waitFor(() => {
      expect(useful()).toHaveAttribute("aria-pressed", "false");
    });
    // Once the leaving digit has rolled away.
    await waitFor(() => {
      expect(useful()).toHaveTextContent(/^♡1Useful\[Noting\]$/u);
    });
  });

  it("believes the server over a stale card: marking what is already marked stays marked", async () => {
    // Another tab marked it; this card still says unmarked. The press asks
    // for "marked", and the server — which already has it — says so.
    const user = userEvent.setup();
    await card({ usefulCount: 0 }, () =>
      Promise.resolve({ status: "set", useful: true, count: 1 }),
    );

    await user.click(useful());

    await waitFor(() => {
      expect(useful()).toHaveTextContent(/^♥1Useful\[Noting\]$/u);
    });
  });

  it("fails with the band under it, naming the state still true, and reports the sentence", async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();
    await card(
      { usefulCount: 2 },
      () => Promise.reject(new TypeError("offline")),
      onStatus,
    );

    await user.click(useful());

    expect(await screen.findByText("Not marked")).toBeVisible();
    expect(screen.getByText("Your connection dropped.")).toBeVisible();
    expect(onStatus).toHaveBeenLastCalledWith(
      "Not marked. Your connection dropped.",
    );
    // No optimistic count to take back.
    expect(useful()).toHaveTextContent(/^♡2Useful\[Noting\]$/u);
  });

  it("says Still marked when taking one back fails", async () => {
    const user = userEvent.setup();
    await card({ usefulCount: 2, viewerHasReacted: true }, () =>
      Promise.reject(new TypeError("offline")),
    );

    await user.click(useful());

    expect(await screen.findByText("Still marked")).toBeVisible();
  });

  it("tries again with the same request, so a mark whose answer was lost is not taken back", async () => {
    // The first press landed and only its answer was lost. A toggle would
    // have unmarked it on the retry; a set asks for "marked" again.
    const user = userEvent.setup();
    const set = vi
      .fn<Setter>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({ status: "set", useful: true, count: 1 });
    await card({ entryId: "01A", usefulCount: 0 }, set);

    await user.click(useful());
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(useful()).toHaveAttribute("aria-pressed", "true");
    });
    expect(set.mock.calls).toStrictEqual([
      [{ data: { entryId: "01A", useful: true } }],
      [{ data: { entryId: "01A", useful: true } }],
    ]);
    expect(screen.queryByText("Not marked")).toBeNull();
  });
});

describe("PostCard: the author's under-review marker (R-62, D-67; round 29 #4)", () => {
  it("sits in the author row before the badge, where SHARED would be", async () => {
    const post = await card({
      underReview: true,
      isOwn: true,
      verdict: 0,
      caption: "Held.",
    });

    expect(partsOf(post).slice(0, 5)).toStrictEqual([
      "author",
      "review-tag",
      "verdict-badge",
      "caption",
      "run-strip",
    ]);
  });

  it("is bracketed MONO.xs in ink, and says the board's sentence aloud", async () => {
    const post = await card({ underReview: true, isOwn: true });
    const tag = post.querySelector<HTMLElement>('[data-part="review-tag"]');
    if (tag === null) throw new Error("no tag");

    // Ink, not muted: the runner can't fix it, and not pink, so it does
    // not read as a press (round 29 #4).
    expect(tag).toHaveClass("text-ink");
    const drawn = tag.querySelector('[aria-hidden="true"]');
    expect(drawn).toHaveTextContent("[Under review]");
    expect(drawn?.firstElementChild).toHaveClass("text-mono-xs");
    // The card's link is what a screen reader lands on, and it says the
    // sentence rather than the brackets.
    const link = within(post).getByRole("link");
    expect(link).toHaveAccessibleName(/Under review, only you can see this/);
    expect(link).not.toHaveAccessibleName(/\[Under review\]/);
  });

  it("is absent from every other card", async () => {
    const post = await card({ underReview: false });

    expect(post.querySelector('[data-part="review-tag"]')).toBeNull();
    expect(screen.queryByText(/Under review/u)).toBeNull();
  });
});

describe("PostCard: the viewer's own post says so (the Feed board)", () => {
  it("ends the time line with YOU on the viewer's own post", async () => {
    const post = await card({ isOwn: true });
    const author = post.querySelector('[data-part="author"]');

    expect(author?.textContent).toMatch(/^AA runner2h ago · 10:00 AM · You$/u);
  });

  it("says nothing of the kind on anyone else's", async () => {
    const post = await card({ isOwn: false });
    const author = post.querySelector('[data-part="author"]');

    expect(author?.textContent).not.toMatch(/You/u);
  });
});

describe("PostCard: Useful waits for a confirmed address (round 26 #11; seam 7)", () => {
  it("asks the server on every press, and opens the sheet only on its refusal", async () => {
    // Drawn at full strength (rule 07, "not yet"), and the server decides:
    // the page's answer about the address is as old as its loader.
    const user = userEvent.setup();
    const onStatus = vi.fn();
    const set = vi.fn<Setter>(unconfirmed);
    await card({ entryId: "01A", usefulCount: 2 }, set, onStatus);
    expect(useful()).not.toHaveAttribute("aria-disabled");

    await user.click(useful());

    expect(set).toHaveBeenCalledWith({
      data: { entryId: "01A", useful: true },
    });
    // The root's sheet, led by Useful's sentence (D-113).
    expect(
      await screen.findByRole("dialog", { name: "Confirm your email first" }),
    ).toHaveTextContent("Opened from useful");
    await waitFor(() => {
      expect(useful()).not.toHaveAttribute("aria-busy");
    });
    // Nothing changed, so the mark and the count stay as they were.
    expect(useful()).toHaveAttribute("aria-pressed", "false");
    expect(useful()).toHaveTextContent(/^♡2Useful\[Noting\]$/u);
    // A refusal is an answer, not a failure: no band, nothing announced.
    expect(screen.queryByText("Not marked")).toBeNull();
    expect(onStatus).toHaveBeenLastCalledWith("");
  });

  it("asks a runner the server says yes to nothing", async () => {
    const user = userEvent.setup();
    await card({ usefulCount: 0 }, nothing, vi.fn());

    await user.click(useful());

    await waitFor(() => {
      expect(useful()).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
