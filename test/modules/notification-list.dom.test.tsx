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

  it("locks the button while it works, and releases it after", async () => {
    // A second click mid-clear is a second request for the same thing.
    //
    // The release is asserted on the success path rather than a failure,
    // because `onMarkAllRead` has a `finally` and no `catch`: a rejection
    // escapes as an unhandled one, which is a real gap (law 5) rather than
    // something a test should reach into. Recorded as D-43.
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

    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    pending.resolve(undefined);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Mark all read" }),
      ).not.toBeDisabled();
    });
  });
});
