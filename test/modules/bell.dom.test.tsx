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
 * The bell, in the two states it actually has.
 *
 * S2 in the design is explicit that the bell "never rings, shakes or
 * bounces — it changes state and stops", and that the glyph comes from the
 * Icon Pack rather than an emoji. Both are assertions no `renderToString`
 * could make about a component that renders a typed <Link>.
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

describe("NotificationBell", () => {
  it("is a named link to the notifications screen", async () => {
    await renderWithRouter(<NotificationBell unreadCount={0} />);
    const bell = screen.getByRole("link", { name: "Notifications" });
    expect(bell).toHaveAttribute("href", "/notifications");
  });

  it("says nothing when there is nothing unread", async () => {
    // `> 0`, not `>= 0`: a bracketed [0] is a count of nothing dressed up
    // as news.
    await renderWithRouter(<NotificationBell unreadCount={0} />);
    expect(
      screen.getByRole("link", { name: "Notifications" }),
    ).toHaveTextContent("");
  });

  it("shows the count in brackets once there is one", async () => {
    await renderWithRouter(<NotificationBell unreadCount={3} />);
    expect(
      screen.getByRole("link", { name: "Notifications" }),
    ).toHaveTextContent("[3]");
  });

  it("shows a count of one, not just many", async () => {
    // The boundary the `> 0` guard turns on.
    await renderWithRouter(<NotificationBell unreadCount={1} />);
    expect(
      screen.getByRole("link", { name: "Notifications" }),
    ).toHaveTextContent("[1]");
  });

  it("draws the pack's bell glyph, never an emoji, and never animates", async () => {
    // The 🔔-emoji bell is CLAUDE.md's canonical violation: an emoji
    // renders in whatever font the platform picks, which is the one thing
    // an icon system exists to stop.
    const { container } = await renderWithRouter(
      <NotificationBell unreadCount={2} />,
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
