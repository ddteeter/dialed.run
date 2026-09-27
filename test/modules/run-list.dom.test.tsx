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

describe("R: a row", () => {
  it("says how far and which day, in the runner's unit and the run's own zone", async () => {
    // 01:30 UTC on the 30th is still the 29th in Chicago.
    const lateSaturday = Math.floor(Date.UTC(2026, 7, 30, 1, 30) / 1000);
    await renderWithRouter(list([runSummary({ startedAt: lateSaturday })]));

    expect(within(onlyRow()).getByText("6.2 mi · Sat Aug 29")).toBeVisible();
  });

  it("opens run detail for a run with no entry", async () => {
    await renderWithRouter(list([runSummary()]));

    const link = within(onlyRow()).getByRole("link");
    expect(link).toHaveAttribute("href", `/runs/${RUN_ID}`);
    // The whole row's words are one 44px target, not a line of text.
    expect(link).toHaveClass("target", "flex-1");
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
      list([runSummary({ entryId: "01ENTRY", hasVerdict: true })]),
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

describe("R: the badges, and the one breath", () => {
  it("marks conditions that came as a fact, in the dialed text colour", async () => {
    await renderWithRouter(list([runSummary()]));

    const row = onlyRow();
    expect(within(row).getByText("41°F damp")).toHaveClass("text-dialed-text");
    const badge = within(row).getByText("Conditions");
    expect(badge).toHaveClass("border-hairline", "text-label");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("marks an indoor run a treadmill, with an indoor badge", async () => {
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
    expect(within(row).getByText("Treadmill")).toHaveClass("text-muted");
    expect(within(row).getByText("Indoor")).toHaveClass("border-hairline");
  });

  it("says set by you, and badges it set, for a band the runner chose", async () => {
    await renderWithRouter(
      list([
        runSummary({
          weatherStatus: "manual",
          conditions: SET_BY_YOU,
        }),
      ]),
    );

    const row = onlyRow();
    expect(within(row).getByText("Set by you")).toHaveClass("text-label");
    // Round 26, item 2: the range and the sky, never the stored middle.
    expect(within(row).getByText("Set · 50–59° · Rain")).toHaveClass(
      "border-hairline",
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
  });

  it("breathes instead of badging while the weather is asked for", async () => {
    await renderWithRouter(
      list([runSummary({ weatherStatus: "pending", conditions: undefined })]),
    );

    const row = onlyRow();
    expect(within(row).getByText("Fetching weather")).toBeVisible();
    expect(row.querySelectorAll(".rounded-pill")).toHaveLength(0);
  });

  it("makes the one badge that is a control: SET CONDITIONS › into R2b", async () => {
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
    expect(within(row).getByText("No weather for this time")).toHaveClass(
      "text-muted",
    );
    const control = within(row).getByRole("button", {
      name: "Set conditions ›",
    });
    expect(control).toHaveClass("border-ink");
    expect(control).toHaveAttribute("aria-haspopup", "dialog");
    // A sibling of the row's link, never inside it.
    expect(control.closest("a")).toBeNull();
  });

  it("offers no control for a run that cannot take a band", async () => {
    await renderWithRouter(
      list([runSummary({ weatherStatus: "failed", conditions: undefined })]),
    );

    expect(within(onlyRow()).queryByRole("button")).toBeNull();
  });
});

describe("R: R2b from the list", () => {
  it("opens for the row it was asked from, and reloads the list when it lands", async () => {
    const user = userEvent.setup();
    const setConditions = vi.fn<ConditionsActions["setConditions"]>(() =>
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
        { setConditions },
      ),
    );
    const invalidate = vi.spyOn(router, "invalidate");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(
      within(rowAt(1)).getByRole("button", {
        name: "Set conditions ›",
      }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "No weather saved",
    });
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );
    await user.click(within(sheet).getByRole("radio", { name: "50–59°" }));
    await user.click(within(sheet).getByRole("radio", { name: "Rain" }));
    await user.click(
      within(sheet).getByRole("button", { name: "Set 50–59° and rain" }),
    );

    await waitFor(() => {
      expect(setConditions).toHaveBeenCalledWith({
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
      name: "Set conditions ›",
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
        name: "Set conditions ›",
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
        name: "Set conditions ›",
      }),
    );
    sheet = await screen.findByRole("dialog");
    // The first step, not the last run's picks.
    expect(sheet).toHaveAccessibleName("No weather saved");
    expect(within(sheet).queryByRole("radio")).toBeNull();
  });
});
