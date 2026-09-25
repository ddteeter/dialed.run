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
import type { VerdictBacklogProps } from "../../src/modules/runs/components/VerdictBacklog";

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
    kit: undefined,
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

/**
 * `renderTable`, with the router's `invalidate` watched — the one thing
 * the table asks of the router, when the last row clears.
 */
async function renderTableWatching(
  rows: readonly BacklogRow[],
  saveRow: VerdictBacklogProps["saveRow"],
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
  const invalidate = vi.spyOn(router, "invalidate");
  render(<RouterProvider router={router} />);
  return invalidate;
}

const body = () => screen.getAllByRole("rowgroup")[1];
const rowsOf = () => screen.getAllByRole("row").slice(1);
const slot = (name: RegExp) => screen.getByRole("button", { name });

/**
 * A promise this test resolves when it chooses, so the in-flight state is
 * reachable at all — a pending state visible only for a tick is one a test
 * races. `Promise.withResolvers` is the platform's own spelling and the
 * one eslint insists on.
 */
function deferred(): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
} {
  return Promise.withResolvers<unknown>();
}

describe("VerdictBacklog: what a row offers", () => {
  it("lays A3's three inputs flat, and is a real table while it does it", async () => {
    await renderTable([row()]);

    // A table, so a reader gets row and column semantics for free — which
    // is most of what makes a backlog readable at all.
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
      // Round 16: the header asks A3's question. It used to read
      // "Verdict · 1–5", and a reviewer could not tell what the digits were.
    ).toStrictEqual(["Run", "Conditions", "Outfit", "Did it work?"]);
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
    // Round 20: "No usual kit here · Pick" — the cell names the gap.
    expect(screen.getByText("No usual kit here ·")).toBeVisible();
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

describe("VerdictBacklog: a run that already has a kit", () => {
  const kitted = row({
    runId: "01RUN3",
    kit: {
      entryId: "01ENT3",
      itemIds: ["01ITEM9"],
      itemNames: ["Houdini"],
    },
    suggestion: undefined,
  });

  it("shows the kit it has, and offers no other", async () => {
    // A kit with no verdict is in the backlog, and `attachKit` never
    // replaces a kit — so a Use or a Pick here would choose a kit that is
    // then silently dropped.
    await renderTable([kitted]);

    expect(screen.getByText("Houdini")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Pick" })).toBeNull();
    expect(screen.queryByText("No usual kit here ·")).toBeNull();
  });

  it("saves the verdict against the kit it showed", async () => {
    const saveRow = await renderTable([kitted]);

    fireEvent.keyDown(body() ?? document.body, { key: "4" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(saveRow).toHaveBeenCalledWith({
        data: { runId: "01RUN3", itemIds: ["01ITEM9"], verdict: 1 },
      });
    });
  });

  it("says an entry saved with nothing on it has no kit, and still saves", async () => {
    const saveRow = await renderTable([
      row({
        runId: "01RUN4",
        kit: { entryId: "01ENT4", itemIds: [], itemNames: [] },
        suggestion: undefined,
      }),
    ]);

    expect(screen.getByText("No kit on this run")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Pick" })).toBeNull();
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(saveRow).toHaveBeenCalledWith({
        data: { runId: "01RUN4", itemIds: [], verdict: 0 },
      });
    });
  });
});

describe("VerdictBacklog: the keyboard", () => {
  it("shows the verdict's word and no digit anywhere", async () => {
    // Round 16, and the reason it exists: "the row shows A3's five words,
    // never the digits — digits are keyboard shortcuts, not labels (Flow
    // Map: 'no numeric scores in the UI')". A reviewer watching the demo
    // could not tell what `1`–`5` were, and asked whether they were
    // per-item.
    await renderTable([row()]);

    const slots = screen.getAllByRole("button", { name: /—/ });
    expect(slots.map((slot) => slot.textContent)).toStrictEqual([
      "Way cold",
      "A bit cold",
      "Dialed",
      "A bit warm",
      "Way warm",
    ]);
    // The name adds only the row; the key is a shortcut, and reading
    // "key 3" to somebody who cannot see the legend is noise.
    const dialed = screen.getByRole("button", { name: /^Dialed —/ });
    expect(dialed.getAttribute("aria-label")).not.toContain("key");
    expect(dialed).toHaveAttribute("aria-pressed", "false");

    // And no digit is drawn in the verdict cell. Scoped to the slots
    // rather than the whole table, because the row is full of legitimate
    // digits — the date, the distance, the wind. What round 16 forbids is
    // a digit standing in for a verdict.
    for (const slot of slots) {
      expect(slot.textContent).not.toMatch(/\d/);
    }
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
    await renderTable([row(), bare], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });
    await waitFor(() => {
      expect(rowsOf()[0]).toHaveAttribute("data-failed", "true");
    });
    // Round 22, item 18: the band spans the row, directly under it, with
    // Try again inside — a control's band (round 23, item 9), whose kicker
    // names what is still true: the run is not logged.
    const band = document.querySelector("[data-slot='row-failure']");
    expect(band?.previousElementSibling).toBe(rowsOf()[0]);
    expect(band?.querySelector("td")).toHaveAttribute("colspan", "4");
    expect(band).toHaveTextContent("Not logged");
    expect(band).not.toHaveTextContent("Nothing saved");
    expect(band).toHaveTextContent("Our end failed. Nothing changed.");
    expect(band?.querySelector("[data-part='failure-band']")).not.toBeNull();
    // On the row being worked, the band shows below the desk as well.
    expect(band).toHaveClass("block", "desk:table-row");
    expect(band).not.toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(rowsOf()[0]).toHaveAttribute("data-saved", "true");
    });
    expect(rowsOf()[0]).not.toHaveAttribute("data-failed");
    expect(document.querySelector("[data-slot='row-failure']")).toBeNull();
    expect(saveRow).toHaveBeenCalledTimes(2);
  });

  it("keeps the band on its own row while another row is being worked", async () => {
    // "The row keeps its place and choice": moving on does not clear it,
    // and the band belongs to the row that failed, not the selection.
    const saveRow = vi.fn().mockRejectedValue(new Error("offline"));
    await renderTable([row(), bare], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });
    await waitFor(() => {
      expect(rowsOf()[0]).toHaveAttribute("data-failed", "true");
    });
    fireEvent.keyDown(body() ?? document.body, { key: "ArrowDown" });

    const band = document.querySelector("[data-slot='row-failure']");
    expect(band).not.toBeNull();
    // Waiting its turn below the desk, like the row it belongs to.
    expect(band).toHaveClass("hidden", "desk:table-row");
    expect(rowsOf()[0]).toHaveAttribute("data-failed", "true");
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

describe("VerdictBacklog: what each state is drawn as", () => {
  it("gives the three hues the meanings T2 gives them, by sign not by key", async () => {
    // "Same hue meanings as T2" — pink cold, teal dialed, grey warm. Read
    // from the *value*, so the hue stays tied to the meaning and not to
    // how many keys the table happens to offer.
    await renderTable([row()]);

    for (const name of [/^Way cold/, /^A bit cold/]) {
      // `--quiet`, which is the board's own off state — not `--muted`.
      expect(slot(name)).toHaveClass("border-hairline-2", "text-quiet");
      // The slot is square, mono and padded, in every state — "square is
      // the tell for a statement rather than a control", and mono is the
      // tell that the digit is a measured thing. `target` is rule 03 and
      // lives at the site rather than in the treatment.
      expect(slot(name)).toHaveClass(
        "target",
        "rounded-none",
        "font-mono",
        // MONO.xs is the floor everywhere (`tokens.js`), which is what the
        // board's own 9px would have broken.
        "text-mono-xs",
      );
    }

    fireEvent.click(slot(/^Way cold/));
    expect(slot(/^Way cold/)).toHaveClass(
      "border-action",
      "bg-action",
      "text-accent-ink",
    );

    fireEvent.click(slot(/^Dialed/));
    expect(slot(/^Dialed/)).toHaveClass("border-teal", "bg-teal");
    // …and the one just deselected goes back to resting, so the hue is
    // not merely added.
    expect(slot(/^Way cold/)).toHaveClass("border-hairline-2");

    fireEvent.click(slot(/^Way warm/));
    expect(slot(/^Way warm/)).toHaveClass(
      "border-quiet",
      "bg-quiet",
      "text-ground",
    );
  });

  it("dates a row where its run happened, not where UTC had reached", async () => {
    // D-96. 03:30 UTC on Thursday 3 September is still Wednesday evening
    // in Chicago. The row, the rail and the table cell all say Wednesday,
    // because the run's own observation names its zone; the same row
    // without one is dated in UTC, as every row was before.
    const lateEvening = Math.floor(Date.UTC(2026, 8, 3, 3, 30) / 1000);
    await renderTable([
      row({
        startedAt: lateEvening,
        conditions: { ...conditions, timeZone: "America/Chicago" },
      }),
    ]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).toContain("Wed 2 Sep");
    expect(rail?.textContent).not.toContain("Thu 3 Sep");
    expect(screen.getAllByText("Wed 2 Sep").length).toBeGreaterThan(0);
  });

  it("dates a row with no known zone in UTC", async () => {
    const lateEvening = Math.floor(Date.UTC(2026, 8, 3, 3, 30) / 1000);
    await renderTable([row({ startedAt: lateEvening })]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).toContain("Thu 3 Sep");
  });

  it("writes the conditions as one measured line", async () => {
    // The actual temperature, the condition, the wind in the viewer's own
    // units — mono, with the brand's separator. The row and the rail
    // render the same line, which is why it is a function rather than two
    // pieces of markup.
    //
    // This asserted "37° · Clear · WIND 9": feels-like where DS2 draws the
    // actual temperature, and the fixture's 9 kph printed as 9 to a viewer
    // who counts miles. It pinned task 115's misreading of the board
    // rather than the board, and the 2026-09-22 reconciliation sweep is
    // what caught it. 5°C is 41°F; 9 km/h is 6 mph.
    await renderTable([row()]);

    expect(screen.getAllByText("41° · Clear · 6mph")).toHaveLength(2);
  });

  it("says how long and how far, in the viewer's own units", async () => {
    await renderTable([row()]);

    expect(screen.getByText(/40:00 · 5\.0mi/)).toBeInTheDocument();
  });

  it("draws a resting row with a hairline and no wash", async () => {
    await renderTable([row()]);

    const [only] = rowsOf();
    expect(only).toHaveClass("row-press", "border-b", "border-hairline");
    expect(only).not.toHaveClass("bg-tint");
  });

  it("spells out every key it claims, beside what it does", async () => {
    // The legend is the surface's instruction manual: a table driven by
    // keys that does not say which keys is a table nobody can drive.
    await renderTable([row()]);

    const legend = screen.getByText("Keys").parentElement;
    expect(legend?.textContent).toContain("↑↓row");
    // The legend is the only place a digit appears, and it maps the keys
    // to the words rather than asserting they are "the verdict".
    expect(legend?.textContent).toContain("1–5way cold → way warm");
    expect(legend?.textContent).toContain("↵save & next");
    // Skip is a key, not a slot — there is no sixth button offering to do
    // nothing.
    expect(legend?.textContent).toContain("↓skip");
    expect(legend?.textContent).toContain("Taboutfit");
  });

  it("says nothing before anything has happened, and is not waiting", async () => {
    await renderTable([row()]);

    // The live region exists from first paint — a region that appears
    // with its first message is a region a reader never hears. It starts
    // empty rather than with a placeholder sentence, and it is not in its
    // waiting state.
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(screen.getByText("Saving")).not.toBeVisible();
    // Empty, not merely "not one of the messages": a region seeded with a
    // sentence announces it to a reader the moment the screen mounts.
    // The resting half is `PendingLabel`'s first span.
    expect(status.firstElementChild?.firstElementChild).toHaveTextContent("");
  });

  it("breathes while a row is in flight, and names the row it saved", async () => {
    // The pending half of `PendingLabel`, which nothing reached: the
    // announcement is the receipt, and "Saved" with no day in it is a
    // receipt for whichever row you like.
    const pending = deferred();
    const saveRow = vi.fn().mockReturnValue(pending.promise);
    await renderTable([row(), bare], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    // **`toBeVisible`, not `textContent`.** `PendingLabel` stacks both
    // halves in one grid cell and swaps them by `visibility`, so the
    // region's text contains "Saving" whatever `pending` is — an
    // assertion on the text passes against a component that never
    // switches. Visibility is the mechanism, so visibility is what is
    // asked.
    await waitFor(() => {
      expect(screen.getByText("Saving")).toBeVisible();
    });
    // The breathing bracket is the app's one waiting device, and it is
    // `aria-hidden` — the word beside it is what a reader hears.
    expect(screen.getByRole("status").querySelector(".breathe")).not.toBeNull();

    pending.resolve({ entryId: "01NEW" });
    await waitFor(() => {
      expect(screen.getByText("Saving")).not.toBeVisible();
    });
    // The day is in the receipt: "Saved" with no day in it is a receipt
    // for whichever row you like.
    expect(screen.getByText(/^Saved /)).toBeVisible();
    expect(screen.getByRole("status").textContent).toContain("2 Sep");
  });
});

describe("VerdictBacklog: the rail", () => {
  it("shows the selected run's conditions, and follows the selection", async () => {
    await renderTable([row(), bare]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).toContain("Selected");
    // Every row here shares one observation, so what proves the rail
    // follows the selection is the day it names.
    expect(rail?.textContent).toContain("2 Sep");

    fireEvent.keyDown(body() ?? document.body, { key: "ArrowDown" });
    expect(rail?.textContent).toContain("4 Sep");
  });

  it("attributes the weather it shows, and carries none of design's notes", async () => {
    await renderTable([row()]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    // Visual Crossing's free tier requires attribution wherever conditions
    // are shown, and the rail shows them.
    expect(rail?.textContent).toContain("Weather by Visual Crossing");
    // This test used to assert the opposite — that the rail said
    // "Verdicts saved here count exactly like verdicts from the phone".
    // That sentence is a `data-annotation` on the Desktop Contract: design
    // explaining the table to us, not copy for a runner. The architecture
    // test `annotations-are-not-copy` guards the whole class; this pins
    // the instance that shipped.
    expect(rail?.textContent).not.toContain("count exactly like verdicts");
  });

  it("says there is no weather on a run with none, and still takes a verdict", async () => {
    // Round 22, item 18: "No conditions: rail sentence 'No weather on
    // this run.' — verdict still allowed."
    await renderTable([row({ conditions: undefined, suggestion: undefined })]);

    const rail = document.querySelector("[data-slot='backlog-rail']");
    expect(rail?.textContent).toContain("Selected");
    expect(rail?.textContent).toContain("No weather on this run.");
    expect(
      screen.getByRole("button", { name: /^Dialed —/ }),
    ).not.toHaveAttribute("aria-disabled");
    // The note and the attribution are not conditional on it.
    expect(rail?.textContent).toContain("Weather by Visual Crossing");
  });
});

describe("VerdictBacklog: all logged (round 22, item 18)", () => {
  it("says [ ALL LOGGED ] when there is nothing to clear, and draws no table", async () => {
    // Reachable by typing the URL with an empty queue.
    await renderTable([]);

    expect(screen.getByText("[All logged]")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.querySelector("[data-slot='backlog-rail']")).toBeNull();
    expect(screen.queryByText(/runs · oldest first/)).toBeNull();
  });

  it("clears to [ ALL LOGGED ] when the last row lands, and asks for the bar's count again", async () => {
    const saveRow = vi.fn().mockResolvedValue({ entryId: "01NEW" });
    const invalidate = await renderTableWatching([row()], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    expect(await screen.findByText("[All logged]")).toBeVisible();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not ask again while rows are still waiting", async () => {
    const saveRow = vi.fn().mockResolvedValue({ entryId: "01NEW" });
    const invalidate = await renderTableWatching([row(), bare], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.keyDown(body() ?? document.body, { key: "3" });
    fireEvent.keyDown(body() ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(rowsOf()[0]).toHaveAttribute("data-saved", "true");
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText("[All logged]")).toBeNull();
  });
});

describe("VerdictBacklog: 720–1039, one run at a time", () => {
  it("draws only the selected row below the desk, and every row from it up", async () => {
    // Round 22, item 18: "720–1039: no table; A3 one at a time in the
    // panel." One markup, two layouts: the classes are the rule.
    await renderTable([row(), bare]);

    expect(rowsOf()[0]).toHaveClass("flex", "desk:table-row");
    expect(rowsOf()[0]).not.toHaveClass("hidden");
    expect(rowsOf()[1]).toHaveClass("hidden", "desk:table-row");
    expect(screen.getByRole("table")).toHaveClass("block", "desk:table");
    // The count heads the queue while there is one to count.
    expect(screen.getByText(/^2 runs · oldest first$/u)).toBeVisible();
  });

  it("logs the row with A3's own verb where there is no Enter to press", async () => {
    const saveRow = vi.fn().mockResolvedValue({ entryId: "01NEW" });
    await renderTable([row(), bare], saveRow);

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    fireEvent.click(
      within(rowsOf()[0] ?? document.body).getByRole("button", {
        name: /^A bit warm —/,
      }),
    );
    const [logIt] = screen.getAllByRole("button", { name: "Log it" });
    if (logIt === undefined) throw new Error("no Log it");
    fireEvent.click(logIt);

    await waitFor(() => {
      expect(saveRow).toHaveBeenCalledWith({
        data: {
          runId: "01RUN1",
          itemIds: ["01ITEM1", "01ITEM2"],
          verdict: 1,
        },
      });
    });
  });

  it("skips to the next run, and back to the last at the end", async () => {
    await renderTable([row(), bare]);

    const [skip] = screen.getAllByRole("button", { name: "Skip" });
    if (skip === undefined) throw new Error("no Skip");
    fireEvent.click(skip);

    expect(rowsOf()[1]).toHaveAttribute("aria-current", "true");
    expect(rowsOf()[1]).not.toHaveClass("hidden");
    expect(rowsOf()[0]).toHaveClass("hidden");
  });
});

describe("VerdictBacklog: keys it does not claim", () => {
  it("leaves a key it does not claim to the browser", async () => {
    // Both halves matter and neither is visible. `actionForKey` answering
    // `undefined` has to *return* — falling through would read `.kind` off
    // nothing and throw — and the table must not `preventDefault` a key it
    // is not handling, or Tab stops reaching the outfit cell, which is the
    // one navigation the contract names by key.
    await renderTable([row(), bare]);

    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(body() ?? document.body, tab);
    expect(tab.defaultPrevented).toBe(false);
    // …and nothing moved.
    expect(rowsOf()[0]).toHaveAttribute("aria-current", "true");

    // A key it does claim is taken: `↓` must not also scroll the page.
    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(body() ?? document.body, down);
    expect(down.defaultPrevented).toBe(true);
    expect(rowsOf()[1]).toHaveAttribute("aria-current", "true");
  });
});
