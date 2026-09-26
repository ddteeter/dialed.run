import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../src/lib/contracts";
import type { CoverageBand } from "../../src/modules/feed";
import {
  CallLadder,
  LogThisNext,
} from "../../src/modules/onboarding/components/CallLadder";
import { ladderFrom } from "../../src/modules/onboarding/ladder";

/**
 * The Call tab's teaser — K, as round 22's item 24 rules it.
 *
 * The assertion that matters most is the one about what is *absent*: this
 * screen shows progress and never a recommendation, because the call is
 * the next epic and a teaser that guessed an outfit would ship the thing
 * the data is not good enough for yet.
 */
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

/**
Renders inside a router, because "Log a run" is a typed link.
*/
async function renderLadder(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/call"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const countdown = () => {
  const found = document.querySelector<HTMLElement>("[data-part='countdown']");
  if (found === null) throw new Error("no countdown");
  return found;
};

/**
The band rows, not the legend's — both are lists of `<li>`.
*/
function bandRows() {
  const [bands] = screen.getAllByRole("list");
  return within(bands ?? document.body).getAllByRole("listitem");
}

describe("K's header", () => {
  it("names the tab in the eyebrow and says what it is doing, on ink", async () => {
    await renderLadder(<CallLadder ladder={ladderFrom([])} />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Learning your body.",
    });
    const header = heading.closest("header");
    expect(header).toHaveAttribute("data-ground", "ink");
    expect(header).toHaveTextContent(/^The CallLearning your body\.$/u);
  });
});

/**
The meter's cells, and which of them are logged.
*/
function cells() {
  const meter = screen.getByRole("img", { name: /verdicts logged$/u });
  const all = within(meter).queryAllByText("", { selector: "span" });
  return {
    meter,
    total: all.length,
    logged: all.filter((cell) => cell.dataset.state === "logged"),
    empty: all.filter((cell) => cell.dataset.state === undefined),
  };
}

describe("zero verdicts (round 26 #15)", () => {
  it("is K as drawn: 0 of 15, an empty meter, the instruction and the zero line", async () => {
    await renderLadder(<CallLadder ladder={ladderFrom([])} />);

    expect(CALL_VERDICT_THRESHOLD).toBe(15);
    expect(
      within(countdown()).getByText("The Call · 0 of 15 verdicts"),
    ).toBeVisible();
    expect(
      screen.getByText("Log 15 verdicts and the Call starts."),
    ).toHaveClass("font-display");
    const meter = cells();
    expect(meter.meter).toHaveAccessibleName("0 of 15 verdicts logged");
    expect(meter.total).toBe(15);
    expect(meter.logged).toHaveLength(0);
    expect(meter.empty[0]).toHaveClass("border-accent-ink");
    expect(meter.empty[0]).not.toHaveClass("bg-accent-ink");
    expect(
      screen.getByText("Your first verdict is one run away."),
    ).toBeVisible();
    // No ladder at all rather than an empty frame, and nothing to ask for.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("Log this next")).toBeNull();
    // The one thing that moves the meter.
    expect(screen.getByRole("link", { name: "Log a run" })).toHaveAttribute(
      "href",
      "/runs/new",
    );
  });

  it("is one of K's two yellow moments", async () => {
    await renderLadder(<CallLadder ladder={ladderFrom([])} />);
    expect(countdown()).toHaveClass("bg-hi-viz", "text-accent-ink");
  });
});

describe("partway (round 26 #15: 4 OF 15)", () => {
  it("counts in the kicker, fills one cell per verdict, and says how many to go", async () => {
    await renderLadder(
      <CallLadder ladder={ladderFrom([band(-5), band(0, { dialed: 4 })])} />,
    );

    expect(
      within(countdown()).getByText("The Call · 4 of 15 verdicts"),
    ).toBeVisible();
    const meter = cells();
    expect(meter.meter).toHaveAccessibleName("4 of 15 verdicts logged");
    expect(meter.logged).toHaveLength(4);
    expect(meter.empty).toHaveLength(11);
    expect(meter.logged[0]).toHaveClass("bg-accent-ink");
    // The logged cells come first.
    expect(
      meter.logged
        .at(-1)
        ?.compareDocumentPosition(meter.empty[0] ?? document.body),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByText(
        "11 to go. Each one teaches it what you run warm or cold in.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Log 15 verdicts and the Call starts."),
    ).toBeVisible();
    expect(screen.queryByText(/one run away/u)).toBeNull();
    expect(screen.queryByText(/enough to call/u)).toBeNull();
    // The ask, on ink, with its hi-viz eyebrow.
    const ask = screen.getByText("Log this next").closest("section");
    expect(ask).toHaveAttribute("data-ground", "ink");
    expect(ask).toHaveTextContent("[-5–0°]");
    expect(screen.getByText("Log this next")).toHaveClass("text-hiviz-text");
    expect(screen.getByRole("link", { name: "Log a run" })).toBeVisible();
  });

  it("with one left, says one to go", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([band(0, { dialed: CALL_VERDICT_THRESHOLD - 1 })])}
      />,
    );
    expect(cells().logged).toHaveLength(14);
    expect(
      screen.getByText(
        "1 to go. Each one teaches it what you run warm or cold in.",
      ),
    ).toBeVisible();
  });
});

describe("threshold met (round 22, item 24)", () => {
  it("keeps K, fills the meter, says the Call is next, and offers no button", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([band(0, { dialed: CALL_VERDICT_THRESHOLD + 3 })])}
      />,
    );

    expect(
      within(countdown()).getByText("The Call · 15 of 15 verdicts"),
    ).toBeVisible();
    expect(cells().logged).toHaveLength(15);
    expect(cells().empty).toHaveLength(0);
    expect(screen.getByText("That’s enough to call.")).toBeVisible();
    expect(
      screen.getByText("The Call arrives in the next release."),
    ).toBeVisible();
    expect(screen.queryByText(/and the Call starts/u)).toBeNull();
    // "No button — there's no B1 to hand off to."
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Log this next")).toBeNull();
  });
});

describe("coverage", () => {
  it("heads the ladder with the verdict total", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([band(0, { dialed: 3 }), band(5, { cold: 2 })])}
      />,
    );
    expect(screen.getByText("Your coverage")).toBeVisible();
    expect(screen.getByText("[5 verdicts]")).toBeVisible();
  });

  it("renders every band it was given, gaps included", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5),
          band(10, { cold: 1 }),
        ])}
      />,
    );

    const rows = bandRows();
    expect(rows).toHaveLength(3);
    // The gap is the point of the screen — it has to be visible to be
    // asked for.
    expect(rows[1]).toHaveTextContent("[5–10°]");
    expect(rows[1]).toHaveTextContent("unknown");
  });

  it("labels coverage as text, never as a mark alone", async () => {
    // Design round 6 §AB gave coverage ink density, and the words stay:
    // "the counts are there so the reading never depends on the swatch".
    // Lower case: `Mono` uppercases in CSS so the accessible name stays
    // readable.
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 1 }),
          band(10),
        ])}
      />,
    );

    const rows = bandRows();
    expect(rows[0]).toHaveTextContent("covered");
    expect(rows[1]).toHaveTextContent("partial");
    expect(rows[2]).toHaveTextContent("unknown");
  });

  it("marks coverage in ink density, and never in a hue", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 1 }),
          band(10),
        ])}
      />,
    );

    const marks = [
      ...document.querySelectorAll<HTMLElement>("[data-coverage]"),
    ];
    expect(marks.map((mark) => mark.dataset.coverage)).toEqual([
      // Three bands, then the legend's own three.
      "covered",
      "partial",
      "unknown",
      "covered",
      "partial",
      "unknown",
    ]);
    for (const mark of marks) {
      expect(mark.className).not.toMatch(/pink|teal/);
    }
  });

  it("counts the bands at each level, so a hollow year reads as hollow", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5, { dialed: 3 }),
          band(10, { dialed: 1 }),
          band(15),
        ])}
      />,
    );

    const legend = screen.getAllByRole("list")[1];
    expect(legend).toBeDefined();
    const inLegend = within(legend ?? document.body);
    expect(inLegend.getByText(/covered 2/)).toBeVisible();
    expect(inLegend.getByText(/partial 1/)).toBeVisible();
    expect(inLegend.getByText(/unknown 1/)).toBeVisible();
  });

  it("shows how many verdicts each band holds, adding all three kinds", async () => {
    // All three counts non-zero and distinct, so a sum that subtracted one
    // of them would show a different number.
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([band(0, { cold: 2, dialed: 4, warm: 1 })])}
      />,
    );

    const [row] = bandRows();
    expect(row).toHaveTextContent("7");
  });

  it("never recommends a garment", async () => {
    await renderLadder(
      <CallLadder ladder={ladderFrom([band(0, { dialed: 20 })])} />,
    );
    expect(screen.queryByText(/wear|jacket|tights|singlet/i)).toBeNull();
  });
});

/**
 * The ask, on its own, because inside the ladder its empty case cannot
 * happen — a runner with verdicts always has a thinnest band.
 */
describe("LogThisNext", () => {
  it("renders nothing when there is no band to ask for", () => {
    const { container } = render(<LogThisNext band={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
