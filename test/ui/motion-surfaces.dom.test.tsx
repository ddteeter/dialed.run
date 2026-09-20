import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { Digits, rollFrom } from "../../src/ui/Digits";
import { FlowStep, LOG_FLOW, directionBetween } from "../../src/ui/FlowStep";
import { DURATION } from "../../src/ui/motion";
import { Sheet } from "../../src/ui/Sheet";
import { Skeleton } from "../../src/ui/Skeleton";
import { TabBar, activeTabIndex } from "../../src/ui/TabBar";

/**
 * The surfaces whose move lives in a component rather than only in CSS.
 *
 * jsdom cannot watch an animation run, so each case asserts the decision
 * the component made — which class, which offset, which direction — and
 * never merely that a class string exists somewhere in the markup.
 */

/**
TabBar renders typed <Link>s, which need router context.
*/
async function renderAt(element: ReactElement, path: string) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function indicator(): HTMLElement | null {
  return document.querySelector("[data-slot='tab-indicator'] span");
}

describe("Tab switch: the indicator slides under the label", () => {
  it("puts the indicator under the tab that owns the path", async () => {
    // One fifth of the track, moved in whole multiples of itself — which
    // is what makes the five equal columns load-bearing rather than
    // cosmetic.
    await renderAt(<TabBar />, "/closet");
    expect(indicator()).toHaveClass("tab-indicator", "w-1/5");
    expect(indicator()).toHaveStyle({ translate: "100% 0" });
  });

  it("moves it to the right fifth for every tab", async () => {
    // Four tabs at five positions: the third seat is `+ Add`, which is a
    // launcher and never takes the indicator, so the offsets skip 200%.
    for (const [path, offset] of [
      ["/feed", "0% 0"],
      ["/closet", "100% 0"],
      ["/call", "300% 0"],
      ["/feed/me", "400% 0"],
    ] as const) {
      const { unmount } = await renderAt(<TabBar />, path);
      expect([path, indicator()?.getAttribute("style")]).toEqual([
        path,
        `translate: ${offset};`,
      ]);
      unmount();
    }
  });

  it("does not follow the runner into the log flow", async () => {
    // Round 12: "+ Add is a launcher, not a tab: the indicator never
    // travels to it." Logging a run is a task laid over wherever you
    // were, so the bar does not claim you have gone somewhere.
    await renderAt(<TabBar />, "/runs/new");

    expect(indicator()).toBeNull();
    expect(screen.getByRole("link", { name: "+ Add" })).toHaveClass(
      "text-muted",
    );
    // The seat is still in the bar — it is the indicator that stays away,
    // not the way in.
    expect(screen.getByRole("link", { name: "+ Add" })).toHaveAttribute(
      "href",
      "/runs/new",
    );
  });

  it("marks the active label and leaves the rest muted", async () => {
    await renderAt(<TabBar />, "/closet");
    const active = screen.getByRole("link", { name: "Closet" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("tab-label", "text-ink");
    const resting = screen.getByRole("link", { name: "Feed" });
    expect(resting).not.toHaveAttribute("aria-current");
    // Both carry the transition: the colour flip is the half of the move
    // that survives reduced motion, so it cannot live on one side only.
    expect(resting).toHaveClass("tab-label", "text-muted");
  });

  it("shows no indicator at all on a path no tab owns", async () => {
    // A tab bar still pointing at wherever you were last is a tab bar
    // that lies. `/runs/manual` is inside the log flow, not on a tab.
    await renderAt(<TabBar />, "/runs/manual");
    expect(indicator()).toBeNull();
    expect(screen.getByRole("link", { name: "+ Add" })).toHaveClass(
      "text-muted",
    );
  });

  it("gives a descendant path to the deepest tab that owns it", () => {
    const tabs = [{ to: "/feed" }, { to: "/closet" }, { to: "/feed/me" }];
    // The reason this is a function: `/feed/me` is a descendant of
    // `/feed`, so first-match-wins lights the Feed tab while the runner
    // is looking at their own profile.
    expect(activeTabIndex("/feed/me", tabs)).toBe(2);
    // And the other order, which is the one the real array happens not to
    // have: the seat goes to the deepest owner, not to whichever matched
    // last. Without that, the answer depends on how the tabs are listed.
    expect(
      activeTabIndex("/feed/me", [{ to: "/feed/me" }, { to: "/feed" }]),
    ).toBe(0);
    expect(activeTabIndex("/feed/entry/01H", tabs)).toBe(0);
    expect(activeTabIndex("/feed", tabs)).toBe(0);
    // A route, not a prefix: `/feed` must not claim `/feedback`.
    expect(activeTabIndex("/feedback", tabs)).toBeUndefined();
    expect(activeTabIndex("/runs/manual", tabs)).toBeUndefined();
  });

  it("gives a launcher no seat, however well it owns the path", () => {
    // The launcher is skipped before ownership is even asked, so a path
    // it would otherwise win outright still lights nothing.
    const bar = [{ to: "/feed" }, { to: "/runs/new", launcher: true }];
    expect(activeTabIndex("/runs/new", bar)).toBeUndefined();
    expect(activeTabIndex("/runs/new/anything", bar)).toBeUndefined();
    // And it takes nothing from the tabs that are tabs.
    expect(activeTabIndex("/feed", bar)).toBe(0);
  });
});

describe("Log flow step: direction carries which way you are going", () => {
  it("is forward up the flow and back down it", () => {
    // "Direction tells you which way you are travelling through the flow,
    // so Back feels like back."
    expect(directionBetween(LOG_FLOW.intake, LOG_FLOW.attach)).toBe("forward");
    expect(directionBetween(LOG_FLOW.verdict, LOG_FLOW.attach)).toBe("back");
    // Arriving at the step you were already on — `/runs/new` to
    // `/runs/manual` — is not going back.
    expect(directionBetween(LOG_FLOW.intake, LOG_FLOW.intake)).toBe("forward");
  });

  it("orders the flow the way the product does", () => {
    expect(LOG_FLOW.intake).toBeLessThan(LOG_FLOW.attach);
    expect(LOG_FLOW.attach).toBeLessThan(LOG_FLOW.verdict);
  });

  it("enters from the trailing edge, and reverses when you go back", async () => {
    // Each step is its own route, so the component remembers across
    // mounts rather than across renders. The sequence is the test.
    const first = render(<FlowStep step={LOG_FLOW.intake}>intake</FlowStep>);
    expect(screen.getByText("intake")).toHaveClass("flow-step-forward");
    await waitFor(() => {
      expect(screen.getByText("intake")).toBeInTheDocument();
    });
    first.unmount();

    const second = render(<FlowStep step={LOG_FLOW.verdict}>verdict</FlowStep>);
    const forward = screen.getByText("verdict");
    expect(forward).toHaveAttribute("data-flow-direction", "forward");
    expect(forward).toHaveClass("flow-step-forward");
    await waitFor(() => {
      expect(screen.getByText("verdict")).toBeInTheDocument();
    });
    second.unmount();

    render(<FlowStep step={LOG_FLOW.attach}>attach</FlowStep>);
    const back = screen.getByText("attach");
    expect(back).toHaveAttribute("data-flow-direction", "back");
    expect(back).toHaveClass("flow-step-back");
    expect(back).not.toHaveClass("flow-step-forward");
  });

  it("remembers a step that changed under it, not only the one it mounted with", () => {
    // The step is recorded from an effect that depends on it. With a
    // constant dependency list the effect runs once on mount and a screen
    // that swapped steps in place would leave the *next* one measuring
    // against a step nobody is on any more.
    const mounted = render(<FlowStep step={LOG_FLOW.intake}>one</FlowStep>);
    mounted.rerender(<FlowStep step={LOG_FLOW.verdict}>one</FlowStep>);
    mounted.unmount();

    render(<FlowStep step={LOG_FLOW.attach}>two</FlowStep>);

    expect(screen.getByText("two")).toHaveAttribute(
      "data-flow-direction",
      "back",
    );
  });
});

describe("Numbers & temps: the digits roll", () => {
  it("rolls down only when the value went down", () => {
    expect(rollFrom(0, 1)).toBe("up");
    expect(rollFrom(9, 10)).toBe("up");
    expect(rollFrom(1, 0)).toBe("down");
    expect(rollFrom(10, 9)).toBe("down");
    // Total on purpose: a value that did not move does not roll
    // backwards, so "no change" answers the same way as an increment
    // rather than being a third case nothing renders.
    expect(rollFrom(4, 4)).toBe("up");
  });

  it("shows the count and nothing else until it changes", () => {
    const { container } = render(<Digits value={7} />);
    expect(container.textContent).toBe("7");
    // No animation on first paint: a page load is not a change. The class
    // attribute is empty rather than absent or arbitrary — an arriving
    // class here would roll every count on every page load.
    expect(container.querySelector(":scope > span > span")).toHaveAttribute(
      "class",
      "",
    );
    expect(container.firstElementChild).toHaveAttribute("class", "digit-slot");
  });

  it("schedules nothing while the count is standing still", () => {
    // The effect's guard, which is otherwise invisible: without it a
    // timer is armed on every mount of every count in the app, to do
    // nothing when it fires.
    const armed = vi.spyOn(globalThis, "setTimeout");
    try {
      render(<Digits value={7} />);
      expect(
        armed.mock.calls.filter(([, delay]) => delay === DURATION.quick),
      ).toHaveLength(0);
    } finally {
      armed.mockRestore();
    }
  });

  it("rolls up on an increment and down on a decrement", async () => {
    const { container, rerender } = render(<Digits value={0} />);

    rerender(<Digits value={1} />);
    expect(container.querySelector(".digit-in-up")).toHaveTextContent("1");
    expect(container.querySelector(".digit-out-up")).toHaveTextContent("0");
    // "A crossfade reads as a bug": the old value leaves, it does not fade.
    expect(container.querySelector(".digit-leaving")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    await waitFor(() => {
      expect(container.querySelector(".digit-leaving")).toBeNull();
    });
    expect(container.textContent).toBe("1");

    rerender(<Digits value={0} />);
    // The other way, or a decrement would read as the wrong number
    // arriving.
    expect(container.querySelector(".digit-in-down")).toHaveTextContent("0");
    expect(container.querySelector(".digit-out-down")).toHaveTextContent("1");
    expect(container.querySelector(".digit-in-up")).toBeNull();
  });

  it("drops the departed value even where no animation ever ends", async () => {
    // happy-dom fires no `animationend`, and neither does a browser that
    // dropped the class. Law 5: the count is the primary thing.
    const { container, rerender } = render(<Digits value={4} />);
    rerender(<Digits value={5} />);
    expect(container.textContent).toBe("45");
    await waitFor(() => {
      expect(container.textContent).toBe("5");
    });
  });

  it("cancels the drop when it is unmounted mid-roll", () => {
    // A timer outliving its component is a leak, and here it would also
    // set state on something that is gone.
    const armed = vi.spyOn(globalThis, "setTimeout");
    const cancelled = vi.spyOn(globalThis, "clearTimeout");
    try {
      const { rerender, unmount } = render(<Digits value={4} />);
      rerender(<Digits value={5} />);
      const rolls = armed.mock.results.filter(
        (_, index) => armed.mock.calls[index]?.[1] === DURATION.quick,
      );
      expect(rolls).toHaveLength(1);

      unmount();

      expect(cancelled).toHaveBeenCalledWith(rolls[0]?.value);
    } finally {
      armed.mockRestore();
      cancelled.mockRestore();
    }
  });

  it("takes the caller's class alongside its own slot", () => {
    const { container } = render(<Digits value={2} className="text-quiet" />);
    expect(container.firstElementChild).toHaveAttribute(
      "class",
      "digit-slot text-quiet",
    );
  });
});

describe("the two surfaces that were already right", () => {
  it("waits with the breathing brackets, never with a pulse", () => {
    // Tailwind's `animate-pulse` is a 2s loop on a foreign curve that
    // keeps running under `prefers-reduced-motion`. One waiting device.
    const { container } = render(<Skeleton className="h-4 w-24" />);
    expect(container.firstElementChild).toHaveClass("breathe", "h-4", "w-24");
    expect(container.firstElementChild).not.toHaveClass("animate-pulse");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("gives the sheet its travel, on the element whose `open` drives it", () => {
    render(
      <Sheet
        open={false}
        onClose={() => {
          throw new Error("not called");
        }}
        label="Pick a kit"
      >
        body
      </Sheet>,
    );
    const dialog = screen.getByLabelText("Pick a kit");
    expect(dialog).toHaveClass("sheet-motion");
    // Tailwind v4 compiles `-translate-x-1/2` into the `translate`
    // property, which is the property the travel needs. The wide layout
    // centres on margin instead so the two cannot collide.
    expect(dialog.className).not.toMatch(/translate-[xy]/);
    expect(dialog).toHaveClass("wide:m-auto");
  });
});
