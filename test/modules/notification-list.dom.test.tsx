import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { NotificationList } from "../../src/modules/notifications/components/NotificationList";
import {
  HIDDEN_NOTICE,
  REPORT_OUTCOME,
} from "../../src/modules/safety/notice-copy";

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
  overrides: {
    id?: string;
    body?: string;
    read?: boolean;
    markable?: boolean;
    kind?: string;
    linkId?: string;
    linkHandle?: string;
  } = {},
) {
  const isRead = overrides.read ?? false;
  return {
    id: overrides.id ?? "01N",
    userId: "01USER",
    kind: overrides.kind ?? "kit_reminder",
    subjectId: NOTHING,
    body: overrides.body ?? "Log your kit?",
    linkId: overrides.linkId ?? NOTHING,
    linkHandle: overrides.linkHandle ?? NOTHING,
    read: isRead,
    createdAt: 1_755_000_000,
    markable: overrides.markable ?? !isRead,
  };
}

const nothing = () => Promise.resolve();

function markAll(): HTMLElement {
  return screen.getByRole("button", { name: "Mark all read" });
}

/**
A runner whose home zone has not been looked up yet: times read UTC, marked.
*/
const OWED = { homeZone: undefined };

describe("NotificationList · the rows", () => {
  it("is S2b when there is nothing: the bracketed QUIET and its one next step", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[]}
        markAllRead={nothing}
      />,
    );

    // A heading under the screen's own, not a paragraph drawn as one
    // (axe's `p-as-heading`, #566).
    const quiet = screen.getByRole("heading", { level: 2, name: "Quiet" });
    expect(quiet).toBeVisible();
    expect(quiet).toHaveTextContent(/^\[ Quiet \]$/u);
    // Drawn, not said (D-150): both glyphs are hidden from a reader, so
    // the headline is heard as "Quiet".
    const glyphs = screen.getAllByText(/^[[\]]$/u);
    expect(glyphs).toHaveLength(2);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      screen.getByText(
        "Log a run and we’ll ask you one question about it. That’s most of what lands here.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
    // Nothing to mark, so no control that could only do nothing; the row
    // above the list stays and says so (R55·184a, 184c).
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
    expect(screen.getByText("All read")).toHaveClass("text-muted");
    // Centred in the one ruled panel the list would be.
    const panel = quiet.parentElement;
    expect(panel).toHaveAttribute("data-state", "empty");
    expect(panel).toHaveClass("bg-panel", "text-center", "items-center");
  });

  it("renders one row per notification, with its body and its time in mono", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
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
    const time = screen.getAllByText("Tue Aug 12, 12:00 UTC");
    expect(time[0]).toHaveClass("font-mono");
  });

  it("reads the times on the runner's home zone once it is known (R-96)", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={{ homeZone: "America/Chicago" }}
        notifications={[notification({ id: "01A", body: "Ran" })]}
        markAllRead={nothing}
      />,
    );

    // Chicago is five hours behind UTC in August, and unmarked.
    expect(screen.getByText("Tue Aug 12, 07:00")).toBeVisible();
    expect(screen.queryByText(/UTC/u)).toBeNull();
  });

  it("marks unread with the dot and ink, read with quiet and no dot, never a fill (R55·183, 184b)", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({ id: "01A", read: false }),
          notification({ id: "01B", read: true }),
        ]}
        markAllRead={nothing}
      />,
    );

    const [unread, read] = screen.getAllByRole("listitem");
    expect(unread).toHaveAttribute("data-state", "unread");
    const unreadRow = unread?.firstElementChild;
    expect(unreadRow).toHaveClass("text-ink");
    expect(unreadRow).not.toHaveClass("bg-panel");
    expect(unreadRow?.firstElementChild).toHaveClass("bg-action", "size-2");
    expect(read).toHaveAttribute("data-state", "read");
    const readRow = read?.firstElementChild;
    expect(readRow).toHaveClass("text-quiet");
    expect(readRow).not.toHaveClass("text-ink");
    expect(readRow?.firstElementChild).toHaveClass("size-2");
    expect(readRow?.firstElementChild).not.toHaveClass("bg-action");
    // The kept width is the dot's own shape and nothing else.
    expect(readRow?.firstElementChild?.classList).toHaveLength(5);
    // The dot says "unread" to the eye only.
    expect(within(unread ?? document.body).getByText("Unread")).toHaveClass(
      "sr-only",
    );
    expect(
      within(read ?? document.body).queryByText("Unread"),
    ).not.toBeInTheDocument();
    // One --panel list with hairline dividers (184b).
    expect(screen.getByRole("list")).toHaveClass(
      "bg-panel",
      "divide-y",
      "divide-hairline",
      "desk:rounded-card",
    );
  });

  it("counts the unread above the list, markable or not (R55·184a)", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({ id: "01A", read: false, markable: false }),
          notification({ id: "01B", read: false }),
          notification({ id: "01C", read: true }),
        ]}
        markAllRead={nothing}
      />,
    );
    const count = screen.getByText("2 unread");
    expect(count).toHaveClass("text-muted", "font-mono");
    expect(count.parentElement).toHaveAttribute("data-part", "mark-all-row");
    expect(count.parentElement).toContainElement(markAll());
  });

  it("reads ALL READ once nothing is unread, and offers nothing", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[notification({ read: true })]}
        markAllRead={nothing}
      />,
    );
    expect(screen.getByText("All read")).toBeVisible();
    expect(screen.queryByText(/unread$/u)).toBeNull();
  });

  it("offers Mark all read only while something is unread", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[notification({ read: true })]}
        markAllRead={nothing}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("offers nothing to mark when the only unread row is a verdict still owed", async () => {
    // The server leaves an owed reminder unread; a button that could only
    // leave it unread is a button that does nothing.
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[notification({ read: false, markable: false })]}
        markAllRead={nothing}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "data-state",
      "unread",
    );
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });
});

describe("NotificationList · moderation notices (C8, D-132, D-145)", () => {
  it("reads both outcomes to the reporter, and the hide to the author", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({ id: "01A", body: REPORT_OUTCOME.removed }),
          notification({ id: "01B", body: REPORT_OUTCOME.kept }),
          notification({ id: "01C", body: HIDDEN_NOTICE.photo }),
        ]}
        markAllRead={nothing}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(
      rows.map(
        (row) =>
          row.querySelector('[data-part="notification-body"]')?.textContent,
      ),
    ).toStrictEqual([
      "We removed what you reported.",
      "We reviewed what you reported and left it up. We didn't find that it breaks our community rules. Disagree? Write to desk@dialed.run.",
      "Photo hidden while we review it. Someone reported a photo on your run, so other runners can't see it until a person reviews it, usually within a day. It was hidden automatically. We'll tell you what we decide.",
    ]);
  });
});

describe("NotificationList · Mark all read", () => {
  it("clears them all and reloads the screen", async () => {
    const user = userEvent.setup();
    const markAllRead = vi.fn(() => Promise.resolve());
    const router = await renderWithRouter(
      <NotificationList
        viewer={OWED}
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
        viewer={OWED}
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
        viewer={OWED}
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
        viewer={OWED}
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
        viewer={OWED}
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

describe("NotificationList · where a row goes (R48·129f, R48·131c)", () => {
  it("opens the garment a correction was filed from", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({
            kind: "correction_applied",
            body: "We fixed the weight on AFO Middle Layer. Thanks.",
            linkId: "01GARMENT",
          }),
        ]}
        markAllRead={nothing}
      />,
    );
    expect(
      screen.getByRole("link", {
        name: "Unread We fixed the weight on AFO Middle Layer. Thanks. Tue Aug 12, 12:00 UTC",
      }),
    ).toHaveAttribute("href", "/closet/01GARMENT");
    // The whole row is the link, regular weight and never underlined,
    // and it ends in the muted chevron (R55·183).
    const link = screen.getByRole("link", {
      name: /We fixed the weight on AFO Middle Layer/u,
    });
    expect(link.parentElement).toHaveAttribute("data-part", "notification-row");
    // Padded to 44 like every tappable thing, whatever row it ends.
    expect(link).toHaveClass("target", "no-underline", "flex", "text-ink");
    expect(link).not.toHaveClass("underline");
    const chevron = link.lastElementChild;
    expect(chevron?.tagName.toLowerCase()).toBe("svg");
    expect(chevron).toHaveClass("text-muted");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByText("We fixed the weight on AFO Middle Layer. Thanks."),
    ).toHaveClass("text-body", "font-normal");
  });

  it("opens the upload for a run that landed on Strava", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({
            kind: "strava_reminder",
            body: "New run on Strava. Upload its file, then add what you wore.",
          }),
        ]}
        markAllRead={nothing}
      />,
    );
    expect(
      screen.getByRole("link", {
        name: /New run on Strava\. Upload its file, then add what you wore\./u,
      }),
    ).toHaveAttribute("href", "/runs/new");
    expect(
      screen.getByRole("link", { name: /New run on Strava/u }),
    ).toHaveClass("target", "flex");
  });

  it("opens one follower's profile by the handle they have now", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({
            kind: "followed",
            body: "@ada followed you.",
            linkId: "01ADA",
            linkHandle: "ada_runs",
          }),
        ]}
        markAllRead={nothing}
      />,
    );
    expect(
      screen.getByRole("link", { name: /@ada followed you\./u }),
    ).toHaveAttribute("href", "/feed/u/ada_runs");
    expect(
      screen.getByRole("link", { name: /@ada followed you\./u }),
    ).toHaveClass("target", "flex");
  });

  it("opens the runner's own profile for a group", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({
            kind: "followed",
            body: "@ada and 3 others followed you.",
          }),
        ]}
        markAllRead={nothing}
      />,
    );
    const link = screen.getByRole("link", {
      name: /@ada and 3 others followed you\./u,
    });
    expect(link).toHaveAttribute("href", "/feed/me");
    expect(link).toHaveClass("target", "flex");
  });

  it("keeps a decline's reason on its own line", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[
          notification({
            kind: "correction_declined",
            body: "We kept the fabric on Harrier as it is.\nNot enough to go on",
            linkId: "01GARMENT",
          }),
        ]}
        markAllRead={nothing}
      />,
    );
    expect(
      screen.getByText(/We kept the fabric on Harrier as it is\./u),
    ).toHaveClass("whitespace-pre-line");
  });

  it("is not a link for a kind with nowhere to go", async () => {
    await renderWithRouter(
      <NotificationList
        viewer={OWED}
        notifications={[notification({ body: "Your run import didn't work" })]}
        markAllRead={nothing}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Your run import didn't work")).toBeVisible();
    // No chevron on a row that opens nothing (R55·183).
    expect(screen.getByRole("listitem").querySelector("svg")).toBeNull();
  });
});
