import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhotoPager } from "../../src/modules/feed/components/PhotoPager";

/**
 * D's pager (R55·207): each photo at 4:5 with its counter bottom right;
 * at desk capped at 560 and centred on --photo, with the shared arrows
 * inside the photo's edges and ← → wherever focus is inside it.
 */
const KEYS = ["user/01/a.jpg", "user/01/b.jpg", "user/01/c.jpg"];

function pager(): HTMLElement {
  return screen.getByRole("group", { name: "Photos" });
}

function row(): HTMLElement {
  const element = pager().querySelector<HTMLElement>('[data-part="photo"]');
  if (element === null) throw new Error("no row");
  return element;
}

function nextButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Next photo" });
}

function previousButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Previous photo" });
}

/**
 * Lays the row's items out as a browser would: one 620 column apart.
 */
const WIDTH = 620;

function layOut(): void {
  for (const [index, item] of [...row().children].entries()) {
    Object.defineProperty(item, "offsetLeft", {
      configurable: true,
      value: index * WIDTH,
    });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PhotoPager", () => {
  it("draws nothing with no photos", () => {
    const { container } = render(
      <PhotoPager photoKeys={[]} deletePhoto={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is one 4:5 slot per photo, served from D's route, each with its own counter", () => {
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    const slots = pager().querySelectorAll('[data-part="photo-slot"]');
    expect(slots).toHaveLength(3);
    for (const [index, slot] of [...slots].entries()) {
      expect(slot).toHaveClass(
        "aspect-4/5",
        "w-full",
        "desk:h-full",
        "desk:w-auto",
      );
      expect(slot.querySelector("img")).toHaveAttribute(
        "src",
        `/feed/photo/${KEYS[index] ?? ""}`,
      );
      expect(
        within(slot as HTMLElement).getByText(`${String(index + 1)} / 3`),
      ).toBeVisible();
    }
  });

  it("serves from the caller's place when told to", () => {
    render(
      <PhotoPager
        photoKeys={["k/1.jpg"]}
        deletePhoto={undefined}
        srcOf={(key) => `https://photos.example/${key}`}
      />,
    );
    expect(pager().querySelector("img")).toHaveAttribute(
      "src",
      "https://photos.example/k/1.jpg",
    );
  });

  it("swipes as a snapping row, and at desk frames each photo 560 tall on --photo", () => {
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    expect(row()).toHaveClass(
      "flex",
      "snap-x",
      "snap-mandatory",
      "overflow-x-auto",
      "gap-2",
    );
    const item = row().firstElementChild;
    expect(item).toHaveClass(
      "w-full",
      "shrink-0",
      "snap-start",
      "desk:flex",
      "desk:h-140",
      "desk:justify-center",
      "desk:rounded-card",
      "desk:bg-photo",
    );
  });

  it("sets the arrows over the shown photo's box, taking only their own presses", () => {
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    const box = nextButton()?.parentElement;
    expect(box).toHaveClass(
      "pointer-events-none",
      "absolute",
      "inset-y-0",
      "left-1/2",
      "aspect-4/5",
      "-translate-x-1/2",
      "*:pointer-events-auto",
    );
    expect(nextButton()).toHaveClass("desk:flex", "hidden");
  });

  it("has no arrows for a lone photo, nor a counter", () => {
    render(<PhotoPager photoKeys={["k/1.jpg"]} deletePhoto={undefined} />);
    expect(nextButton()).toBeNull();
    expect(previousButton()).toBeNull();
    expect(within(pager()).queryByText(/\d \/ \d/u)).toBeNull();
  });

  it("turns the row to the next photo, instantly", () => {
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    layOut();
    const scrollTo = vi.fn();
    row().scrollTo = scrollTo;

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 620 });
    expect(previousButton()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1240 });
    expect(nextButton()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 620 });
  });

  it("turns on ← and → from anywhere inside it", () => {
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    layOut();
    const scrollTo = vi.fn();
    row().scrollTo = scrollTo;

    fireEvent.keyDown(screen.getByRole("button", { name: "Next photo" }), {
      key: "ArrowRight",
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 620 });
    fireEvent.keyDown(row(), { key: "ArrowLeft" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0 });
    expect(previousButton()).toBeNull();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("stops listening for keys once it is gone", () => {
    const { unmount } = render(
      <PhotoPager photoKeys={KEYS} deletePhoto={undefined} />,
    );
    const group = pager();
    const remove = vi.spyOn(group, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("follows a swipe: the page nearest the row's scroll is the one shown", () => {
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    layOut();
    row().scrollLeft = 1200;
    fireEvent.scroll(row());
    expect(nextButton()).toBeNull();
    expect(previousButton()).not.toBeNull();

    row().scrollLeft = 700;
    fireEvent.scroll(row());
    expect(nextButton()).not.toBeNull();
    expect(previousButton()).not.toBeNull();

    row().scrollLeft = 200;
    fireEvent.scroll(row());
    expect(previousButton()).toBeNull();
  });

  it("puts the owner's delete on each photo, and none for anyone else", () => {
    const deletePhoto = vi.fn();
    const { unmount } = render(
      <PhotoPager photoKeys={KEYS} deletePhoto={deletePhoto} />,
    );
    const slots = pager().querySelectorAll('[data-part="photo-slot"]');
    for (const slot of slots) {
      expect(
        within(slot as HTMLElement).getByRole("button", { name: /Delete/u }),
      ).toBeVisible();
    }
    unmount();
    render(<PhotoPager photoKeys={KEYS} deletePhoto={undefined} />);
    expect(screen.queryByRole("button", { name: /Delete/u })).toBeNull();
  });
});
