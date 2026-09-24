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
 * Screen M, redrawn to S2c (round 22, item 13), with Mark all read on the
 * control-failure pattern (round 23, item 9).
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

function markAll(): HTMLElement {
  return screen.getByRole("button", { name: "Mark all read" });
}

describe("NotificationList · the rows", () => {
  it("is S2b when there is nothing: the bracketed QUIET and its one next step", async () => {
    await renderWithRouter(
      <NotificationList notifications={[]} markAllRead={nothing} />,
    );

    expect(screen.getByText("Quiet")).toBeVisible();
    expect(
      screen.getByText(
        "Log a run and we’ll ask you one question about it. That’s most of what lands here.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
    // Nothing to mark, so no control that could only do nothing.
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("renders one row per notification, with its body and its time in mono", async () => {
    await renderWithRouter(
      <NotificationList
        notifications={[
          notification({
            id: "01A",
            body: "New run on Strava — log your kit?",
          }),
          notification({ id: "01B", body: "Your run import didn't work" }),
        ]}
        markAllRead={nothing}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/New run on Strava/)).toBeVisible();
    // A literal for the reason `feed-profiles` carries: deriving the
    // expectation from the same ambient call the component used made the
    // assertion true of any answer, including two different ones.
    const time = screen.getAllByText("Tue 12 Aug, 12:00");
    expect(time[0]).toHaveClass("font-mono");
  });

  it("puts unread on white with a pink dot, and read on the paper in quiet", async () => {
    // S2c: unread = --panel + the dot; read = paper, --quiet, and the dot's
    // width kept as indent so the text does not move when a row is read.
    // Never the hi-viz wash — yellow is failure and nothing else.
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
    expect(unread).toHaveAttribute("data-state", "unread");
    expect(unread).toHaveClass("bg-panel", "text-ink");
    expect(unread).not.toHaveClass("bg-unread");
    expect(unread?.firstElementChild).toHaveClass("bg-action", "size-2");
    expect(read).toHaveAttribute("data-state", "read");
    expect(read).toHaveClass("text-quiet");
    expect(read).not.toHaveClass("bg-panel");
    expect(read?.firstElementChild).toHaveClass("size-2");
    expect(read?.firstElementChild).not.toHaveClass("bg-action");
  });

  it("offers Mark all read only while something is unread", async () => {
    await renderWithRouter(
      <NotificationList
        notifications={[notification({ read: true })]}
        markAllRead={nothing}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });
});

describe("NotificationList · Mark all read", () => {
  it("clears them all and reloads the screen", async () => {
    const user = userEvent.setup();
    const markAllRead = vi.fn(() => Promise.resolve());
    const router = await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={markAllRead}
      />,
    );

    await user.click(markAll());

    await waitFor(() => {
      expect(markAllRead).toHaveBeenCalledTimes(1);
    });
    // Back to the same screen, so the loader re-runs and the rows come
    // back read rather than the component guessing at the new state.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/notifications");
    });
  });

  it("breathes [ Marking ] in place, busy but never disabled, and the rows stay put", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={() => pending.promise}
      />,
      "/notifications",
    );
    const button = markAll();
    expect(button).toHaveAttribute("data-part", "mark-all");
    expect(button).toHaveAttribute("data-state", "rest");
    expect(button).not.toHaveAttribute("aria-busy");

    await user.click(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "true");
    });
    expect(button).toHaveAttribute("data-state", "pending");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toBeEnabled();
    expect(screen.getByText("Marking")).toBeVisible();
    // Not optimistic: the row is still unread while the server works.
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "data-state",
      "unread",
    );

    pending.resolve(undefined);
    await waitFor(() => {
      expect(markAll()).not.toHaveAttribute("aria-busy");
    });
  });

  it("starts one clear however many times it is pressed", async () => {
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

    // Held rather than looked up again: while it works, its name is the
    // pending verb.
    const button = markAll();
    await user.click(button);
    await user.click(button);

    expect(markAllRead).toHaveBeenCalledTimes(1);
    pending.resolve(undefined);
  });

  it("says Nothing marked under the control when it fails, and changes nothing", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <NotificationList
        notifications={[notification()]}
        markAllRead={() => Promise.reject(new TypeError("fetch failed"))}
      />,
      "/notifications",
    );

    expect(screen.getByRole("status")).toHaveTextContent("");
    await user.click(markAll());

    expect(await screen.findByText("Nothing marked")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing marked. Your connection dropped.",
    );
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "data-state",
      "unread",
    );
    // And the label is back, ready for another go.
    expect(markAll()).not.toHaveAttribute("aria-busy");
  });

  it("tries again from the band", async () => {
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

    await user.click(markAll());
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.queryByText("Nothing marked")).toBeNull();
    });
    expect(markAllRead).toHaveBeenCalledTimes(2);
  });
});
