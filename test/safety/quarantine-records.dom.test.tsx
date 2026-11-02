import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { QuarantineRecords } from "../../src/modules/safety/components/QuarantineRecords";
import type { QuarantineSummary } from "../../src/modules/safety/quarantine";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

/**
 * C12: Review's quarantine, and recording a record's NCMEC report, which
 * sets the year it is kept from the report.
 */
type RecordFn = Parameters<typeof QuarantineRecords>[0]["recordReport"];

const AUG_29_2026 = Date.UTC(2026, 7, 29) / 1000;
const SEP_10_2026 = Date.UTC(2026, 8, 10) / 1000;
const YEAR = 365 * 24 * 60 * 60;
/**
A column D1 left empty, as drizzle reads it back.
*/
const NOT_SET = z.null().parse(JSON.parse("null"));

function held(overrides: Partial<QuarantineSummary> = {}): QuarantineSummary {
  return {
    id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
    subjectType: "photo",
    subjectId: "p1",
    uploaderId: "uploader-1",
    entryId: "e1",
    quarantinedAt: AUG_29_2026,
    retainUntil: AUG_29_2026 + YEAR,
    ncmecReportedAt: NOT_SET,
    ncmecReportId: NOT_SET,
    ...overrides,
  };
}

/**
A call still out: the promise it returns never settles.
*/
function neverSettles(): void {
  // Nothing resolves it.
}

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

describe("QuarantineRecords", () => {
  it("lists what is held, with its clock, and that it is not yet reported", () => {
    render(<QuarantineRecords records={[held()]} recordReport={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Quarantine · 1" }),
    ).toBeVisible();
    expect(part("quarantined-at")?.textContent).toBe("Held Aug 29 2026");
    expect(part("retain-until")?.textContent).toBe("Kept until Aug 29 2027");
    expect(part("ncmec")?.textContent).toBe("[not reported to NCMEC]");
    expect(screen.getByText("Uploader uploader-1")).toBeVisible();
    // The Form Contract's order is a column: the field, the §4a band
    // directly above the action, then the action.
    expect(
      screen
        .getByRole("button", { name: "Record the NCMEC report" })
        .closest("form"),
    ).toHaveClass("flex", "flex-col", "gap-4");
  });

  it("says when a record was reported, and its number", () => {
    render(
      <QuarantineRecords
        records={[held({ ncmecReportedAt: SEP_10_2026, ncmecReportId: "42" })]}
        recordReport={vi.fn()}
      />,
    );

    expect(part("ncmec")?.textContent).toBe(
      "[reported to NCMEC Sep 10 2026] · 42",
    );
    expect(
      screen.getByRole("textbox", { name: /CyberTipline report number/u }),
    ).toHaveValue("42");
  });

  it("records the report and shows the year it now runs to", async () => {
    const recordReport = vi.fn<RecordFn>().mockResolvedValue({
      outcome: "recorded",
      ncmecReportedAt: SEP_10_2026,
      ncmecReportId: "123456",
      retainUntil: SEP_10_2026 + YEAR,
    });
    render(
      <QuarantineRecords records={[held()]} recordReport={recordReport} />,
    );
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: /CyberTipline report number/u }),
      " 123456 ",
    );
    await user.click(
      screen.getByRole("button", { name: "Record the NCMEC report" }),
    );

    expect(await screen.findByText("Report recorded.")).toBeInTheDocument();
    expect(recordReport).toHaveBeenCalledWith({
      data: { recordId: "01JABCDEFGHJKMNPQRSTVWXYZ0", reportId: "123456" },
    });
    await waitFor(() => {
      expect(part("ncmec")?.textContent).toBe(
        "[reported to NCMEC Sep 10 2026] · 123456",
      );
    });
    expect(part("retain-until")?.textContent).toBe("Kept until Sep 10 2027");
    expect(part("quarantined-at")?.textContent).toBe("Held Aug 29 2026");
  });

  it("says it is recording while the call is out", async () => {
    const recordReport = vi
      .fn<RecordFn>()
      .mockReturnValue(new Promise(neverSettles));
    render(
      <QuarantineRecords records={[held()]} recordReport={recordReport} />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Record the NCMEC report" }));

    expect(
      await screen.findByRole("button", { name: "Recording" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("sends no number when none is given", async () => {
    const recordReport = vi.fn<RecordFn>().mockResolvedValue({
      outcome: "recorded",
      ncmecReportedAt: SEP_10_2026,
      ncmecReportId: NOT_SET,
      retainUntil: SEP_10_2026 + YEAR,
    });
    render(
      <QuarantineRecords records={[held()]} recordReport={recordReport} />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Record the NCMEC report" }));

    await waitFor(() => {
      expect(part("ncmec")?.textContent).toBe(
        "[reported to NCMEC Sep 10 2026]",
      );
    });
    expect(recordReport).toHaveBeenCalledWith({
      data: { recordId: "01JABCDEFGHJKMNPQRSTVWXYZ0", reportId: undefined },
    });
  });

  it("refuses a number that is not one, before the round trip", async () => {
    const recordReport = vi.fn<RecordFn>();
    render(
      <QuarantineRecords records={[held()]} recordReport={recordReport} />,
    );
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("textbox", { name: /CyberTipline report number/u }),
      "12 34",
    );
    await user.click(
      screen.getByRole("button", { name: "Record the NCMEC report" }),
    );

    expect(
      await screen.findAllByText(
        "Paste the report number as NCMEC gave it: letters, digits and dashes, 40 at most.",
      ),
    ).not.toHaveLength(0);
    expect(recordReport).not.toHaveBeenCalled();
    expect(part("ncmec")?.textContent).toBe("[not reported to NCMEC]");
  });

  it("says a purged record is gone, and drops its form", async () => {
    const recordReport = vi
      .fn<RecordFn>()
      .mockResolvedValue({ outcome: "gone" });
    render(
      <QuarantineRecords records={[held()]} recordReport={recordReport} />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Record the NCMEC report" }));

    expect(
      await screen.findByText("This record is gone: its year was up."),
    ).toBeVisible();
    const row = part("quarantine-record");
    expect(row).not.toBeNull();
    expect(
      within(row ?? document.body).queryByRole("button", {
        name: "Record the NCMEC report",
      }),
    ).toBeNull();
    expect(screen.queryByText("Report recorded.")).toBeNull();
    expect(part("ncmec")?.textContent).toBe("[not reported to NCMEC]");
  });

  it("renders nothing when nothing is held", () => {
    render(<QuarantineRecords records={[]} recordReport={vi.fn()} />);
    expect(part("quarantine-record")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("QuarantineRecords: a lapsed session (Au7, D-155)", () => {
  it("carries page to log-in", () => {
    carriedSince();
    render(<QuarantineRecords records={[held()]} recordReport={vi.fn()} />);

    expect(carriedSince()).toEqual(["page"]);
  });
});
