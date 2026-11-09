import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeskKit } from "../../src/modules/safety/components/DeskKit";
import type { DeskKit as Kit } from "../../src/modules/safety/desk-kit";
import { renderWithRouter } from "../modules/run-fixtures";

/**
 * R-154 (#388, design 188; Design 153, #527): the kit an operator opens
 * in place, whatever its audience or state.
 */

const KIT_ID = "01JKIT00000000000000000001";
const PHOTO_1 = "01JPHOTO000000000000000001";
const PHOTO_2 = "01JPHOTO000000000000000002";

/**
 * A private kit hidden pending review: two photos, one not yet screened,
 * and two garments, one with a brand. Sep 10 2026, 12:00 UTC.
 */
function kit(overrides: Partial<Kit> = {}): Kit {
  return {
    id: KIT_ID,
    runnerId: "01JRUNNER00000000000000001",
    handle: "k_lopes",
    audience: "private",
    moderationStatus: "hidden_pending_review",
    verdict: -1,
    caption: "Cold start",
    createdAt: 1_789_041_600,
    run: { title: "Morning loop", startedAt: 1_789_041_600 },
    photos: [
      { id: PHOTO_1, photoKey: "entries/u/k/1", screenStatus: "pass" },
      { id: PHOTO_2, photoKey: "entries/u/k/2", screenStatus: "pending" },
    ],
    garments: [
      {
        id: "g1",
        name: "Thermal tights",
        brand: undefined,
        category: "bottom",
      },
      { id: "g2", name: "Wind shell", brand: "Patagonia", category: "top" },
    ],
    ...overrides,
  };
}

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("DeskKit", () => {
  it("names whose kit it is, who may see it and where review left it", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Kit" }),
    ).toBeInTheDocument();
    expect(part("kit-band")).toHaveTextContent(
      "@k_lopes[private][hidden pending review]",
    );
    expect(screen.getByRole("link", { name: "@k_lopes" })).toHaveAttribute(
      "href",
      "/desk/runners?query=k_lopes&filter=all",
    );
    expect(screen.getByText(KIT_ID).parentElement).toHaveClass("select-all");
  });

  it.each([
    ["runners", "ok", "[shared][live]"],
    ["private", "removed", "[private][removed]"],
  ] as const)(
    "says %s as the audience's word and %s as review's",
    async (audience, moderationStatus, words) => {
      await renderWithRouter(
        <DeskKit kit={kit({ audience, moderationStatus })} />,
      );

      expect(part("kit-band")).toHaveTextContent(`@k_lopes${words}`);
    },
  );

  it("names a runner with no handle by their account id, unlinked", async () => {
    await renderWithRouter(<DeskKit kit={kit({ handle: undefined })} />);

    expect(part("kit-band")).toHaveTextContent(
      /^01JRUNNER00000000000000001\[/u,
    );
    expect(screen.queryByRole("link", { name: /^@/u })).not.toBeInTheDocument();
  });

  it("shows the run, the verdict and the caption", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    expect(part("kit-run")).toHaveTextContent("Morning loop · Sep 10");
    // Read from the one scale, not restated.
    expect(part("kit-verdict")).toHaveTextContent(/^A bit cold$/u);
    expect(part("kit-caption")).toHaveTextContent("Cold start");
  });

  it("leaves out a run since deleted, and a caption never written", async () => {
    await renderWithRouter(
      <DeskKit
        kit={kit({
          run: undefined,
          caption: undefined,
          verdict: undefined,
        })}
      />,
    );

    expect(part("kit-run")).toBeNull();
    expect(part("kit-caption")).toBeNull();
    expect(part("kit-verdict")).toHaveTextContent("No verdict");
  });

  it("serves every photo through the reviewer route, with its id, and says which is not yet screened", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Photos · 2" }),
    ).toBeInTheDocument();
    const images = screen.getAllByRole("img");
    expect(images.map((image) => image.getAttribute("src"))).toStrictEqual([
      "/desk/review-photo/entries/u/k/1",
      "/desk/review-photo/entries/u/k/2",
    ]);
    expect(images.map((image) => image.getAttribute("alt"))).toStrictEqual([
      PHOTO_1,
      PHOTO_2,
    ]);
    const statuses = screen.getAllByText(/screening:/u);
    expect(statuses.map((status) => status.textContent)).toStrictEqual([
      "[screening: pending]",
    ]);
  });

  it("lists the garments by name, brand and category", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    const garments = part("kit-garments");
    expect(
      screen.getByRole("heading", { level: 2, name: "Garments" }),
    ).toBeInTheDocument();
    expect(
      [...(garments?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
    ).toStrictEqual([
      "Thermal tights · bottom",
      "Wind shell · Patagonia · top",
    ]);
  });

  it("says so when a kit has no photos or garments", async () => {
    await renderWithRouter(<DeskKit kit={kit({ photos: [], garments: [] })} />);

    expect(part("kit-photos")).toHaveTextContent("No photos on this kit.");
    expect(part("kit-garments")).toHaveTextContent("No garments on this kit.");
  });

  it("says no kit has the id, and still leads back to Review", async () => {
    await renderWithRouter(<DeskKit kit={undefined} />);

    expect(part("desk-kit")).toHaveTextContent(
      "No kit has this id. It may be deleted.",
    );
    expect(part("kit-band")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to Review" }),
    ).toHaveAttribute("href", "/desk/review");
  });
});
