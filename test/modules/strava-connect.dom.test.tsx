import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clockLabel, dayLabel, deviceTimeZone } from "../../src/lib/dates";
import { StravaConnect } from "../../src/modules/runs/components/StravaConnect";
import { expectBusy } from "../ui/unavailable";

/**
 * Connect and disconnect (Remaining Screens T1, T3; round 22, item 23;
 * round 23, item 9; round 25; round 26, item 21).
 *
 * The leaving-the-app half is `globalThis.location`, which is stubbed here
 * rather than driven.
 */
const location = {
  reload: vi.fn(),
};

vi.stubGlobal("location", location);

afterEach(() => {
  location.reload.mockClear();
});

const nothing = () => Promise.resolve();

/**
 * Renders inside a router, because the official button is a `Link`.
 */
async function renderInRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/runs/strava"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

async function screenFor(
  isConnected: boolean,
  overrides: {
    disconnect?: () => Promise<unknown>;
    lastRunSeenAt?: number;
  } = {},
) {
  return renderInRouter(
    <StravaConnect
      configured
      connected={isConnected}
      lastRunSeenAt={overrides.lastRunSeenAt}
      runCount={186}
      disconnect={overrides.disconnect ?? nothing}
    />,
  );
}

/**
T3b's confirm, or a failure saying it is not open.
*/
function confirmBox(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    "[data-slot='disconnect-confirm']",
  );
  if (found === null) throw new Error("no disconnect confirm");
  return found;
}

describe("StravaConnect: not configured", () => {
  it("draws nothing at all — never a dead control", async () => {
    await renderInRouter(
      <div data-testid="host">
        <StravaConnect
          configured={false}
          connected={false}
          lastRunSeenAt={undefined}
          runCount={0}
          disconnect={nothing}
        />
      </div>,
    );

    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });
});

describe("StravaConnect: not yet connected", () => {
  it("offers Strava's own button, and says where approval happens", async () => {
    await screenFor(false);

    const button = screen.getByRole("link", { name: "Connect with Strava" });
    expect(button).toHaveAttribute("href", "/runs/strava-connect");
    expect(button).toHaveAttribute("data-part", "strava-button");
    expect(
      screen.getByText("You’ll approve this on Strava’s own screen."),
    ).toBeVisible();
    // No disconnect for a connection that does not exist.
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StravaConnect: the last run seen (round 25, T3a)", () => {
  it("adds when Strava last told us a run landed, in the runner's zone", async () => {
    const at = Math.floor(Date.UTC(2026, 7, 29, 13, 58) / 1000);
    await screenFor(true, { lastRunSeenAt: at });

    const zone = deviceTimeZone() ?? "UTC";
    expect(
      await screen.findByText(
        `Connected · Last run seen ${dayLabel(at, zone)}, ${clockLabel(at, zone)}`,
      ),
    ).toHaveClass("text-dialed-text");
  });

  it("says only connected before the first run lands", async () => {
    await screenFor(true);

    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.queryByText(/Last run seen/u)).toBeNull();
  });
});

describe("StravaConnect: connected", () => {
  it("says it is connected, and offers only a disconnect", async () => {
    await screenFor(true);

    expect(screen.getByText("Connected")).toHaveClass("text-dialed-text");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Disconnect",
    ]);
  });

  it("confirms first, as T3b draws it: what is kept and what stops", async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn(nothing);
    await screenFor(true, { disconnect });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(disconnect).not.toHaveBeenCalled();
    const confirm = confirmBox();
    expect(confirm).toHaveClass("border-ink");
    expect(
      within(confirm).getByRole("heading", { name: "Disconnect Strava?" }),
    ).toBeVisible();
    const lines = [...confirm.querySelectorAll(":scope dl > div")].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      "KeptAll 186 runs, their outfits and verdicts",
      "KeptAdding runs: upload any run’s file here, as always",
      "StopsThe reminder after each run",
    ]);
    expect(within(confirm).getAllByText("Kept")[0]).toHaveClass(
      "text-dialed-text",
    );
    expect(within(confirm).getByText("Stops")).toHaveClass("text-cold-text");
    // T3b's weight: the act is the ink fill, the way back is the outline —
    // and both are full 44px targets.
    expect(
      within(confirm).getByRole("button", { name: "Disconnect" }),
    ).toHaveClass("target", "bg-ink", "text-ground");
    expect(
      within(confirm).getByRole("button", { name: "Keep it" }),
    ).toHaveClass("target", "border-ink", "bg-transparent");
  });

  it("keeps it on Keep it, changing nothing", async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn(nothing);
    await screenFor(true, { disconnect });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(
      document.querySelector("[data-slot='disconnect-confirm']"),
    ).toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("disconnects on the confirm, and reloads so the screen comes from the server", async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn(nothing);
    await screenFor(true, { disconnect });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(
      within(confirmBox()).getByRole("button", { name: "Disconnect" }),
    );

    await waitFor(() => {
      expect(location.reload).toHaveBeenCalledTimes(1);
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("says still connected when the disconnect fails, and tries again", async () => {
    const user = userEvent.setup();
    const disconnect = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockResolvedValueOnce(undefined);
    await screenFor(true, { disconnect });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const verb = within(confirmBox()).getByRole("button", {
      name: "Disconnect",
    });
    await user.click(verb);

    expect(await screen.findByText("Still connected")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Still connected. Our end failed.",
    );
    expect(location.reload).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(location.reload).toHaveBeenCalledTimes(1);
    });
  });

  it("waits behind its in-flight label while it disconnects", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<unknown>();
    const disconnect = vi.fn(() => pending.promise);
    await screenFor(true, { disconnect });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const verb = within(confirmBox()).getByRole("button", {
      name: "Disconnect",
    });
    await user.click(verb);

    await waitFor(() => {
      expectBusy(verb);
    });
    expect(verb).toHaveAccessibleName("Disconnecting");
    await user.click(verb);
    expect(disconnect).toHaveBeenCalledTimes(1);
    pending.resolve(undefined);
  });
});
