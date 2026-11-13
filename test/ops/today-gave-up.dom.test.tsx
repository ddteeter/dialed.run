import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { Today, lastTryOf } from "../../src/modules/ops/components/Today";
import type { DeskToday } from "../../src/modules/ops/desk";
import type { GaveUpJob } from "../../src/modules/ops/gave-up";
import { bracketed } from "../ui/bracketed";

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
      decidedToday: 0,
      oldestWaitingAt: undefined,
      screenerUnfinished: 0,
      corrections: 0,
      bansThisWeek: 0,
      bansAllTime: 0,
      flaggedAccounts: 0,
      oldestFlaggedAt: undefined,
      gaveUp,
      oldestGaveUpAt,
      digestUnconfirmedAt: undefined,
      lastDigestAt: undefined,
      outboxBehind: 0,
      oldestBehindAt: undefined,
    },
    skipped: [],
    breakers: [],
    operatorHandle: undefined,
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

/**
Renders under a router: Today's flagged number is a link (R47·125).
*/
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

async function renderToday(
  jobs: readonly GaveUpJob[],
  handlers: Partial<Parameters<typeof Today>[0]> = {},
  today = desk(jobs.length, jobs[0]?.firstFailedAt),
) {
  const retry = vi.fn(() => Promise.resolve("retried"));
  const drop = vi.fn(() => Promise.resolve());
  const onChanged = vi.fn(() => Promise.resolve());
  await renderWithRouter(
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
  it("is one line at zero, with no count", async () => {
    await renderToday([]);

    expect(within(section()).getByText("Nothing gave up.")).toBeVisible();
    expect(within(section()).queryByText(/\[/u)).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("counts the jobs and dates the oldest, in hi-viz", async () => {
    await renderToday([job()]);

    const count = within(section()).getByText(bracketed("1 job · oldest 2d"));
    expect(count).toHaveClass("text-hiviz-text");
  });

  it("draws the count's brackets without saying them (D-150, PR#286-1)", async () => {
    await renderToday([job()]);

    const count = within(section()).getByText(bracketed("1 job · oldest 2d"));
    const hidden = [...count.querySelectorAll('[aria-hidden="true"]')];
    expect(hidden.map((part) => part.textContent)).toEqual(["[", "]"]);
  });

  it("speaks in the plural past one, from the whole table's count", async () => {
    await renderToday([job()], {}, desk(3, NOON - 6 * HOUR));

    expect(
      within(section()).getByText(bracketed("3 jobs · oldest 6h")),
    ).toBeInTheDocument();
  });

  it("dates no oldest when it has none to date", async () => {
    await renderToday([job()], {}, desk(1));

    expect(within(section()).getByText(bracketed("1 job"))).toBeInTheDocument();
  });

  it("shows the two newest, then expands in place to show them all", async () => {
    await renderToday(
      [job({ id: "a" }), job({ id: "b" }), job({ id: "c" })],
      {},
      desk(4, NOON - DAY),
    );

    expect(rows()).toHaveLength(2);
    const more = within(section()).getByRole("button", {
      name: "+ 2 more · Show all",
    });
    // The list carries its closing rule, not Show all (N3-14).
    expect(rows()[0]?.parentElement).toHaveClass("border-b", "border-hairline");
    expect(more).not.toHaveClass("border-t");
    // Display type is uppercase (G-15).
    expect(
      within(section()).getByRole("heading", { name: "Gave up" }),
    ).toHaveClass("uppercase");

    fireEvent.click(more);

    expect(rows()).toHaveLength(3);
    expect(
      within(section()).queryByRole("button", { name: /Show all/u }),
    ).toBeNull();
  });

  it("offers no Show all when every job already shows", async () => {
    await renderToday([job({ id: "a" }), job({ id: "b" })]);

    expect(
      within(section()).queryByRole("button", { name: /Show all/u }),
    ).toBeNull();
  });

  it("says what each job was doing, why it stopped, and its tries and when", async () => {
    await renderToday([job()]);

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

  it("names each kind of job as the Desk does", async () => {
    await renderToday(
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

  it("says one try in the singular", async () => {
    await renderToday([job({ tries: 1 })]);

    expect(screen.getByText("1 try · last 09:00")).toBeInTheDocument();
  });

  it("keeps the raw error one click away, and only when there is one", async () => {
    await renderToday([
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
    // Review's text mark, not the browser's triangle, and a target that
    // overlaps the gaps rather than widening them (G-21).
    const summary = details?.querySelector("summary");
    expect(summary).toHaveClass(
      "target",
      "-my-3",
      "list-none",
      "[&::-webkit-details-marker]:hidden",
    );
    const [closed, open] =
      summary?.querySelectorAll("[aria-hidden='true']") ?? [];
    expect(closed).toHaveTextContent(/^▸$/u);
    expect(closed).toHaveClass("group-open:hidden");
    expect(open).toHaveTextContent(/^▾$/u);
    expect(open).toHaveClass("hidden", "group-open:inline");
    expect(details).toHaveClass("group");
  });

  it("gives every job but enrichment one Retry, and Drop", async () => {
    await renderToday([job()]);

    const buttons = within(rows()[0] ?? document.body).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toStrictEqual([
      "Retry[Retrying]",
      "Drop[Dropping]",
    ]);
    // Bare Drop is flush with the row's edge; the Retry pill centres
    // (#627 G-21).
    const [retry, drop] = buttons;
    expect(
      within(drop ?? document.body).getByText("Drop").parentElement,
    ).toHaveClass("justify-items-start");
    expect(
      within(retry ?? document.body).getByText("Retry").parentElement,
    ).toHaveClass("place-items-center");
  });

  it("gives enrichment its two retries, re-run disabled with no stored page", async () => {
    await renderToday([job({ kind: "enrichment", hasStoredPage: false })]);

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

  it("does nothing when a disabled re-run is pressed", async () => {
    const { retry } = await renderToday([
      job({ kind: "enrichment", hasStoredPage: false }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Re-run extraction/u }));

    expect(retry).not.toHaveBeenCalled();
  });

  it("re-runs extraction over a stored page", async () => {
    const { retry, onChanged } = await renderToday([
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
    const { retry } = await renderToday([job({ id: "p", kind: "enrichment" })]);

    fireEvent.click(screen.getByRole("button", { name: /Re-fetch page/u }));

    await waitFor(() => {
      expect(retry).toHaveBeenCalledWith({ data: { id: "p", step: "again" } });
    });
  });

  it("retries, then reloads the page's data, which takes the row away", async () => {
    const { retry, drop, onChanged } = await renderToday([job({ id: "w" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Retry/u }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(retry).toHaveBeenCalledWith({ data: { id: "w", step: "again" } });
    expect(drop).not.toHaveBeenCalled();
  });

  it("drops, quietly", async () => {
    const { retry, drop, onChanged } = await renderToday([job({ id: "w" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Drop/u }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(drop).toHaveBeenCalledWith({ data: { id: "w" } });
    expect(retry).not.toHaveBeenCalled();
  });

  it("breathes on the pressed control while it waits, and only that one", async () => {
    await renderToday([job({ id: "a" }), job({ id: "b" })], {
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
    async (_, name, handler) => {
      await renderToday(
        [job({ id: "a", kind: "enrichment", hasStoredPage: true })],
        {
          [handler]: never,
        },
      );

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

  it("keeps Drop quiet: bare muted text, never a pill", async () => {
    await renderToday([job()]);

    const drop = screen.getByRole("button", { name: /^Drop/u });
    expect(drop).toHaveClass("text-muted");
    expect(drop).not.toHaveClass("rounded-pill");
  });

  it("says a failed retry under its own row, and Try again repeats it", async () => {
    const retry = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("retried");
    const { onChanged } = await renderToday(
      [job({ id: "a" }), job({ id: "b" })],
      {
        retry,
      },
    );
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

describe("lastTryOf", () => {
  it("is the time alone on the Desk's own day", () => {
    expect(lastTryOf(NOON - 8 * HOUR + 12 * 60, NOON)).toBe("04:12");
  });

  it("carries the date on any other day", () => {
    expect(lastTryOf(NOON - 13 * HOUR - 20 * 60, NOON)).toBe("Sep 15 22:40");
  });
});

/**
An empty Today whose digest skipped `skipped`.
*/
function withSkipped(skipped: DeskToday["skipped"]): DeskToday {
  return { ...desk(0), skipped };
}

/**
 * OPS-11: a morning's digest that skipped an operator whose address is not
 * confirmed is said on Today, one named line per operator (round 38 #62b).
 * Which day it shows on is `deskToday`'s to decide (test/ops/desk.test.ts).
 */
describe("a digest that skipped an operator, on Today", () => {
  const JESS = {
    userId: "op-jess",
    handle: "jess",
    address: "je•••@gmail.com",
  };

  it("names them under the three numbers, in hi-viz, with no button", async () => {
    await renderToday([], {}, withSkipped([JESS]));
    const line = document.querySelector("[data-part='digest-unconfirmed']");
    expect(line?.textContent).toBe(
      "Digest not emailedToday's digest wasn't sent to @jess. Their email address, je•••@gmail.com, isn't confirmed.",
    );
    expect(screen.getByText("Digest not emailed")).toHaveClass(
      "text-hiviz-text",
    );
    expect(line?.previousElementSibling).toBe(
      screen.getByRole("list", { name: "Today" }),
    );
    expect(line?.querySelector("button")).toBeNull();
  });

  it("says one line per operator, and an operator with no handle as one", async () => {
    await renderToday(
      [],
      {},
      withSkipped([
        JESS,
        { userId: "op-x", handle: undefined, address: "x•••@example.com" },
      ]),
    );
    const lines = document.querySelectorAll("[data-part='digest-unconfirmed']");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.textContent).toContain(
      "Today's digest wasn't sent to an operator. Their email address, x•••@example.com, isn't confirmed.",
    );
  });

  it("says nothing when the digest skipped nobody", async () => {
    await renderToday([], {}, withSkipped([]));
    expect(
      document.querySelector("[data-part='digest-unconfirmed']"),
    ).toBeNull();
  });
});

function runningBehind() {
  return document.querySelector("[data-part='running-behind']");
}

function behind(
  outboxBehind: number,
  oldestBehindAt: number | undefined,
  skipped: DeskToday["skipped"] = [],
): DeskToday {
  const today = desk(0);
  return {
    ...today,
    counts: { ...today.counts, outboxBehind, oldestBehindAt },
    skipped,
  };
}

/**
 * Design 168: queued jobs the morning's drain could not reach, one line
 * under Today's three numbers, only above zero. What counts as behind is
 * `todayCounts`' to decide (test/ops/desk.test.ts).
 */
describe("an outbox running behind, on Today", () => {
  it("says how many and how long the oldest has waited, in hi-viz, with no button", async () => {
    await renderToday([], {}, behind(12, NOON - 38 * HOUR));
    expect(runningBehind()?.textContent).toBe(
      "Running behind12 queued jobs were still due after this morning's run. The oldest has waited 38h.",
    );
    expect(screen.getByText("Running behind")).toHaveClass("text-hiviz-text");
    expect(runningBehind()?.previousElementSibling).toBe(
      screen.getByRole("list", { name: "Today" }),
    );
    expect(runningBehind()?.querySelector("button")).toBeNull();
  });

  it("says one job in the singular, its wait in whole hours however long", async () => {
    await renderToday([], {}, behind(1, NOON - 2 * DAY - HOUR - 1));
    expect(runningBehind()?.textContent).toBe(
      "Running behind1 queued job was still due after this morning's run. The oldest has waited 49h.",
    );
  });

  it("sits under the skipped-digest line when both show", async () => {
    await renderToday(
      [],
      {},
      behind(3, NOON - HOUR, [
        { userId: "op-jess", handle: "jess", address: "je•••@gmail.com" },
      ]),
    );
    expect(runningBehind()?.previousElementSibling).toBe(
      document.querySelector("[data-part='digest-unconfirmed']"),
    );
  });

  it("leaves out the wait when no oldest is known", async () => {
    await renderToday([], {}, behind(2, undefined));
    expect(runningBehind()?.textContent).toBe(
      "Running behind2 queued jobs were still due after this morning's run.",
    );
  });

  it("says nothing when nothing is behind", async () => {
    await renderToday([], {}, behind(0, undefined));
    expect(runningBehind()).toBeNull();
  });
});

/**
 * Design 164: a hold breaker at its ceiling this hour, one line a cause
 * under the three numbers, in hi-viz, with nothing to press.
 */
/**
An empty Today with `breakers` at their ceilings.
*/
function withBreakers(breakers: DeskToday["breakers"]): DeskToday {
  return { ...desk(0), breakers };
}

describe("a hold breaker at its ceiling, on Today", () => {
  it("says what stopped and what happens instead, for each cause", async () => {
    await renderToday(
      [],
      {},
      withBreakers([
        { cause: "fingerprint", isOver: true, count: 5, ceiling: 5 },
        { cause: "classifier", isOver: true, count: 4, ceiling: 4 },
        { cause: "reports", isOver: true, count: 12, ceiling: 12 },
      ]),
    );
    const lines = [
      ...document.querySelectorAll("[data-part='breaker-over']"),
    ].map((line) => line.textContent);
    expect(lines).toStrictEqual([
      "Holds paused5 uploads matched removed images in the last hour, the most held in one hour. New matches are screened like any photo until the hour clears.",
      "Holds pausedThe screener hid 4 photos in the last hour, the most it hides in one hour. New flags stay visible only to their owners until the hour clears.",
      "Holds pausedReports hid 12 posts in the last hour, the most they hide in one hour. New ones go to Review without being hidden until the hour clears.",
    ]);
  });

  it("sits under the three numbers in hi-viz, with no button", async () => {
    await renderToday(
      [],
      {},
      withBreakers([
        { cause: "reports", isOver: true, count: 10, ceiling: 10 },
      ]),
    );
    const line = document.querySelector("[data-part='breaker-over']");
    expect(screen.getByText("Holds paused")).toHaveClass("text-hiviz-text");
    expect(line?.previousElementSibling).toBe(
      screen.getByRole("list", { name: "Today" }),
    );
    expect(line?.querySelector("button")).toBeNull();
  });

  it("says nothing on an ordinary hour", async () => {
    await renderToday([], {}, withBreakers([]));
    expect(document.querySelector("[data-part='breaker-over']")).toBeNull();
  });
});
