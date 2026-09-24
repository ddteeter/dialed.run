import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { NotificationBell } from "../../src/modules/notifications/components/NotificationBell";

/**
 * The bell, in S2a's three states as round 22 assigned them (item 13): a
 * number for runs waiting on a verdict, a dot for anything else unread,
 * and nothing at all.
 *
 * S2 is also explicit that the bell "never rings, shakes or bounces — it
 * changes state and stops", and that the glyph comes from the Icon Pack
 * rather than an emoji. Both are assertions no `renderToString` could make
 * about a component that renders a typed <Link>.
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

function bell(): HTMLElement {
  return screen.getByRole("link", { name: /^Notifications/u });
}

describe("NotificationBell", () => {
  it("is a link to the notifications screen", async () => {
    await renderWithRouter(<NotificationBell unreadCount={0} />);
    expect(bell()).toHaveAttribute("href", "/notifications");
  });

  it("says nothing and steps back when there is nothing new", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={0} />,
    );
    expect(bell()).toHaveAccessibleName("Notifications");
    expect(bell()).toHaveTextContent("");
    expect(bell()).toHaveAttribute("data-state", "quiet");
    expect(bell()).toHaveClass("text-muted");
    expect(bell()).not.toHaveClass("text-ink");
  });

  it("shows a dot, not a number, for unread notifications", async () => {
    // A follow or a useful is news, not a to-do — so it is never counted.
    await renderWithRouter(<NotificationBell unreadCount={4} />);
    expect(bell()).toHaveAccessibleName("Notifications, unread");
    expect(bell()).toHaveTextContent("");
    expect(bell()).toHaveAttribute("data-state", "dot");
    expect(bell()).toHaveClass("text-ink");
    expect(bell()).not.toHaveClass("text-muted");
    expect(bell().querySelector(".bg-action")).not.toBeNull();
  });

  it("shows the dot for a single unread notification", async () => {
    // The boundary the `> 0` turns on.
    await renderWithRouter(<NotificationBell unreadCount={1} />);
    expect(bell()).toHaveAttribute("data-state", "dot");
  });

  it("counts the runs waiting for a verdict, and the number wins over the dot", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={5} verdictsWaiting={3} />,
    );
    expect(bell()).toHaveTextContent(/^3$/u);
    expect(bell()).toHaveAccessibleName(
      "Notifications, 3 waiting for a verdict",
    );
    expect(bell()).toHaveAttribute("data-state", "number");
    expect(bell()).toHaveClass("text-ink");
    // A measured count, so it is mono — and only the count: no dot too.
    expect(screen.getByText("3")).toHaveClass("font-mono");
    expect(bell().children).toHaveLength(2);
  });

  it("counts a single waiting run", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={1} />,
    );
    expect(bell()).toHaveTextContent(/^1$/u);
  });

  it("counts up to nine, and caps past it at 9+", async () => {
    const { unmount } = await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={9} />,
    );
    expect(bell()).toHaveTextContent(/^9$/u);
    unmount();

    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={10} />,
    );
    expect(bell()).toHaveTextContent(/^9\+$/u);
    expect(bell()).toHaveAccessibleName(
      "Notifications, 9+ waiting for a verdict",
    );
  });

  it("draws the pack's bell glyph, never an emoji, and never animates", async () => {
    // The 🔔-emoji bell is CLAUDE.md's canonical violation: an emoji
    // renders in whatever font the platform picks, which is the one thing
    // an icon system exists to stop.
    const { container } = await renderWithRouter(
      <NotificationBell unreadCount={2} verdictsWaiting={2} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("width", "20");
    // Decorative: the link carries the accessible name, so a second one on
    // the glyph would announce twice.
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.getHTML()).not.toMatch(/animate-|transition|motion-/);
  });
});
