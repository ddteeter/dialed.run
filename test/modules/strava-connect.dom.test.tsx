import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StravaConnect,
  leaveForStrava,
} from "../../src/modules/runs/components/StravaConnect";
import { expectAvailable, expectBusy } from "../ui/unavailable";

/**
 * Connect, reconnect and disconnect (Remaining Screens T1, T3; round 22,
 * item 23; round 23, item 9).
 *
 * The leaving-the-app half is `globalThis.location`, which is stubbed here
 * rather than driven.
 */
const location = {
  assign: vi.fn(),
  reload: vi.fn(),
};

vi.stubGlobal("location", location);

afterEach(() => {
  location.assign.mockClear();
  location.reload.mockClear();
});

const nothing = () => Promise.resolve();
const noUrl = () => Promise.resolve(undefined);
const STRAVA = "https://www.strava.com/oauth/authorize?state=01";

function screenFor(
  status: "ok" | "broken" | undefined,
  overrides: {
    getAuthorizeUrl?: () => Promise<string | undefined>;
    disconnect?: () => Promise<unknown>;
  } = {},
) {
  return render(
    <StravaConnect
      configured
      status={status}
      runCount={186}
      getAuthorizeUrl={overrides.getAuthorizeUrl ?? noUrl}
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
  it("draws nothing at all — never a dead control", () => {
    const { container } = render(
      <StravaConnect
        configured={false}
        status={undefined}
        runCount={0}
        getAuthorizeUrl={noUrl}
        disconnect={nothing}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("StravaConnect: not yet connected", () => {
  it("fetches the authorize URL at click time and leaves for Strava", async () => {
    // The URL carries a fresh CSRF nonce, so it is fetched when the runner
    // asks rather than rendered into the page.
    const user = userEvent.setup();
    const getAuthorizeUrl = vi.fn(() => Promise.resolve(STRAVA));
    screenFor(undefined, { getAuthorizeUrl });

    expect(
      screen.getByText("You’ll approve this on Strava’s own screen."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Connect Strava" }));

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(STRAVA);
    });
    expect(getAuthorizeUrl).toHaveBeenCalledTimes(1);
  });

  it("waits behind its in-flight label, and asks once", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<string | undefined>();
    const getAuthorizeUrl = vi.fn(() => pending.promise);
    screenFor(undefined, { getAuthorizeUrl });

    const button = screen.getByRole("button", { name: "Connect Strava" });
    expectAvailable(button);
    await user.click(button);
    await waitFor(() => {
      expectBusy(button);
    });
    expect(button).toHaveAccessibleName("Connecting");
    await user.click(button);
    expect(getAuthorizeUrl).toHaveBeenCalledTimes(1);
    pending.resolve(STRAVA);
  });

  it("says not connected under the button when it fails, and tries again", async () => {
    const user = userEvent.setup();
    const getAuthorizeUrl = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error("upstream down"))
      .mockResolvedValueOnce(STRAVA);
    screenFor(undefined, { getAuthorizeUrl });

    await user.click(screen.getByRole("button", { name: "Connect Strava" }));

    expect(await screen.findByText("Not connected")).toBeVisible();
    expect(screen.getByText("Our end failed.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not connected. Our end failed.",
    );
    expect(location.assign).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(STRAVA);
    });
  });

  it("treats a server with no URL to give as a failure, not a trip", async () => {
    const user = userEvent.setup();
    screenFor(undefined, { getAuthorizeUrl: noUrl });

    await user.click(screen.getByRole("button", { name: "Connect Strava" }));

    expect(await screen.findByText("Not connected")).toBeVisible();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it("says nothing at rest", () => {
    screenFor(undefined);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByText("Not connected")).toBeNull();
  });
});

describe("leaveForStrava", () => {
  it("goes where the server says, and refuses to go nowhere", async () => {
    await leaveForStrava(() => Promise.resolve(STRAVA));
    expect(location.assign).toHaveBeenCalledWith(STRAVA);

    await expect(leaveForStrava(noUrl)).rejects.toThrow(
      "Strava gave no authorize URL.",
    );
  });
});

describe("StravaConnect: connected", () => {
  it("says it is connected, and offers only a disconnect", () => {
    screenFor("ok");

    expect(
      screen.getByText(
        "Strava is connected. We'll remind you to log your kit after a run.",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Disconnect",
    ]);
  });

  it("confirms first, as T3b draws it: what is kept and what stops", async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn(nothing);
    screenFor("ok", { disconnect });

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
      "KeptYour closet and everything it has learned",
      "StopsReminders after each Strava run",
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
    screenFor("ok", { disconnect });

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
    screenFor("ok", { disconnect });

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
    screenFor("ok", { disconnect });

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
    screenFor("ok", { disconnect });

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

describe("StravaConnect: broken", () => {
  it("asks them to reconnect, and still offers the way out", () => {
    screenFor("broken");

    expect(screen.getByText("Strava needs to be reconnected.")).toBeVisible();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Reconnect Strava[Reconnecting]",
      "Disconnect",
    ]);
  });

  it("reconnects through the same authorize flow", async () => {
    const user = userEvent.setup();
    screenFor("broken", { getAuthorizeUrl: () => Promise.resolve(STRAVA) });

    await user.click(screen.getByRole("button", { name: "Reconnect Strava" }));

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(STRAVA);
    });
  });

  it("says not connected when the reconnect fails", async () => {
    const user = userEvent.setup();
    screenFor("broken", {
      getAuthorizeUrl: () => Promise.reject(new Error("down")),
    });

    const button = screen.getByRole("button", { name: "Reconnect Strava" });
    await user.click(button);

    expect(await screen.findByText("Not connected")).toBeVisible();
    await waitFor(() => {
      expectAvailable(button);
    });
  });
});
