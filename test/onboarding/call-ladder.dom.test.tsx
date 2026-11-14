import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { drawnText, saidText } from "../modules/spoken-text";
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
import { queryWeatherCredit, WEATHER_CREDIT } from "../ui/weather-credit";

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
    said: `${String(bandFloorC)} to ${String(bandFloorC + 5)} degrees`,
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
The bands said in words (the strip is drawn for the eye), not the legend.
*/
function bandRows() {
  const [bands] = screen.getAllByRole("list");
  return within(bands ?? document.body).getAllByRole("listitem");
}

function strip(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    "[data-part='coverage-strip']",
  );
  if (found === null) throw new Error("no strip");
  return found;
}

function axis(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    "[data-part='coverage-axis']",
  );
  if (found === null) throw new Error("no axis");
  return found;
}

describe("K's header", () => {
  it("says what it is doing on ink, full-bleed on the phone and a plain title from wide (#630 F-02)", async () => {
    await renderLadder(<CallLadder ladder={ladderFrom([])} />);
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Learning your body.",
    });
    const header = heading.closest("header");
    expect(header).toHaveAttribute("data-ground", "ink-until-wide");
    expect(header).toHaveClass(
      "-mx-6",
      "-mt-8",
      "px-6",
      "bg-ground",
      "wide:mx-0",
      "wide:mt-0",
      "wide:p-0",
    );
    expect(heading).toHaveClass("text-display", "wide:text-title");
    // THE CALL once on the screen: the countdown's kicker says it.
    expect(header).toHaveTextContent(/^Learning your body\.$/u);
    expect(screen.getAllByText(/^The Call/u)).toHaveLength(1);
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
      within(countdown()).getByText("The Call · 0 of 15 needed"),
    ).toBeVisible();
    expect(
      screen.getByText("Log 15 verdicts and the Call starts."),
    ).toHaveClass("font-display");
    const meter = cells();
    expect(meter.meter).toHaveAccessibleName("0 of 15 verdicts logged");
    expect(meter.total).toBe(15);
    // One column per cell, read from the threshold: fifteen in a row.
    expect(meter.meter.style.gridTemplateColumns).toBe(
      "repeat(15, minmax(0, 1fr))",
    );
    expect(meter.logged).toHaveLength(0);
    expect(meter.empty[0]).toHaveClass("border-accent-ink");
    expect(meter.empty[0]).not.toHaveClass("bg-accent-ink");
    expect(
      screen.getByText("Your first verdict is one run away."),
    ).toBeVisible();
    // No ladder at all rather than an empty frame, and nothing to ask for.
    expect(screen.queryByRole("list")).toBeNull();
    // No bands, so nothing of Visual Crossing's to credit (D-144).
    expect(queryWeatherCredit(document.body)).toBeNull();
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
      within(countdown()).getByText("The Call · 4 of 15 needed"),
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
    expect(drawnText(ask)).toContain("[-5–0°]");
    // Round 53 · 162.3: said in the band's own words.
    expect(saidText(ask)).toBe("Log this next-5 to 0 degrees");
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
  it("keeps K, fills the meter, says the Call is next, and ends on Log another run (R55·231)", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([band(0, { dialed: CALL_VERDICT_THRESHOLD + 3 })])}
      />,
    );

    expect(
      within(countdown()).getByText("The Call · 15 of 15 needed"),
    ).toBeVisible();
    expect(cells().logged).toHaveLength(15);
    expect(cells().empty).toHaveLength(0);
    expect(screen.getByText("That’s enough to call.")).toBeVisible();
    expect(
      screen.getByText("The Call arrives in the next release."),
    ).toBeVisible();
    expect(screen.queryByText(/and the Call starts/u)).toBeNull();
    // "No button — there's no B1 to hand off to." Visual Crossing's
    // credit under the coverage (D-144), then R55·231's way to keep
    // logging, pink and after a hairline: no Log a run pill.
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [WEATHER_CREDIT, "Log another run"],
    );
    const another = screen.getByRole("link", { name: "Log another run" });
    expect(another).toHaveAttribute("href", "/runs/new");
    expect(another).toHaveClass("target", "font-bold", "text-cold-text");
    expect(another.parentElement).toHaveClass(
      "border-t",
      "border-hairline",
      "pt-4",
    );
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
    // R55·231: a heading, and the head counts every verdict, saying so.
    expect(
      screen.getByRole("heading", { level: 2, name: "Your coverage" }),
    ).toHaveClass("font-display", "text-heading");
    expect(screen.getByText("5 verdicts in all")).toHaveClass(
      "text-mono-xs",
      "text-muted",
    );
  });

  it("credits Visual Crossing inside the coverage, whose bands are feels-like bands (D-144)", async () => {
    await renderLadder(
      <CallLadder ladder={ladderFrom([band(0, { dialed: 3 })])} />,
    );
    const coverage = screen.getByText("Your coverage").closest("section");
    if (coverage === null) throw new Error("no coverage");
    expect(queryWeatherCredit(coverage)).not.toBeNull();
  });

  it("draws every band it was given, gaps included, as one strip over an axis (R55·231)", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([
          band(0, { dialed: 3 }),
          band(5),
          band(10, { cold: 1 }),
        ])}
      />,
    );

    // One cell a band, square-cornered and filling its track.
    expect(strip().style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(strip()).toHaveClass("grid", "gap-0.5");
    const marks = [...strip().children];
    expect(
      marks.map((mark) =>
        mark instanceof HTMLElement ? mark.dataset.coverage : undefined,
      ),
    ).toEqual(["covered", "unknown", "partial"]);
    expect(marks[0]).toHaveClass("block", "h-7", "w-full", "rounded-none");
    // Under each cell its floor, then its count; the eye's, not the ear's.
    expect(axis().style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect([...axis().children].map((cell) => cell.textContent)).toEqual([
      "0°3",
      "5°0",
      "10°1",
    ]);
    expect(strip().parentElement).toHaveAttribute("aria-hidden", "true");
    // The gap is the point of the screen: said in words too.
    const rows = bandRows();
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("5 to 10 degrees, unknown, 0 verdicts");
    expect(rows[1]?.parentElement).toHaveClass("sr-only");
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
    // The legend's keys are 12 squares.
    expect(marks[3]).toHaveClass("inline-block", "size-3");
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
    expect(legend).toHaveClass("flex", "flex-wrap", "gap-4");
  });

  it("leaves a level at zero out of the legend (R55·231: UNKNOWN 0 goes)", async () => {
    await renderLadder(
      <CallLadder
        ladder={ladderFrom([band(0, { dialed: 3 }), band(5, { dialed: 1 })])}
      />,
    );
    const legend = within(screen.getAllByRole("list")[1] ?? document.body);
    expect(legend.getAllByRole("listitem")).toHaveLength(2);
    expect(legend.queryByText(/unknown/u)).toBeNull();
    expect(legend.getByText("covered 1")).toBeVisible();
    expect(legend.getByText("partial 1")).toBeVisible();
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
