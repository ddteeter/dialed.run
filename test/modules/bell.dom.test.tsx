import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { NotificationBell } from "../../src/modules/notifications/components/NotificationBell";
import { bellLoader } from "../../src/modules/notifications/components/bell-loader";

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

function glyph(): Element {
  const box = bell().querySelector('[data-slot="bell-glyph"]');
  if (box === null) throw new Error("no bell glyph box");
  return box;
}

describe("NotificationBell", () => {
  it("is a link to the notifications screen", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={0} />,
    );
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
    await renderWithRouter(
      <NotificationBell unreadCount={4} verdictsWaiting={0} />,
    );
    expect(bell()).toHaveAccessibleName("Notifications, 4 new");
    expect(bell()).toHaveTextContent("");
    expect(bell()).toHaveAttribute("data-state", "dot");
    expect(bell()).toHaveClass("text-ink");
    expect(bell()).not.toHaveClass("text-muted");
    expect(bell().querySelector(".bg-action")).not.toBeNull();
  });

  it("shows the dot for a single unread notification", async () => {
    // The boundary the `> 0` turns on.
    await renderWithRouter(
      <NotificationBell unreadCount={1} verdictsWaiting={0} />,
    );
    expect(bell()).toHaveAttribute("data-state", "dot");
  });

  it("names the dot's count in digits, and in words past where the number caps", async () => {
    // Round 27 #25 (R-141(1)): "9+" read aloud is "nine plus".
    const { unmount } = await renderWithRouter(
      <NotificationBell unreadCount={9} verdictsWaiting={0} />,
    );
    expect(bell()).toHaveAccessibleName("Notifications, 9 new");
    unmount();

    await renderWithRouter(
      <NotificationBell unreadCount={12} verdictsWaiting={0} />,
    );
    expect(bell()).toHaveAccessibleName("Notifications, more than 9 new");
  });

  it("counts the runs waiting for a verdict, and the number wins over the dot", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={5} verdictsWaiting={3} />,
    );
    expect(bell()).toHaveTextContent(/^3$/u);
    // Round 26 #9: "Notifications" and "Notifications, 3 new".
    expect(bell()).toHaveAccessibleName("Notifications, 3 new");
    expect(bell()).toHaveAttribute("data-state", "number");
    expect(bell()).toHaveClass("text-ink");
    // A measured count, so it is mono — and only the count: no dot too.
    expect(screen.getByText("3")).toHaveClass("font-mono");
    expect(glyph().children).toHaveLength(2);
  });

  it("centres its glyph like the search glyph beside it, and hangs the mark on the glyph's corner", async () => {
    // #632 (A-08 and its six repeats): `items-start` pinned the glyph to
    // the top of its 44px target, 12px above the search glyph. The mark
    // is placed on the glyph's own box, so centring the glyph does not
    // drag the mark down with it — or lift the glyph with the mark.
    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={3} />,
    );
    expect(bell()).toHaveClass("items-center", "justify-center");
    expect(bell()).not.toHaveClass("items-start");
    expect(glyph()).toHaveClass("relative");
    expect(screen.getByText("3")).toHaveClass("absolute", "top-0", "left-3.5");
  });

  it("hangs the dot on the glyph's corner too", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={2} verdictsWaiting={0} />,
    );
    const dot = glyph().lastElementChild;
    expect(dot).toHaveClass("absolute", "top-0", "left-3.5", "bg-action");
    expect(glyph().children).toHaveLength(2);
  });

  it("counts a single waiting run", async () => {
    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={1} />,
    );
    expect(bell()).toHaveTextContent(/^1$/u);
  });

  it("counts up to nine, and caps past it: 9+ drawn, more than 9 said", async () => {
    const { unmount } = await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={9} />,
    );
    expect(bell()).toHaveTextContent(/^9$/u);
    expect(bell()).toHaveAccessibleName("Notifications, 9 new");
    unmount();

    await renderWithRouter(
      <NotificationBell unreadCount={0} verdictsWaiting={10} />,
    );
    expect(bell()).toHaveTextContent(/^9\+$/u);
    expect(bell()).toHaveAccessibleName("Notifications, more than 9 new");
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

describe("bellLoader", () => {
  it("draws the bell from the counts it reads, asking only when called", async () => {
    // The system states' bell (PR #104): the router hands in the read,
    // and the page calls it after mount.
    const read = vi.fn(() =>
      Promise.resolve({ unreadCount: 5, verdictsWaiting: 3 }),
    );
    const load = bellLoader(read);
    expect(read).not.toHaveBeenCalled();

    await renderWithRouter(await load());

    expect(read).toHaveBeenCalledOnce();
    expect(bell()).toHaveTextContent(/^3$/u);
    expect(bell()).toHaveAccessibleName("Notifications, 3 new");
  });

  it("passes the unread count through on its own", async () => {
    const load = bellLoader(() =>
      Promise.resolve({ unreadCount: 4, verdictsWaiting: 0 }),
    );

    await renderWithRouter(await load());

    expect(bell()).toHaveAccessibleName("Notifications, 4 new");
  });
});
