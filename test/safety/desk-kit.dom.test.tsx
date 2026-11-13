import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeskKit } from "../../src/modules/safety/components/DeskKit";
import type { DeskKit as Kit } from "../../src/modules/safety/desk-kit";
import { renderWithRouter } from "../modules/run-fixtures";

/**
 * R-154 (#388, design 188; Round 51 · 153, #527): the kit an operator
 * opens in place, whatever its audience or state.
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
    run: {
      startedAt: 1_789_041_600,
      timeZone: "America/New_York",
      feelsLikeC: 5,
      moisture: "damp",
    },
    tempUnit: "f",
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

    // The board draws no heading: the page's h1 is for screen readers,
    // and names whose kit it is (round 52 #155.3).
    expect(
      screen.getByRole("heading", { level: 1, name: "Kit by @k_lopes" }),
    ).toHaveClass("sr-only");
    // R51·153: one bordered strip, dot-separated, the handle in its own
    // case and the words in capitals (G-18).
    expect(part("kit-band")).toHaveTextContent(
      /^@k_lopes · private · hidden pending review$/u,
    );
    expect(part("kit-band")).toHaveClass(
      "border",
      "border-hairline",
      "items-center",
      "font-mono",
    );
    expect(part("kit-band")).not.toHaveClass("uppercase");
    expect(part("kit-band")?.lastElementChild).toHaveClass("uppercase");
    expect(screen.getByRole("link", { name: "@k_lopes" })).not.toHaveClass(
      "uppercase",
    );
    expect(part("kit-band")?.nextElementSibling).toBe(part("kit-run"));
    expect(screen.getByRole("link", { name: "@k_lopes" })).toHaveAttribute(
      "href",
      "/desk/runners?query=k_lopes&filter=all",
    );
    // MONO.xs in --muted, selectable, so it can be copied into the
    // takedown form (round 52 #155.3).
    const id = screen.getByText(KIT_ID);
    expect(id).toHaveClass("font-mono", "text-mono-xs");
    expect(id.parentElement).toHaveClass("text-muted", "select-all");
  });

  it.each([
    ["runners", "ok", " · shared · live"],
    ["private", "removed", " · private · removed"],
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
      /^01JRUNNER00000000000000001 · /u,
    );
    expect(screen.queryByRole("link", { name: /^@/u })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Kit by 01JRUNNER00000000000000001",
      }),
    ).toBeInTheDocument();
  });

  it("lays the kit out in the board's order, its id last", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    const parts = [
      ...(part("desk-kit")?.querySelectorAll<HTMLElement>("[data-part]") ?? []),
    ].map((element) => element.dataset.part);
    expect(
      parts.filter((name) => name?.startsWith("kit-") === true),
    ).toStrictEqual([
      "kit-band",
      "kit-run",
      "kit-photos",
      "kit-verdict",
      "kit-garments",
      "kit-caption",
      "kit-id",
    ]);
    // The back link before everything, and the kit's id after the notes.
    expect(part("desk-kit")?.firstElementChild).toHaveTextContent(
      "Back to Review",
    );
    expect(part("desk-kit")?.lastElementChild).toHaveTextContent(KIT_ID);
  });

  it("says when in the run line: the day and start in the run's zone, the feels-like and the moisture, and no city", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    // Noon UTC is 8:00 AM in New York; 5 °C is 41 °F. No city: no run
    // stores a place (round 52 #155.1).
    const drawn = screen.getByText("Sep 10 · 8:00 AM · 41° · damp");
    expect(drawn).toHaveAttribute("aria-hidden", "true");
    // Said in words, out of the line's capitals (round 52 #158).
    expect(drawn.nextElementSibling).toHaveTextContent(
      /^Sep 10, 8:00 AM, 41 degrees, damp$/u,
    );
    expect(drawn.nextElementSibling).toHaveClass("sr-only", "normal-case");
    expect(part("kit-run")).toHaveClass("uppercase", "text-muted");
    expect(part("kit-run")?.firstElementChild).toHaveClass("font-mono");
  });

  it("gives the temperature in the operator's unit", async () => {
    await renderWithRouter(<DeskKit kit={kit({ tempUnit: "c" })} />);

    expect(part("kit-run")).toHaveTextContent(
      /^Sep 10 · 8:00 AM · 5° · dampSep 10, 8:00 AM, 5 degrees, damp$/u,
    );
  });

  it("leaves out what the run line has no value for, dating it in UTC with no zone", async () => {
    await renderWithRouter(
      <DeskKit
        kit={kit({
          run: {
            startedAt: 1_789_041_600,
            timeZone: undefined,
            feelsLikeC: undefined,
            moisture: undefined,
          },
        })}
      />,
    );

    expect(part("kit-run")).toHaveTextContent(
      /^Sep 10 · 12:00 PMSep 10, 12:00 PM$/u,
    );
  });

  it("shows the verdict and the notes", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

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

  it("says a removed kit's photos are deleted where they were, keeping its band and run line", async () => {
    await renderWithRouter(
      <DeskKit kit={kit({ moderationStatus: "removed" })} />,
    );

    expect(part("kit-photos")).toHaveTextContent(
      /^Removed\. Photos deleted\.$/u,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^Photos/u }),
    ).not.toBeInTheDocument();
    expect(part("kit-band")).toHaveTextContent(/ · removed$/u);
    expect(part("kit-run")).toHaveTextContent(/^Sep 10/u);
  });

  it.each([
    [{}, "Back to Review", "/desk/review"],
    [
      { from: "report", row: "01JROW0000000000000000001" },
      "Back to the report",
      "/desk/review#report-01JROW0000000000000000001",
    ],
    [
      { from: "request", row: "01JROW0000000000000000002" },
      "Back to the request",
      "/desk/review#request-01JROW0000000000000000002",
    ],
  ] as const)(
    "names where the operator came from (%o) and returns there",
    async (origin, label, href) => {
      await renderWithRouter(<DeskKit kit={kit()} origin={origin} />);

      const back = screen.getByRole("link", { name: label });
      expect(back).toHaveAttribute("href", href);
      expect(back).toHaveClass("target");
      // The board underlines its words (G-18).
      expect(within(back).getByText(label)).toHaveClass("underline");
    },
  );

  it("offers no action: the decisions stay on the row", async () => {
    await renderWithRouter(<DeskKit kit={kit()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
      screen.getByRole("heading", { level: 1, name: "Kit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Review" }),
    ).toHaveAttribute("href", "/desk/review");
  });
});
