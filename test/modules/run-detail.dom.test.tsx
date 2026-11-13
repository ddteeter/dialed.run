import { screen, waitFor, within } from "@testing-library/react";
import { drawnText, saidText } from "./spoken-text";
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

const MILES: Units = { temp: "f", distance: "mi" };

async function openSheet(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "Set conditions" }));
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
    expect(strip).toHaveTextContent("Sat Aug 29 · 6:04 AM · File");
    expect(within(strip).getByText("6.2 mi")).toBeVisible();
    expect(within(strip).getByText("8:20 /mi")).toBeVisible();
    // Said in words: "8:20 /mi" is read as "slash m i".
    expect(within(strip).getByText("8:20 /mi")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(strip).getByText("8 minutes 20 seconds per mile"),
    ).toHaveClass("sr-only");
  });

  it("draws no pace, shown or said, for a run with no distance", async () => {
    await renderWithRouter(detail(runSummary({ distanceM: 0 })));

    const strip = region("run-strip");
    expect(within(strip).queryByText(/\/mi/u)).toBeNull();
    expect(within(strip).queryByText(/per mile/u)).toBeNull();
    // Not even an empty said half for a reader to land on.
    expect(strip.querySelector(".sr-only")).toBeNull();
  });

  it("names a run entered by hand as the board does, and dates it in UTC with no zone", async () => {
    await renderWithRouter(
      detail(runSummary({ source: "manual", conditions: undefined })),
    );

    expect(region("run-strip")).toHaveTextContent(
      "Sat Aug 29 · 11:04 AM · By hand",
    );
  });

  it("credits Garmin on a run that came through Garmin's API (G1)", async () => {
    await renderWithRouter(detail(runSummary({ source: "garmin" })));

    expect(region("run-strip")).toHaveTextContent(
      "Sat Aug 29 · 6:04 AM · Garmin",
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
    // Round 52 #158: each line of measures is drawn for the eye and said
    // in words, once.
    const feels = within(block).getByText(
      "Feels 36° · 88% hum · 9mph · Light rain",
    );
    expect(feels).toHaveAttribute("aria-hidden", "true");
    expect(feels.nextElementSibling).toHaveClass("sr-only");
    expect(feels.nextElementSibling).toHaveTextContent(
      "Feels like 36 degrees, 88 percent humidity, wind 9 miles per hour, Light rain",
    );
    expect(within(block).getByText("41°F")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(block).getByText("damp")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(block).getByText("41 degrees Fahrenheit, damp")).toHaveClass(
      "sr-only",
    );
    expect(
      within(block).getByRole("link", {
        name: "Weather data provided by Visual Crossing",
      }),
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
    // The range and the sky that were picked, never the stored middle
    // (round 26, item 2).
    expect(drawnText(block)).toContain("50–59°Rain");
    expect(block).not.toHaveTextContent("55°");
    // Round 53 · 162.3: a band is said as a range, then the sky picked.
    expect(saidText(block)).toBe(
      "Conditions · set by you50 to 59 degrees, rain",
    );
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
    expect(screen.queryByRole("button", { name: "Set conditions" })).toBeNull();
  });

  it("says no conditions, and offers Set › into R2b, when the weather never came", async () => {
    await renderWithRouter(detail(runSummary(UNAVAILABLE)));

    const row = region("conditions");
    expect(row).toHaveAttribute("data-state", "unavailable");
    expect(row).toHaveTextContent("No conditions");
    expect(row).toHaveTextContent(
      "No weather came back for this time and place.",
    );
    // "Set ›" on screen; the chevron is decoration, so the name says what
    // it sets instead, the visible word first.
    const set = within(row).getByRole("button", { name: "Set conditions" });
    expect(set).toHaveAttribute("aria-haspopup", "dialog");
    expect(set).toHaveTextContent(/^Set ›$/u);
    expect(within(set).getByText("›")).toHaveAttribute("aria-hidden", "true");
    // R2b waits to be asked for: nothing is laid over the run on arrival.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers nothing to set for a run with no place to key it on", async () => {
    await renderWithRouter(
      detail(runSummary({ ...UNAVAILABLE, canSetConditions: false })),
    );

    expect(screen.getByText("No conditions")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set conditions" })).toBeNull();
  });
});

describe("R2b: no weather saved", () => {
  type SetConditions = ConditionsActions["setConditions"];
  type RetryWeather = ConditionsActions["retryWeather"];

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

  it("offers two picks — never a number to type — in the runner's unit, nothing preselected", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      detail(runSummary(UNAVAILABLE), {}, { temp: "c", distance: "km" }),
    );
    const sheet = await openSheet(user);

    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    expect(sheet).toHaveAccessibleName("Set conditions");
    expect(
      within(sheet).getByText(
        "Roughly is fine. This stays on your run and never counts toward anyone else’s.",
      ),
    ).toBeVisible();
    const warm = within(sheet).getByRole("group", { name: "How warm · °C" });
    const bands = within(warm).getAllByRole("radio");
    expect(bands).toHaveLength(12);
    // Drawn "-20–-15°", said as a range (round 53 · 162.3).
    expect(bands[0]).toHaveAccessibleName("minus 20 to minus 15 degrees");
    expect(within(warm).getByText("-20–-15°")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // Three to a row, coldest top-left.
    expect(bands[0]?.closest("label")?.parentElement).toHaveClass(
      "grid-cols-3",
    );
    expect(bands.at(-1)).toHaveAccessibleName("35 to 40 degrees");
    const sky = within(sheet).getByRole("group", { name: "Sky" });
    const skies = within(sky).getAllByRole("radio");
    expect(skies).toHaveLength(4);
    for (const [index, word] of ["Dry", "Damp", "Rain", "Snow"].entries()) {
      expect(skies[index]).toHaveAccessibleName(word);
    }
    // "A guess we make would look like a reading we took."
    expect(within(sheet).queryByRole("radio", { checked: true })).toBeNull();
    expect(sheet.querySelector("input:not([type='radio'])")).toBeNull();
    expect(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    ).toBeVisible();
    expect(
      within(sheet).queryByRole("button", { name: "Try again" }),
    ).toBeNull();
  });

  it("labels the bands in whole Fahrenheit for a Fahrenheit runner", async () => {
    const user = userEvent.setup();
    await renderWithRouter(detail(runSummary(UNAVAILABLE)));
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    const warm = within(sheet).getByRole("group", { name: "How warm · °F" });
    const bands = within(warm).getAllByRole("radio");
    expect(bands[0]).toHaveAccessibleName("minus 4 to 5 degrees");
    expect(bands.at(-1)).toHaveAccessibleName("95 to 104 degrees");
    expect(within(warm).getByText("95–104°")).toBeVisible();
  });

  it("refuses a missing pick with the board's words, on the group it is missing from", async () => {
    const user = userEvent.setup();
    const didSetConditions = vi.fn<SetConditions>(() => Promise.resolve(true));
    await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { setConditions: didSetConditions }),
    );
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    expect(
      await within(sheet).findByText("Pick how warm it was."),
    ).toBeVisible();
    expect(within(sheet).getByText("Pick the sky.")).toBeVisible();
    expect(didSetConditions).not.toHaveBeenCalled();

    await user.click(
      within(sheet).getByRole("radio", { name: "50 to 59 degrees" }),
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    await waitFor(() => {
      expect(within(sheet).queryByText("Pick how warm it was.")).toBeNull();
    });
    expect(within(sheet).getByText("Pick the sky.")).toBeVisible();
    expect(didSetConditions).not.toHaveBeenCalled();
  });

  it("says the pick on the button, sets both, then reloads the run and closes", async () => {
    const user = userEvent.setup();
    const didSetConditions = vi.fn<SetConditions>(() => Promise.resolve(true));
    const { router } = await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { setConditions: didSetConditions }),
    );
    const invalidate = vi.spyOn(router, "invalidate");
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );

    await user.click(
      within(sheet).getByRole("radio", { name: "50 to 59 degrees" }),
    );
    // One pick is not yet a pick to name.
    expect(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    ).toBeVisible();
    await user.click(within(sheet).getByRole("radio", { name: "Rain" }));
    await user.click(
      within(sheet).getByRole("button", {
        name: "Set 50 to 59 degrees and rain",
      }),
    );

    await waitFor(() => {
      expect(didSetConditions).toHaveBeenCalledWith({
        data: { runId: RUN_ID, bandFloorC: 10, sky: "rain" },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("waits while it sets, and says nothing was saved if it fails", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<boolean>();
    const didSetConditions = vi
      .fn<SetConditions>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(true);
    await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { setConditions: didSetConditions }),
    );
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Set conditions" }),
    );
    await user.click(
      within(sheet).getByRole("radio", { name: "32 to 41 degrees" }),
    );
    await user.click(within(sheet).getByRole("radio", { name: "Snow" }));

    const submit = within(sheet).getByRole("button", {
      name: "Set 32 to 41 degrees and snow",
    });
    await user.click(submit);
    await waitFor(() => {
      expectBusy(submit);
    });
    expect(submit).toHaveAccessibleName("Setting");
    // A second press mid-flight is not a second write.
    await user.click(submit);
    expect(didSetConditions).toHaveBeenCalledTimes(1);

    pending.reject(new Error("D1 unavailable"));
    expect(await within(sheet).findByText("Nothing saved")).toBeVisible();

    // Try again resubmits exactly the picks that failed.
    await user.click(within(sheet).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(didSetConditions).toHaveBeenCalledTimes(2);
    });
    expect(didSetConditions).toHaveBeenLastCalledWith({
      data: { runId: RUN_ID, bandFloorC: 0, sky: "snow" },
    });
  });

  it("asks the weather again on Try again, then reloads and closes", async () => {
    const user = userEvent.setup();
    const didRetryWeather = vi.fn<RetryWeather>(() => Promise.resolve(true));
    const { router } = await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { retryWeather: didRetryWeather }),
    );
    const invalidate = vi.spyOn(router, "invalidate");
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(didRetryWeather).toHaveBeenCalledWith({ data: { runId: RUN_ID } });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("says it is trying, and still no conditions when the retry fails", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<boolean>();
    const didRetryWeather = vi
      .fn<RetryWeather>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(true);
    await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { retryWeather: didRetryWeather }),
    );
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
      expect(didRetryWeather).toHaveBeenCalledTimes(2);
    });
  });

  it("closes the way the platform closes it, and changes nothing", async () => {
    // Escape and swipe-down are the dialog's own close; both arrive at
    // the same callback.
    const user = userEvent.setup();
    const didSetConditions = vi.fn<SetConditions>();
    await renderWithRouter(
      detail(runSummary(UNAVAILABLE), { setConditions: didSetConditions }),
    );
    const sheet = await openSheet(user);

    (sheet as HTMLDialogElement).close();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(didSetConditions).not.toHaveBeenCalled();
    // And it opens again from the row.
    expect(await openSheet(user)).toBeVisible();
  });
});
