import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { UnsubscribeLanding } from "../../src/modules/email/components/UnsubscribeLanding";
import type { SubscriptionLanding } from "../../src/modules/email/landing";

/**
 * The unsubscribe landing (round 26 #19, D-64): opening the link asks,
 * its one button unsubscribes, and "Turn them back on" undoes it on the
 * same page.
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

const OFF: SubscriptionLanding = {
  state: "off",
  kind: "run_reminder",
  email: "ma•••@example.com",
};
const ASK: SubscriptionLanding = { ...OFF, state: "ask" };

describe("UnsubscribeLanding (round 27 #8)", () => {
  it("says the reminder is off, with no log-in and no confirm, and where every kind is changed", async () => {
    await renderWithRouter(
      <UnsubscribeLanding
        landing={OFF}
        unsubscribe={vi.fn()}
        resubscribe={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Run reminder emails are off",
      }),
    ).toBeVisible();
    expect(screen.getByText("Unsubscribed")).toHaveClass("text-dialed-text");
    expect(
      screen.getByText("You won't get another one. Strava stays connected."),
    ).toBeVisible();
    // No push in v1 (decision D-44), so the board's push sentence is gone.
    expect(screen.queryByText(/push/iu)).toBeNull();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
    const settingsLink = screen.getByRole("link", {
      name: "Settings › Notifications",
    });
    expect(settingsLink).toHaveAttribute("href", "/account/notifications");
    expect(settingsLink).toHaveClass("underline");
    expect(settingsLink.closest("p")).toHaveTextContent(
      "Change every kind in Settings › Notifications.",
    );
  });

  it("turns them back on, on the same page, and returns to the question", async () => {
    const resubscribe = vi.fn(() => Promise.resolve<SubscriptionLanding>(ASK));
    const unsubscribe = vi.fn(() => Promise.resolve<SubscriptionLanding>(OFF));
    const user = userEvent.setup();
    await renderWithRouter(
      <UnsubscribeLanding
        landing={ASK}
        unsubscribe={unsubscribe}
        resubscribe={resubscribe}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    const turnOn = await screen.findByRole("button", {
      name: "Turn them back on",
    });
    expect(turnOn).toHaveClass("underline");
    await user.click(turnOn);

    expect(resubscribe).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { name: "Stop run reminder emails?" }),
    ).toBeVisible();
    // The earlier "Unsubscribed." is no longer true, so it is not said.
    expect(screen.getByRole("status").textContent).toBe("");
    expect(
      screen.queryByRole("button", { name: "Turn them back on" }),
    ).toBeNull();
  });

  it("says Still off, with the cause, when turning them on fails", async () => {
    const resubscribe = vi.fn(() => Promise.reject(new Error("down")));
    const user = userEvent.setup();
    await renderWithRouter(
      <UnsubscribeLanding
        landing={OFF}
        unsubscribe={vi.fn()}
        resubscribe={resubscribe}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Turn them back on" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Still off. Our end failed.",
      );
    });
    expect(
      screen.getByRole("heading", { name: "Run reminder emails are off" }),
    ).toBeVisible();
  });

  it("says a bad link doesn't work, and where emails are changed instead", async () => {
    await renderWithRouter(
      <UnsubscribeLanding
        landing={{ state: "invalid" }}
        unsubscribe={vi.fn()}
        resubscribe={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "That link doesn't work" }),
    ).toBeVisible();
    expect(screen.getByText(/^Change emails in/u)).toHaveTextContent(
      "Change emails in Settings › Notifications.",
    );
    expect(
      screen.getByRole("link", { name: "Settings › Notifications" }),
    ).toHaveAttribute("href", "/account/notifications");
  });

  it("asks first, naming the address masked: nobody is unsubscribed until the button is pressed", async () => {
    const unsubscribe = vi.fn(() => Promise.resolve<SubscriptionLanding>(OFF));
    const user = userEvent.setup();
    await renderWithRouter(
      <UnsubscribeLanding
        landing={ASK}
        unsubscribe={unsubscribe}
        resubscribe={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Stop run reminder emails?" }),
    ).toBeVisible();
    expect(screen.getByText("Run reminder emails")).toHaveClass("text-quiet");
    expect(
      screen.getByText(
        "We'll stop emailing ma•••@example.com when a run lands on Strava. Account emails don't change.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/^Change every kind in/u)).toBeVisible();
    // No band before anything has failed.
    expect(screen.queryByText("Still subscribed")).toBeNull();
    expect(unsubscribe).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", {
        name: "Run reminder emails are off",
      }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Unsubscribed.");
  });

  it("keeps the question on screen under a STILL SUBSCRIBED band when the unsubscribe fails", async () => {
    const unsubscribe = vi
      .fn<() => Promise<SubscriptionLanding>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(OFF);
    const user = userEvent.setup();
    await renderWithRouter(
      <UnsubscribeLanding
        landing={ASK}
        unsubscribe={unsubscribe}
        resubscribe={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("Still subscribed")).toBeVisible();
    expect(
      screen.getByText("That didn't go through. Try again?"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Stop run reminder emails?" }),
    ).toBeVisible();

    await user.click(retry);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("heading", {
        name: "Run reminder emails are off",
      }),
    ).toBeVisible();
  });

  it("keeps the browser's own submit from leaving the page", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <UnsubscribeLanding
        landing={ASK}
        unsubscribe={vi.fn(() => Promise.resolve<SubscriptionLanding>(OFF))}
        resubscribe={vi.fn()}
      />,
    );
    let submitted: Event | undefined;
    document.addEventListener("submit", (event) => {
      submitted = event;
    });
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(submitted?.defaultPrevented).toBe(true);
  });
});
