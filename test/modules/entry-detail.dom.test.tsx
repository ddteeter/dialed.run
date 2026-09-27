import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { EntryDetail } from "../../src/modules/feed/components/EntryDetail";
import type { entryDetailForViewer } from "../../src/modules/feed/entries";
import { pointConditions } from "../feed/conditions-fixture";
import { MILES, renderFeedScreen } from "./feed-fixtures";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;
type Item = Entry["items"][number];

/**
 * Screen D, as round 22 draws it "when it isn't full": the run strip is
 * the one part every entry has, and everything else is present or absent,
 * never a placeholder.
 */
const OWNER = "01USER";

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "01ENTRY",
    userId: OWNER,
    authorDisplayName: "mark_t",
    runId: "01RUN",
    runTitle: "Evening run",
    distanceM: 5 * 1609.34,
    durationS: 2600,
    // Tue Aug 12 2025, 06:30 UTC.
    startedAt: Date.UTC(2025, 7, 12, 6, 30) / 1000,
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

function item(overrides: Partial<Item> = {}): Item {
  return {
    itemId: "01ITEM",
    name: "Houdini",
    brand: "Patagonia",
    category: "top",
    layer: "outer",
    flag: undefined,
    note: undefined,
    ...overrides,
  };
}

const nothing = () => Promise.resolve();
const marked = () => Promise.resolve({ useful: true, count: 1 });

function detail(
  overrides: Partial<Entry> = {},
  options: {
    viewerId?: string | undefined;
    shouldPrompt?: boolean;
    recordPrompted?: () => Promise<unknown>;
    setUseful?: () => Promise<{ useful: boolean; count: number }>;
    report?: boolean;
  } = {},
) {
  return (
    <EntryDetail
      units={MILES}
      entry={entry(overrides)}
      viewerId={"viewerId" in options ? options.viewerId : "01STRANGER"}
      shouldPromptVerdict={options.shouldPrompt ?? false}
      recordPrompted={options.recordPrompted ?? nothing}
      setUseful={options.setUseful ?? marked}
      reportAffordance={
        options.report === false ? undefined : (
          <button type="button">Report this entry</button>
        )
      }
    />
  );
}

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-part="${CSS.escape(name)}"]`,
  );
}

function partsInOrder(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[data-part]:not([data-part="failure-band"])',
    ),
  ]
    .map((element) => element.dataset.part ?? "")
    .filter((name) => name !== "verdict-badge");
}

describe("EntryDetail: the order, and what a sparse entry leaves out", () => {
  it("is photo pager, strip, note, kit, tags, Useful, Report on a full entry", async () => {
    await renderFeedScreen(
      detail({
        photoKeys: ["a.jpg"],
        caption: "Wore the shell.",
        items: [item()],
        tags: ["hands_cold"],
        verdict: 1,
      }),
    );

    expect(partsInOrder()).toStrictEqual([
      "photo",
      "run-strip",
      "note",
      "kit",
      "tags",
      "reactions",
      "report",
    ]);
  });

  it("is the strip and Useful alone with nothing else — no placeholders", async () => {
    await renderFeedScreen(detail({}, { report: false }));

    expect(partsInOrder()).toStrictEqual(["run-strip", "reactions"]);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("EntryDetail: the heading", () => {
  it("is Your run to its author", async () => {
    await renderFeedScreen(detail({}, { viewerId: OWNER }));
    expect(screen.getByRole("heading", { name: "Your run" })).toBeVisible();
  });

  it("is the author's name to anyone else, or A runner", async () => {
    await renderFeedScreen(detail());
    expect(screen.getByRole("heading", { name: "mark_t" })).toBeVisible();
  });

  it("falls back to A runner, and never calls a signed-out viewer the author", async () => {
    await renderFeedScreen(
      detail({ authorDisplayName: undefined }, { viewerId: undefined }),
    );
    expect(screen.getByRole("heading", { name: "A runner" })).toBeVisible();
  });

  it("goes back to the feed from the header's own slot", async () => {
    await renderFeedScreen(detail());
    expect(screen.getByRole("link", { name: "Back to feed" })).toHaveAttribute(
      "href",
      "/feed",
    );
  });
});

describe("EntryDetail: the run strip", () => {
  it("says when, how far and how fast, all measured", async () => {
    await renderFeedScreen(detail());

    const strip = part("run-strip");
    expect(strip).toHaveTextContent("Tue Aug 12 · 6:30 AM5.0mi8:40 /mi");
    expect(screen.getByText("5.0mi")).toHaveClass("font-mono", "text-mono-lg");
    expect(screen.getByText("8:40 /mi")).toHaveClass("font-mono", "text-quiet");
  });

  it("leaves pace out of a run with no distance — no empty cell for it", async () => {
    await renderFeedScreen(detail({ distanceM: 0 }));
    expect(part("run-strip")).not.toHaveTextContent("/mi");
    expect(screen.getByText("0.0mi").parentElement?.children).toHaveLength(1);
  });

  it("carries the badge when there is a verdict, and loses it when there is none", async () => {
    await renderFeedScreen(detail({ verdict: -1 }));
    expect(
      part("run-strip")?.querySelector('[data-part="verdict-badge"]'),
    ).toHaveTextContent("A bit cold");
  });

  it("has no badge on an entry nobody judged", async () => {
    await renderFeedScreen(detail());
    expect(part("verdict-badge")).toBeNull();
  });

  it("gives the conditions in teal, in the run's own zone", async () => {
    await renderFeedScreen(
      detail({
        conditions: {
          ...pointConditions({ tempC: 8, feelsLikeC: 6, condition: "Wind" }),
          timeZone: "America/Chicago",
        },
      }),
    );

    expect(screen.getByText("46° · Wind")).toHaveClass("text-dialed-text");
    expect(screen.getByText("Tue Aug 12 · 1:30 AM")).toBeVisible();
  });

  it("says Indoor when the run was, and nothing when it just has no weather", async () => {
    await renderFeedScreen(detail({ indoor: true }));
    expect(screen.getByText("Indoor")).toHaveClass("text-muted");
  });

  it("says nothing at all about conditions it does not have", async () => {
    await renderFeedScreen(detail());
    expect(part("run-strip")?.children).toHaveLength(2);
  });
});

describe("EntryDetail: the owner's verdict prompt", () => {
  it("takes the badge's place, directly under the strip, and opens A3", async () => {
    await renderFeedScreen(
      detail({ verdict: 0 }, { viewerId: OWNER, shouldPrompt: true }),
    );

    const prompt = screen.getByRole("link", { name: /didn’t log a verdict/u });
    expect(prompt).toHaveAttribute("href", "/feed/verdict/01ENTRY");
    expect(prompt).toHaveAttribute("data-part", "verdict-prompt");
    expect(prompt).toHaveTextContent(
      "You didn’t log a verdict for this run. Add one?Did it work?",
    );
    expect(prompt).toHaveClass("bg-dialed-tint", "border-teal", "rounded-none");
    expect(part("run-strip")?.nextElementSibling).toBe(prompt);
    // In the badge's place: not both.
    expect(part("verdict-badge")).toBeNull();
  });

  it("is absent when the entry is not owed one", async () => {
    await renderFeedScreen(detail());
    expect(part("verdict-prompt")).toBeNull();
  });

  it("spends the once-only budget by showing, once, and only when shown", async () => {
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
          {detail({}, { shouldPrompt: prompt, recordPrompted })}
        </>
      );
    }

    await renderFeedScreen(<LatePrompt />);
    expect(recordPrompted).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "The prompt arrives" }),
    );
    await waitFor(() => {
      expect(recordPrompted).toHaveBeenCalledWith({
        data: { entryId: "01ENTRY" },
      });
    });
    // A re-render with nothing relevant changed spends nothing more.
    await user.click(screen.getByRole("button", { name: /Useful/u }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Useful/u })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(recordPrompted).toHaveBeenCalledTimes(1);
  });
});

describe("EntryDetail: the photos", () => {
  it("pages them one at a time, each with its own counter", async () => {
    await renderFeedScreen(detail({ photoKeys: ["a.jpg", "b.jpg"] }));

    const pager = part("photo");
    expect(pager).toHaveClass("snap-x", "snap-mandatory", "overflow-x-auto");
    const images = [...document.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toStrictEqual([
      "/feed/photo/a.jpg",
      "/feed/photo/b.jpg",
    ]);
    expect(screen.getByText("1 / 2")).toHaveClass("font-mono");
    expect(screen.getByText("2 / 2")).toBeVisible();
  });
});

describe("EntryDetail: the note, the kit and the tags", () => {
  it("shows the note when there is one", async () => {
    await renderFeedScreen(detail({ caption: "Wore the shell." }));
    expect(part("note")).toHaveTextContent("Wore the shell.");
  });

  it("lists the kit, brand first where there is one", async () => {
    await renderFeedScreen(
      detail({
        items: [
          item(),
          item({ itemId: "01B", brand: undefined, name: "L/S crew" }),
        ],
      }),
    );

    const rows = part("kit")?.querySelectorAll("li") ?? [];
    expect([...rows].map((row) => row.textContent)).toStrictEqual([
      "Patagonia Houdini",
      "L/S crew[Generic]",
    ]);
    expect(screen.getByText("Kit")).toHaveClass("font-mono");
  });

  it("marks a generic piece [GENERIC], and only that one", async () => {
    await renderFeedScreen(
      detail({
        items: [
          item({ itemId: "01A", brand: undefined, name: "Tights" }),
          item({ itemId: "01B" }),
        ],
      }),
    );

    expect(screen.getAllByText("[Generic]")).toHaveLength(1);
    expect(screen.getByText("[Generic]")).toHaveClass(
      "font-mono",
      "text-label",
    );
  });

  it("puts a flag at the row's end, in words, and Fine shows nothing", async () => {
    await renderFeedScreen(
      detail({
        items: [
          item({ itemId: "01A", flag: "too_much" }),
          item({ itemId: "01B", name: "Gloves", flag: "not_enough" }),
          item({ itemId: "01C", name: "Tights" }),
        ],
      }),
    );

    expect(screen.getByText("[Too much]")).toHaveClass(
      "font-mono",
      "font-semibold",
    );
    expect(screen.getByText("[Not enough]")).toBeVisible();
    const rows = part("kit")?.querySelectorAll("li") ?? [];
    expect(rows[2]).toHaveTextContent(/^Patagonia Tights$/u);
    expect(rows[2]?.children).toHaveLength(1);
  });

  it("reads the tags in A3's words on the track fill, and drops a stored word that is not one", async () => {
    await renderFeedScreen(
      detail({ tags: ["hands_cold", "not_a_tag", "chafed"] }),
    );

    const chips = part("tags")?.querySelectorAll("li") ?? [];
    expect([...chips].map((chip) => chip.textContent)).toStrictEqual([
      "hands cold",
      "chafed",
    ]);
    expect(chips[0]).toHaveClass("bg-tint");
  });

  it("draws no tag row when no stored word is a tag", async () => {
    await renderFeedScreen(detail({ tags: ["not_a_tag"] }));
    expect(part("tags")).toBeNull();
  });
});

describe("EntryDetail: Useful and Report", () => {
  it("leaves both off the runner's own entry — they are what others say", async () => {
    await renderFeedScreen(detail({ usefulCount: 3 }, { viewerId: OWNER }));

    expect(screen.queryByRole("button", { name: /Useful/u })).toBeNull();
    expect(part("report")).toBeNull();
    expect(partsInOrder()).toStrictEqual(["run-strip"]);
  });

  it("is Useful on the control-failure pattern, announced in the screen's region", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      detail(
        { usefulCount: 11 },
        { setUseful: () => Promise.reject(new TypeError("offline")) },
      ),
    );

    await user.click(screen.getByRole("button", { name: /Useful/u }));

    expect(await screen.findByText("Not marked")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not marked. Your connection dropped.",
    );
  });

  it("says nothing in its status region until something happens", async () => {
    await renderFeedScreen(detail());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("puts Report at the foot, in a quiet line", async () => {
    await renderFeedScreen(detail());
    const report = part("report");
    expect(report).toHaveTextContent("Report this entry");
    expect(report).toHaveClass("text-small", "text-label");
  });
});
