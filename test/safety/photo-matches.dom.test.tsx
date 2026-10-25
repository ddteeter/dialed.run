import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PhotoMatches,
  RemovedMatchLine,
} from "../../src/modules/safety/components/PhotoMatches";
import { RemovalRequests } from "../../src/modules/safety/components/RemovalRequests";
import { ReviewQueue } from "../../src/modules/safety/components/ReviewQueue";
import type { PhotoMatch } from "../../src/modules/safety/photo-matches";
import type { QueueRow } from "../../src/modules/safety/review";
import type { PendingTakedownRequest } from "../../src/modules/safety/takedown-requests";
import { renderWithRouter } from "../modules/run-fixtures";

/**
 * D-142 (design 146): a Review row about an intimate image lists the
 * photos that match it by fingerprint, from any runner, each named so the
 * operator can act on it.
 */
const KIT = "01JKIT00000000000000000001";
const PHOTO = "01JPHOTO000000000000000001";
const HIDDEN = "01JPHOTO000000000000000002";
const GARMENT = "01JITEM0000000000000000001";

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
  },
];

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("PhotoMatches", () => {
  it("lists each match as an operator's image, named, linking only a kit an operator can open", async () => {
    await renderWithRouter(
      <PhotoMatches found={{ fingerprinted: true, matches: MATCHES }} />,
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
      <PhotoMatches found={{ fingerprinted: true, matches: MATCHES }} />,
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
          matches: [
            {
              kind: "garment",
              id: GARMENT,
              photoKey: "items/u/i/v1/card.webp",
              canOpen: false,
              distance: 1,
              ownerId: "u-kim",
              handle: undefined,
            },
          ],
        }}
      />,
    );
    expect(part("match-distance")?.textContent).toBe("1 bit");
  });

  it("says when nothing matches", async () => {
    await renderWithRouter(
      <PhotoMatches found={{ fingerprinted: true, matches: [] }} />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · any runnerNo matching photos from any runner.",
    );
  });

  it("says when there was nothing to match by, rather than that nothing matched", async () => {
    await renderWithRouter(
      <PhotoMatches found={{ fingerprinted: false, matches: [] }} />,
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
  const found = { fingerprinted: true, matches: MATCHES.slice(0, 1) };

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

  it("says when the image it copies was removed, and how many bits apart", async () => {
    await renderWithRouter(
      <RemovedMatchLine match={{ distance: 3, removedAt: REMOVED_AT }} />,
    );
    const line = part("removed-match");
    expect(line).toHaveTextContent(
      /^A copy of an image removed as intimate on Oct 9, 3 bits apart\.$/u,
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
      photoMatches: { fingerprinted: true, matches: [] },
      removedMatch: { distance: 0, removedAt: REMOVED_AT },
      subject: { photoKeys: [] },
    };
    await renderWithRouter(
      <ReviewQueue queue={[row]} resolve={vi.fn()} reviewHandle={vi.fn()} />,
    );
    expect(part("removed-match")).toHaveTextContent("0 bits apart");
    expect(part("photo-matches")).not.toBeNull();
    expect(screen.getByText("[fingerprint]")).toBeVisible();
  });
});
