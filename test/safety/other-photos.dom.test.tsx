import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { shortId } from "../../src/modules/safety/components/short-id";
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
  { id: PHOTO_1, entryId: KIT, photoKey: "entries/u/k/1" },
  { id: PHOTO_2, entryId: KIT, photoKey: "entries/u/k/2" },
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
    // Inside a row of Review's h2 list: a heading of its own, one down.
    expect(
      screen.getByRole("heading", { level: 3, name: "Their other photos · 2" }),
    ).toBeInTheDocument();
    // Each named by its id, so a screen reader does not hear one name twice.
    const links = within(block ?? document.body).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toStrictEqual([
      `/desk/kit/${KIT}`,
      `/desk/kit/${KIT}`,
    ]);
    expect(links.map((link) => link.textContent)).toStrictEqual(["", ""]);
    expect(
      screen.getByRole("link", { name: `${PHOTO_1}: open its kit` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `${PHOTO_2}: open its kit` }),
    ).toBeInTheDocument();
    // R55·198: square tiles, three across, six across at 96 from desk.
    expect(links[0]).toHaveClass("block");
    expect(within(links[0] ?? document.body).getByRole("img")).toHaveClass(
      "aspect-square",
      "w-full",
      "object-cover",
    );
    expect(links[0]?.closest("ul")).toHaveClass(
      "grid",
      "grid-cols-3",
      "desk:grid-cols-[repeat(6,--spacing(24))]",
    );
    expect(
      within(block ?? document.body)
        .getAllByRole("img")
        .map((image) => image.getAttribute("src")),
    ).toStrictEqual([
      "/desk/review-photo/entries/u/k/1",
      "/desk/review-photo/entries/u/k/2",
    ]);
    // R55·198: each id drawn at its first and last four in MONO.xs, the
    // whole id its tooltip and what is said.
    const drawn = screen.getByText(shortId(PHOTO_1));
    expect(drawn).toHaveClass("font-mono", "text-mono-xs");
    expect(drawn.parentElement).toHaveAttribute("aria-hidden", "true");
    const said = screen.getByText(PHOTO_1);
    expect(said).toHaveClass("sr-only");
    expect(said.parentElement).toHaveAttribute("title", PHOTO_1);
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
  it("sits on a queue row an intimate report started, its kits opened from the report (Round 51 · 153)", async () => {
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
      <ReviewQueue
        asOf={0}
        onDecided={vi.fn()}
        queue={[row]}
        resolve={vi.fn()}
        reviewHandle={vi.fn()}
      />,
    );
    expect(part("other-photos")).toHaveTextContent(/^Their other photos · 2/u);
    expect(
      screen.getByRole("link", { name: `${PHOTO_1}: open its kit` }),
    ).toHaveAttribute(
      "href",
      `/desk/kit/${KIT}?from=report&row=01HZZZZZZZZZZZZZZZZZZZZZZZ`,
    );
    // The row the back link returns to.
    expect(
      document.querySelector("#report-01HZZZZZZZZZZZZZZZZZZZZZZZ"),
    ).toContainElement(part("other-photos"));
  });

  it("sits on a removal request whose link is ours, its kits opened from the request (Round 51 · 153)", async () => {
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
      <RemovalRequests
        asOf={0}
        requests={[request]}
        decide={vi.fn()}
        block={vi.fn()}
      />,
    );
    expect(part("other-photos")).toHaveTextContent(/^Their other photos · 1/u);
    expect(
      screen.getByRole("link", { name: `${PHOTO_1}: open its kit` }),
    ).toHaveAttribute(
      "href",
      `/desk/kit/${KIT}?from=request&row=01JREQUEST0000000000000001`,
    );
    expect(
      document.querySelector("#request-01JREQUEST0000000000000001"),
    ).toContainElement(part("other-photos"));
  });
});
