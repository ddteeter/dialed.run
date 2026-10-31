import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  PhotoMatches,
  RemovedMatchLine,
  type DecideMatch,
} from "../../src/modules/safety/components/PhotoMatches";
import { RemovalRequests } from "../../src/modules/safety/components/RemovalRequests";
import { ReviewQueue } from "../../src/modules/safety/components/ReviewQueue";
import type { PhotoMatch } from "../../src/modules/safety/photo-matches";
import type { RemovedImage } from "../../src/modules/safety/removed-fingerprints";
import type { QueueRow } from "../../src/modules/safety/review";
import type { PendingTakedownRequest } from "../../src/modules/safety/takedown-requests";
import { renderWithRouter } from "../modules/run-fixtures";
import { bracketed } from "../ui/bracketed";

/**
 * D-142 (design 146): a Review row about an intimate image lists the
 * photos that match it by fingerprint, from any runner, each named so the
 * operator can act on it.
 */
const KIT = "01JKIT00000000000000000001";
const PHOTO = "01JPHOTO000000000000000001";
const HIDDEN = "01JPHOTO000000000000000002";
// A ULID in Crockford's alphabet, which a garment takedown's input parses.
const GARMENT = "01JGARMENT0000000000000001";

const REMOVED: RemovedImage = {
  keptId: "k-1",
  id: "ph_2m8q",
  kind: "kit",
  handle: "j_runs",
  distance: 3,
  removedAt: Date.UTC(2025, 9, 3, 12) / 1000,
};

const MATCHES: readonly PhotoMatch[] = [
  {
    kind: "kit",
    id: PHOTO,
    entryId: KIT,
    photoKey: "entries/u/k/1",
    canOpen: true,
    isPrivate: false,
    distance: 0,
    ownerId: "u-maya",
    handle: "maya_runs",
  },
  {
    kind: "kit",
    id: HIDDEN,
    entryId: KIT,
    photoKey: "entries/u/k/2",
    canOpen: false,
    isPrivate: true,
    distance: 2,
    ownerId: "u-kim",
    handle: "k_lopes",
  },
  {
    kind: "garment",
    id: GARMENT,
    photoKey: "items/u/i/v1/card.webp",
    canOpen: false,
    distance: 5,
    ownerId: "u-kim",
    handle: undefined,
    isPrivate: false,
  },
];

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("PhotoMatches", () => {
  it("lists each match as an operator's image, named, linking only a kit an operator can open", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{ fingerprinted: true, isCutOff: false, matches: MATCHES }}
      />,
    );

    const block = part("photo-matches");
    expect(block).toHaveTextContent(/^Matching photos · any runner · 3/u);
    const links = within(block ?? document.body)
      .getAllByRole("link")
      .filter((link) => link.dataset.part !== "match-owner");
    expect(links.map((link) => link.getAttribute("href"))).toStrictEqual([
      `/feed/entry/${KIT}`,
    ]);
    expect(links[0]).toHaveClass("target");
    expect(
      screen.getByRole("link", {
        name: `${PHOTO}, 0 bits from the reported photo: open its kit`,
      }),
    ).toBeInTheDocument();
    expect(
      within(block ?? document.body)
        .getAllByRole("img")
        .map((image) => [image.getAttribute("src"), image.getAttribute("alt")]),
    ).toStrictEqual([
      [
        "/safety/review-photo/entries/u/k/1",
        `${PHOTO}, 0 bits from the reported photo: open its kit`,
      ],
      [
        "/safety/review-photo/entries/u/k/2",
        `${HIDDEN}, 2 bits from the reported photo`,
      ],
      [
        "/safety/review-photo/items/u/i/v1/card.webp",
        `Garment ${GARMENT}, 5 bits from the reported photo`,
      ],
    ]);
    expect(screen.getByText(PHOTO)).toHaveClass("font-mono");
    expect(screen.getByText(`Garment ${GARMENT}`)).toHaveClass("font-mono");
  });

  it("says under each how near it is, whether it is private, and whose (round 39 #71)", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{ fingerprinted: true, isCutOff: false, matches: MATCHES }}
      />,
    );

    const distances = [
      ...document.querySelectorAll<HTMLElement>("[data-part='match-distance']"),
    ];
    expect(distances.map((line) => line.textContent)).toStrictEqual([
      "same",
      "2 bits · [private]",
      "5 bits",
    ]);
    for (const line of distances) expect(line).toHaveClass("uppercase");
    const owners = [
      ...document.querySelectorAll<HTMLElement>("[data-part='match-owner']"),
    ];
    expect(owners.map((owner) => owner.textContent)).toStrictEqual([
      "@maya_runs",
      "@k_lopes",
    ]);
    expect(owners.map((owner) => owner.getAttribute("href"))).toStrictEqual([
      "/desk/runners?query=maya_runs&filter=all",
      "/desk/runners?query=k_lopes&filter=all",
    ]);
    expect(owners[0]).toHaveClass("target");
  });

  it("says a bit in the singular", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{
          fingerprinted: true,
          isCutOff: false,
          matches: [
            {
              kind: "garment",
              id: GARMENT,
              photoKey: "items/u/i/v1/card.webp",
              canOpen: false,
              distance: 1,
              ownerId: "u-kim",
              handle: undefined,
              isPrivate: false,
            },
          ],
        }}
      />,
    );
    expect(part("match-distance")?.textContent).toBe("1 bit");
  });

  it("says when nothing matches", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{ fingerprinted: true, isCutOff: false, matches: [] }}
      />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · any runnerNo matching photos from any runner.",
    );
  });

  it("says when there was nothing to match by, rather than that nothing matched", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{ fingerprinted: false, isCutOff: false, matches: [] }}
      />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · any runnerNo fingerprint to match by: the photo is gone, or older than fingerprints.",
    );
  });

  it("renders nothing on a row that does not search", async () => {
    await renderWithRouter(<PhotoMatches found={undefined} />);
    expect(part("photo-matches")).toBeNull();
  });
});

describe("on Review's rows", () => {
  const found = {
    fingerprinted: true,
    isCutOff: false,
    matches: MATCHES.slice(0, 1),
  };

  it("sits on a queue row an intimate report started", async () => {
    const row: QueueRow = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      subjectType: "entry",
      subjectId: KIT,
      source: "reports",
      createdAt: 1_755_000_000,
      reporterCount: 1,
      reasons: ["intimate"],
      due: "Due in 31h",
      otherPhotos: { photos: [], total: 0, handle: undefined },
      photoMatches: found,
      subject: { photoKeys: [] },
    };
    await renderWithRouter(
      <ReviewQueue queue={[row]} resolve={vi.fn()} reviewHandle={vi.fn()} />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      /^Matching photos · any runner · 1/u,
    );
  });

  it("sits on a removal request whose link is ours", async () => {
    const request: PendingTakedownRequest = {
      id: "01JREQUEST0000000000000001",
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      location: `https://dialed.run/feed/entry/${KIT}`,
      description: undefined,
      posterUsername: undefined,
      subject: { subjectType: "entry", subjectId: KIT, entryId: KIT },
      createdAt: 1,
      dueAt: 2,
      due: "Due in 31h",
      holdState: "held",
      relatedIds: [],
      otherPhotos: { photos: [], total: 0, handle: undefined },
      photoMatches: found,
    };
    await renderWithRouter(
      <RemovalRequests requests={[request]} decide={vi.fn()} block={vi.fn()} />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      /^Matching photos · any runner · 1/u,
    );
  });
});

/**
 * D-147 (design 152): a row a fingerprint match started says what the
 * photo is a copy of — the day the image was removed and how near it is.
 */
describe("RemovedMatchLine", () => {
  // Midday UTC, so the day is the same in every zone a test runs in.
  const REMOVED_AT = Date.UTC(2025, 9, 9, 12) / 1000;

  it("says when the image it matches was removed, and how many bits apart", async () => {
    await renderWithRouter(
      <RemovedMatchLine match={{ distance: 3, removedAt: REMOVED_AT }} />,
    );
    const line = part("removed-match");
    expect(line).toHaveTextContent(
      /^A close match to an image removed as intimate on Oct 9, 3 bits apart\.$/u,
    );
    expect(screen.getByText("Oct 9")).toHaveClass("font-mono");
    expect(screen.getByText("3 bits")).toHaveClass("font-mono");
  });

  it("says one bit in the singular", async () => {
    await renderWithRouter(
      <RemovedMatchLine match={{ distance: 1, removedAt: REMOVED_AT }} />,
    );
    expect(part("removed-match")).toHaveTextContent(/, 1 bit apart\.$/u);
  });

  it("calls it the same image at 0 bits, with no distance", async () => {
    await renderWithRouter(
      <RemovedMatchLine match={{ distance: 0, removedAt: REMOVED_AT }} />,
    );
    expect(part("removed-match")).toHaveTextContent(
      /^The same image as one removed as intimate on Oct 9\.$/u,
    );
    expect(screen.getByText("Oct 9")).toHaveClass("font-mono");
  });

  it("renders nothing on any other row", async () => {
    await renderWithRouter(<RemovedMatchLine match={undefined} />);
    expect(part("removed-match")).toBeNull();
  });

  it("sits on a fingerprint row on Review, beside the search for copies", async () => {
    const row: QueueRow = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZZY",
      subjectType: "photo",
      subjectId: PHOTO,
      source: "fingerprint",
      createdAt: 1_755_000_000,
      reporterCount: 0,
      reasons: [],
      otherPhotos: { photos: [], total: 0, handle: undefined },
      photoMatches: { fingerprinted: true, isCutOff: false, matches: [] },
      removedMatches: [
        { ...REMOVED, distance: 0 },
        { ...REMOVED, keptId: "k-2", id: "ph_far", distance: 6 },
      ],
      subject: { photoKeys: [] },
    };
    await renderWithRouter(
      <ReviewQueue queue={[row]} resolve={vi.fn()} reviewHandle={vi.fn()} />,
    );
    expect(part("removed-match")).toHaveTextContent("The same image");
    expect(part("photo-matches")).not.toBeNull();
    expect(screen.getByText(bracketed("held on upload"))).toBeVisible();
    // The line names the nearest; the grid has a tile for each.
    expect(
      document.querySelectorAll('[data-part="removed-tile"]'),
    ).toHaveLength(2);
  });
});

/**
 * Round 41 #84 and round 42: in MATCHING PHOTOS, each image removed as
 * intimate within range is an empty frame reading REMOVED, never the image.
 */
describe("a removed image's tile", () => {
  const REMOVED_AT = Date.UTC(2025, 9, 3, 12) / 1000;
  const NONE = { fingerprinted: true, isCutOff: false, matches: [] } as const;

  it("is an empty frame with the photo's id, its distance and day, and its owner", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={NONE}
        removed={[{ ...REMOVED, removedAt: REMOVED_AT }]}
      />,
    );
    const tile = part("removed-tile");
    expect(tile).not.toBeNull();
    const inTile = within(tile ?? document.body);
    expect(inTile.getByText("Removed")).toHaveClass("font-mono");
    expect(inTile.getByText("ph_2m8q")).toBeVisible();
    expect(inTile.getByText("3 bits · removed Oct 3")).toHaveClass("font-mono");
    expect(inTile.getByRole("link", { name: "@j_runs" })).toHaveAttribute(
      "href",
      expect.stringContaining("/desk/runners"),
    );
    // Never the image, and nothing else opens from it.
    expect(tile?.querySelector("img")).toBeNull();
    expect(inTile.getAllByRole("link")).toHaveLength(1);
    expect(inTile.queryByRole("button")).toBeNull();
  });

  it("names a garment as one, and offers no owner without a handle", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={NONE}
        removed={[
          {
            ...REMOVED,
            kind: "garment",
            id: "g-1",
            handle: undefined,
            distance: 1,
          },
        ]}
      />,
    );
    const inTile = within(part("removed-tile") ?? document.body);
    expect(inTile.getByText("Garment g-1")).toBeVisible();
    expect(inTile.getByText(/^1 bit · removed/u)).toBeVisible();
    expect(inTile.queryByRole("link")).toBeNull();
  });

  it("comes before the matches, counted with them", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{ fingerprinted: true, isCutOff: false, matches: MATCHES }}
        removed={[REMOVED, { ...REMOVED, keptId: "k-2" }]}
      />,
    );
    expect(
      screen.getByText(
        `Matching photos · any runner · ${String(MATCHES.length + 2)}`,
      ),
    ).toBeVisible();
    const tiles = part("photo-matches")?.querySelectorAll("li") ?? [];
    expect(tiles[0]).toHaveAttribute("data-part", "removed-tile");
    expect(tiles[1]).toHaveAttribute("data-part", "removed-tile");
    expect(tiles[2]).not.toHaveAttribute("data-part", "removed-tile");
  });

  it("lists one removed image beside one match, not the empty state", async () => {
    const [first] = MATCHES;
    await renderWithRouter(
      <PhotoMatches
        found={{
          fingerprinted: true,
          isCutOff: false,
          matches: first ? [first] : [],
        }}
        removed={[REMOVED]}
      />,
    );
    expect(
      screen.queryByText("No matching photos from any runner."),
    ).toBeNull();
    expect(part("photo-matches")?.querySelectorAll("li")).toHaveLength(2);
  });

  it("stands in for the empty state when it is all there is", async () => {
    await renderWithRouter(<PhotoMatches found={NONE} removed={[REMOVED]} />);
    expect(
      screen.queryByText("No matching photos from any runner."),
    ).toBeNull();
    expect(screen.getByText("Matching photos · any runner · 1")).toBeVisible();
  });
});

async function chooseReason(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Why it comes down/u }),
    "it's sexual or explicit",
  );
}

/**
 * R-167 (design 159): a garment found by copy search is taken down from
 * its tile, with a garment row's own bar and no Approve.
 */
describe("a garment match's takedown", () => {
  const GARMENT_MATCH: PhotoMatch = {
    kind: "garment",
    id: GARMENT,
    photoKey: "items/u/i/v1/card.webp",
    canOpen: false,
    distance: 5,
    ownerId: "u-kim",
    handle: "k_lopes",
    isPrivate: false,
  };
  const found = {
    fingerprinted: true,
    isCutOff: false,
    matches: [...MATCHES.slice(0, 1), GARMENT_MATCH],
  };

  it("offers Remove and Remove as suspected CSAM on the garment's tile only, never Approve", async () => {
    await renderWithRouter(<PhotoMatches found={found} decide={vi.fn()} />);

    const tiles = [...(part("photo-matches")?.querySelectorAll("li") ?? [])];
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0] ?? document.body).queryByRole("button")).toBeNull();
    const garment = within(tiles[1] ?? document.body);
    expect(garment.getByRole("button", { name: "Remove" })).toBeVisible();
    expect(
      garment.getByRole("button", { name: "Remove as suspected CSAM" }),
    ).toBeVisible();
    expect(garment.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("offers nothing where no takedown was handed down", async () => {
    await renderWithRouter(<PhotoMatches found={found} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("removes the garment's photo with the reason, and the tile leaves the list", async () => {
    const user = userEvent.setup();
    const decide = vi
      .fn<DecideMatch>()
      .mockResolvedValue({ outcome: "removed" });
    await renderWithRouter(<PhotoMatches found={found} decide={decide} />);

    await chooseReason(user);
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(decide).toHaveBeenCalledExactlyOnceWith({
      data: { itemId: GARMENT, action: "remove", reason: "explicit" },
    });
    await waitFor(() => {
      expect(screen.queryByText(`Garment ${GARMENT}`)).toBeNull();
    });
    expect(screen.getByText(PHOTO)).toBeVisible();
  });

  it("asks again before a quarantine, naming the garment photo and its owner", async () => {
    const user = userEvent.setup();
    const decide = vi
      .fn<DecideMatch>()
      .mockResolvedValue({ outcome: "removed" });
    await renderWithRouter(<PhotoMatches found={found} decide={decide} />);

    await chooseReason(user);
    await user.click(
      screen.getByRole("button", { name: "Remove as suspected CSAM" }),
    );

    expect(decide).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Remove this garment photo everywhere and keep the evidence for the report?",
      ),
    ).toBeVisible();
    expect(screen.getByText(/@k_lopes's account stays open\./u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove and report" }));

    expect(decide).toHaveBeenCalledExactlyOnceWith({
      data: { itemId: GARMENT, action: "quarantine", reason: "explicit" },
    });
  });

  it("is handed down to Review's rows and removal requests", async () => {
    const decide = vi.fn<DecideMatch>();
    const matches = {
      fingerprinted: true,
      isCutOff: false,
      matches: [GARMENT_MATCH],
    };
    const row: QueueRow = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZZX",
      subjectType: "entry",
      subjectId: KIT,
      source: "reports",
      createdAt: 1_755_000_000,
      reporterCount: 1,
      reasons: ["intimate"],
      otherPhotos: { photos: [], total: 0, handle: undefined },
      photoMatches: matches,
      subject: { photoKeys: [] },
    };
    const request: PendingTakedownRequest = {
      id: "01JREQUEST0000000000000002",
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      location: `https://dialed.run/feed/entry/${KIT}`,
      description: undefined,
      posterUsername: undefined,
      subject: { subjectType: "entry", subjectId: KIT, entryId: KIT },
      createdAt: 1,
      dueAt: 2,
      due: "Due in 31h",
      holdState: "held",
      relatedIds: [],
      otherPhotos: { photos: [], total: 0, handle: undefined },
      photoMatches: matches,
    };
    await renderWithRouter(
      <>
        <RemovalRequests
          requests={[request]}
          decide={vi.fn()}
          block={vi.fn()}
          decideMatch={decide}
        />
        <ReviewQueue
          queue={[row]}
          resolve={vi.fn()}
          reviewHandle={vi.fn()}
          decideMatch={decide}
        />
      </>,
    );

    const blocks = [
      ...document.querySelectorAll<HTMLElement>("[data-part='photo-matches']"),
    ];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(
        within(block).getByRole("button", { name: "Remove as suspected CSAM" }),
      ).toBeVisible();
    }
  });
});

/**
`count` kit matches, each a different runner's, or all one runner's.
*/
function matchesFrom(count: number, runners: number): PhotoMatch[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "kit" as const,
    id: `ph-${String(index)}`,
    entryId: KIT,
    photoKey: `entries/u/k/${String(index)}`,
    canOpen: true,
    isPrivate: false,
    distance: 1,
    ownerId: `u-${String(index % runners)}`,
    handle: undefined,
  }));
}

describe("a list cut off, and a picture many runners share (design 164)", () => {
  it("counts a list cut off at the limit as a floor", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{
          fingerprinted: true,
          isCutOff: true,
          matches: matchesFrom(12, 1),
        }}
      />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · any runner · 12+",
    );
  });

  it("says nothing of runners up to three", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{
          fingerprinted: true,
          isCutOff: false,
          matches: matchesFrom(6, 3),
        }}
      />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · any runner · 6",
    );
    expect(part("many-runners")).toBeNull();
  });

  it("warns above the matches when more than three runners' photos match", async () => {
    await renderWithRouter(
      <PhotoMatches
        found={{
          fingerprinted: true,
          isCutOff: false,
          matches: matchesFrom(4, 4),
        }}
      />,
    );
    const warning = part("many-runners");
    expect(warning?.textContent).toBe(
      "Photos from 4 runners matchA picture this common may not be one person's. Removed as intimate, it would hold every later upload that looks like it.",
    );
    expect(screen.getByText("Photos from 4 runners match")).toHaveClass(
      "text-hiviz-text",
    );
    expect(warning?.nextElementSibling?.tagName).toBe("UL");
  });
});
