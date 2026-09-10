import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ImportStatus } from "../../src/modules/runs/components/ImportStatus";
import type { ImportRow } from "../../src/modules/runs/imports";

/**
 * The import-status fragment: the one place a route loader cannot serve,
 * because the status changes on the server after the page renders.
 *
 * Every branch of it was uncovered — it reached `../functions` for the
 * status query, so no test could import it.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/$runId",
    component: () => <p>The run</p>,
  });
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/new",
    component: () => <p>Upload</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, runRoute, newRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

function importRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    id: "01IMPORT",
    userId: "01USER",
    r2Key: "imports/01USER/01IMPORT.gpx",
    status: "pending",
    failureReason: NOTHING,
    runId: NOTHING,
    idempotencyKey: NOTHING,
    createdAt: 1_755_000_000,
    ...overrides,
  };
}

function watching(row: ImportRow | undefined) {
  return () => Promise.resolve(row);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ImportStatus: while it is still working", () => {
  it("shows a skeleton before the first answer arrives", async () => {
    // No spinner, per §System states — the brackets breathe instead.
    const { container } = render(<div />);
    expect(container).toBeDefined();
    const pending = Promise.withResolvers<ImportRow | undefined>();
    await renderWithRouter(
      <ImportStatus importId="01IMPORT" getStatus={() => pending.promise} />,
    );

    expect(document.querySelector(".animate-pulse")).not.toBeNull();
    pending.resolve(importRow());
  });

  it.each(["pending", "processing"] as const)(
    "says it is reading the run while %s",
    async (status) => {
      await renderWithRouter(
        <ImportStatus
          importId="01IMPORT"
          getStatus={watching(importRow({ status }))}
        />,
      );

      expect(await screen.findByText("Reading your run…")).toBeVisible();
      expect(document.querySelector(".animate-pulse")).not.toBeNull();
    },
  );

  it("polls the status for the import it was given", async () => {
    const getStatus = vi.fn(() => Promise.resolve(importRow()));
    await renderWithRouter(
      <ImportStatus importId="01THISONE" getStatus={getStatus} />,
    );

    await waitFor(() => {
      expect(getStatus).toHaveBeenCalledWith({ data: { importId: "01THISONE" } });
    });
  });

  it("keeps polling while the import is unfinished", async () => {
    // Two seconds apart, per the policy. A loader cannot serve this: the
    // status changes on the server after the page renders.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getStatus = vi.fn(() => Promise.resolve(importRow()));
    await renderWithRouter(
      <ImportStatus importId="01IMPORT" getStatus={getStatus} />,
    );
    await waitFor(() => {
      expect(getStatus).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(6000);

    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops polling the moment the import concludes", async () => {
    // `delay === 0` is the policy's "stop", translated to react-query's
    // `false`. A finished import polled forever is a request per two
    // seconds for a row that will never change again.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getStatus = vi.fn(() =>
      Promise.resolve(importRow({ status: "done", runId: "01RUN" })),
    );
    await renderWithRouter(
      <ImportStatus importId="01IMPORT" getStatus={getStatus} />,
    );
    await waitFor(() => {
      expect(getStatus).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("gives up polling once the budget is spent", async () => {
    // Sixty polls, then stop — the stall message takes over from there.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getStatus = vi.fn(() => Promise.resolve(importRow()));
    await renderWithRouter(
      <ImportStatus importId="01IMPORT" getStatus={getStatus} />,
    );

    await vi.advanceTimersByTimeAsync(200_000);

    expect(getStatus).toHaveBeenCalledTimes(60);
  });
});

describe("ImportStatus: when it finishes", () => {
  it("says the run is in, and offers to open it", async () => {
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "done", runId: "01RUN" }))}
      />,
    );

    expect(await screen.findByText(/Your run is in/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the run" })).toHaveAttribute(
      "href",
      "/runs/01RUN",
    );
  });

  it("still says the run is in when there is no run id to link to", async () => {
    // Shouldn't happen, and the sentence is still the truth — a missing
    // link is better than a link to /runs/undefined.
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "done" }))}
      />,
    );

    expect(await screen.findByText(/Your run is in/)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names a duplicate as one, and points at the run they already have", async () => {
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "duplicate", runId: "01OLD" }))}
      />,
    );

    expect(await screen.findByText(/already logged this run/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open the existing run" }),
    ).toHaveAttribute("href", "/runs/01OLD");
  });

  it("says a duplicate is one even with no run to open", async () => {
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "duplicate" }))}
      />,
    );

    expect(await screen.findByText(/already logged this run/)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("ImportStatus: when it fails", () => {
  it("shows the reason the consumer recorded", async () => {
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(
          importRow({
            status: "failed",
            failureReason: "That file is larger than 25 MB.",
          }),
        )}
      />,
    );

    expect(await screen.findByText("[Import failed]")).toBeVisible();
    expect(screen.getByText("That file is larger than 25 MB.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Try another file" })).toHaveAttribute(
      "href",
      "/runs/new",
    );
  });

  it("falls back to the parse sentence when no reason was recorded", async () => {
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "failed" }))}
      />,
    );

    expect(
      await screen.findByText(/That file didn't parse/),
    ).toBeVisible();
  });

  it("says the same when the query itself keeps failing", async () => {
    // `isError`, the other half of the guard: react-query retries first,
    // so the message appears only once those are exhausted.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={() => Promise.reject(new Error("network went away"))}
      />,
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(
      await screen.findByText(/We lost track of that import/),
    ).toBeVisible();
  });

  it("says it lost track when the row is gone", async () => {
    await renderWithRouter(
      <ImportStatus importId="01IMPORT" getStatus={watching(undefined)} />,
    );

    expect(
      await screen.findByText(/We lost track of that import/),
    ).toBeVisible();
  });


});

describe("ImportStatus: when it takes too long", () => {
  it("stops its timer when the screen goes away", async () => {
    // The stall timer outlives the component otherwise, and fires a state
    // update into nothing.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The stall timer's id is what the cleanup clears, so that is what is
    // asserted: a timer count would also move for react-query's own
    // scheduling and could not tell the two apart.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "processing" }))}
      />,
    );
    await screen.findByText("Reading your run…");
    const stallTimer: unknown = setTimer.mock.results[0]?.value;
    expect(stallTimer).toBeDefined();

    cleanup();

    expect(clearTimer.mock.calls.flat()).toContain(stallTimer);
    setTimer.mockRestore();
    clearTimer.mockRestore();
  });


  it("stops promising and says to check back", async () => {
    // The budget is two minutes of watching. Past it the honest thing is
    // to say the work continues rather than keep a skeleton spinning.
    //
    // `startedWatchingAt` is fixed at mount, so the clock has to answer
    // differently for that first call than for the render that follows —
    // re-rendering with a later clock would move both and read as zero
    // elapsed.
    // Fake timers move the clock and the poll together, which is what
    // this needs: `startedWatchingAt` is fixed at mount, and it is the
    // next poll that re-reads the clock and re-renders.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "processing" }))}
      />,
    );
    expect(await screen.findByText("Reading your run…")).toBeVisible();


    await vi.advanceTimersByTimeAsync(120_000);

    expect(await screen.findByText(/taking longer than usual/)).toBeVisible();
    expect(screen.queryByText("Reading your run…")).toBeNull();
  });

  it("keeps reading right up to the budget", async () => {
    // `>=`, so one millisecond short is still "reading your run".
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithRouter(
      <ImportStatus
        importId="01IMPORT"
        getStatus={watching(importRow({ status: "processing" }))}
      />,
    );
    expect(await screen.findByText("Reading your run…")).toBeVisible();

    await vi.advanceTimersByTimeAsync(119_999);

    expect(screen.getByText("Reading your run…")).toBeVisible();
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });
});
