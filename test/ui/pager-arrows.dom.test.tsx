import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PagerArrows, pagerKeys } from "../../src/ui/PagerArrows";

const LABELS = { previous: "Previous photo", next: "Next photo" };

/**
 * A caller that owns the index, as D's pager and the viewer do.
 */
function Pager({
  count,
  start = 0,
  from = "desk",
}: Readonly<{ count: number; start?: number; from?: "wide" | "desk" }>) {
  const [index, setIndex] = useState(start);
  return (
    <div className="relative" onKeyDown={pagerKeys(index, count, setIndex)}>
      <output>{String(index)}</output>
      <PagerArrows
        index={index}
        count={count}
        onIndex={setIndex}
        from={from}
        labels={LABELS}
      />
    </div>
  );
}

/**
 * A pager beside another control that re-renders the page.
 */
function Host() {
  const [index, setIndex] = useState(0);
  const [renders, setRenders] = useState(0);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setRenders(renders + 1);
        }}
      >
        Elsewhere {String(renders)}
      </button>
      <PagerArrows
        index={index}
        count={2}
        onIndex={setIndex}
        from="desk"
        labels={LABELS}
      />
    </div>
  );
}

function previous(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Previous photo" });
}

function next(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Next photo" });
}

describe("PagerArrows (R55·207, Design 249.1)", () => {
  it("draws nothing for one photo", () => {
    const { container } = render(
      <PagerArrows
        index={0}
        count={1}
        onIndex={vi.fn()}
        from="desk"
        labels={LABELS}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing with no photos at all", () => {
    const { container } = render(
      <PagerArrows
        index={0}
        count={0}
        onIndex={vi.fn()}
        from="desk"
        labels={LABELS}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hands focus to Previous at the last of three, where both were mounted", () => {
    render(<Pager count={3} start={1} />);
    const button = screen.getByRole("button", { name: "Next photo" });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("status")).toHaveTextContent("2");
    expect(previous()).toHaveFocus();
  });

  it("takes focus once per hand-off, not on every later render", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(previous()).toHaveFocus();
    const elsewhere = screen.getByRole("button", { name: /Elsewhere/u });
    elsewhere.focus();
    fireEvent.click(elsewhere);
    expect(screen.getByRole("button", { name: "Elsewhere 1" })).toHaveFocus();
  });

  it("shows only Next on the first photo, both in the middle, only Previous on the last", () => {
    const { unmount } = render(<Pager count={3} />);
    expect(previous()).toBeNull();
    expect(next()).not.toBeNull();
    unmount();

    const middle = render(<Pager count={3} start={1} />);
    expect(previous()).not.toBeNull();
    expect(next()).not.toBeNull();
    middle.unmount();

    render(<Pager count={3} start={2} />);
    expect(previous()).not.toBeNull();
    expect(next()).toBeNull();
  });

  it("draws the 44 round ground buttons with a hairline inside each edge", () => {
    render(<Pager count={3} start={1} />);
    for (const button of [previous(), next()]) {
      expect(button).toHaveClass(
        "target",
        "absolute",
        "top-1/2",
        "-translate-y-1/2",
        "size-11",
        "rounded-pill",
        "border",
        "border-hairline",
        "bg-ground",
        "text-ink",
        "items-center",
        "justify-center",
      );
      expect(button).toHaveAttribute("type", "button");
    }
    expect(previous()).toHaveClass("left-3");
    expect(previous()).not.toHaveClass("right-3");
    expect(next()).toHaveClass("right-3");
    expect(next()).not.toHaveClass("left-3");
  });

  it("shows from desk for D and from wide for the viewer, hidden below", () => {
    const { unmount } = render(<Pager count={2} />);
    expect(next()).toHaveClass("hidden", "desk:flex");
    expect(next()).not.toHaveClass("wide:flex");
    unmount();
    render(<Pager count={2} from="wide" />);
    expect(next()).toHaveClass("hidden", "wide:flex");
    expect(next()).not.toHaveClass("desk:flex");
  });

  it("names its buttons with the caller's words", () => {
    render(
      <PagerArrows
        index={1}
        count={3}
        onIndex={vi.fn()}
        from="desk"
        labels={{ previous: "Back a page", next: "On a page" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Back a page" })).toBeVisible();
    expect(screen.getByRole("button", { name: "On a page" })).toBeVisible();
  });

  it("turns one page each way", () => {
    const onIndex = vi.fn();
    render(
      <PagerArrows
        index={1}
        count={3}
        onIndex={onIndex}
        from="desk"
        labels={LABELS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onIndex).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(onIndex).toHaveBeenLastCalledWith(0);
    expect(onIndex).toHaveBeenCalledTimes(2);
  });

  it("moves focus to Previous when Next leaves at the last photo, even with two", () => {
    render(<Pager count={2} />);
    const button = screen.getByRole("button", { name: "Next photo" });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("status")).toHaveTextContent("1");
    expect(next()).toBeNull();
    expect(previous()).toHaveFocus();
  });

  it("moves focus to Next when Previous leaves at the first photo", () => {
    render(<Pager count={3} start={1} />);
    const button = screen.getByRole("button", { name: "Previous photo" });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("status")).toHaveTextContent("0");
    expect(previous()).toBeNull();
    expect(next()).toHaveFocus();
  });

  it("leaves focus where it is when the pressed button stays", () => {
    render(<Pager count={4} />);
    const nextButton = screen.getByRole("button", { name: "Next photo" });
    nextButton.focus();
    fireEvent.click(nextButton);
    expect(screen.getByRole("status")).toHaveTextContent("1");
    expect(nextButton).toHaveFocus();
    const previousButton = screen.getByRole("button", {
      name: "Previous photo",
    });
    previousButton.focus();
    fireEvent.click(nextButton);
    // Next pressed by pointer while Previous holds focus: Previous stays.
    expect(screen.getByRole("status")).toHaveTextContent("2");
    expect(previousButton).toHaveFocus();
  });
});

/**
 * One key on an element wired with `pagerKeys` at `index` of three.
 * `fireEvent` answers false when the default was stopped.
 */
function press(
  key: string,
  index: number,
): { onIndex: ReturnType<typeof vi.fn>; isPrevented: boolean } {
  const onIndex = vi.fn();
  const { unmount } = render(
    <div data-testid="pager" onKeyDown={pagerKeys(index, 3, onIndex)} />,
  );
  const isPrevented = !fireEvent.keyDown(screen.getByTestId("pager"), {
    key,
  });
  unmount();
  return { onIndex, isPrevented };
}

describe("pagerKeys", () => {
  it("turns a page on → and ←, and stops the key's default", () => {
    const right = press("ArrowRight", 1);
    expect(right.onIndex).toHaveBeenCalledWith(2);
    expect(right.isPrevented).toBe(true);
    const left = press("ArrowLeft", 1);
    expect(left.onIndex).toHaveBeenCalledWith(0);
    expect(left.isPrevented).toBe(true);
  });

  it("does nothing at an end, and leaves the key's default", () => {
    const right = press("ArrowRight", 2);
    expect(right.onIndex).not.toHaveBeenCalled();
    expect(right.isPrevented).toBe(false);
    const left = press("ArrowLeft", 0);
    expect(left.onIndex).not.toHaveBeenCalled();
    expect(left.isPrevented).toBe(false);
  });

  it("ignores every other key", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Tab"]) {
      const result = press(key, 1);
      expect(result.onIndex).not.toHaveBeenCalled();
      expect(result.isPrevented).toBe(false);
    }
  });

  it("turns the page from the keyboard in a real pager", () => {
    render(<Pager count={3} />);
    const status = screen.getByRole("status");
    fireEvent.keyDown(status, { key: "ArrowRight" });
    expect(status).toHaveTextContent("1");
    fireEvent.keyDown(status, { key: "ArrowRight" });
    fireEvent.keyDown(status, { key: "ArrowRight" });
    expect(status).toHaveTextContent("2");
    fireEvent.keyDown(status, { key: "ArrowLeft" });
    expect(status).toHaveTextContent("1");
  });
});
