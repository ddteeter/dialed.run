import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PhotoViewer } from "../../src/ui/PhotoViewer";

/**
 * The full photo (Round 56 · 249.1, 249.3): the head's counter, the pager
 * (arrows, ← → keys, a swipe), every way it closes, and Remove.
 */
const photos = [
  { src: "/a.jpg", alt: "First kit" },
  { src: "/b.jpg", alt: "Second kit" },
  { src: "/c.jpg", alt: "Third kit" },
];

function renderViewer(openAt = 0, shown = photos) {
  const onClose = vi.fn();
  const onRemove = vi.fn();
  render(
    <PhotoViewer
      photos={shown}
      openAt={openAt}
      onClose={onClose}
      onRemove={onRemove}
    />,
  );
  const dialog = screen.getByRole("dialog");
  return { onClose, onRemove, dialog };
}

/**
The photo row, given a width so a scroll position means a photo.
*/
function rowOf(dialog: HTMLElement, width = 400): HTMLElement {
  const row = dialog.querySelector<HTMLElement>("[data-part=viewer-photos]");
  if (row === null) throw new Error("no photo row");
  Object.defineProperty(row, "clientWidth", { value: width });
  return row;
}

describe("PhotoViewer", () => {
  it("opens modal on the photo it was asked for, named by its counter", () => {
    const { dialog } = renderViewer(1);
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAccessibleName("Photo 2 of 3");
    expect(dialog).toHaveTextContent("Photo 2 of 3");
    // Only the photo shown is in the accessibility tree.
    expect(screen.getByRole("img", { name: "Second kit" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First kit" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Third kit" })).toBeNull();
  });

  it("keeps an out-of-range start inside the row", () => {
    expect(renderViewer(7).dialog).toHaveAccessibleName("Photo 3 of 3");
  });

  it("keeps a negative start inside the row", () => {
    expect(renderViewer(-2).dialog).toHaveAccessibleName("Photo 1 of 3");
  });

  it("scrolls the row to the photo it opened on", () => {
    // The width is only known once mounted, so stub it on the prototype.
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(300);
    const { dialog } = renderViewer(2);
    width.mockRestore();
    expect(
      dialog.querySelector<HTMLElement>("[data-part=viewer-photos]")
        ?.scrollLeft,
    ).toBe(600);
  });

  it("pages with the arrows, each absent at its end", async () => {
    const user = userEvent.setup();
    const { dialog } = renderViewer(0);
    const row = rowOf(dialog);
    const previous = () =>
      screen.queryByRole("button", { name: "Previous photo" });
    const next = () => screen.getByRole("button", { name: "Next photo" });
    expect(previous()).toBeNull();

    await user.click(next());
    expect(dialog).toHaveAccessibleName("Photo 2 of 3");
    expect(row.scrollLeft).toBe(400);
    expect(previous()).not.toBeNull();

    await user.click(next());
    expect(dialog).toHaveAccessibleName("Photo 3 of 3");
    expect(row.scrollLeft).toBe(800);
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();

    const back = previous();
    if (back === null) throw new Error("no previous arrow");
    await user.click(back);
    expect(dialog).toHaveAccessibleName("Photo 2 of 3");
    expect(row.scrollLeft).toBe(400);
  });

  it("pages with the ← → keys and ignores others", () => {
    const { dialog } = renderViewer(1);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(dialog).toHaveAccessibleName("Photo 3 of 3");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(dialog).toHaveAccessibleName("Photo 1 of 3");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(dialog).toHaveAccessibleName("Photo 1 of 3");
  });

  it("scrolls in a region named Photos that a keyboard reaches and pages from", () => {
    const { dialog } = renderViewer(0);
    const region = screen.getByRole("region", { name: "Photos" });
    expect(region).toBe(rowOf(dialog));
    expect(region).toContainElement(screen.getByRole("list"));
    region.focus();
    expect(region).toHaveFocus();
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(dialog).toHaveAccessibleName("Photo 2 of 3");
  });

  it("follows a swipe, rounding to the nearest photo", () => {
    const { dialog } = renderViewer(0);
    const row = rowOf(dialog);
    row.scrollLeft = 790;
    fireEvent.scroll(row);
    expect(dialog).toHaveAccessibleName("Photo 3 of 3");
    row.scrollLeft = 390;
    fireEvent.scroll(row);
    expect(dialog).toHaveAccessibleName("Photo 2 of 3");
  });

  it("ignores a scroll before the row has a width", () => {
    const { dialog } = renderViewer(1);
    const row = rowOf(dialog, 0);
    row.scrollLeft = 0;
    fireEvent.scroll(row);
    expect(dialog).toHaveAccessibleName("Photo 2 of 3");
  });

  it("has no arrows for one photo", () => {
    const { dialog } = renderViewer(0, photos.slice(0, 1));
    expect(dialog).toHaveAccessibleName("Photo 1 of 1");
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous photo" })).toBeNull();
  });

  it("closes by the ✕, which reports to the host that unmounts it", async () => {
    const user = userEvent.setup();
    const { onClose, onRemove } = renderViewer();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("closes by Esc or system back, which reach it as its close", () => {
    const { dialog, onClose } = renderViewer();
    // happy-dom's dialog has no cancel step; the platform's cancel ends
    // in `close`, which is the event the viewer reports from.
    (dialog as HTMLDialogElement).close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("removes the photo shown, with no confirm", async () => {
    const user = userEvent.setup();
    const { onRemove, onClose } = renderViewer(0);
    await user.click(screen.getByRole("button", { name: "Next photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is the centred panel from 720, a floating surface", () => {
    const { dialog } = renderViewer();
    // Full screen on a phone, with the dialog's own caps lifted.
    expect(dialog).toHaveClass("fixed", "inset-0", "h-dvh", "max-w-none");
    expect(dialog).toHaveClass("max-h-none", "bg-ground", "flex-col");
    // MEASURE.column, RADIUS.sheet, the drawer's panel, edge and lift, the
    // stronger edge in dark (246b), over the scrim.
    expect(dialog).toHaveClass(
      "wide:max-w-column",
      "wide:rounded-sheet",
      "wide:ground-drawer",
      "wide:dark:border-hairline-2",
      "wide:shadow-lift",
      "backdrop:bg-scrim/60",
      "wide:m-auto",
      "wide:h-fit",
      "wide:max-h-[var(--sheet-cap)]",
    );
    expect(screen.getByRole("img")).toHaveClass(
      "object-contain",
      "max-h-full",
      "wide:max-h-[calc(var(--sheet-cap)-9rem)]",
    );
  });

  it("shows the arrows from 720, the viewer's width", () => {
    renderViewer(1);
    for (const name of ["Previous photo", "Next photo"]) {
      expect(screen.getByRole("button", { name })).toHaveClass(
        "hidden",
        "wide:flex",
      );
    }
  });

  it("draws Remove as the hairline pill", () => {
    renderViewer();
    expect(screen.getByRole("button", { name: "Remove photo" })).toHaveClass(
      "target",
      "rounded-pill",
      "border-hairline",
    );
  });
});
