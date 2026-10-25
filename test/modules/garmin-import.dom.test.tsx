import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GarminImport } from "../../src/modules/runs/components/GarminImport";
import type { GarminImportActions } from "../../src/modules/runs/components/GarminImport";
import { UploadForm } from "../../src/modules/runs/components/UploadForm";
import type {
  GarminPicker,
  GarminPickerRow,
} from "../../src/modules/runs/garmin/service";
import type { ImportOutcome } from "../../src/modules/runs/imports";
import { SAT_MORNING, renderWithRouter, runSummary } from "./run-fixtures";

/**
 * Import from Garmin on A1 (plan 157; design G3): the owner's last ten
 * runs on Garmin, and a tap that hands one to A1's own card. Rows are
 * synthetic.
 */

// The column is nullable and the outcome carries it as it is.
const NO_REASON = z.null().parse(JSON.parse("null"));

const ROW: GarminPickerRow = {
  activityId: "101",
  startedAt: SAT_MORNING,
  distanceM: 9978,
  durationS: 3098,
  runId: undefined,
};

function never<T>(): Promise<T> {
  return new Promise(() => {
    // deliberately never settled
  });
}

function actions(
  overrides: Partial<GarminImportActions> = {},
): GarminImportActions {
  return {
    picker: () =>
      Promise.resolve<GarminPicker>({ status: "ready", rows: [ROW] }),
    importActivity: () =>
      Promise.resolve({ status: "started" as const, importId: "01IMPORT" }),
    ...overrides,
  };
}

function a1(
  garmin: GarminImportActions | undefined,
  getOutcome: () => Promise<ImportOutcome | undefined> = never,
) {
  return (
    <UploadForm
      upload={() => Promise.resolve({ importId: "01UPLOAD" })}
      getOutcome={getOutcome}
      retime={() => Promise.resolve("moved")}
      units={{ temp: "f", distance: "mi" }}
      garmin={garmin}
    />
  );
}

function section(): HTMLElement {
  return screen.getByRole("region", { name: "IMPORT FROM GARMIN · LAST 10" });
}

describe("A1: Import from Garmin (G3)", () => {
  it("is not there unless the route turned it on", async () => {
    await renderWithRouter(a1(undefined));
    expect(document.querySelector("[data-part='garmin-import']")).toBeNull();
  });

  it("is not there when the server says it is not this runner's", async () => {
    await renderWithRouter(
      a1(actions({ picker: () => Promise.resolve(undefined) })),
    );
    await waitFor(() => {
      expect(document.querySelector("[data-part='garmin-import']")).toBeNull();
    });
    // The rest of A1 is untouched by it.
    expect(document.querySelector("[data-part='drop-zone']")).not.toBeNull();
  });

  it("breathes three rows while it asks Garmin, once", async () => {
    const picker = vi.fn(never<GarminPicker | undefined>);
    await renderWithRouter(a1(actions({ picker })));

    expect(
      within(section())
        .getAllByRole("listitem")
        .filter((item) => item.dataset.part === "garmin-loading"),
    ).toHaveLength(3);
    expect(within(section()).getByRole("list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(document.querySelector(".breathe")).not.toBeNull();
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it("lists a run as date · distance · time, then Garmin, with IMPORT ›", async () => {
    await renderWithRouter(a1(actions()));

    const row = await within(section()).findByRole("listitem");
    expect(row).toHaveTextContent("Sat Aug 29 · 6.2 mi · 51:38");
    expect(row).toHaveTextContent("Garmin");
    expect(
      within(row).getByRole("button", {
        name: "Import Sat Aug 29 · 6.2 mi · 51:38",
      }),
    ).toHaveTextContent("Import ›");
  });

  it("opens the run for one already here", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      a1(
        actions({
          picker: () =>
            Promise.resolve({
              status: "ready",
              rows: [{ ...ROW, runId: "01RUN" }],
            }),
        }),
      ),
    );

    const link = await within(section()).findByRole("link", {
      name: "Imported: open Sat Aug 29 · 6.2 mi · 51:38",
    });
    expect(link).toHaveTextContent("[Imported] ›");
    expect(link).toHaveAttribute("href", "/runs/01RUN");
    await user.click(link);
    expect(await screen.findByText("at /runs/$runId")).toBeVisible();
  });

  it("says so when Garmin has no runs", async () => {
    await renderWithRouter(
      a1(
        actions({
          picker: () => Promise.resolve({ status: "ready", rows: [] }),
        }),
      ),
    );
    expect(
      await within(section()).findByText("No runs on Garmin yet."),
    ).toBeVisible();
  });

  it.each([
    [
      "Garmin does not answer",
      () => Promise.resolve({ status: "unreachable" as const }),
      "Garmin didn't answer.",
    ],
    [
      "the connection drops",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "Your connection dropped.",
    ],
  ])(
    "says so when %s for the list, and tries again",
    async (_, first, sentence) => {
      const user = userEvent.setup();
      const picker = vi
        .fn<GarminImportActions["picker"]>()
        .mockImplementationOnce(first)
        .mockResolvedValue({ status: "ready", rows: [ROW] });
      await renderWithRouter(a1(actions({ picker })));

      expect(await within(section()).findByText(sentence)).toBeVisible();
      expect(section()).toHaveTextContent(/not loaded/iu);
      // Try again asks again, and breathes while it does.
      const next = Promise.withResolvers<GarminPicker | undefined>();
      picker.mockImplementationOnce(() => next.promise);
      await user.click(
        within(section()).getByRole("button", { name: /try again/iu }),
      );
      expect(
        document.querySelectorAll("[data-part='garmin-loading']"),
      ).toHaveLength(3);
      expect(within(section()).queryByText(sentence)).toBeNull();

      next.resolve({ status: "ready", rows: [ROW] });
      expect(
        await within(section()).findByRole("button", { name: /^Import / }),
      ).toBeVisible();
      expect(picker).toHaveBeenCalledTimes(2);
    },
  );

  it("hands a tapped run to A1's own card", async () => {
    const user = userEvent.setup();
    const importActivity = vi.fn<GarminImportActions["importActivity"]>(() =>
      Promise.resolve({ status: "started", importId: "01IMPORT" }),
    );
    const getOutcome = vi.fn(() =>
      Promise.resolve<ImportOutcome>({
        status: "done",
        failureReason: NO_REASON,
        run: runSummary({ deviceName: "Garmin" }),
      }),
    );
    await renderWithRouter(a1(actions({ importActivity }), getOutcome));

    await user.click(
      await within(section()).findByRole("button", { name: /^Import / }),
    );

    expect(
      await screen.findByText("Parsed · Garmin · Sat Aug 29 · 6.2 mi · 51:38"),
    ).toBeVisible();
    expect(getOutcome).toHaveBeenCalledWith({ data: { importId: "01IMPORT" } });
    const sent = importActivity.mock.calls[0]?.[0].data;
    expect(sent?.activityId).toBe("101");
    expect(sent?.idempotencyKey).toMatch(/^[0-9A-Z]{26}$/u);
    // The picker goes with the well.
    expect(document.querySelector("[data-part='garmin-import']")).toBeNull();
  });

  it("is busy while the tap is out, and takes no second tap", async () => {
    const user = userEvent.setup();
    const importActivity = vi.fn(
      never<{ status: "started"; importId: string }>,
    );
    await renderWithRouter(a1(actions({ importActivity })));

    const button = await within(section()).findByRole("button", {
      name: /^Import /,
    });
    await user.click(button);
    await user.click(button);

    expect(button).toHaveTextContent("Importing");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(importActivity).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "answers unreachable",
      () => Promise.resolve({ status: "unreachable" as const }),
      "Garmin didn't answer.",
    ],
    [
      "loses the connection",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "Your connection dropped.",
    ],
    [
      "is refused",
      () => Promise.reject(new Error("a server error")),
      "Our end failed. Nothing changed.",
    ],
    [
      "is not this runner's",
      () => Promise.resolve(undefined),
      "Garmin didn't answer.",
    ],
  ])(
    "says so when the import %s, and tries again under the same key",
    async (_, first, sentence) => {
      const user = userEvent.setup();
      const importActivity = vi
        .fn<GarminImportActions["importActivity"]>()
        .mockImplementationOnce(first)
        .mockReturnValue(never());
      await renderWithRouter(a1(actions({ importActivity })));

      await user.click(
        await within(section()).findByRole("button", { name: /^Import / }),
      );
      expect(await within(section()).findByText(sentence)).toBeVisible();
      expect(section()).toHaveTextContent(/not imported/iu);
      const button = within(section()).getByRole("button", {
        name: /^Import /,
      });
      expect(button).toHaveTextContent("Import ›");
      expect(button).not.toHaveAttribute("aria-busy");

      await user.click(
        within(section()).getByRole("button", { name: /try again/iu }),
      );
      await waitFor(() => {
        expect(importActivity).toHaveBeenCalledTimes(2);
      });
      const [first_, second] = importActivity.mock.calls;
      expect(second?.[0].data.idempotencyKey).toBe(
        first_?.[0].data.idempotencyKey,
      );
      expect(within(section()).queryByText(sentence)).toBeNull();
    },
  );

  it("starts a fresh tap under a new key", async () => {
    const user = userEvent.setup();
    const importActivity = vi
      .fn<GarminImportActions["importActivity"]>()
      .mockResolvedValue({ status: "unreachable" });
    await renderWithRouter(a1(actions({ importActivity })));

    const button = await within(section()).findByRole("button", {
      name: /^Import /,
    });
    await user.click(button);
    await within(section()).findByText("Garmin didn't answer.");
    await user.click(button);
    await waitFor(() => {
      expect(importActivity).toHaveBeenCalledTimes(2);
    });
    const [first, second] = importActivity.mock.calls;
    expect(second?.[0].data.idempotencyKey).not.toBe(
      first?.[0].data.idempotencyKey,
    );
  });

  it("dates a run in the runner's own zone", async () => {
    // 02:00 UTC on Sunday is still Saturday evening in Chicago.
    const lateSaturday = Date.UTC(2026, 7, 30, 2, 0) / 1000;
    const options = new Intl.DateTimeFormat().resolvedOptions();
    const zone = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ ...options, timeZone: "America/Chicago" });
    try {
      await renderWithRouter(
        a1(
          actions({
            picker: () =>
              Promise.resolve({
                status: "ready",
                rows: [{ ...ROW, startedAt: lateSaturday }],
              }),
          }),
        ),
      );
      const row = await within(section()).findByRole("listitem");
      expect(row).toHaveTextContent(/^Sat Aug 29 · /u);
    } finally {
      zone.mockRestore();
    }
  });
});

/**
For a render that never gets as far as an import.
*/
function noImport(): void {
  // Nothing is tapped here.
}

describe("GarminImport on its own", () => {
  it("asks the source it is handed, and asks again when handed another", () => {
    const first = vi.fn(never<GarminPicker | undefined>);
    const second = vi.fn(never<GarminPicker | undefined>);
    const props = {
      units: { temp: "f", distance: "mi" } as const,
      onImport: noImport,
    };
    const { rerender } = render(
      <GarminImport {...props} actions={actions({ picker: first })} />,
    );
    rerender(<GarminImport {...props} actions={actions({ picker: first })} />);
    expect(first).toHaveBeenCalledTimes(1);

    rerender(<GarminImport {...props} actions={actions({ picker: second })} />);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
