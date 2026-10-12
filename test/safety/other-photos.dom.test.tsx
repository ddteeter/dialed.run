import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OtherPhotos } from "../../src/modules/safety/components/OtherPhotos";
import { RemovalRequests } from "../../src/modules/safety/components/RemovalRequests";
import { ReviewQueue } from "../../src/modules/safety/components/ReviewQueue";
import type { OtherPhoto } from "../../src/modules/safety/other-photos";
import type { QueueRow } from "../../src/modules/safety/review";
import type { PendingTakedownRequest } from "../../src/modules/safety/takedown-requests";
import { renderWithRouter } from "../modules/run-fixtures";

/**
 * D-117 (R-145 c): a Review row about an intimate image lists the same
 * runner's other photos, each opening its kit and carrying the id the
 * takedown form takes.
 */
const KIT = "01JKIT00000000000000000001";
const PHOTOS: readonly OtherPhoto[] = [
  { id: "01JPHOTO000000000000000001", entryId: KIT, photoKey: "entries/u/k/1" },
  { id: "01JPHOTO000000000000000002", entryId: KIT, photoKey: "entries/u/k/2" },
];

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("OtherPhotos", () => {
  it("lists each photo as an operator's image, opening its kit, with its id", async () => {
    await renderWithRouter(<OtherPhotos photos={PHOTOS} />);

    const block = part("other-photos");
    expect(block).toHaveTextContent(/^Their other photos · 2/u);
    const links = within(block ?? document.body).getAllByRole("link", {
      name: "Their other photo: open its kit",
    });
    expect(links.map((link) => link.getAttribute("href"))).toStrictEqual([
      `/feed/entry/${KIT}`,
      `/feed/entry/${KIT}`,
    ]);
    expect(links[0]).toHaveClass("target");
    expect(
      within(block ?? document.body)
        .getAllByRole("img")
        .map((image) => image.getAttribute("src")),
    ).toStrictEqual([
      "/safety/review-photo/entries/u/k/1",
      "/safety/review-photo/entries/u/k/2",
    ]);
    const id = screen.getByText("01JPHOTO000000000000000001");
    expect(id).toHaveClass("font-mono");
  });

  it("says when the runner has posted nothing else", async () => {
    await renderWithRouter(<OtherPhotos photos={[]} />);
    expect(part("other-photos")).toHaveTextContent(
      "Their other photos · 0No other photos from this runner.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when no runner is known", async () => {
    await renderWithRouter(<OtherPhotos photos={undefined} />);
    expect(part("other-photos")).toBeNull();
  });
});

describe("on Review's rows", () => {
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
      otherPhotos: PHOTOS,
      subject: { photoKeys: [] },
    };
    await renderWithRouter(
      <ReviewQueue queue={[row]} resolve={vi.fn()} reviewHandle={vi.fn()} />,
    );
    expect(part("other-photos")).toHaveTextContent(/^Their other photos · 2/u);
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
      otherPhotos: PHOTOS.slice(0, 1),
    };
    await renderWithRouter(
      <RemovalRequests requests={[request]} decide={vi.fn()} block={vi.fn()} />,
    );
    expect(part("other-photos")).toHaveTextContent(/^Their other photos · 1/u);
  });
});
