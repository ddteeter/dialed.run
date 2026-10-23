import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PhotoMatches } from "../../src/modules/safety/components/PhotoMatches";
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
    distance: 0,
  },
  {
    kind: "kit",
    id: HIDDEN,
    entryId: KIT,
    photoKey: "entries/u/k/2",
    canOpen: false,
    distance: 2,
  },
  {
    kind: "garment",
    id: GARMENT,
    photoKey: "items/u/i/v1/card.webp",
    canOpen: false,
    distance: 5,
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
    expect(block).toHaveTextContent(/^Matching photos · 3/u);
    const links = within(block ?? document.body).getAllByRole("link");
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

  it("says when nothing matches", async () => {
    await renderWithRouter(
      <PhotoMatches found={{ fingerprinted: true, matches: [] }} />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · 0No matching photos from any runner.",
    );
  });

  it("says when there was nothing to match by, rather than that nothing matched", async () => {
    await renderWithRouter(
      <PhotoMatches found={{ fingerprinted: false, matches: [] }} />,
    );
    expect(part("photo-matches")).toHaveTextContent(
      "Matching photos · 0No fingerprint to match by: the photo is gone, or older than fingerprints.",
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
      otherPhotos: [],
      photoMatches: found,
      subject: { photoKeys: [] },
    };
    await renderWithRouter(
      <ReviewQueue queue={[row]} resolve={vi.fn()} reviewHandle={vi.fn()} />,
    );
    expect(part("photo-matches")).toHaveTextContent(/^Matching photos · 1/u);
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
      otherPhotos: [],
      photoMatches: found,
    };
    await renderWithRouter(
      <RemovalRequests requests={[request]} decide={vi.fn()} block={vi.fn()} />,
    );
    expect(part("photo-matches")).toHaveTextContent(/^Matching photos · 1/u);
  });
});
