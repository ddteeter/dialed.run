import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DURATION, EASING, shouldReduceMotion } from "../../src/ui/motion";
import {
  departedKeys,
  movesBetween,
  reflowFrames,
  reflowTiming,
  useListMotion,
} from "../../src/ui/use-list-motion";

/**
 * The closet's two list surfaces — "items reflow to new positions" and
 * "row collapses its own height".
 *
 * happy-dom cannot run an animation, so what is asserted is what is
 * decided: which rows are still in the list, which are marked as leaving,
 * and exactly what is handed to `Element.animate`. The last one is the
 * part a class-string assertion could never reach, because the travel is
 * measured rather than written.
 */

/**
 * A rect for a row whose position the test controls through `data-y`.
 *
 * happy-dom lays nothing out — every rect is zeroes — so a FLIP measured
 * against it computes no movement at all and every assertion below would
 * pass against a hook that did nothing.
 */
function layOut(): void {
  Object.defineProperty(HTMLLIElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLLIElement) {
      return { x: 0, y: Number(this.dataset.y ?? "0") };
    },
  });
}

interface Row {
  id: string;
  y: number;
}

function Harness({ items }: Readonly<{ items: readonly Row[] }>) {
  const { shown, leaving, listRef } = useListMotion(items, (row) => row.id);
  return (
    <ul ref={listRef}>
      {shown.map((row) => (
        <li
          key={row.id}
          data-testid={row.id}
          data-y={String(row.y)}
          className="collapsing-row"
          data-leaving={leaving.has(row.id) ? "true" : undefined}
        />
      ))}
    </ul>
  );
}

const THREE: readonly Row[] = [
  { id: "a", y: 0 },
  { id: "b", y: 100 },
  { id: "c", y: 200 },
];

/**
`b` retired and hidden: `c` moves up into its place.
*/
const WITHOUT_B: readonly Row[] = [
  { id: "a", y: 0 },
  { id: "c", y: 100 },
];

/**
 * The spy the rows are animated through, replaced per test.
 *
 * A one-field object rather than a bare `let`, because assigning to a
 * module variable from inside a function is a lint error and a `beforeEach`
 * is exactly such a function.
 */
const spy: { animate: ReturnType<typeof vi.fn> } = { animate: vi.fn() };

beforeEach(() => {
  layOut();
  spy.animate = vi.fn();
  Object.defineProperty(HTMLLIElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: spy.animate,
  });
});

afterEach(() => {
  vi.useRealTimers();
  // `Reflect.deleteProperty`, not `delete`: the DOM types declare
  // `animate` as always present, so the operator needs a suppression and
  // the reflective form does not.
  Reflect.deleteProperty(HTMLLIElement.prototype, "animate");
});

describe("movesBetween", () => {
  it("inverts the delta for everything that moved", () => {
    const moved = document.createElement("li");
    const moves = movesBetween(
      new Map([[moved, { x: 10, y: 200 }]]),
      new Map([[moved, { x: 4, y: 100 }]]),
    );
    // "Invert": the row is already at its new place, so the animation
    // starts by putting it back where it was — +6 and +100, not -6/-100.
    expect(moves).toEqual([{ node: moved, dx: 6, dy: 100 }]);
  });

  it("skips a row that did not move, so nothing animates on a no-op", () => {
    const still = document.createElement("li");
    const before = new Map([[still, { x: 3, y: 7 }]]);
    expect(movesBetween(before, new Map([[still, { x: 3, y: 7 }]]))).toEqual(
      [],
    );
    // One axis is enough to count as a move: a two-column grid re-packs
    // sideways without anything changing height.
    expect(
      movesBetween(before, new Map([[still, { x: 9, y: 7 }]])),
    ).toHaveLength(1);
    expect(
      movesBetween(before, new Map([[still, { x: 3, y: 9 }]])),
    ).toHaveLength(1);
  });

  it("skips a row that was not there before — no fade, no re-enter", () => {
    const arrived = document.createElement("li");
    expect(
      movesBetween(new Map(), new Map([[arrived, { x: 0, y: 40 }]])),
    ).toEqual([]);
  });
});

describe("reflowFrames and reflowTiming", () => {
  it("travels to the doctrine's move/snap when motion is allowed", () => {
    expect(reflowFrames({ dx: -6, dy: 100 }, false)).toEqual([
      { translate: "-6px 100px" },
      { translate: "0 0" },
    ]);
    expect(reflowTiming(false)).toEqual({
      duration: DURATION.move,
      easing: EASING.snap,
    });
  });

  it("collapses to a 90ms opacity change, and never to nothing", () => {
    // REDUCED_MOTION: "every move collapses to a 90ms opacity change …
    // never reduce to zero". A dip and back, because the row is still in
    // the list and always was.
    const frames = reflowFrames({ dx: -6, dy: 100 }, true);
    expect(frames).toEqual([{ opacity: 0.35 }, { opacity: 1 }]);
    expect(JSON.stringify(frames)).not.toContain("translate");
    expect(reflowTiming(true)).toEqual({
      duration: DURATION.instant,
      easing: "linear",
    });
    expect(DURATION.instant).toBe(90);
  });
});

describe("departedKeys", () => {
  it("names what left, and nothing else", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect([
      ...departedKeys(rows, [{ id: "a" }, { id: "c" }], (row) => row.id),
    ]).toEqual(["b"]);
    expect(departedKeys(rows, rows, (row) => row.id).size).toBe(0);
    // An arrival is not a departure: showing retired items adds rows and
    // takes none away.
    expect(departedKeys([{ id: "a" }], rows, (row) => row.id).size).toBe(0);
  });
});

describe("useListMotion", () => {
  it("holds a departing row, marked, for one `move` before dropping it", async () => {
    const { rerender } = render(<Harness items={THREE} />);

    rerender(<Harness items={WITHOUT_B} />);

    // Still there, and saying so: the row cannot collapse its own height
    // if it has already been unmounted.
    const leaving = screen.getByTestId("b");
    expect(leaving).toHaveAttribute("data-leaving", "true");
    expect(leaving).toHaveClass("collapsing-row");
    // The rows that stayed are not marked, or they would collapse too.
    expect(screen.getByTestId("c")).not.toHaveAttribute("data-leaving");

    await waitFor(() => {
      expect(screen.queryByTestId("b")).toBeNull();
    });
  });

  it("reflows the survivors from where the collapse left them", async () => {
    const { rerender } = render(<Harness items={THREE} />);
    spy.animate.mockClear();

    rerender(<Harness items={WITHOUT_B} />);
    await waitFor(() => {
      expect(screen.queryByTestId("b")).toBeNull();
    });

    // `a` did not move, so it is not animated at all; `c` came up 100px
    // into the space `b` left.
    expect(spy.animate).toHaveBeenCalledTimes(1);
    expect(spy.animate).toHaveBeenCalledWith(
      [{ translate: "0px 100px" }, { translate: "0 0" }],
      { duration: DURATION.move, easing: EASING.snap },
    );
  });

  it("reflows immediately when rows arrive, with no hold and no re-enter", async () => {
    const { rerender } = render(<Harness items={WITHOUT_B} />);
    spy.animate.mockClear();

    rerender(<Harness items={THREE} />);

    // Nothing left, so nothing is held: `c` is at its new place already.
    expect(screen.getByTestId("b")).not.toHaveAttribute("data-leaving");
    await waitFor(() => {
      expect(spy.animate).toHaveBeenCalledTimes(1);
    });
    // `b` arrived and is not animated — it has nowhere to have come from.
    expect(spy.animate).toHaveBeenCalledWith(
      [{ translate: "0px -100px" }, { translate: "0 0" }],
      { duration: DURATION.move, easing: EASING.snap },
    );
  });

  it("does nothing at all when the list has not changed", () => {
    const { rerender } = render(<Harness items={THREE} />);
    spy.animate.mockClear();
    rerender(<Harness items={[...THREE]} />);
    expect(spy.animate).not.toHaveBeenCalled();
  });

  it("survives a browser with no Web Animations API", async () => {
    Reflect.deleteProperty(HTMLLIElement.prototype, "animate");
    const { rerender } = render(<Harness items={THREE} />);

    rerender(<Harness items={WITHOUT_B} />);

    // Law 5: the filter still works, it just does not move.
    await waitFor(() => {
      expect(screen.queryByTestId("b")).toBeNull();
    });
    expect(screen.getByTestId("c")).toBeInTheDocument();
  });

  it("collapses the reflow when the viewer asked for reduced motion", async () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      const { rerender } = render(<Harness items={THREE} />);
      spy.animate.mockClear();

      rerender(<Harness items={WITHOUT_B} />);
      await waitFor(() => {
        expect(spy.animate).toHaveBeenCalledTimes(1);
      });

      expect(spy.animate).toHaveBeenCalledWith(
        [{ opacity: 0.35 }, { opacity: 1 }],
        { duration: DURATION.instant, easing: "linear" },
      );
      expect(matchMedia).toHaveBeenCalledWith(
        "(prefers-reduced-motion: reduce)",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("shouldReduceMotion", () => {
  it("reads the media query when there is one", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(shouldReduceMotion()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(shouldReduceMotion()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("treats a missing matchMedia as no preference, not as reduce", () => {
    // The server has none, and neither does every test environment.
    // Defaulting the other way would silently switch the whole product
    // to its collapsed moves.
    vi.stubGlobal("matchMedia", undefined);
    expect(shouldReduceMotion()).toBe(false);
    vi.unstubAllGlobals();
  });
});
