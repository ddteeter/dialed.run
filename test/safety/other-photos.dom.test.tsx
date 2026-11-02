import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OtherPhotos } from "../../src/modules/safety/components/OtherPhotos";
import { RemovalRequests } from "../../src/modules/safety/components/RemovalRequests";
import { ReviewQueue } from "../../src/modules/safety/components/ReviewQueue";
import type {
  OtherPhoto,
  OtherPhotos as Others,
} from "../../src/modules/safety/other-photos";
import type { QueueRow } from "../../src/modules/safety/review";
import type { PendingTakedownRequest } from "../../src/modules/safety/takedown-requests";
import { renderWithRouter } from "../modules/run-fixtures";

/**
 * D-117 (R-145 c): a Review row about an intimate image lists the same
 * runner's other photos, each opening its kit and carrying the id the
 * takedown form takes.
 */
const KIT = "01JKIT00000000000000000001";
const PHOTO_1 = "01JPHOTO000000000000000001";
const PHOTO_2 = "01JPHOTO000000000000000002";
const PHOTOS: readonly OtherPhoto[] = [
  { id: PHOTO_1, entryId: KIT, photoKey: "entries/u/k/1", canOpen: true },
  { id: PHOTO_2, entryId: KIT, photoKey: "entries/u/k/2", canOpen: true },
];

/**
The runner's other photos as a row carries them: all of them shown.
*/
function others(
  photos: readonly OtherPhoto[],
  overrides: Partial<Others> = {},
): Others {
  return { photos, total: photos.length, handle: "maya_runs", ...overrides };
}

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("OtherPhotos", () => {
  it("lists each photo as an operator's image, opening its kit, with its id", async () => {
    await renderWithRouter(<OtherPhotos others={others(PHOTOS)} />);

    const block = part("other-photos");
    expect(block).toHaveTextContent(/^Their other photos · 2/u);
    // Each named by its id, so a screen reader does not hear one name twice.
    const links = within(block ?? document.body).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toStrictEqual([
      `/feed/entry/${KIT}`,
      `/feed/entry/${KIT}`,
    ]);
    expect(links.map((link) => link.textContent)).toStrictEqual(["", ""]);
    expect(
      screen.getByRole("link", { name: `Photo ${PHOTO_1}: open its kit` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `Photo ${PHOTO_2}: open its kit` }),
    ).toBeInTheDocument();
    expect(links[0]).toHaveClass("target");
    expect(
      within(block ?? document.body)
        .getAllByRole("img")
        .map((image) => image.getAttribute("src")),
    ).toStrictEqual([
      "/safety/review-photo/entries/u/k/1",
      "/safety/review-photo/entries/u/k/2",
    ]);
    // MONO.sm, and one click selects it whole (round 38 #63a).
    const id = screen.getByText(PHOTO_1);
    expect(id).toHaveClass("font-mono", "text-mono-sm");
    expect(id.parentElement).toHaveClass("select-all");
    // All of them shown: nothing more to open.
    expect(part("more-photos")).toBeNull();
  });

  it("counts them all in the kicker, and opens the rest in Runners (round 38 #63a)", async () => {
    await renderWithRouter(
      <OtherPhotos others={others(PHOTOS, { total: 14 })} />,
    );

    expect(part("other-photos")).toHaveTextContent(/^Their other photos · 14/u);
    // Only MATCHING PHOTOS' kicker takes focus by script (round 42 #89).
    expect(
      screen.getByText(/^Their other photos · 14$/u).parentElement,
    ).not.toHaveAttribute("tabindex");
    const more = screen.getByRole("link", {
      name: "+ 12 more · Open @maya_runs in Runners",
    });
    expect(more).toHaveAttribute(
      "href",
      "/desk/runners?query=maya_runs&filter=all",
    );
    expect(more.parentElement).toHaveAttribute("data-part", "more-photos");
    expect(more.parentElement?.previousElementSibling?.tagName).toBe("UL");
  });

  it("counts the rest without a link for a runner with no handle", async () => {
    await renderWithRouter(
      <OtherPhotos others={others(PHOTOS, { total: 3, handle: undefined })} />,
    );
    expect(part("more-photos")).toHaveTextContent(/^\+ 1 more$/u);
    expect(
      within(part("more-photos") ?? document.body).queryByRole("link"),
    ).toBeNull();
  });

  it("shows a kit an operator cannot open as its image and id, with no link (review S4)", async () => {
    await renderWithRouter(
      <OtherPhotos
        others={others([
          {
            id: PHOTO_1,
            entryId: KIT,
            photoKey: "entries/u/k/1",
            canOpen: false,
          },
        ])}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("img", {
        name: `Photo ${PHOTO_1}, on a kit an operator cannot open`,
      }),
    ).toHaveAttribute("src", "/safety/review-photo/entries/u/k/1");
    expect(screen.getByText(PHOTO_1)).toHaveClass("font-mono");
  });

  it("says when the runner has posted nothing else, with no count", async () => {
    await renderWithRouter(<OtherPhotos others={others([])} />);
    expect(part("other-photos")).toHaveTextContent(
      /^Their other photosNo other photos from this runner\.$/u,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when no runner is known", async () => {
    await renderWithRouter(<OtherPhotos others={undefined} />);
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
      otherPhotos: others(PHOTOS),
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
      otherPhotos: others(PHOTOS.slice(0, 1)),
    };
    await renderWithRouter(
      <RemovalRequests requests={[request]} decide={vi.fn()} block={vi.fn()} />,
    );
    expect(part("other-photos")).toHaveTextContent(/^Their other photos · 1/u);
  });
});
