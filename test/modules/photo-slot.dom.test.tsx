import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PhotoCounter,
  PhotoSlot,
} from "../../src/modules/feed/components/PhotoSlot";

/**
 * R55·206–207: a photo's slot is `--photo` at its ratio while it loads,
 * and the hatch with "Photo didn't load" when it fails, with the img and
 * the counter hidden. The counter is bottom right in ink on a --ground
 * chip, from two photos.
 */
function slot(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    "[data-part='photo'], [data-part='photo-slot']",
  );
  if (element === null) throw new Error("no slot");
  return element;
}

function img(): HTMLImageElement {
  const element = slot().querySelector("img");
  if (element === null) throw new Error("no img");
  return element;
}

/**
 * How many times `src` was set to the photo: once by React's render, and
 * once more if the slot asked again.
 */
function srcSets(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(
    ([name, value]) => name === "src" && value === "/feed/photo/b.jpg",
  ).length;
}

/**
 * `src` sets while one slot mounts: React's own, plus one if it asked
 * again. React's count is whatever it is; the difference is the retry.
 */
function srcSetsOnMount(): number {
  const setAttribute = vi.spyOn(HTMLImageElement.prototype, "setAttribute");
  const { unmount } = render(
    <PhotoSlot src="/feed/photo/b.jpg" shape="portrait" />,
  );
  unmount();
  const count = srcSets(setAttribute);
  setAttribute.mockRestore();
  return count;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PhotoSlot", () => {
  it("is --photo at 4:5 while the photo loads, the img filling it", () => {
    render(<PhotoSlot src="/feed/photo/a.jpg" shape="portrait" />);
    expect(slot()).toHaveAttribute("data-state", "shown");
    expect(slot()).toHaveClass(
      "relative",
      "block",
      "overflow-hidden",
      "rounded-card",
      "aspect-4/5",
      "bg-photo",
    );
    expect(slot()).not.toHaveClass("photo-hatch");
    // Nothing else: no caller's classes means none added.
    expect(slot().className.split(" ").filter(Boolean)).toStrictEqual([
      "relative",
      "block",
      "overflow-hidden",
      "rounded-card",
      "aspect-4/5",
      "bg-photo",
    ]);
    expect(img()).toHaveAttribute("src", "/feed/photo/a.jpg");
    expect(img()).toHaveAttribute("alt", "");
    expect(img()).toHaveClass("size-full", "object-cover");
    expect(img()).not.toHaveAttribute("hidden");
    expect(screen.queryByText("Photo didn't load")).toBeNull();
  });

  it("is square on the public tile, and takes the caller's classes", () => {
    render(<PhotoSlot src="/a.jpg" shape="square" className="w-full" />);
    expect(slot()).toHaveClass("aspect-square", "w-full");
    expect(slot()).not.toHaveClass("aspect-4/5");
  });

  it("hatches and says so when the photo fails, hiding the img and the counter", () => {
    render(
      <PhotoSlot src="/a.jpg" shape="portrait" overlay={<span>counter</span>}>
        <button type="button">Delete</button>
      </PhotoSlot>,
    );
    expect(screen.getByText("counter")).toBeVisible();
    fireEvent.error(img());

    expect(slot()).toHaveAttribute("data-state", "failed");
    expect(slot()).toHaveClass("photo-hatch");
    expect(slot()).not.toHaveClass("bg-photo");
    expect(img()).toHaveAttribute("hidden");
    const note = screen.getByText("Photo didn't load");
    expect(note).toHaveClass("text-mono-xs");
    expect(note.parentElement).toHaveClass(
      "absolute",
      "bottom-3",
      "left-3",
      "text-muted",
    );
    expect(note.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("counter")).toBeNull();
    // The owner's delete stays: a failed photo is still theirs to remove.
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("asks again on mount only for a photo that finished with nothing", () => {
    // happy-dom's img is `complete` with no width, as a failed one is.
    const failedEarly = srcSetsOnMount();

    const width = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(400);
    const loaded = srcSetsOnMount();
    width.mockRestore();

    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      false,
    );
    const onItsWay = srcSetsOnMount();

    expect(failedEarly).toBe(loaded + 1);
    expect(onItsWay).toBe(loaded);
  });
});

describe("PhotoSlot's second ask", () => {
  it("asks again for a new source, and lets go cleanly", () => {
    const setAttribute = vi.spyOn(HTMLImageElement.prototype, "setAttribute");
    const { rerender, unmount } = render(
      <PhotoSlot src="/feed/photo/b.jpg" shape="portrait" />,
    );
    const first = srcSets(setAttribute);
    rerender(<PhotoSlot src="/feed/photo/b.jpg" shape="portrait" />);
    // The same source on a later render is not fetched again.
    expect(srcSets(setAttribute)).toBe(first);
    rerender(<PhotoSlot src="/feed/photo/c.jpg" shape="portrait" />);
    const forC = setAttribute.mock.calls.filter(
      ([name, value]) => name === "src" && value === "/feed/photo/c.jpg",
    ).length;
    // React's own set on the update, and the slot's second ask for it.
    expect(forC).toBe(2);
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});

describe("PhotoCounter", () => {
  it("is absent for a lone photo", () => {
    const { container } = render(<PhotoCounter index={0} count={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says its place bottom right, in ink on a --ground chip", () => {
    render(<PhotoCounter index={1} count={3} />);
    const text = screen.getByText("2 / 3");
    expect(text).toHaveClass("text-mono-xs");
    expect(text.parentElement).toHaveAttribute("data-part", "photo-counter");
    expect(text.parentElement).toHaveClass(
      "absolute",
      "right-3",
      "bottom-3",
      "rounded-pill",
      "bg-ground",
      "px-2",
      "py-1",
      "text-ink",
    );
  });
});

describe("PhotoSlot's part", () => {
  it("is the boards' photo by default, and the pager's photo-slot when asked", () => {
    const { unmount } = render(<PhotoSlot src="/a.jpg" shape="portrait" />);
    expect(slot()).toHaveAttribute("data-part", "photo");
    unmount();
    render(<PhotoSlot src="/a.jpg" shape="portrait" part="photo-slot" />);
    expect(slot()).toHaveAttribute("data-part", "photo-slot");
  });
});
