import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { defaultUnits } from "../../src/lib/contracts";
import type { BacklogRow, Conditions } from "../../src/modules/feed";
import { VerdictBacklog } from "../../src/modules/runs/components/VerdictBacklog";

/**
 * DS2's table, driven the way a runner drives it — on the keyboard.
 *
 * *"↑/↓ moves rows, 1–5 sets the verdict, Enter saves, Tab into the outfit
 * cell opens A2 in a panel."* Playwright walks the journey; what is here
 * is the state space, which is what the surface is made of: a row with a
 * suggestion and one without, a save that works and one that fails, and
 * the two ways Enter can be pressed too early.
 */
const conditions: Conditions = {
  tempC: 5,
  feelsLikeC: 3,
  precipMm: 0,
  condition: "Clear",
  windKph: 9,
  source: "visualcrossing",
  span: { minTempC: 4, maxTempC: 6, minFeelsLikeC: 2, maxFeelsLikeC: 4 },
};

/**
 * 2026-09-02 and 2026-09-04, as epoch seconds — a Wednesday and a Friday,
 * so the two rows never label themselves the same.
 */
const MONDAY = Math.floor(Date.UTC(2026, 8, 2, 12) / 1000);
const WEDNESDAY = Math.floor(Date.UTC(2026, 8, 4, 12) / 1000);

function row(overrides: Partial<BacklogRow> = {}): BacklogRow {
  return {
    runId: "01RUN1",
    startedAt: MONDAY,
    durationS: 2400,
    distanceM: 8000,
    conditions,
    suggestion: {
      entryId: "01ENT1",
      itemIds: ["01ITEM1", "01ITEM2"],
      itemNames: ["Janji half-zip", "Bandit split"],
      wornAt: MONDAY - 86_400 * 7,
    },
    ...overrides,
  };
}

const bare = row({
  runId: "01RUN2",
  startedAt: WEDNESDAY,
  suggestion: undefined,
});

async function renderTable(
  rows: readonly BacklogRow[],
  saveRow = vi.fn().mockResolvedValue({ entryId: "01NEW" }),
) {
  const element: ReactElement = (
    <VerdictBacklog rows={rows} units={defaultUnits} saveRow={saveRow} />
  );
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/runs/backlog"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return saveRow;
}

const body = () => screen.getAllByRole("rowgroup")[1];
const rowsOf = () => screen.getAllByRole("row").slice(1);

describe("VerdictBacklog: what a row offers", () => {
  it("lays A3's three inputs flat, and is a real table while it does it", async () => {
    await renderTable([row()]);

    // A table, so a reader gets row and column semantics for free — which
    // is most of what makes a backlog readable at all.
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toStrictEqual(["Run", "Conditions", "Outfit", "Verdict · 1–5"]);
    expect(rowsOf()).toHaveLength(1);
  });

  it("offers the kit the runner wore in the nearest conditions", async () => {
    await renderTable([row()]);

    // "Same as Monday? Use · Pick" — the suggestion names the day it came
    // from rather than saying "a previous run".
    expect(screen.getByText(/^Same as/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use" })).toBeInTheDocument();
    // Pick is A2 at its own route, which at width is the centred panel.
    // No picker is rebuilt here, which is the whole of "not a new form".
    expect(screen.getByRole("link", { name: "Pick" })).toHaveAttribute(
      "href",
      "/feed/attach/01RUN1",
    );
  });

  it("offers only Pick when there is nothing near enough to suggest", async () => {
    await renderTable([bare]);

    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(screen.queryByText(/^Same as/)).toBeNull();
    expect(screen.getByRole("link", { name: "Pick" })).toHaveAttribute(
      "href",
      "/feed/attach/01RUN2",
    );
  });

  it("says so rather than blanking the cell when conditions never resolved", async () => {
    // An indoor run, or one the hourly cron has not caught up with. The
    // row is still judgeable — it just has nothing to be near.
    await renderTable([row({ conditions: undefined, suggestion: undefined })]);

    expect(screen.getByText("No conditions")).toBeInTheDocument();
  });

  it("shows the kit once it is taken, in place of the offer", async () => {
    await renderTable([row()]);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    expect(screen.getByText("Janji half-zip")).toBeInTheDocument();
    expect(screen.getByText("Bandit split")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
  });
});

describe("VerdictBacklog: the keyboard", () => {
  it("names each slot by the verdict, not by the digit", async () => {
    await renderTable([row()]);

    // The digit is what a sighted runner reads; "3" announces nothing
    // about how a run felt, so the word and the key both go in the name.
    const dialed = screen.getByRole("button", { name: /^Dialed —/ });
    expect(dialed.getAttribute("aria-label")).toContain("key 3");
    expect(dialed).toHaveAttribute("aria-pressed", "false");
  });

  it("sets the verdict on the selected row and says which", async () => {
    await renderTable([row(), bare]);

    fireEvent.keyDown(body() ?? document.body, { key: "2" });

    // Scoped to the selected row: both rows carry the same five slots, and
    // what this case is about is that only the selected one moved.
    const [first, second] = rowsOf();
    expect(
      within(first ?? document.body).getByRole("button", {
        name: /^A bit cold —/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(second ?? document.body).getByRole("button", {
        name: /^A bit cold —/,
      }),
    ).toHaveAttribute("aria-pressed", "false");
    // Rule 07's live region: a table driven by keys with nothing
    // announcing them is a table only a sighted runner can clear.
    expect(screen.getByRole("status").textContent).toContain("A bit cold");
  });

  it("moves the selection with the arrows, and clamps at the ends", async () => {
    await renderTable([row(), bare]);

    const [first, second] = rowsOf();
    expect(first).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(body() ?? document.body, { key: "ArrowDown" });
    expect(second).toHaveAttribute("aria-current", "true");
    expect(first).not.toHaveAttribute("aria-current");

    // Off the end: the selection stays put rather than wrapping to the top.
    fireEvent.keyDown(body() ?? document.body, { key: "ArrowDown" });
    expect(second).toHaveAttribute("aria-current", "true");
  });

  it("puts one row in the tab order, not fifty", async () => {
    await renderTable([row(), bare]);

    const [first, second] = rowsOf();
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
  });

  it("follows focus, so clicking a row and typing agree about which it is", async () => {
    await renderTable([row(), bare]);

    fireEvent.focus(rowsOf()[1] ?? document.body);
    expect(rowsOf()[1]).toHaveAttribute("aria-current", "true");
  });
});

describe("VerdictBacklog: saving", () => {
  it("sends the kit and the verdict, then moves on", async () => {
    const saveRow = await renderTable([row(), bare]);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(saveRow).toHaveBeenCalledWith({
        data: {
          runId: "01RUN1",
          itemIds: ["01ITEM1", "01ITEM2"],
          verdict: 0,
        },
      });
    });
    // "Save & next" — the point of the surface is getting to the end.
    await waitFor(() => {
      expect(rowsOf()[1]).toHaveAttribute("aria-current", "true");
    });
  });

  it("keeps a saved row where it is, and counts it", async () => {
    // "It leaves the list on the next visit, not on save — motion has no
    // 'row flies away'."
    await renderTable([row(), bare]);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/1 of 2 saved/)).toBeInTheDocument();
    });
    expect(rowsOf()).toHaveLength(2);
    expect(rowsOf()[0]).toHaveAttribute("data-saved", "true");
    expect(rowsOf()[0]).toHaveClass("bg-tint");
  });

  it("asks for the outfit first, because A3 does too", async () => {
    const saveRow = await renderTable([row()]);

    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Pick an outfit",
      );
    });
    expect(saveRow).not.toHaveBeenCalled();
  });

  it("asks for the verdict when only the outfit is there", async () => {
    const saveRow = await renderTable([row()]);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("1 to 5");
    });
    expect(saveRow).not.toHaveBeenCalled();
  });

  it("leaves the row exactly as it was when the save fails", async () => {
    // Law 5 and the Form Contract: the control that did the thing says
    // what happened, in its own place. Nothing is lost, so Enter retries.
    const saveRow = vi.fn().mockRejectedValue(new Error("offline"));
    await renderTable([row()], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "4" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Could not save",
      );
    });
    expect(rowsOf()[0]).not.toHaveAttribute("data-saved");
    expect(screen.getByText(/0 of 1 saved/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^A bit warm —/ }),
    ).toHaveAttribute("aria-pressed", "true");
    // Round 4's §AF: the control that did the thing says what happened
    // **in its own place**. A line at the foot of a fifty-row table does
    // not say which row. Marked by border weight, never by hue — "pink is
    // action, never failure".
    expect(rowsOf()[0]).toHaveAttribute("data-failed", "true");
    expect(rowsOf()[0]).toHaveClass("border-b-2", "border-ink");
  });

  it("clears the failure mark when the row is tried again", async () => {
    // Leaving the mark on a row that is being saved again would say "this
    // failed" about something still in flight.
    const saveRow = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ entryId: "01NEW" });
    await renderTable([row()], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });
    await waitFor(() => {
      expect(rowsOf()[0]).toHaveAttribute("data-failed", "true");
    });

    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });
    await waitFor(() => {
      expect(rowsOf()[0]).toHaveAttribute("data-saved", "true");
    });
    expect(rowsOf()[0]).not.toHaveAttribute("data-failed");
  });

  it("clicks the slot as well as typing it", async () => {
    // The keyboard is the reason the surface exists, and the mouse still
    // has to work — DS5's "hover-only anything" in its other direction.
    const saveRow = await renderTable([row()]);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.click(screen.getByRole("button", { name: /^Way warm —/ }));
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(saveRow).toHaveBeenCalledWith({
        data: { runId: "01RUN1", itemIds: ["01ITEM1", "01ITEM2"], verdict: 2 },
      });
    });
  });
});

describe("VerdictBacklog: the rail", () => {
  it("shows the selected run's conditions, and follows the selection", async () => {
    await renderTable([row(), bare]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).toContain("Selected");
    // Every row here shares one observation, so what proves the rail
    // follows the selection is the day it names.
    expect(rail?.textContent).toContain("Sep 2");

    fireEvent.keyDown(body() ?? document.body, { key: "ArrowDown" });
    expect(rail?.textContent).toContain("Sep 4");
  });

  it("says the thing that stops this reading as a bulk tool", async () => {
    await renderTable([row()]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).toContain("count exactly like verdicts");
    // Visual Crossing's free tier requires attribution wherever conditions
    // are shown, and the rail shows them.
    expect(rail?.textContent).toContain("Weather by Visual Crossing");
  });

  it("draws no conditions card when the selected run has none", async () => {
    await renderTable([row({ conditions: undefined, suggestion: undefined })]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).not.toContain("Selected");
    // The note and the attribution are not conditional on it.
    expect(rail?.textContent).toContain("Weather by Visual Crossing");
  });
});

describe("VerdictBacklog: nothing to clear", () => {
  it("renders the table's chrome and no rows", async () => {
    // Reachable by typing the URL. `rowAfterMove` is what stops the
    // selection going negative here, and the rail reads `rows[0]`.
    await renderTable([]);

    expect(rowsOf()).toHaveLength(0);
    expect(screen.getByText(/0 of 0 saved/)).toBeInTheDocument();
    expect(
      document.querySelector("[data-slot='backlog-rail']"),
    ).not.toBeNull();
  });

  it("does nothing on a key with no row under it", async () => {
    await renderTable([]);

    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });
    fireEvent.keyDown(body() ?? document.body, { key: "3" });

    // Nothing is announced, because nothing happened. `PendingLabel`'s
    // hidden half still contributes "Saving" to `textContent` — what this
    // asserts is that no row spoke.
    expect(screen.getByRole("status").textContent).not.toMatch(
      /Sep|Pick an outfit|1 to 5/,
    );
  });
});
