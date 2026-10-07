import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Today,
  lastTryOf,
  spanOf,
} from "../../src/modules/ops/components/Today";
import type { DeskToday } from "../../src/modules/ops/desk";
import type { GaveUpJob } from "../../src/modules/ops/gave-up";

/**
 * Today's Gave up section (Operator Screens D6's rows, round 29 B·2's
 * placement; R-119): what the system stopped retrying, and the retry that
 * fits each job.
 */

/**
Tuesday 16 September 2025, 12:00 UTC — the board's own date.
*/
const NOON = Date.UTC(2025, 8, 16, 12) / 1000;
const HOUR = 3600;
const DAY = 24 * HOUR;

function desk(gaveUp: number, oldestGaveUpAt?: number): DeskToday {
  return {
    asOf: NOON,
    counts: {
      waiting: 0,
      oldestWaitingAt: undefined,
      screenerUnfinished: 0,
      bansThisWeek: 0,
      bansAllTime: 0,
      gaveUp,
      oldestGaveUpAt,
    },
  };
}

function job(overrides: Partial<GaveUpJob> = {}): GaveUpJob {
  return {
    id: "g1",
    kind: "weather",
    doing: "Fetch weather for @sam's run, Sep 14 · 6:10 AM",
    reason: "No weather came back.",
    rawError: undefined,
    tries: 3,
    firstFailedAt: NOON - 2 * DAY,
    lastFailedAt: NOON - 3 * HOUR,
    hasStoredPage: false,
    ...overrides,
  };
}

function renderToday(
  jobs: readonly GaveUpJob[],
  handlers: Partial<Parameters<typeof Today>[0]> = {},
  today = desk(jobs.length, jobs[0]?.firstFailedAt),
) {
  const retry = vi.fn(() => Promise.resolve("retried"));
  const drop = vi.fn(() => Promise.resolve());
  const onChanged = vi.fn(() => Promise.resolve());
  render(
    <Today
      today={today}
      gaveUp={jobs}
      retry={retry}
      drop={drop}
      onChanged={onChanged}
      {...handlers}
    />,
  );
  return { retry, drop, onChanged };
}

function section(): HTMLElement {
  return screen.getByRole("region", { name: "Gave up" });
}

function rows(): HTMLElement[] {
  return within(section()).queryAllByRole("listitem");
}

/**
A server that never answers: the press stays in flight.
*/
function never(): Promise<unknown> {
  return new Promise<unknown>(() => {
    /*
    Never settles.
    */
  });
}

describe("Gave up, on Today", () => {
  it("is one line at zero, with no count", () => {
    renderToday([]);

    expect(within(section()).getByText("Nothing gave up.")).toBeVisible();
    expect(within(section()).queryByText(/\[/u)).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("counts the jobs and dates the oldest, in hi-viz", () => {
    renderToday([job()]);

    const count = within(section()).getByText("[1 job · oldest 2d]");
    expect(count).toHaveClass("text-hiviz-text");
  });

  it("speaks in the plural past one, from the whole table's count", () => {
    renderToday([job()], {}, desk(3, NOON - 6 * HOUR));

    expect(
      within(section()).getByText("[3 jobs · oldest 6h]"),
    ).toBeInTheDocument();
  });

  it("dates no oldest when it has none to date", () => {
    renderToday([job()], {}, desk(1));

    expect(within(section()).getByText("[1 job]")).toBeInTheDocument();
  });

  it("shows the two newest, then expands in place to show them all", () => {
    renderToday(
      [job({ id: "a" }), job({ id: "b" }), job({ id: "c" })],
      {},
      desk(4, NOON - DAY),
    );

    expect(rows()).toHaveLength(2);
    const more = within(section()).getByRole("button", {
      name: "+ 2 more · Show all",
    });

    fireEvent.click(more);

    expect(rows()).toHaveLength(3);
    expect(
      within(section()).queryByRole("button", { name: /Show all/u }),
    ).toBeNull();
  });

  it("offers no Show all when every job already shows", () => {
    renderToday([job({ id: "a" }), job({ id: "b" })]);

    expect(
      within(section()).queryByRole("button", { name: /Show all/u }),
    ).toBeNull();
  });

  it("says what each job was doing, why it stopped, and its tries and when", () => {
    renderToday([job()]);

    const [row] = rows();
    expect(row?.textContent).toBe(
      [
        "Conditions",
        "2d ago",
        "Fetch weather for @sam's run, Sep 14 · 6:10 AM",
        "No weather came back.",
        "3 tries · last 09:00",
        "Retry",
        "[Retrying]",
        "Drop",
        "[Dropping]",
      ].join(""),
    );
    expect(within(row ?? document.body).getByText("Conditions")).toHaveClass(
      "text-hiviz-text",
    );
  });

  it("names each kind of job as the Desk does", () => {
    renderToday(
      [
        job({ id: "e", kind: "enrichment" }),
        job({ id: "i", kind: "import" }),
        job({ id: "r", kind: "reminder" }),
      ],
      {},
      desk(3),
    );
    fireEvent.click(screen.getByRole("button", { name: /Show all/u }));

    const captions = rows().map(
      (row) => row.querySelector(".text-hiviz-text")?.textContent,
    );
    expect(captions).toStrictEqual(["Enrichment", "Import", "Reminder"]);
  });

  it("says one try in the singular", () => {
    renderToday([job({ tries: 1 })]);

    expect(screen.getByText("1 try · last 09:00")).toBeInTheDocument();
  });

  it("keeps the raw error one click away, and only when there is one", () => {
    renderToday([
      job({ id: "a", rawError: "Page returned 403" }),
      job({ id: "b" }),
    ]);

    const [withError, without] = rows();
    const details = withError?.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(
      within(withError ?? document.body).getByText("Raw error"),
    ).toBeInTheDocument();
    expect(
      within(withError ?? document.body).getByText("Page returned 403"),
    ).toBeInTheDocument();
    expect(without?.querySelector("details")).toBeNull();
  });

  it("gives every job but enrichment one Retry, and Drop", () => {
    renderToday([job()]);

    const buttons = within(rows()[0] ?? document.body).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toStrictEqual([
      "Retry[Retrying]",
      "Drop[Dropping]",
    ]);
  });

  it("gives enrichment its two retries, re-run disabled with no stored page", () => {
    renderToday([job({ kind: "enrichment", hasStoredPage: false })]);

    const row = within(rows()[0] ?? document.body);
    expect(
      row.getAllByRole("button").map((button) => button.textContent),
    ).toStrictEqual([
      "Re-fetch page[Re-fetching]",
      "Re-run extraction[Re-running]",
      "Drop[Dropping]",
    ]);
    const rerun = row.getByRole("button", { name: /Re-run extraction/u });
    expect(rerun).toHaveAttribute("aria-disabled", "true");
    expect(rerun).not.toHaveAttribute("disabled");
    expect(rerun).toHaveClass("text-muted");
  });

  it("does nothing when a disabled re-run is pressed", () => {
    const { retry } = renderToday([
      job({ kind: "enrichment", hasStoredPage: false }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Re-run extraction/u }));

    expect(retry).not.toHaveBeenCalled();
  });

  it("re-runs extraction over a stored page", async () => {
    const { retry, onChanged } = renderToday([
      job({ id: "p", kind: "enrichment", hasStoredPage: true }),
    ]);
    const rerun = screen.getByRole("button", { name: /Re-run extraction/u });
    expect(rerun).not.toHaveAttribute("aria-disabled");
    expect(rerun).toHaveClass("text-ink");

    fireEvent.click(rerun);

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(retry).toHaveBeenCalledWith({ data: { id: "p", step: "extract" } });
  });

  it("re-fetches an enrichment job's page", async () => {
    const { retry } = renderToday([job({ id: "p", kind: "enrichment" })]);

    fireEvent.click(screen.getByRole("button", { name: /Re-fetch page/u }));

    await waitFor(() => {
      expect(retry).toHaveBeenCalledWith({ data: { id: "p", step: "again" } });
    });
  });

  it("retries, then reloads the page's data, which takes the row away", async () => {
    const { retry, drop, onChanged } = renderToday([job({ id: "w" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Retry/u }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(retry).toHaveBeenCalledWith({ data: { id: "w", step: "again" } });
    expect(drop).not.toHaveBeenCalled();
  });

  it("drops, quietly", async () => {
    const { retry, drop, onChanged } = renderToday([job({ id: "w" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Drop/u }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(drop).toHaveBeenCalledWith({ data: { id: "w" } });
    expect(retry).not.toHaveBeenCalled();
  });

  it("breathes on the pressed control while it waits, and only that one", () => {
    renderToday([job({ id: "a" }), job({ id: "b" })], {
      retry: never,
    });

    const [first, second] = rows();
    fireEvent.click(
      within(first ?? document.body).getByRole("button", { name: /^Retry/u }),
    );

    expect(
      within(first ?? document.body).getByRole("button", { name: /^Retry/u }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      within(first ?? document.body).getByRole("button", { name: /^Drop/u }),
    ).not.toHaveAttribute("aria-busy");
    expect(
      within(second ?? document.body).getByRole("button", { name: /^Retry/u }),
    ).not.toHaveAttribute("aria-busy");
  });

  it.each([
    ["Drop", /^Drop/u, "drop"],
    ["Re-run extraction", /^Re-run extraction/u, "retry"],
  ] as const)(
    "breathes on %s alone while it waits, unavailable to a second press",
    (_, name, handler) => {
      renderToday([job({ id: "a", kind: "enrichment", hasStoredPage: true })], {
        [handler]: never,
      });

      const pressed = screen.getByRole("button", { name });
      fireEvent.click(pressed);

      expect(pressed).toHaveAttribute("aria-busy", "true");
      expect(pressed).toHaveAttribute("aria-disabled", "true");
      const others = screen
        .getAllByRole("button")
        .filter((button) => button !== pressed);
      for (const other of others) {
        expect(other).not.toHaveAttribute("aria-busy");
      }
    },
  );

  it("keeps Drop quiet: bare muted text, never a pill", () => {
    renderToday([job()]);

    const drop = screen.getByRole("button", { name: /^Drop/u });
    expect(drop).toHaveClass("text-muted");
    expect(drop).not.toHaveClass("rounded-pill");
  });

  it("says a failed retry under its own row, and Try again repeats it", async () => {
    const retry = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("retried");
    const { onChanged } = renderToday([job({ id: "a" }), job({ id: "b" })], {
      retry,
    });
    const [first, second] = rows();

    fireEvent.click(
      within(second ?? document.body).getByRole("button", { name: /^Retry/u }),
    );

    const band = await within(second ?? document.body).findByText("Still here");
    expect(band).toBeInTheDocument();
    expect(within(first ?? document.body).queryByText("Still here")).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(
      within(second ?? document.body).getByRole("button", {
        name: "Try again",
      }),
    );

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(retry).toHaveBeenLastCalledWith({
      data: { id: "b", step: "again" },
    });
  });
});

describe("spanOf", () => {
  it.each([
    [-5, "0m"],
    [59, "0m"],
    [60, "1m"],
    [HOUR - 1, "59m"],
    [HOUR, "1h"],
    [DAY - 1, "23h"],
    [DAY, "1d"],
    [3 * DAY + HOUR, "3d"],
  ])("says %d seconds as %s", (seconds, said) => {
    expect(spanOf(seconds)).toBe(said);
  });
});

describe("lastTryOf", () => {
  it("is the time alone on the Desk's own day", () => {
    expect(lastTryOf(NOON - 8 * HOUR + 12 * 60, NOON)).toBe("04:12");
  });

  it("carries the date on any other day", () => {
    expect(lastTryOf(NOON - 13 * HOUR - 20 * 60, NOON)).toBe("Sep 15 22:40");
  });
});
