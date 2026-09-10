import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { RunDetail } from "../../src/modules/runs/components/RunDetail";
import type { RunRow } from "../../src/modules/runs/service";

/**
 * The run screen, and D-24's manual-temp fallback.
 *
 * Weather is never typed by a human on the default path, so this form is
 * the exception and the conditions it appears under are the thing worth
 * pinning. All of it was uncovered until the action moved to a prop.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

function run(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "01RUN",
    userId: "01USER",
    source: "manual",
    startedAt: 1_755_000_000,
    durationS: 1830,
    distanceM: 5432,
    lat: NOTHING,
    lng: NOTHING,
    indoor: false,
    effort: NOTHING,
    title: "Evening run",
    idempotencyKey: NOTHING,
    weatherStatus: "failed",
    ...overrides,
  };
}

const nothing = () => Promise.resolve();

describe("RunDetail: what the run says", () => {
  it("names it and renders the measured values in mono", async () => {
    await renderWithRouter(
      <RunDetail
        run={run({ weatherStatus: "attached" })}
        recordManualTemp={nothing}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Evening run" }),
    ).toBeVisible();
    // 5432 m is 5.43 KM and 1830 s is 31 MIN — rounded to the minute, not
    // truncated, or a 1:59:30 run reads as an hour and 59.
    const measured = screen.getByText(/5\.43 KM/);
    expect(measured).toHaveTextContent("5.43 KM · 31 MIN");
    expect(measured).toHaveClass("font-mono");
  });

  it("marks an indoor run as indoor", async () => {
    await renderWithRouter(
      <RunDetail run={run({ indoor: true })} recordManualTemp={nothing} />,
    );
    expect(screen.getByText("[Indoor]")).toBeVisible();
  });

  it("does not mark an outdoor one", async () => {
    await renderWithRouter(<RunDetail run={run()} recordManualTemp={nothing} />);
    expect(screen.queryByText("[Indoor]")).toBeNull();
  });
});

describe("RunDetail: when the manual-temp fallback appears", () => {
  it.each([
    ["failed", true],
    ["pending", true],
    ["attached", false],
    ["manual", false],
    ["none", false],
  ] as const)("outdoor run with %s conditions: %s", async (status, expected) => {
    // D-24: the fallback exists only where no observation is resolvable.
    // Offering it next to conditions we already have invites a human to
    // overwrite a measurement.
    await renderWithRouter(
      <RunDetail
        run={run({ weatherStatus: status })}
        recordManualTemp={nothing}
      />,
    );

    const form = screen.queryByRole("button", { name: "Save temperature" });
    expect(form === null).toBe(!expected);
  });

  it("never appears on an indoor run, whatever the status says", async () => {
    // An indoor run has no conditions to resolve, so a stale 'pending' on
    // one is not an invitation to type a temperature.
    await renderWithRouter(
      <RunDetail
        run={run({ indoor: true, weatherStatus: "pending" })}
        recordManualTemp={nothing}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Save temperature" }),
    ).toBeNull();
  });
});

describe("RunDetail: typing a temperature", () => {
  it("says what it is for, and that it will not train the model", async () => {
    await renderWithRouter(<RunDetail run={run()} recordManualTemp={nothing} />);

    expect(screen.getByText("[Unavailable]")).toBeVisible();
    expect(screen.getByText(/won’t train the model/)).toBeVisible();
    expect(screen.getByLabelText(/Temp/)).toHaveValue(10);
  });

  it("sends the number the user typed, for this run", async () => {
    const user = userEvent.setup();
    const recordManualTemp = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <RunDetail
        run={run({ id: "01THISRUN" })}
        recordManualTemp={recordManualTemp}
      />,
    );

    const field = screen.getByLabelText(/Temp/);
    await user.clear(field);
    await user.type(field, "-3");
    await user.click(screen.getByRole("button", { name: "Save temperature" }));

    await waitFor(() => {
      expect(recordManualTemp).toHaveBeenCalledWith({
        data: { runId: "01THISRUN", tempC: -3 },
      });
    });
  });

  it("submits through its own handler, never the browser's", async () => {
    const user = userEvent.setup();
    await renderWithRouter(<RunDetail run={run()} recordManualTemp={nothing} />);

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Save temperature" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("locks the button while it saves", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderWithRouter(
      <RunDetail run={run()} recordManualTemp={() => pending.promise} />,
    );
    const button = screen.getByRole("button", { name: "Save temperature" });

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it("says so when the save fails, and lets them try again", async () => {
    const user = userEvent.setup();
    const recordManualTemp = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockResolvedValueOnce(undefined);
    await renderWithRouter(
      <RunDetail run={run()} recordManualTemp={recordManualTemp} />,
    );
    const button = screen.getByRole("button", { name: "Save temperature" });

    await user.click(button);

    const message = await screen.findByText(/try/i);
    expect(message).toBeVisible();
    expect(button).not.toBeDisabled();

    // And the message clears on the next attempt rather than sitting next
    // to a running save.
    const pending = Promise.withResolvers<undefined>();
    recordManualTemp.mockReturnValueOnce(pending.promise);
    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByText(message.textContent)).toBeNull();
    });
    pending.resolve(undefined);
  });

  it("leaves the CTA slot for the kit-attach flow", async () => {
    await renderWithRouter(<RunDetail run={run()} recordManualTemp={nothing} />);
    expect(document.querySelector("[data-slot='attach-kit-cta']")).not.toBeNull();
  });
});
