import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { Digits } from "../../src/ui/Digits";
import { FlowStep, LOG_FLOW, directionBetween } from "../../src/ui/FlowStep";
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
    for (const [path, offset] of [
      ["/feed", "0% 0"],
      ["/closet", "100% 0"],
      ["/runs/new", "200% 0"],
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

  it("gives a descendant path to the longest tab that matches it", () => {
    const tabs = [{ to: "/feed" }, { to: "/closet" }, { to: "/feed/me" }];
    // The reason this is a function: `/feed/me` is a descendant of
    // `/feed`, so first-match-wins lights the Feed tab while the runner
    // is looking at their own profile.
    expect(activeTabIndex("/feed/me", tabs)).toBe(2);
    expect(activeTabIndex("/feed/entry/01H", tabs)).toBe(0);
    expect(activeTabIndex("/feed", tabs)).toBe(0);
    // A route, not a prefix: `/feed` must not claim `/feedback`.
    expect(activeTabIndex("/feedback", tabs)).toBeUndefined();
    expect(activeTabIndex("/runs/manual", tabs)).toBeUndefined();
  });
});

describe("Log flow step: direction carries which way you are going", () => {
  it("is forward from nothing, forward up the flow, back down it", () => {
    // "Direction tells you which way you are travelling through the flow,
    // so Back feels like back."
    expect(directionBetween(undefined, LOG_FLOW.verdict)).toBe("forward");
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
    const first = render(
      <FlowStep step={LOG_FLOW.intake}>intake</FlowStep>,
    );
    expect(screen.getByText("intake")).toHaveClass("flow-step-forward");
    await waitFor(() => {
      expect(screen.getByText("intake")).toBeInTheDocument();
    });
    first.unmount();

    const second = render(
      <FlowStep step={LOG_FLOW.verdict}>verdict</FlowStep>,
    );
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
});

describe("Numbers & temps: the digits roll", () => {
  it("shows the count and nothing else until it changes", () => {
    const { container } = render(<Digits value={7} />);
    expect(container.textContent).toBe("7");
    // No animation on first paint: a page load is not a change.
    expect(container.querySelector(".digit-in-up")).toBeNull();
    expect(container.querySelector(".digit-slot")).toBeInTheDocument();
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

  it("takes the caller's class alongside its own slot", () => {
    const { container } = render(<Digits value={2} className="text-quiet" />);
    expect(container.firstElementChild).toHaveClass(
      "digit-slot",
      "text-quiet",
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
