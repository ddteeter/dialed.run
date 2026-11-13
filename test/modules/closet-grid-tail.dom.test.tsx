import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PHONE_TRACKS,
  isRowFull,
  trackCount,
  useIsRowFull,
} from "../../src/modules/closet/components/grid-tail";

/**
 * Round 55 · 187: where the closet's Add cell goes, which depends on how
 * many tracks `auto-fill` laid out. happy-dom lays nothing out, so the
 * computed template and the resize are driven by hand here; the real
 * widths are measured in e2e/conformance/closet-empty.conformance.spec.ts.
 */
describe("trackCount", () => {
  it("counts the resolved tracks of a laid-out grid", () => {
    expect(trackCount("190px 190px 190px")).toBe(3);
    expect(trackCount("171px 171px")).toBe(2);
    expect(trackCount("200px")).toBe(1);
  });

  it("keeps the phone's two when the grid reports nothing", () => {
    expect(PHONE_TRACKS).toBe(2);
    expect(trackCount("")).toBe(2);
    expect(trackCount(" ")).toBe(2);
  });
});

describe("isRowFull", () => {
  it("is full when the count fills the last row, and for no pieces", () => {
    expect(isRowFull(0, 2)).toBe(true);
    expect(isRowFull(4, 2)).toBe(true);
    expect(isRowFull(6, 3)).toBe(true);
  });

  it("has room when the last row is short", () => {
    expect(isRowFull(1, 2)).toBe(false);
    expect(isRowFull(7, 3)).toBe(false);
    expect(isRowFull(4, 5)).toBe(false);
  });
});

/**
What the stubbed layout reports, and the resize callback it was given.
*/
const layout: { template: string; resize: (() => void) | undefined } = {
  template: "",
  resize: undefined,
};
const disconnect = vi.fn();

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = disconnect;
  constructor(callback: () => void) {
    layout.resize = callback;
  }
}

function stubLayout() {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => {
    const { style } = document.createElement("ul");
    style.gridTemplateColumns = layout.template;
    return style;
  });
}

function Probe({ count }: Readonly<{ count: number }>) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const isFull = useIsRowFull(listRef, count);
  return (
    <ul ref={listRef} data-full={String(isFull)}>
      <li>cell</li>
    </ul>
  );
}

describe("useIsRowFull", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    layout.template = "";
    layout.resize = undefined;
    disconnect.mockClear();
  });

  it("measures the grid on mount and again when its width changes", () => {
    stubLayout();
    layout.template = "190px 190px 190px";
    render(<Probe count={3} />);
    const list = screen.getByRole("list");
    // Three pieces on three tracks fill the row.
    expect(list).toHaveAttribute("data-full", "true");

    layout.template = "190px 190px 190px 190px";
    act(() => {
      layout.resize?.();
    });
    // Four tracks leave room beside the third piece.
    expect(list).toHaveAttribute("data-full", "false");
  });

  it("starts from the phone's two tracks before it can measure", () => {
    stubLayout();
    render(<Probe count={1} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-full", "false");
  });

  it("stops watching when the grid goes", () => {
    stubLayout();
    const { unmount } = render(<Probe count={2} />);
    // The previous test's grid is cleaned up after its own hooks run.
    disconnect.mockClear();
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
