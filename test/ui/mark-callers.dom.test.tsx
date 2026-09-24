import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import type { CoverageBand } from "../../src/modules/feed";
import { OwnProfile } from "../../src/modules/feed/components/OwnProfile";
import type { OwnProfile as OwnProfileData } from "../../src/modules/feed/profiles";
import { CallLadder } from "../../src/modules/onboarding/components/CallLadder";
import { ladderFrom } from "../../src/modules/onboarding/ladder";

/**
 * Rule 10 · **every graphic has words** — asked of the callers, which is
 * where the answer actually lives.
 *
 * `CoverageMark` and `VerdictMark` are both `aria-hidden`, and the packet
 * is pointed about it: *"`CoverageMark` is deliberately `aria-hidden`
 * because every caller prints the level beside it — verify that claim
 * caller by caller before adding a label, or you will produce 'partial,
 * partial'."* The claim held: all four call sites print the word. But it
 * was a claim in a comment, and nothing made it true — a caller could drop
 * the word tomorrow and leave a mark that says nothing to anybody, with
 * `marks.dom.test.tsx` still green because the mark itself is unchanged.
 *
 * So the redundancy is tested from the outside: **the row the mark sits in
 * must read as a sentence with the mark deleted.** That is the same
 * property the contract asks of the coverage bar — *"the count line
 * beneath it is real text, not decoration — it is the accessible
 * equivalent, so it is never omitted"* — and it is what makes hiding the
 * graphic the right call rather than a lossy one.
 */

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const entryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/entry/$entryId",
    component: () => <p>An entry</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, entryRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function band(
  bandFloorC: number,
  counts: Partial<CoverageBand> = {},
): CoverageBand {
  return {
    bandFloorC,
    label: `${String(bandFloorC)}–${String(bandFloorC + 5)}°`,
    cold: 0,
    dialed: 0,
    warm: 0,
    ...counts,
  };
}

function ownProfile(coverage: readonly CoverageBand[]): OwnProfileData {
  return {
    userId: "01USER",
    displayName: undefined,
    cityLabel: undefined,
    thermalLevel: undefined,
    followerCount: 0,
    followingCount: 0,
    entryCount: 0,
    coverage: [...coverage],
    mostWornItems: [],
    recentEntries: [],
  };
}

/**
 * The text of the row a mark sits in, with the mark itself removed.
 *
 * Removing it is the whole method: what is left is what a screen reader
 * gets, because the mark is `aria-hidden`. Asserting against the row's
 * full `textContent` would pass on a mark that printed the word itself,
 * which is the thing being ruled out.
 */
function rowWithoutMark(mark: Element): string {
  const row = mark.closest("li");
  const copy = row?.cloneNode(true) as Element | undefined;
  const hiddenNodes = copy?.querySelectorAll("[aria-hidden='true']") ?? [];
  for (const hidden of hiddenNodes) {
    hidden.remove();
  }
  return copy?.textContent ?? "";
}

function marks(attribute: string): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`[${CSS.escape(attribute)}]`),
  ];
}

describe("CoverageMark's callers print the level", () => {
  it("says the word in every band row of the ladder", async () => {
    // O6's ladder: one row per band, the swatch between the temperature
    // and the level. Design's own line is the reason — "the counts are
    // there so the reading never depends on the swatch".
    // In a router: K's "Log a run" is a typed link.
    await renderWithRouter(
      <CallLadder
        ladder={ladderFrom([
          band(-5, { dialed: 1 }),
          band(0, { dialed: 4 }),
          band(5, { dialed: 9 }),
        ])}
      />,
    );

    const swatches = marks("data-coverage");
    expect(swatches.length).toBeGreaterThan(3);
    for (const swatch of swatches) {
      const level = swatch.dataset.coverage ?? "";
      expect(rowWithoutMark(swatch)).toContain(level);
    }
  });

  it("would fail if a caller dropped the word", () => {
    // The cases above can only say "the word is there", which a
    // `rowWithoutMark` that returned the mark's own text would also say.
    // This is the shape that must not pass.
    render(
      <ul>
        <li>
          <span aria-hidden="true" data-coverage="partial">
            partial
          </span>
        </li>
      </ul>,
    );
    const [swatch] = marks("data-coverage");
    expect(swatch).toBeDefined();
    expect(rowWithoutMark(swatch ?? document.body)).not.toContain("partial");
  });
});

describe("VerdictMark's caller prints the verdict", () => {
  it("reads differently for each verdict once the mark is removed", async () => {
    // G's "how you call it, by band". Three slots and a hue say the same
    // thing the word does; the word is the one a reader gets.
    //
    // **The three bands are identical but for the verdict**, which is what
    // makes this an assertion about the word rather than about the row.
    // Same floor, same label, same total — so if the readings still differ
    // three ways, the only thing that can be carrying it is text, and if
    // they do not, a reader hears the same sentence for under-dressed and
    // over-dressed.
    //
    // The words themselves are `OwnProfile`'s own copy and are not
    // restated here. Naming them would make this a second, rival copy of a
    // string the component owns — and would fail on a wording change that
    // is perfectly correct.
    const readings = new Set<string>();
    for (const counts of [{ cold: 3 }, { dialed: 3 }, { warm: 3 }]) {
      const { unmount } = await renderWithRouter(
        <OwnProfile profile={ownProfile([band(0, counts)])} />,
      );
      const [mark] = marks("data-verdict");
      expect(mark).toBeDefined();
      readings.add(rowWithoutMark(mark ?? document.body));
      unmount();
    }

    expect(readings.size).toBe(3);
    for (const reading of readings) expect(reading.trim()).not.toBe("");
  });

  it("leaves nothing for a reader to hear from the mark itself", async () => {
    // Both marks are hidden, so the row must carry the whole fact. A test
    // that only checked the row's text would pass on a mark that was
    // announced *as well*, which is the "partial, partial" the packet
    // warns about.
    await renderWithRouter(
      <OwnProfile profile={ownProfile([band(0, { dialed: 4 })])} />,
    );

    for (const mark of marks("data-verdict")) {
      expect(mark).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.queryByRole("img")).toBeNull();
  });
});
