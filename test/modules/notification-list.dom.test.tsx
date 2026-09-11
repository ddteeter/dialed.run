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

import { NotificationList } from "../../src/modules/notifications/components/NotificationList";

/**
 * The notification list. Uncovered until "mark all read" moved from an
 * import to a prop.
 */
async function renderWithRouter(element: ReactElement, at = "/") {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const notificationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/notifications",
    component: () => element,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, notificationsRoute]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

const NOTHING = z.null().parse(JSON.parse("null"));

function notification(
  overrides: { id?: string; body?: string; read?: boolean } = {},
) {
  return {
    id: overrides.id ?? "01N",
    userId: "01USER",
    kind: "kit_reminder",
    subjectId: NOTHING,
    body: overrides.body ?? "Log your kit?",
    read: overrides.read ?? false,
    createdAt: 1_755_000_000,
  };
}

const nothing = () => Promise.resolve();

describe("NotificationList", () => {
  it("says nothing yet, rather than showing an empty list", async () => {
    await renderWithRouter(
      <NotificationList notifications={[]} markAllRead={nothing} />,
    );

    expect(screen.getByText("Nothing yet.")).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
    // The button stays: a list you can clear is a list you can clear even
    // when it is empty.
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();
  });

  it("renders one row per notification, with its body and its time", async () => {
    await renderWithRouter(
      <NotificationList
        notifications={[
          notification({ id: "01A", body: "New run on Strava — log your kit?" }),
          notification({ id: "01B", body: "Your run import didn't work" }),
        ]}
        markAllRead={nothing}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/New run on Strava/)).toBeVisible();
    // The timestamp is a measured value, so it renders in mono.
    const time = screen.getAllByText(
      new Date(1_755_000_000 * 1000).toLocaleString(),
    );
    expect(time[0]).toHaveClass("font-mono");
  });

  it("marks the unread ones, and only those", async () => {
    // The highlight is the whole reason a notification list is worth
    // opening twice.
    await renderWithRouter(
      <NotificationList
        notifications={[
          notification({ id: "01A", read: false }),
          notification({ id: "01B", read: true }),
        ]}
        markAllRead={nothing}
      />,
    );

    const [unread, read] = screen.getAllByRole("listitem");
    expect(unread).toHaveClass("bg-hi-viz/20");
    expect(read).toHaveClass("bg-white");
    expect(read).not.toHaveClass("bg-hi-viz/20");
  });

  it("clears them all and reloads the screen", async () => {
    const user = userEvent.setup();
    const markAllRead = vi.fn(() => Promise.resolve());
    const router = await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={markAllRead}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      expect(markAllRead).toHaveBeenCalledTimes(1);
    });
    // Back to the same screen, so the loader re-runs and the rows come
    // back read rather than the component guessing at the new state.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/notifications");
    });
  });

  it("marks itself busy without ever being disabled, and releases after", async () => {
    // A second click mid-clear is a second request for the same thing —
    // but the guard is in the handler, never on a `disabled` attribute.
    // §5: a disabled button drops focus and stops announcing, so the
    // button stays enabled, keeps its name, and says it is busy with aria.
    //
    // Started on /notifications, which is where the clear navigates to, so
    // the component is not remounted underneath the assertion — a remount
    // would reset `isMarking` and the release would look observed when it
    // was not.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={() => pending.promise}
      />,
      "/notifications",
    );
    const button = screen.getByRole("button", { name: "Mark all read" });

    // At rest first. A button that starts busy is telling a screen reader
    // that work is under way before anyone has asked for any, and the
    // clean state afterwards would look identical.
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("aria-disabled");

    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(button).toHaveAttribute("aria-disabled", "true");
    // The two that a `disabled` attribute would have taken away.
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName("Mark all read");

    pending.resolve(undefined);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Mark all read" }),
      ).not.toHaveAttribute("aria-busy");
    });
    // Both of them go, not just the one. A button permanently marked
    // `aria-disabled` reads as broken to a screen reader while looking
    // perfectly fine on screen.
    expect(
      screen.getByRole("button", { name: "Mark all read" }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("starts one clear however many times the button is clicked", async () => {
    // The guard moved off the DOM and into the handler, so this is what
    // now holds it — nothing about the button's attributes stops a second
    // click reaching the handler.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const markAllRead = vi.fn(() => pending.promise);
    await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={markAllRead}
      />,
      "/notifications",
    );
    const button = screen.getByRole("button", { name: "Mark all read" });

    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(markAllRead).toHaveBeenCalledTimes(1);

    // And it is a guard, not a latch: once the first clear finishes, a
    // second click has to get through. Leaving `inFlight` set would make
    // the button work exactly once per page load, which looks like a dead
    // button rather than a bug.
    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
    await user.click(button);
    await waitFor(() => {
      expect(markAllRead).toHaveBeenCalledTimes(2);
    });
  });

  it("says nothing until something happens", async () => {
    // The live region is permanently mounted and starts empty. Seeded with
    // any text it would announce on arrival, before the user has done
    // anything — and a `sr-only` region saying something wrong is invisible
    // to everyone who could report it.
    await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={() => Promise.resolve(undefined)}
      />,
      "/notifications",
    );

    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("clears a stale failure when the next attempt starts", async () => {
    // `setFailure(undefined)` at the top of the handler. Without it the
    // band from a failed clear outlives the retry that fixed it, so the
    // screen says the thing failed while the notifications sit there
    // marked read.
    const user = userEvent.setup();
    const markAllRead = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 went away"))
      .mockResolvedValueOnce(undefined);
    await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={markAllRead}
      />,
      "/notifications",
    );

    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    const retry = await screen.findByRole("button", { name: "Try again" });

    await user.click(retry);

    await waitFor(() => {
      expect(
        screen.queryByText("Our end failed. Nothing changed."),
      ).toBeNull();
    });
    expect(markAllRead).toHaveBeenCalledTimes(2);
  });

  it("says a failed clear failed, instead of escaping as an unhandled rejection", async () => {
    // D-43. This was `try { … } finally { … }` with no `catch`, so a D1
    // failure re-threw out of a `void`-ed call: the button re-enabled, the
    // user was told nothing, and on screen it looked exactly like a click
    // that had not registered.
    //
    // The rejection is watched for rather than assumed absent — an
    // unhandled one does not fail the assertion that follows it, which is
    // how this survived being tested at all.
    const user = userEvent.setup();
    const escaped: string[] = [];
    const watch = (event: PromiseRejectionEvent) => {
      escaped.push(String(event.reason));
      event.preventDefault();
    };
    globalThis.addEventListener("unhandledrejection", watch);
    try {
      await renderWithRouter(
        <NotificationList
          notifications={[notification()]}
          markAllRead={() => Promise.reject(new Error("D1 went away"))}
        />,
        "/notifications",
      );
      await user.click(screen.getByRole("button", { name: "Mark all read" }));

      // The same sentence a failed submit gives, from the same classifier.
      expect(
        await screen.findByText("Our end failed. Nothing changed."),
      ).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Nothing saved. Our end failed. Nothing changed.",
      );
      expect(
        screen.getByRole("button", { name: "Try again" }),
      ).toBeVisible();
    } finally {
      globalThis.removeEventListener("unhandledrejection", watch);
    }

    expect(escaped).toStrictEqual([]);
  });
});
