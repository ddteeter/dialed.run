import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTappedSlow } from "../../src/ui/tapped-slow";
import { SLOW_ROUTE_MS } from "../../src/ui/tabs";

/**
 * Round 22 X3 for an in-screen link: *"the brackets go on the tapped
 * element's label"* — the one pressed, not its neighbours, and only once
 * the route is slow.
 */
function Row({
  to,
  label,
}: Readonly<{ to: "/closet" | "/feed"; label: string }>) {
  const { isWaiting, onClick } = useTappedSlow();
  return (
    <Link to={to} onClick={onClick} data-waiting={String(isWaiting)}>
      {label}
    </Link>
  );
}

/**
 * The rows sit in the root, beside the outlet, so they stay mounted
 * through a load: a tap's mark must go when the load settles, not only
 * when the screen holding it does.
 */
async function slowApp() {
  const load = Promise.withResolvers<undefined>();
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Row to="/closet" label="Units" />
        <Row to="/feed" label="Privacy" />
        <Outlet />
      </>
    ),
  });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>index</p>,
  });
  const slow = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    loader: () => load.promise,
    component: () => <p>arrived</p>,
  });
  // A second slow page, which never arrives.
  const again = createRoute({
    getParentRoute: () => rootRoute,
    path: "/call",
    loader: () =>
      new Promise<never>(() => {
        // Never settles.
      }),
    component: () => <p>unreachable</p>,
  });
  const other = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed",
    component: () => <p>other</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, slow, again, other]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("Units");
  return {
    router,
    release: async () => {
      await act(async () => {
        load.resolve(undefined);
        await vi.advanceTimersByTimeAsync(0);
      });
    },
  };
}

const waiting = (name: string) =>
  screen.getByRole("link", { name }).dataset.waiting;

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useTappedSlow (X3, in-screen links)", () => {
  it("breathes only the tapped link, and only past the threshold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const app = await slowApp();

    fireEvent.click(screen.getByRole("link", { name: "Units" }));
    await elapse(SLOW_ROUTE_MS - 1);
    // Under 300ms nothing shows.
    expect(waiting("Units")).toBe("false");

    await elapse(1);
    expect(waiting("Units")).toBe("true");
    // The neighbour was not pressed, so it does not breathe.
    expect(waiting("Privacy")).toBe("false");

    await app.release();
    expect(await screen.findByText("arrived")).toBeInTheDocument();
  });

  it("forgets the tap once the load settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const app = await slowApp();

    fireEvent.click(screen.getByRole("link", { name: "Units" }));
    await elapse(SLOW_ROUTE_MS);
    expect(waiting("Units")).toBe("true");

    await app.release();
    await screen.findByText("arrived");
    expect(waiting("Units")).toBe("false");

    // And the next slow load, which nobody pressed this row for, does not
    // find it still marked.
    act(() => {
      void app.router.navigate({ to: "/call" });
    });
    await elapse(SLOW_ROUTE_MS * 2);
    expect(waiting("Units")).toBe("false");
  });

  it("does not breathe a link nobody pressed, however slow the route", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const app = await slowApp();

    act(() => {
      void app.router.navigate({ to: "/closet" });
    });
    await elapse(SLOW_ROUTE_MS * 2);

    expect(waiting("Units")).toBe("false");
    expect(waiting("Privacy")).toBe("false");
    await app.release();
  });
});
