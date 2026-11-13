import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RunList } from "../../src/modules/runs/components/RunList";
import type { ConditionsActions } from "../../src/modules/runs/components/SetConditionsSheet";
import type { RunSummary } from "../../src/modules/runs/service";
import {
  RUN_ID,
  SET_BY_YOU,
  SAT_MORNING,
  renderWithRouter,
  runSummary,
} from "./run-fixtures";
import { RUNS_LISTED } from "../../src/modules/runs/run-months";
import { queryWeatherCredit, WEATHER_CREDIT } from "../ui/weather-credit";

/**
 * The runs list (round 22, "R Runs list"): four badges and one breath, a
 * row that opens wherever its run is waiting, and the empty state E1's
 * frame draws.
 */

function list(
  runs: readonly RunSummary[],
  actions: Partial<ConditionsActions> = {},
) {
  return (
    <RunList
      runs={runs}
      units={{ temp: "f", distance: "mi" }}
      actions={{
        setConditions: actions.setConditions ?? (() => Promise.resolve(true)),
        retryWeather: actions.retryWeather ?? (() => Promise.resolve(true)),
      }}
    />
  );
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-slot='run-row']")];
}

function rowAt(index: number): HTMLElement {
  const row = rows()[index];
  if (row === undefined) throw new Error(`no row ${String(index)}`);
  return row;
}

function onlyRow(): HTMLElement {
  expect(rows()).toHaveLength(1);
  return rowAt(0);
}

describe("R: the empty list", () => {
  it("says there are none yet, in brackets, and how to log one", async () => {
    await renderWithRouter(list([]));

    const empty = document.querySelector("[data-slot='run-list']");
    expect(empty).toHaveAttribute("data-state", "empty");
    expect(empty).toHaveTextContent("[No runs yet]");
    expect(
      screen.getByText("Upload a file or enter one by hand."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Log a run" })).toHaveAttribute(
      "href",
      "/runs/new",
    );
    expect(rows()).toHaveLength(0);
  });
});

describe("R: a row (Round 55 · 235)", () => {
  it("leads with the day, in the run's own zone, as its underlined way in", async () => {
    // 01:30 UTC on the 30th is still the 29th in Chicago.
    const lateSaturday = Math.floor(Date.UTC(2026, 7, 30, 1, 30) / 1000);
    await renderWithRouter(list([runSummary({ startedAt: lateSaturday })]));

    const link = within(onlyRow()).getByRole("link");
    expect(link).toHaveTextContent(/^Sat Aug 29$/u);
    // The line's own height, its 44 hit area proud of it (a11y.css 03).
    expect(link).toHaveClass(
      "target-line",
      "inline-block",
      "self-start",
      "text-body",
      "font-semibold",
      "text-ink",
      "underline",
      "underline-offset-4",
    );
  });

  it("is one 64 row: words on the left, marks on the right", async () => {
    await renderWithRouter(list([runSummary()]));

    const row = onlyRow();
    expect(row).toHaveClass("grid", "min-h-16", "items-center", "border-b");
    expect(row.lastElementChild).toHaveAttribute("data-part", "run-marks");
  });

  it("credits Garmin once on each Garmin row, in sans beside the line, and on no other (G1)", async () => {
    await renderWithRouter(
      list([
        runSummary({ id: "g", deviceName: "Garmin" }),
        runSummary({ id: "f", startedAt: SAT_MORNING - 60 }),
      ]),
    );

    expect(
      rows().map(
        (row) =>
          row.querySelectorAll("[data-part='garmin-attribution']").length,
      ),
    ).toEqual([1, 0]);
    const credit = rowAt(0).querySelector("[data-part='garmin-attribution']");
    expect(credit).toHaveTextContent("Garmin");
    expect(credit?.previousElementSibling).toHaveTextContent("41°F damp");
  });

  it("opens run detail for a run with no entry", async () => {
    await renderWithRouter(list([runSummary()]));

    expect(within(onlyRow()).getByRole("link")).toHaveAttribute(
      "href",
      `/runs/${RUN_ID}`,
    );
  });

  it("opens the verdict for a run with a kit and no verdict yet", async () => {
    await renderWithRouter(list([runSummary({ entryId: "01ENTRY" })]));

    expect(within(onlyRow()).getByRole("link")).toHaveAttribute(
      "href",
      "/feed/verdict/01ENTRY",
    );
  });

  it("opens the post for a run with a verdict", async () => {
    await renderWithRouter(
      list([runSummary({ entryId: "01ENTRY", hasVerdict: true, verdict: 0 })]),
    );

    expect(within(onlyRow()).getByRole("link")).toHaveAttribute(
      "href",
      "/feed/entry/01ENTRY",
    );
  });

  it("keeps the rows in the order they came, one per run", async () => {
    await renderWithRouter(
      list([
        runSummary({ id: "01A", distanceM: 1609.34 }),
        runSummary({ id: "01B", distanceM: 3218.68 }),
      ]),
    );

    expect(
      rows().map((row) => row.querySelector("a")?.getAttribute("href")),
    ).toEqual(["/runs/01A", "/runs/01B"]);
  });
});

describe("R: the month breaks and the end (Round 55 · 235)", () => {
  const NOV_12 = Math.floor(Date.UTC(2026, 10, 12, 12) / 1000);
  const NOV_10 = Math.floor(Date.UTC(2026, 10, 10, 12) / 1000);
  const OCT_30 = Math.floor(Date.UTC(2026, 9, 30, 12) / 1000);

  it("heads each month in MONO.xs with its count, and ends on the oldest month", async () => {
    await renderWithRouter(
      list([
        runSummary({ id: "01A", startedAt: NOV_12 }),
        runSummary({ id: "01B", startedAt: NOV_10 }),
        runSummary({ id: "01C", startedAt: OCT_30 }),
      ]),
    );

    expect(headings()).toEqual([
      "November 2026 · 2 runs",
      "October 2026 · 1 run",
    ]);
    const heading = screen.getByRole("heading", {
      name: "November 2026 · 2 runs",
    });
    expect(heading).toHaveClass("border-b", "border-hairline");
    expect(within(heading).getByText(/November/u)).toHaveClass(
      "text-mono-xs",
      "uppercase",
      "text-label",
    );
    // Each month holds its own rows.
    const november = screen.getByRole("region", { name: "November 2026" });
    expect(
      within(november)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/runs/01A", "/runs/01B"]);
    const end = screen.getByText("That’s every run · since Oct 2026");
    expect(end).toHaveClass("text-mono-xs", "text-label", "text-center");
  });

  it("dates a month on the run's own clock", async () => {
    // 03:00 UTC on Nov 1 is still October in Chicago.
    const halloweenNight = Math.floor(Date.UTC(2026, 10, 1, 3) / 1000);
    await renderWithRouter(list([runSummary({ startedAt: halloweenNight })]));

    expect(headings()).toEqual(["October 2026 · 1 run"]);
  });

  it("never says every run when the list stopped at what it reads", async () => {
    const many = Array.from({ length: RUNS_LISTED }, (_, index) =>
      runSummary({ id: `01R${String(index)}`, startedAt: NOV_12 - index }),
    );
    await renderWithRouter(list(many));

    expect(rows()).toHaveLength(RUNS_LISTED);
    expect(screen.queryByText(/every run/u)).toBeNull();
  });

  it("says every run one short of it", async () => {
    const many = Array.from({ length: RUNS_LISTED - 1 }, (_, index) =>
      runSummary({ id: `01R${String(index)}`, startedAt: NOV_12 - index }),
    );
    await renderWithRouter(list(many));

    expect(screen.getByText("That’s every run · since Nov 2026")).toBeVisible();
  });
});

describe("R: the marks", () => {
  it.each([
    [-2, "Way cold", "text-cold-text"],
    [-1, "A bit cold", "text-cold-text"],
    [0, "Dialed", "text-dialed-text"],
    [1, "A bit warm", "text-quiet"],
    [2, "Way warm", "text-quiet"],
  ])(
    "marks verdict %i as %s in its T2 text hue, with its kit",
    async (verdict, label, hue) => {
      await renderWithRouter(
        list([runSummary({ entryId: "01ENTRY", hasVerdict: true, verdict })]),
      );

      const marks = marksOf(onlyRow());
      expect(within(marks).getByText(label)).toHaveClass(
        "text-mono-xs",
        "font-semibold",
        hue,
      );
      expect(within(marks).getByText("Kit")).toHaveClass("text-label");
    },
  );

  it("marks a run with no kit and no verdict as needing both", async () => {
    await renderWithRouter(list([runSummary()]));

    const marks = marksOf(onlyRow());
    expect(marks).toHaveClass("flex", "flex-col", "items-end");
    expect([...marks.children].map((mark) => mark.textContent)).toEqual([
      "No verdict",
      "No kit",
    ]);
    expect(within(marks).getByText("No verdict")).toHaveClass(
      "font-semibold",
      "text-muted",
    );
  });
});

function headings(): (string | null)[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);
}

function marksOf(row: HTMLElement): HTMLElement {
  const marks = row.querySelector<HTMLElement>("[data-part='run-marks']");
  if (marks === null) throw new Error("no marks");
  return marks;
}

describe("R: the one line, and badges only for exceptions", () => {
  it("reads conditions · distance in the dialed text colour, with no badge", async () => {
    await renderWithRouter(list([runSummary()]));

    const row = onlyRow();
    const reading = within(row).getByText("41°F damp · 6.2 mi");
    const line = reading.parentElement;
    expect(line).toHaveClass("text-mono-sm", "truncate", "text-dialed-text");
    // Round 52 #158: drawn for the eye, said in words.
    expect(reading).toHaveAttribute("aria-hidden", "true");
    expect(reading.nextElementSibling).toHaveTextContent(
      "41 degrees Fahrenheit, damp, 6.2 miles",
    );
    expect(row.querySelectorAll(".rounded-pill")).toHaveLength(0);
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("says indoor in the line, with no badge", async () => {
    await renderWithRouter(
      list([
        runSummary({
          indoor: true,
          weatherStatus: "none",
          conditions: undefined,
        }),
      ]),
    );

    const row = onlyRow();
    expect(within(row).getByText("Indoor · 6.2 mi").parentElement).toHaveClass(
      "text-label",
    );
    expect(row.querySelectorAll(".rounded-pill")).toHaveLength(0);
  });

  it("badges a band the runner chose, and leaves the line its distance", async () => {
    await renderWithRouter(
      list([
        runSummary({
          weatherStatus: "manual",
          conditions: SET_BY_YOU,
        }),
      ]),
    );

    const row = onlyRow();
    expect(within(row).getByText("6.2 mi").parentElement).toHaveClass(
      "text-label",
    );
    // Round 26, item 2: the range and the sky, never the stored middle.
    const badge = within(row).getByText("Set · 50–59° · Rain");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expectBadge(badge.parentElement, "border-hairline", "text-label");
    // Round 53 · 162.3: the band is said as a range.
    expect(within(row).getByText("Set, 50 to 59 degrees, rain")).toHaveClass(
      "sr-only",
    );
    expect(row).not.toHaveTextContent("55°");
  });

  it("badges a band set before the sheet asked for a sky with the range alone", async () => {
    await renderWithRouter(
      list([
        runSummary({
          weatherStatus: "manual",
          conditions: { ...SET_BY_YOU, sky: undefined },
        }),
      ]),
    );

    expect(within(onlyRow()).getByText("Set · 50–59°")).toBeVisible();
    expect(within(onlyRow()).getByText("Set, 50 to 59 degrees")).toHaveClass(
      "sr-only",
    );
  });

  it("reads the conditions it has, not a wait, whatever the status says", async () => {
    // Conditions that have arrived are the line, even if the run's status
    // has not caught up with them yet.
    await renderWithRouter(list([runSummary({ weatherStatus: "pending" })]));
    expect(within(onlyRow()).queryByText("Fetching weather")).toBeNull();
    expect(onlyRow()).toHaveTextContent("41°F damp");
  });

  it("offers no SET CONDITIONS for a run that has its conditions", async () => {
    await renderWithRouter(list([runSummary({ canSetConditions: true })]));
    expect(
      within(onlyRow()).queryByRole("button", { name: /set conditions/iu }),
    ).toBeNull();
  });

  it("breathes, flush left, instead of badging while the weather is asked for (N1-14)", async () => {
    await renderWithRouter(
      list([runSummary({ weatherStatus: "pending", conditions: undefined })]),
    );

    const row = onlyRow();
    const words = within(row).getByText("Fetching weather");
    // The pending label's own start alignment, not the centred default.
    expect(words.closest(".grid")).toHaveClass("justify-items-start");
    expect(words.closest(".grid")).not.toHaveClass("place-items-center");
    const line = words.closest(".font-mono");
    expect(line).toHaveClass("flex", "items-center", "text-label");
    expect(line).toHaveTextContent("[Fetching weather]·6.2 mi");
    expect(within(row).getByText("6.2 miles")).toHaveClass("sr-only");
    expect(row.querySelectorAll(".rounded-pill")).toHaveLength(0);
  });

  it("makes the one badge that is a control: SET CONDITIONS › into R2b, as tall as the others", async () => {
    await renderWithRouter(
      list([
        runSummary({
          weatherStatus: "failed",
          conditions: undefined,
          canSetConditions: true,
        }),
      ]),
    );

    const row = onlyRow();
    expect(within(row).getByText("6.2 mi").parentElement).toHaveClass(
      "text-label",
    );
    expect(row).not.toHaveTextContent("No weather for this time");
    const control = within(row).getByRole("button", {
      name: "Set conditions",
    });
    // The 44 hit area hangs past the line; the pill is the badges' 22.
    expect(control).toHaveClass("target", "-my-3", "bg-transparent", "p-0");
    expect(control).toHaveAttribute("aria-haspopup", "dialog");
    expectBadge(control.firstElementChild, "border-ink", "text-ink");
    // The › is drawn and not said.
    expect(control).toHaveTextContent("Set conditions ›");
    expect(within(control).getByText("›")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // A sibling of the row's link, never inside it.
    expect(control.closest("a")).toBeNull();
  });

  it("says what is missing, with no control, for a run that cannot take a band", async () => {
    await renderWithRouter(
      list([runSummary({ weatherStatus: "failed", conditions: undefined })]),
    );

    expect(
      within(onlyRow()).getByText("No weather for this time · 6.2 mi"),
    ).toBeVisible();
    expect(within(onlyRow()).queryByRole("button")).toBeNull();
  });
});

/**
Every badge is one pill, 22 tall (Round 55 · 235b).
*/
function expectBadge(badge: Element | null, ...tone: readonly string[]): void {
  expect(badge).toHaveClass(
    "inline-flex",
    "shrink-0",
    "items-center",
    "rounded-pill",
    "border",
    "px-2",
    "py-1",
    "text-mono-xs",
    ...tone,
  );
}

describe("R: R2b from the list", () => {
  it("opens for the row it was asked from, and reloads the list when it lands", async () => {
    const user = userEvent.setup();
    const didSetConditions = vi.fn<ConditionsActions["setConditions"]>(() =>
      Promise.resolve(true),
    );
    const { router } = await renderWithRouter(
      list(
        [
          runSummary({
            id: "01A",
            weatherStatus: "failed",
            conditions: undefined,
            canSetConditions: true,
          }),
          runSummary({
            id: "01B",
            startedAt: SAT_MORNING - 86_400,
            weatherStatus: "failed",
            conditions: undefined,
            canSetConditions: true,
          }),
        ],
        { setConditions: didSetConditions },
      ),
    );
    const invalidate = vi.spyOn(router, "invalidate");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(
      within(rowAt(1)).getByRole("button", {
        name: "Set conditions",
      }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "No weather saved",
    });
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );
    await user.click(
      within(sheet).getByRole("radio", { name: "50 to 59 degrees" }),
    );
    await user.click(within(sheet).getByRole("radio", { name: "Rain" }));
    await user.click(
      within(sheet).getByRole("button", {
        name: "Set 50 to 59 degrees and rain",
      }),
    );

    await waitFor(() => {
      expect(didSetConditions).toHaveBeenCalledWith({
        data: { runId: "01B", bandFloorC: 10, sky: "rain" },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("opens again for the same row after the platform closed it", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      list([
        runSummary({
          weatherStatus: "failed",
          conditions: undefined,
          canSetConditions: true,
        }),
      ]),
    );
    const control = within(onlyRow()).getByRole("button", {
      name: "Set conditions",
    });

    await user.click(control);
    const sheet = await screen.findByRole("dialog");
    sheet.closest("dialog")?.close();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await user.click(control);
    expect(
      await screen.findByRole("dialog", { name: "No weather saved" }),
    ).toBeVisible();
  });

  it("starts a second run's sheet at its first step", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      list([
        runSummary({
          id: "01A",
          weatherStatus: "failed",
          conditions: undefined,
          canSetConditions: true,
        }),
        runSummary({
          id: "01B",
          weatherStatus: "failed",
          conditions: undefined,
          canSetConditions: true,
        }),
      ]),
    );

    await user.click(
      within(rowAt(0)).getByRole("button", {
        name: "Set conditions",
      }),
    );
    let sheet = await screen.findByRole("dialog");
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );
    (sheet as HTMLDialogElement).close();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await user.click(
      within(rowAt(1)).getByRole("button", {
        name: "Set conditions",
      }),
    );
    sheet = await screen.findByRole("dialog");
    // The first step, not the last run's picks.
    expect(sheet).toHaveAccessibleName("No weather saved");
    expect(within(sheet).queryByRole("radio")).toBeNull();
  });
});

describe("R: Visual Crossing's credit (D-144)", () => {
  it("credits the provider once, under the list, when any row shows its reading", async () => {
    await renderWithRouter(
      list([
        runSummary({
          id: "01A",
          weatherStatus: "manual",
          conditions: SET_BY_YOU,
        }),
        runSummary({
          id: "01B",
          weatherStatus: "pending",
          conditions: undefined,
        }),
        runSummary({ id: "01C" }),
      ]),
    );

    expect(screen.getAllByRole("link", { name: WEATHER_CREDIT })).toHaveLength(
      1,
    );
    for (const row of rows()) expect(queryWeatherCredit(row)).toBeNull();
  });

  it("credits nobody when no row shows the provider's reading", async () => {
    await renderWithRouter(
      list([
        runSummary({
          id: "01A",
          weatherStatus: "manual",
          conditions: SET_BY_YOU,
        }),
        runSummary({
          id: "01B",
          weatherStatus: "pending",
          conditions: undefined,
        }),
      ]),
    );

    expect(queryWeatherCredit(document.body)).toBeNull();
  });
});
