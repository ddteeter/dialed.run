import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RunDetail } from "../../src/modules/runs/components/RunDetail";
import type { ConditionsActions } from "../../src/modules/runs/components/SetConditionsSheet";
import type { Units } from "../../src/lib/contracts";
import type { RunSummary } from "../../src/modules/runs/service";
import { expectBusy } from "../ui/unavailable";
import {
  RUN_ID,
  SET_BY_YOU,
  renderWithRouter,
  runSummary,
} from "./run-fixtures";

/**
 * A run before its kit (round 22, "R Run before kit"), and R2b: no inputs
 * on the screen, the conditions read-only where the weather came, and
 * "Set ›" into a band where it did not.
 */

type SetConditions = ConditionsActions["setConditions"];
type RetryWeather = ConditionsActions["retryWeather"];

const MILES: Units = { temp: "f", distance: "mi" };

async function openSheet(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "Set ›" }));
  return screen.findByRole("dialog", { name: "No weather saved" });
}

function detail(
  run: RunSummary,
  actions: Partial<ConditionsActions> = {},
  units: Units = MILES,
) {
  return (
    <RunDetail
      run={run}
      units={units}
      actions={{
        setConditions: actions.setConditions ?? (() => Promise.resolve(true)),
        retryWeather: actions.retryWeather ?? (() => Promise.resolve(true)),
      }}
    />
  );
}

const UNAVAILABLE = {
  weatherStatus: "failed" as const,
  conditions: undefined,
  canSetConditions: true,
};

function region(slot: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-slot='${CSS.escape(slot)}']`,
  );
  if (found === null) throw new Error(`no ${slot}`);
  return found;
}

describe("R: a run before its kit", () => {
  it("strips the run: when, where from, how far, how fast", async () => {
    await renderWithRouter(detail(runSummary()));

    const strip = region("run-strip");
    expect(strip).toHaveTextContent("Sat 29 Aug · 6:04 AM · File");
    expect(within(strip).getByText("6.2 mi")).toBeVisible();
    expect(within(strip).getByText("8:20 /mi")).toBeVisible();
  });

  it("names a run entered by hand as the board does, and dates it in UTC with no zone", async () => {
    await renderWithRouter(
      detail(runSummary({ source: "manual", conditions: undefined })),
    );

    expect(region("run-strip")).toHaveTextContent(
      "Sat 29 Aug · 11:04 AM · By hand",
    );
  });

  it("says the kit is what it is waiting for, and asks for it in the log verb", async () => {
    await renderWithRouter(detail(runSummary()));

    const kit = region("kit");
    expect(kit).toHaveAttribute("data-state", "empty");
    expect(kit).toHaveTextContent(
      "No kit yet. Without one, this run can’t teach your closet anything.",
    );
    const primary = screen.getByRole("link", { name: "What did you wear?" });
    expect(primary).toHaveAttribute("href", `/feed/attach/${RUN_ID}`);
    expect(primary).toHaveClass("bg-action");
  });

  it("has no input on it at all", async () => {
    await renderWithRouter(detail(runSummary(UNAVAILABLE)));

    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

describe("R: the conditions row", () => {
  it("is A1's ink block, read-only, when the weather arrived", async () => {
    await renderWithRouter(detail(runSummary()));

    const block = region("conditions");
    expect(block).toHaveAttribute("data-state", "attached");
    expect(block).toHaveAttribute("data-ground", "ink");
    expect(block).toHaveTextContent("Conditions · auto-attached");
    expect(block).toHaveTextContent("41°F");
    expect(block).toHaveTextContent("damp");
    expect(block).toHaveTextContent("Feels 36° · 88% hum · 9mph · Light rain");
    expect(
      within(block).getByRole("link", { name: "Weather by Visual Crossing" }),
    ).toBeVisible();
    // No correction note here: only A1's card can move the time.
    expect(block).not.toHaveTextContent("Never typed by hand");
  });

  it("says set by you, and nothing it does not know, for a band chosen in R2b", async () => {
    await renderWithRouter(
      detail(
        runSummary({
          weatherStatus: "manual",
          conditions: SET_BY_YOU,
        }),
      ),
    );

    const block = region("conditions");
    expect(block).toHaveAttribute("data-state", "set");
    expect(block).toHaveTextContent("Conditions · set by you");
    expect(block).toHaveTextContent("55°F");
    expect(block).not.toHaveTextContent("Feels");
    expect(within(block).queryByRole("link")).toBeNull();
  });

  it("breathes while the weather is still being asked for", async () => {
    await renderWithRouter(
      detail(runSummary({ weatherStatus: "pending", conditions: undefined })),
    );

    expect(screen.getByText("Fetching weather")).toBeVisible();
    expect(document.querySelector("[data-slot='conditions']")).toBeNull();
  });

  it("calls an indoor run a treadmill, with nothing to set", async () => {
    await renderWithRouter(
      detail(
        runSummary({
          indoor: true,
          weatherStatus: "none",
          conditions: undefined,
        }),
      ),
    );

    expect(region("conditions")).toHaveAttribute("data-state", "indoor");
    expect(screen.getByText("Treadmill")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set ›" })).toBeNull();
  });

  it("says no conditions, and offers Set › into R2b, when the weather never came", async () => {
    await renderWithRouter(detail(runSummary(UNAVAILABLE)));

    const row = region("conditions");
    expect(row).toHaveAttribute("data-state", "unavailable");
    expect(row).toHaveTextContent("No conditions");
    expect(row).toHaveTextContent(
      "No weather came back for this time and place.",
    );
    expect(within(row).getByRole("button", { name: "Set ›" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });

  it("offers nothing to set for a run with no place to key it on", async () => {
    await renderWithRouter(
      detail(runSummary({ ...UNAVAILABLE, canSetConditions: false })),
    );

    expect(screen.getByText("No conditions")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set ›" })).toBeNull();
  });
});

describe("R2b: no weather saved", () => {
  it("says what happened, outlined, with the two ways on", async () => {
    const user = userEvent.setup();
    await renderWithRouter(detail(runSummary(UNAVAILABLE)));

    const sheet = await openSheet(user);

    expect(within(sheet).getByText("No history for that time")).toBeVisible();
    const box = sheet.querySelector("[data-slot='weather-unavailable']");
    expect(box).toHaveClass("border-ink");
    expect(box).toHaveTextContent("No weather saved");
    expect(box).toHaveTextContent(
      "We have no record for that hour. Set the conditions yourself and the run still counts.",
    );
    expect(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it("offers bands to pick — never a number to type — in the runner's unit", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      detail(runSummary(UNAVAILABLE), {}, { temp: "c", distance: "km" }),
    );
    const sheet = await openSheet(user);

    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    const bands = within(sheet).getByRole("group", { name: "Conditions" });
    const buttons = within(bands).getAllByRole("button");
    expect(buttons).toHaveLength(12);
    expect(buttons[0]).toHaveAccessibleName("-20–-15°");
    expect(buttons.at(-1)).toHaveAccessibleName("35–40°");
    expect(sheet.querySelector("input")).toBeNull();
    expect(
      within(sheet).queryByRole("button", { name: "Try again" }),
    ).toBeNull();
  });

  it("sets the band picked, then reloads the run and closes", async () => {
    const user = userEvent.setup();
    const setConditions = vi.fn<SetConditions>(() => Promise.resolve(true));
    const { router } = await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { setConditions }),
    );
    const invalidate = vi.spyOn(router, "invalidate");
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    await user.click(within(sheet).getByRole("button", { name: "50–59°" }));

    await waitFor(() => {
      expect(setConditions).toHaveBeenCalledWith({
        data: { runId: RUN_ID, bandFloorC: 10 },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("waits behind the band it is setting, and says what is still true if it fails", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<boolean>();
    const setConditions = vi
      .fn<SetConditions>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(true);
    await renderWithRouter(detail(runSummary(UNAVAILABLE), { setConditions }));
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    const band = within(sheet).getByRole("button", { name: "50–59°" });
    await user.click(band);
    await waitFor(() => {
      expectBusy(band);
    });
    expect(band).toHaveAccessibleName("Setting");
    // Every band waits: a second pick mid-flight is not a second write.
    const other = within(sheet).getByRole("button", { name: "59–68°" });
    expectBusy(other);
    await user.click(other);
    expect(setConditions).toHaveBeenCalledTimes(1);

    pending.reject(new Error("D1 unavailable"));
    expect(await within(sheet).findByText("No conditions")).toBeVisible();
    expect(within(sheet).getByText("Our end failed.")).toBeVisible();

    await user.click(within(sheet).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(setConditions).toHaveBeenLastCalledWith({
        data: { runId: RUN_ID, bandFloorC: 10 },
      });
    });
  });

  it("asks the weather again on Try again, then reloads and closes", async () => {
    const user = userEvent.setup();
    const retryWeather = vi.fn<RetryWeather>(() => Promise.resolve(true));
    const { router } = await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { retryWeather }),
    );
    const invalidate = vi.spyOn(router, "invalidate");
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(retryWeather).toHaveBeenCalledWith({ data: { runId: RUN_ID } });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("says it is trying, and still no conditions when the retry fails", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<boolean>();
    const retryWeather = vi
      .fn<RetryWeather>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(true);
    await renderWithRouter(detail(runSummary(UNAVAILABLE), { retryWeather }));
    const sheet = await openSheet(user);

    const retry = within(sheet).getByRole("button", { name: "Try again" });
    await user.click(retry);
    await waitFor(() => {
      expectBusy(retry);
    });
    expect(retry).toHaveAccessibleName("Trying");

    pending.reject(new Error("D1 unavailable"));
    expect(await within(sheet).findByText("No conditions")).toBeVisible();
    expect(within(sheet).getByRole("status")).toHaveTextContent(
      "No conditions. Our end failed.",
    );

    // The band's own Try again repeats the retry.
    const band = sheet.querySelector<HTMLElement>("[data-part='failure-band']");
    if (band === null) throw new Error("no failure band");
    await user.click(within(band).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(retryWeather).toHaveBeenCalledTimes(2);
    });
  });

  it("closes the way the platform closes it, and changes nothing", async () => {
    // Escape and swipe-down are the dialog's own close; both arrive at
    // the same callback.
    const user = userEvent.setup();
    const setConditions = vi.fn<SetConditions>();
    await renderWithRouter(detail(runSummary(UNAVAILABLE), { setConditions }));
    const sheet = await openSheet(user);

    (sheet as HTMLDialogElement).close();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(setConditions).not.toHaveBeenCalled();
    // And it opens again from the row.
    expect(await openSheet(user)).toBeVisible();
  });
});
