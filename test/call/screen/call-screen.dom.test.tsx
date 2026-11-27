import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CallResult } from "../../../src/modules/call/contract";
import { CallScreen } from "../../../src/modules/call/screen";
import { drawn } from "../../../src/modules/call/screen/facts";
import { drawnText, saidText } from "../../modules/spoken-text";
import { violations } from "../../ui/axe";
import {
  belowThresholdCall,
  borrowedCall,
  confidentCall,
  drawnFrom,
  noForecastCall,
  probableCall,
  type Drawn,
} from "./fixtures";

/**
 * Screen B2 in its four states (design sprint-a6), each drawn from the
 * real view model: what is present, what is absent, and what a screen
 * reader hears.
 */
const WHEN = "Tomorrow · 6:10 AM · Steady";

function draw(
  call: CallResult,
  options: { unit?: "f" | "c"; verdictsLogged?: number } = {},
): Drawn & { container: HTMLElement } {
  const made = drawnFrom(call, options.unit);
  const { container } = render(
    <CallScreen
      view={made.view}
      facts={made.facts}
      verdictsLogged={options.verdictsLogged}
      slots={{
        when: WHEN,
        sameConditions: <aside data-part="same-conditions">the feed</aside>,
      }}
    />,
  );
  return { ...made, container };
}

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-part="${CSS.escape(name)}"]`,
  );
}

function partOrThrow(name: string): HTMLElement {
  const element = part(name);
  if (element === null) throw new Error(`no ${name}`);
  return element;
}

/**
 * The kit as drawn and as said, a row a piece.
 */
function kitRows(): { drawn: string; said: string }[] {
  return within(partOrThrow("kit"))
    .getAllByRole("listitem")
    .map((row) => ({ drawn: drawnText(row), said: saidText(row) }));
}

/**
 * Whether `first` comes before `second` in the page.
 */
function isBefore(first: Element, second: Element): boolean {
  return (
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

describe("B2, a probable Call", () => {
  it("introduces the kit with the verb as the screen's one heading", () => {
    draw(probableCall());

    expect(
      screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent),
    ).toStrictEqual(["PROBABLY WEAR"]);
  });

  it("draws the hour line over the verb and the confidence chip under it, without the slot brackets", () => {
    draw(probableCall());
    const heading = partOrThrow("heading");

    expect(drawnText(heading)).toBe(
      `${WHEN}PROBABLY WEARPROBABLE · 4 RUNS IN BAND`,
    );
    expect(saidText(heading)).toBe(
      `${WHEN}PROBABLY WEARProbable, 4 runs in band`,
    );
  });

  it("draws each piece's name with its line under it, as the view gives them", () => {
    const { view } = draw(probableCall());

    expect(kitRows()).toStrictEqual([
      {
        drawn: "Merino half-zipDIALED 8 OF 9 · 32–41°",
        said: "Merino half-zipDialed 8 of 9, 32 to 41 degrees",
      },
      {
        drawn: "Winter tightsTOO MUCH ONCE · 32–41°",
        said: "Winter tightsToo much once, 32 to 41 degrees",
      },
      {
        drawn: "Thermal beanieCLIMATE COHORT · 78% AT 32–41°",
        said: "Thermal beanieClimate cohort, 78 percent at 32 to 41 degrees",
      },
      {
        drawn: "Trail socksNO VERDICTS YET",
        said: "Trail socksNo verdicts yet",
      },
    ]);
    // The same thing said of the view, so a change to a line's wording
    // moves the fixture and not this.
    expect(kitRows()).toStrictEqual(
      view.pieces.map((piece) => ({
        drawn: `${piece.name ?? ""}${drawn(piece.line.shown).join(" · ")}`,
        said: `${piece.name ?? ""}${piece.line.said}`,
      })),
    );
  });

  it("holds each part of a line together, so the line wraps only at its mark", () => {
    draw(probableCall());
    const [zip] = within(partOrThrow("kit")).getAllByRole("listitem");

    expect(
      [...(zip?.querySelectorAll(".whitespace-nowrap") ?? [])].map(
        (held) => held.textContent,
      ),
    ).toStrictEqual(["DIALED 8 OF 9", "32–41°"]);
  });

  it("follows the reader's unit, since the view formatted the line", () => {
    draw(probableCall(), { unit: "c" });

    expect(kitRows()[0]).toStrictEqual({
      drawn: "Merino half-zipDIALED 8 OF 9 · 0–5°",
      said: "Merino half-zipDialed 8 of 9, 0 to 5 degrees",
    });
  });

  it("says the engine's sentences in the hi-viz field", () => {
    const { view } = draw(probableCall());

    expect(partOrThrow("paragraph").textContent).toBe(
      "You've been too cold twice in this band. Skip the gloves — too much twice in this band.",
    );
    expect(partOrThrow("paragraph").textContent).toBe(view.paragraph);
  });

  it("puts the feed's block between the paragraph and the why-nots", () => {
    draw(probableCall());
    const feed = partOrThrow("same-conditions");

    expect(isBefore(partOrThrow("paragraph"), feed)).toBe(true);
    expect(isBefore(feed, partOrThrow("why-nots"))).toBe(true);
    expect(isBefore(partOrThrow("kit"), partOrThrow("paragraph"))).toBe(true);
    expect(isBefore(partOrThrow("heading"), partOrThrow("kit"))).toBe(true);
  });

  it("offers the why-nots under their caption", () => {
    draw(probableCall());

    expect(
      screen.getByRole("heading", { level: 2, name: "Why not" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Why not the tee?" }),
    ).toBeInTheDocument();
  });

  it("draws neither the borrowed field, the no-forecast card nor the count", () => {
    draw(probableCall());

    expect(part("borrowed")).toBeNull();
    expect(part("no-forecast")).toBeNull();
    expect(part("count")).toBeNull();
  });

  it("has nothing axe objects to", async () => {
    const { container } = draw(probableCall());

    expect(await violations(container)).toStrictEqual([]);
  });
});

describe("B2, a confident Call", () => {
  it("says WEAR THIS, with CONFIDENT in the chip PROBABLE takes", () => {
    draw(confidentCall());
    const heading = partOrThrow("heading");

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "WEAR THIS",
    );
    expect(drawnText(heading)).toBe(
      `${WHEN}WEAR THISCONFIDENT · 11 RUNS IN BAND`,
    );
    expect(saidText(heading)).toBe(
      `${WHEN}WEAR THISConfident, 11 runs in band`,
    );
  });
});

describe("B2 with nothing in the slots", () => {
  it("draws no hour line and nothing where the feed's block goes", () => {
    const { view, facts } = drawnFrom(probableCall());
    render(<CallScreen view={view} facts={facts} />);

    expect(drawnText(partOrThrow("heading"))).toBe(
      "PROBABLY WEARPROBABLE · 4 RUNS IN BAND",
    );
    // No empty line stands where the hour line would: the verb, then the chip.
    expect(
      [...partOrThrow("heading").children].map((child) => child.tagName),
    ).toStrictEqual(["H1", "SPAN"]);
    expect(part("same-conditions")).toBeNull();
    expect(
      [...partOrThrow("call").querySelectorAll<HTMLElement>(":scope > *")].map(
        (child) => child.dataset.part,
      ),
    ).toStrictEqual(["heading", "kit", "paragraph", "why-nots"]);
  });

  it("draws the no-forecast card without an hour line, not with an empty one", () => {
    const { view, facts } = drawnFrom(noForecastCall());
    render(<CallScreen view={view} facts={facts} />);

    expect(partOrThrow("no-forecast").textContent).toBe(
      "No forecast for this hourThis Call comes from all your runs, not this hour's weather.",
    );
    expect(partOrThrow("no-forecast").children).toHaveLength(2);
  });
});

describe("B2 with no sentence and nothing left out", () => {
  it("has no hi-viz field and no why-nots, not empty ones", () => {
    const kit = probableCall().kit.slice(2);
    draw(probableCall({ kit, ranking: kit }));

    expect(part("paragraph")).toBeNull();
    expect(part("why-nots")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("has no list for a kit with no piece", () => {
    draw(probableCall({ kit: [], ranking: [] }));

    expect(part("kit")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("draws the line alone for a piece the lookup has no name for", () => {
    const { view, facts } = drawnFrom(probableCall());
    const [zip] = view.pieces;
    if (zip === undefined) throw new Error("no piece");
    render(
      <CallScreen
        view={{ ...view, pieces: [{ ...zip, name: undefined }] }}
        facts={facts}
      />,
    );

    expect(kitRows()).toStrictEqual([
      {
        drawn: "DIALED 8 OF 9 · 32–41°",
        said: "Dialed 8 of 9, 32 to 41 degrees",
      },
    ]);
    expect(
      within(partOrThrow("kit")).getByRole("listitem").children,
    ).toHaveLength(1);
  });
});

describe("C1b, a borrowed Call at home", () => {
  it("says whose runs it leans on in the BORROWED CALL field, on ink", () => {
    const { view } = draw(borrowedCall());
    if (view.header.kind !== "call") throw new Error("not a Call");
    const field = partOrThrow("borrowed");

    expect(field).toHaveAttribute("data-ground", "ink");
    expect(drawnText(field)).toBe(
      "BORROWED CALLYou've logged 0 runs in 77–86°. This comes from runners in your climate, not from you.",
    );
    expect(saidText(field)).toBe(
      "BORROWED CALLYou've logged 0 runs in 77 to 86 degrees. This comes from runners in your climate, not from you.",
    );
    expect(drawnText(field)).toBe(
      `${view.header.title.shown}${view.header.body?.shown ?? ""}`,
    );
  });

  it("puts the field over the verb, with no chip and no hour line", () => {
    draw(borrowedCall());

    expect(isBefore(partOrThrow("borrowed"), partOrThrow("heading"))).toBe(
      true,
    );
    expect(partOrThrow("heading").textContent).toBe("PROBABLY WEAR");
    expect(screen.queryByText(WHEN)).toBeNull();
    expect(
      screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent),
    ).toStrictEqual(["PROBABLY WEAR"]);
  });

  it("draws the pieces with the lines the view gives them", () => {
    const { view } = draw(borrowedCall());

    expect(kitRows()).toStrictEqual(
      view.pieces.map((piece) => ({
        drawn: `${piece.name ?? ""}${drawn(piece.line.shown).join(" · ")}`,
        said: `${piece.name ?? ""}${piece.line.said}`,
      })),
    );
    expect(kitRows().map((row) => row.drawn)).toStrictEqual([
      "SingletCLIMATE COHORT · 81% AT 77–86°",
      "Split shortsCLIMATE COHORT · 74% AT 77–86°",
      "Mesh capWORKS AT 68–90°",
    ]);
  });

  it("has no paragraph, no no-forecast card and no count", () => {
    const { view } = draw(borrowedCall());

    expect(view.paragraph).toBeUndefined();
    expect(part("paragraph")).toBeNull();
    expect(part("no-forecast")).toBeNull();
    expect(part("count")).toBeNull();
  });

  it("has nothing axe objects to", async () => {
    const { container } = draw(borrowedCall());

    expect(await violations(container)).toStrictEqual([]);
  });
});

describe("C0a, a Call with no forecast", () => {
  it("says so on a card that carries the hour line", () => {
    draw(noForecastCall());

    expect(partOrThrow("no-forecast").textContent).toBe(
      `${WHEN}No forecast for this hourThis Call comes from all your runs, not this hour's weather.`,
    );
  });

  it("heads the kit by all the runner's runs, with no IN BAND", () => {
    const { container } = draw(noForecastCall());
    const heading = partOrThrow("heading");

    expect(isBefore(partOrThrow("no-forecast"), heading)).toBe(true);
    expect(drawnText(heading)).toBe("PROBABLY WEARPROBABLE · 23 RUNS");
    expect(saidText(heading)).toBe("PROBABLY WEARProbable, 23 runs");
    expect(container.textContent).not.toMatch(/in band/iu);
  });

  it("has no paragraph and no borrowed field, and still offers the why-nots", () => {
    const { view } = draw(noForecastCall());

    expect(view.paragraph).toBeUndefined();
    expect(part("paragraph")).toBeNull();
    expect(part("borrowed")).toBeNull();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toStrictEqual(["Why not the tee?+", "Why not the vest?+"]);
  });

  it("draws the pieces with the lines the view gives them", () => {
    const { view } = draw(noForecastCall());

    expect(kitRows().map((row) => row.drawn)).toStrictEqual(
      view.pieces.map(
        (piece) => `${piece.name ?? ""}${drawn(piece.line.shown).join(" · ")}`,
      ),
    );
  });

  it("has nothing axe objects to", async () => {
    const { container } = draw(noForecastCall());

    expect(await violations(container)).toStrictEqual([]);
  });
});

describe("C0b, below the verdict threshold", () => {
  it("draws the count alone, whatever kit the view lists", () => {
    // The count's header over a view that still holds a kit and why-nots,
    // so this holds whether or not the engine lists one below the threshold.
    const { header } = drawnFrom(belowThresholdCall()).view;
    const above = drawnFrom(probableCall());
    const { container } = render(
      <CallScreen
        view={{ ...above.view, header }}
        facts={above.facts}
        slots={{ when: WHEN, sameConditions: <aside>the feed</aside> }}
      />,
    );

    expect(above.view.pieces).not.toHaveLength(0);
    expect(above.facts.whyNots).not.toHaveLength(0);
    expect(part("count")).not.toBeNull();
    expect(container.children).toHaveLength(1);
    expect(part("call")).toBeNull();
    expect(part("kit")).toBeNull();
    expect(part("why-nots")).toBeNull();
    expect(screen.queryByText("the feed")).toBeNull();
    expect(screen.queryByText(WHEN)).toBeNull();
  });

  it("makes the count the screen's one heading", () => {
    draw(belowThresholdCall());

    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toStrictEqual(["7 more verdicts"]);
  });

  it("hands the runner's verdict total to the count", () => {
    draw(belowThresholdCall(0), { verdictsLogged: 3 });

    expect(
      screen.getByText(
        "Verdicts count on runs with conditions. Yours so far have none.",
      ),
    ).toBeInTheDocument();
  });

  it("has nothing axe objects to", async () => {
    const { container } = draw(belowThresholdCall());

    expect(await violations(container)).toStrictEqual([]);
  });
});
