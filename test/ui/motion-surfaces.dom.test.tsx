import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { Digits, rollFrom } from "../../src/ui/Digits";
import { FlowStep, LOG_FLOW, directionBetween } from "../../src/ui/FlowStep";
import { DURATION } from "../../src/ui/motion";
import { Sheet } from "../../src/ui/Sheet";
import { Skeleton } from "../../src/ui/Skeleton";
import { TabBar } from "../../src/ui/TabBar";
import { activeTabIndex, tabToLight } from "../../src/ui/tabs";

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

/**
 * A router the test can walk, rather than one screen per render.
 *
 * `renderAt` mounts the bar fresh each time, which is what a full page load
 * does — and that is the wrong shape for anything about the bar's *memory*,
 * which exists precisely to survive a navigation. Here the bar stays
 * mounted and the location moves underneath it, as it does in the app.
 */
async function renderWalking(element: ReactElement, paths: readonly string[]) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {element}
        <Outlet />
      </>
    ),
  });
  const children = paths.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      // The bar is what is under test; the screen under it is not.
      component: () => <></>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: [paths[0] ?? "/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return async (to: string) => {
    await act(async () => {
      await router.navigate({ to, reloadDocument: false });
    });
  };
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

  it("never travels to the launcher's own seat", async () => {
    // Round 12: "+ Add is a launcher, not a tab: the indicator never
    // travels to it." The third seat is at 200%, and no path produces it.
    const { unmount } = await renderAt(<TabBar />, "/runs/new");

    expect(indicator()).not.toHaveStyle({ translate: "200% 0" });
    expect(screen.getByRole("button", { name: "Add" })).toHaveClass(
      "text-label",
    );
    // The seat is still in the bar — it is the indicator that stays away,
    // not the way in. A button rather than a link, per the Accessibility
    // Contract: a launcher cannot be where you are.
    expect(screen.getByRole("button", { name: "Add" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    unmount();
  });

  it("holds the tab beneath while the flow is up (D-80)", async () => {
    // The other half of the launcher row: "the tab beneath stays
    // selected". The runner was in the closet; logging a run is laid over
    // it, so the closet is still where they are.
    const closet = await renderAt(<TabBar />, "/closet");
    expect(indicator()).toHaveStyle({ translate: "100% 0" });
    closet.unmount();

    // Every step of the flow, including the two that live under `/feed` —
    // where path ownership would otherwise hand the seat to a tab the
    // runner never tapped.
    for (const path of [
      "/runs/new",
      "/runs/manual",
      "/feed/attach/run_1",
      "/feed/verdict/entry_1",
    ]) {
      const step = await renderAt(<TabBar />, path);
      expect([path, indicator()?.getAttribute("style")]).toEqual([
        path,
        "translate: 100% 0;",
      ]);
      step.unmount();
    }

    // And it is given back the moment the flow ends somewhere real.
    await renderAt(<TabBar />, "/feed/entry/entry_1");
    expect(indicator()).toHaveStyle({ translate: "0% 0" });
  });

  it("keeps the memory current as the runner moves between tabs", async () => {
    // The record is written from an effect that depends on which tab is
    // lit. With a constant dependency list it fires once per mount — and
    // the bar is mounted for the whole session on a client navigation, so
    // the tab beneath the flow would be whichever one they opened the app
    // on, for as long as the tab stayed open.
    const go = await renderWalking(<TabBar />, [
      "/closet",
      "/feed",
      "/runs/new",
    ]);
    expect(indicator()).toHaveStyle({ translate: "100% 0" });

    await go("/feed");
    expect(indicator()).toHaveStyle({ translate: "0% 0" });

    await go("/runs/new");
    // The feed, which is where they last were — not the closet they opened
    // the app on.
    expect(indicator()).toHaveStyle({ translate: "0% 0" });
  });

  it("does not forget the tab when the runner passes somewhere the bar does not own", async () => {
    // Onboarding owns no seat, so there is nothing to record — and
    // recording it anyway would write `undefined` over a perfectly good
    // memory, leaving the flow with no tab beneath it.
    const go = await renderWalking(<TabBar />, [
      "/closet",
      "/onboarding/name",
      "/runs/new",
    ]);
    expect(indicator()).toHaveStyle({ translate: "100% 0" });

    await go("/onboarding/name");
    expect(indicator()).toBeNull();

    await go("/runs/new");
    expect(indicator()).toHaveStyle({ translate: "100% 0" });
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
    expect(resting).toHaveClass("tab-label", "text-label");
  });

  it("shows no indicator at all on a path no tab owns", async () => {
    // A tab bar still pointing at wherever you were last is a tab bar
    // that lies. Onboarding is outside the bar entirely — and outside the
    // log flow, so the memory does not apply to it either.
    await renderAt(<TabBar />, "/onboarding/name");
    expect(indicator()).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toHaveClass(
      "text-label",
    );
  });

  it("announces the held tab as the current item, never the current page", async () => {
    // The Accessibility Contract's round-12 row. Expected reading:
    // "Closet, link, current, 2 of 5" · "Add, button, dialog".
    const go = await renderWalking(<TabBar />, ["/closet", "/runs/new"]);

    // On its own page the tab is the current *page*, which is the
    // router's own attribute and not ours.
    expect(screen.getByRole("link", { name: "Closet" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await go("/runs/new");

    // Held under the flow: the current item in the set. The runner is not
    // on the closet, and saying "page" would send them to the wrong
    // screen.
    expect(screen.getByRole("link", { name: "Closet" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // "No tab is `page` during the flow; the flow screen announces
    // itself."
    for (const link of screen.getAllByRole("link")) {
      expect([link.textContent, link.getAttribute("aria-current")]).not.toEqual(
        [link.textContent, "page"],
      );
    }
    // And the launcher is never either.
    expect(screen.getByRole("button", { name: "Add" })).not.toHaveAttribute(
      "aria-current",
    );

    // Exactly one tab is held — the one they came from. "Current item in
    // the set" means one item, and a bar that marked all four would say
    // nothing while looking correct.
    for (const name of ["Feed", "Call", "You"]) {
      expect([
        name,
        screen.getByRole("link", { name }).hasAttribute("aria-current"),
      ]).toEqual([name, false]);
    }
  });

  it("marks no tab as current while the runner is on one of them", async () => {
    // The other half of "exactly one": on a tab's own page the router owns
    // the attribute and nothing else may claim it.
    await renderWalking(<TabBar />, ["/closet"]);

    for (const name of ["Feed", "Call", "You"]) {
      expect([
        name,
        screen.getByRole("link", { name }).hasAttribute("aria-current"),
      ]).toEqual([name, false]);
    }
    expect(screen.getByRole("link", { name: "Closet" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the flow from the launcher, which is not a link", async () => {
    const go = await renderWalking(<TabBar />, ["/closet", "/runs/new"]);
    expect(screen.queryByRole("link", { name: "Add" })).toBeNull();

    act(() => {
      screen.getByRole("button", { name: "Add" }).click();
    });

    // It still navigates — the flow is three routes, and `rise` is what
    // makes that read as a layer. `haspopup` describes what the runner
    // gets, not which element implements it. The navigation is not awaited
    // by the handler, so the assertion waits for the router rather than
    // the click.
    //
    // The indicator's *position* is the wrong thing to assert here: the
    // closet's seat is where it already was, so it reads the same whether
    // the click did anything or not. What only happens once the flow is up
    // is the tab being held rather than occupied.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Closet" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });
    await go("/closet");
    expect(screen.getByRole("link", { name: "Closet" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("lights nothing on a cold load straight into the flow", () => {
    // The memory is per-document, so a runner who opened `/runs/new` from
    // a link has no tab beneath — and the honest answer is none, not a
    // guess. Asserted through the pure function, because "no tab has been
    // visited yet" is a state a rendered sequence cannot get back to.
    expect(tabToLight("/runs/new", undefined)).toBeUndefined();
    expect(tabToLight("/feed/verdict/entry_1", undefined)).toBeUndefined();
    // …and the remembered tab is used only inside the flow. A post detail
    // is a real place, owned by Feed, whatever was remembered.
    expect(tabToLight("/feed/entry/entry_1", 1)).toBe(0);
    expect(tabToLight("/runs/new", 1)).toBe(1);
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

/**
 * A route change, modelled faithfully.
 *
 * Each step is its own route, so the outgoing step unmounts and the
 * incoming one mounts — but in **one commit**, which is the part an
 * `unmount()` followed by a fresh `render()` gets wrong. Keying the element
 * on the step is what reproduces it: React renders the new step (reading
 * the record), then runs the deleted subtree's cleanup, then the new
 * subtree's effect.
 *
 * The distinction is load-bearing now that leaving the flow clears the
 * record. Detached, every step would read `entering`.
 */
function step(at: number): ReactElement {
  return (
    <FlowStep key={at} step={at}>
      step {at}
    </FlowStep>
  );
}

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

  it("does not move on the way in — the router's rise is the arrival", () => {
    // Round 12: "+ Add is a launcher … a flow is a task laid on top of
    // where you were." A1 used to play the step slide here as well, which
    // is two moves on one navigation.
    render(step(LOG_FLOW.intake));

    const entered = screen.getByText(/step 1/u);
    expect(entered).toHaveAttribute("data-flow-direction", "entering");
    expect(entered).not.toHaveClass("flow-step-forward");
    expect(entered).not.toHaveClass("flow-step-back");
  });

  it("stays still when the step re-renders, however it was entered", () => {
    // **The whole screen slid when a verdict was chosen.** Arrival used to
    // be recomputed on every render from the record the step's own effect
    // had just written, so a step entered with nothing behind it rendered
    // `entering`, and its first re-render — any state change at all —
    // read "previous 3, now 3", decided `forward`, and started the 24px
    // step slide under the runner's finger.
    //
    // Every test above models a *route change*: a keyed element, so each
    // step is a new mount. None re-rendered a step in place, which is the
    // one thing a screen does all the time and the one that broke.
    const flow = render(step(LOG_FLOW.verdict));
    expect(screen.getByText(/step 3/u)).toHaveAttribute(
      "data-flow-direction",
      "entering",
    );

    // Same key, same element: what a parent's state change does.
    flow.rerender(step(LOG_FLOW.verdict));
    flow.rerender(step(LOG_FLOW.verdict));

    const still = screen.getByText(/step 3/u);
    expect(still).toHaveAttribute("data-flow-direction", "entering");
    expect(still).not.toHaveClass("flow-step-forward");
    expect(still).not.toHaveClass("flow-step-back");
  });

  it("keeps the direction it arrived with through re-renders", () => {
    // The other half: a step that *did* arrive forward keeps saying so,
    // rather than recomputing against a record that now names itself.
    const flow = render(step(LOG_FLOW.intake));
    flow.rerender(step(LOG_FLOW.attach));
    flow.rerender(step(LOG_FLOW.attach));

    const kept = screen.getByText(/step 2/u);
    expect(kept).toHaveAttribute("data-flow-direction", "forward");
    expect(kept).toHaveClass("flow-step-forward");
  });

  it("enters from the trailing edge, and reverses when you go back", () => {
    const flow = render(step(LOG_FLOW.intake));

    flow.rerender(step(LOG_FLOW.verdict));
    const forward = screen.getByText(/step 3/u);
    expect(forward).toHaveAttribute("data-flow-direction", "forward");
    expect(forward).toHaveClass("flow-step-forward");
    expect(forward).not.toHaveClass("flow-step-back");

    flow.rerender(step(LOG_FLOW.attach));
    const back = screen.getByText(/step 2/u);
    expect(back).toHaveAttribute("data-flow-direction", "back");
    expect(back).toHaveClass("flow-step-back");
    expect(back).not.toHaveClass("flow-step-forward");
  });

  it("forgets the flow once the runner leaves it", () => {
    // The bug this closes: finish at the verdict, go somewhere else, then
    // tap `+ Add` again. The record still said 3, so the intake slid in
    // backwards as if the runner had returned to it.
    const flow = render(step(LOG_FLOW.intake));
    flow.rerender(step(LOG_FLOW.verdict));
    expect(screen.getByText(/step 3/u)).toHaveClass("flow-step-forward");
    flow.unmount();

    render(step(LOG_FLOW.intake));

    expect(screen.getByText(/step 1/u)).toHaveAttribute(
      "data-flow-direction",
      "entering",
    );
  });

  it("clears only its own record, never one a later step has claimed", () => {
    // The two steps overlap for one commit on every route change: the new
    // one mounts before the old one's cleanup runs. A cleanup that cleared
    // unconditionally would wipe the record the *incoming* step had just
    // written, and the step after it would read the flow as unentered.
    const flow = render(step(LOG_FLOW.intake));
    flow.rerender(
      <>
        {step(LOG_FLOW.intake)}
        {step(LOG_FLOW.verdict)}
      </>,
    );
    // The intake leaves; the verdict stays and its record must survive.
    flow.rerender(<>{step(LOG_FLOW.verdict)}</>);

    flow.rerender(
      <>
        {step(LOG_FLOW.verdict)}
        {step(LOG_FLOW.attach)}
      </>,
    );

    expect(screen.getByText(/step 2/u)).toHaveAttribute(
      "data-flow-direction",
      "back",
    );
  });

  it("remembers a step that changed under it, not only the one it mounted with", () => {
    // The step is recorded from an effect that depends on it. With a
    // constant dependency list the effect runs once on mount and a screen
    // that swapped steps in place would leave the *next* one measuring
    // against a step nobody is on any more.
    //
    // No `key` here, deliberately: this is the same element being given a
    // new step, which is the case the dependency list exists for.
    const mounted = render(<FlowStep step={LOG_FLOW.intake}>one</FlowStep>);
    mounted.rerender(<FlowStep step={LOG_FLOW.verdict}>one</FlowStep>);

    mounted.rerender(
      <>
        <FlowStep step={LOG_FLOW.verdict}>one</FlowStep>
        <FlowStep step={LOG_FLOW.attach}>two</FlowStep>
      </>,
    );

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
    // Horizontally centred; vertically it is DS3's panel and top-aligned,
    // which is why this is `mx-auto` and not the `m-auto` it was before
    // task 115 — "a flow's first step and its fifth should start at the
    // same y", and `m-auto` centres the panel on its own height.
    expect(dialog).toHaveClass("wide:mx-auto");
    expect(dialog).not.toHaveClass("wide:m-auto");
  });
});
