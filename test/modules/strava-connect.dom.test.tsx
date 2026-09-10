import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StravaConnect } from "../../src/modules/runs/components/StravaConnect";
import { RETRY_GENERIC } from "../../src/lib/copy";

/**
 * Connect / reconnect / disconnect (102 §6).
 *
 * Four states — unconfigured, unconnected, connected, broken — and every
 * one of them was uncovered until the two server functions moved to
 * props. The leaving-the-app half is `globalThis.location`, which is
 * stubbed here rather than driven.
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

describe("StravaConnect: nothing to connect to", () => {
  it("says the deployment has no Strava, and offers no button", () => {
    // Law 5's shape at the UI: credentials do not exist yet, and the
    // screen degrades to a sentence rather than a button that cannot work.
    render(
      <StravaConnect
        configured={false}
        status={undefined}
        getAuthorizeUrl={noUrl}
        disconnect={nothing}
      />,
    );

    expect(screen.getByText(/aren’t set up for this deployment/)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

function connectScreen(getAuthorizeUrl: () => Promise<string | undefined>) {
  return render(
    <StravaConnect
      configured
      status={undefined}
      getAuthorizeUrl={getAuthorizeUrl}
      disconnect={nothing}
    />,
  );
}

describe("StravaConnect: not yet connected", () => {
  it("fetches the authorize URL at click time and leaves for Strava", async () => {
    // The URL carries a fresh CSRF nonce, so it is fetched when the user
    // asks rather than rendered into the page.
    const user = userEvent.setup();
    const getAuthorizeUrl = vi.fn(() =>
      Promise.resolve("https://www.strava.com/oauth/authorize?state=01"),
    );
    connectScreen(getAuthorizeUrl);

    await user.click(screen.getByRole("button", { name: "Connect Strava" }));

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(
        "https://www.strava.com/oauth/authorize?state=01",
      );
    });
    // And a link, for the case where the redirect is blocked.
    expect(
      await screen.findByRole("link", { name: "Continue to Strava" }),
    ).toHaveAttribute("href", "https://www.strava.com/oauth/authorize?state=01");
  });

  it("says so when the server has no URL to give", async () => {
    // `undefined` means unconfigured secrets — a different problem from a
    // failed call, and a different sentence.
    const user = userEvent.setup();
    connectScreen(noUrl);

    await user.click(screen.getByRole("button", { name: "Connect Strava" }));

    expect(await screen.findByText("Strava isn't configured yet.")).toBeVisible();
    expect(location.assign).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says so when the call fails, in the shared retry words", async () => {
    const user = userEvent.setup();
    connectScreen(() => Promise.reject(new Error("network went away")));

    await user.click(screen.getByRole("button", { name: "Connect Strava" }));

    expect(await screen.findByText(RETRY_GENERIC)).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Strava" })).not.toBeDisabled();
  });

  it("locks the button while it fetches", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<string | undefined>();
    connectScreen(() => pending.promise);
    const button = screen.getByRole("button", { name: "Connect Strava" });

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it("says nothing at rest — no empty message, no dead link", () => {
    // Not just "no text": an empty <p> or <a> in a flex column takes a
    // line's worth of gap with it, and a link with no href is a control
    // that announces itself and goes nowhere.
    const { container } = connectScreen(noUrl);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("clears the last message when the user tries again", async () => {
    // A stale "Strava isn't configured yet." next to a running attempt is
    // a lie about what is happening.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<string | undefined>();
    const getAuthorizeUrl = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(pending.promise);
    connectScreen(getAuthorizeUrl);
    const button = screen.getByRole("button", { name: "Connect Strava" });

    await user.click(button);
    expect(await screen.findByText("Strava isn't configured yet.")).toBeVisible();

    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByText("Strava isn't configured yet.")).toBeNull();
    });
    pending.resolve(undefined);
  });
});

describe("StravaConnect: connected", () => {
  it("says it is connected, and offers only a disconnect", () => {
    render(
      <StravaConnect
        configured
        status="ok"
        getAuthorizeUrl={noUrl}
        disconnect={nothing}
      />,
    );

    expect(screen.getByText(/Strava is connected/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reconnect Strava" })).toBeNull();
  });

  it("disconnects and reloads, so the screen comes back from the server", async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn(() => Promise.resolve());
    render(
      <StravaConnect
        configured
        status="ok"
        getAuthorizeUrl={noUrl}
        disconnect={disconnect}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(disconnect).toHaveBeenCalledTimes(1);
    });
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("says so when the disconnect fails, and lets them retry", async () => {
    const user = userEvent.setup();
    render(
      <StravaConnect
        configured
        status="ok"
        getAuthorizeUrl={noUrl}
        disconnect={() => Promise.reject(new Error("Strava is down"))}
      />,
    );
    const button = screen.getByRole("button", { name: "Disconnect" });

    await user.click(button);

    expect(await screen.findByText(RETRY_GENERIC)).toBeVisible();
    expect(button).not.toBeDisabled();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("clears the last disconnect failure when the user tries again", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const disconnect = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Strava is down"))
      .mockReturnValueOnce(pending.promise);
    render(
      <StravaConnect
        configured
        status="ok"
        getAuthorizeUrl={noUrl}
        disconnect={disconnect}
      />,
    );
    const button = screen.getByRole("button", { name: "Disconnect" });

    await user.click(button);
    expect(await screen.findByText(RETRY_GENERIC)).toBeVisible();

    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByText(RETRY_GENERIC)).toBeNull();
    });
    pending.resolve(undefined);
  });

  it("says nothing at rest on the connected screen either", () => {
    const { container } = render(
      <StravaConnect
        configured
        status="ok"
        getAuthorizeUrl={noUrl}
        disconnect={nothing}
      />,
    );
    // One paragraph — the "Strava is connected" sentence — and no empty
    // second one waiting for an error.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("locks the button while it disconnects", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    render(
      <StravaConnect
        configured
        status="ok"
        getAuthorizeUrl={noUrl}
        disconnect={() => pending.promise}
      />,
    );
    const button = screen.getByRole("button", { name: "Disconnect" });

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    pending.resolve(undefined);
  });
});

describe("StravaConnect: broken", () => {
  it("asks them to reconnect, and offers both ways out", () => {
    // A broken grant is the user's to fix, so the reconnect is the primary
    // action — but disconnecting entirely stays available.
    render(
      <StravaConnect
        configured
        status="broken"
        getAuthorizeUrl={noUrl}
        disconnect={nothing}
      />,
    );

    expect(screen.getByText("Strava needs to be reconnected.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconnect Strava" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  it("reconnects through the same authorize flow", async () => {
    const user = userEvent.setup();
    render(
      <StravaConnect
        configured
        status="broken"
        getAuthorizeUrl={() => Promise.resolve("https://strava.test/authorize")}
        disconnect={nothing}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reconnect Strava" }));

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith("https://strava.test/authorize");
    });
  });
});
