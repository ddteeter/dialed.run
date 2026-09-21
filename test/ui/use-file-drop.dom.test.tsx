import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFileDrop } from "../../src/ui/use-file-drop";

/**
 * The Desktop Contract's first bend — *"copy and one state change; the
 * layout is untouched"*.
 *
 * What is worth asserting is the two things that are easy to get wrong and
 * silent when they are: `onDragOver` must `preventDefault` or the drop
 * event never fires at all (the browser opens the file instead, which in a
 * flow means leaving it), and a drag carrying no files must not be handed
 * on as a choice the runner did not make.
 */
function Well({ onFiles }: Readonly<{ onFiles: (files: FileList) => void }>) {
  const drop = useFileDrop(onFiles);
  return (
    <div
      {...drop.handlers}
      data-over={drop.isOver ? "true" : undefined}
      // A role so the well is reachable by name rather than by test id.
      role="note"
      aria-label="Photo well"
    />
  );
}

/**
 * A `FileList`, which cannot be constructed directly.
 *
 * `DataTransfer` is the DOM's own way to build one and happy-dom
 * implements it, so this is the real type the handler will see rather
 * than an object shaped like it.
 */
function transferWith(...files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer;
}

const png = () => new File([new Uint8Array([1])], "kit.png", { type: "image/png" });

describe("useFileDrop", () => {
  it("marks the well while a file is over it, and unmarks it after", () => {
    render(<Well onFiles={vi.fn()} />);
    const well = screen.getByRole("note", { name: "Photo well" });

    expect(well).not.toHaveAttribute("data-over");
    fireEvent.dragOver(well, { dataTransfer: transferWith(png()) });
    expect(well).toHaveAttribute("data-over", "true");
    fireEvent.dragLeave(well);
    expect(well).not.toHaveAttribute("data-over");
  });

  it("hands the dropped files to the same callback the input uses", () => {
    // "Face-blur runs the same WASM path on the dropped file — do not
    // fork it." One callback is how that is guaranteed rather than
    // remembered.
    const dropped: File[] = [];
    render(
      <Well
        onFiles={(files) => {
          dropped.push(...files);
        }}
      />,
    );
    const well = screen.getByRole("note", { name: "Photo well" });

    fireEvent.drop(well, { dataTransfer: transferWith(png()) });

    expect(dropped.map((file) => file.name)).toStrictEqual(["kit.png"]);
    // And the well stops being marked, or it stays lit after the drop.
    expect(well).not.toHaveAttribute("data-over");
  });

  it("ignores a drag that carries no file", () => {
    // Text from another tab, a dragged link. Handing an empty list on
    // would take the caller down its "you chose nothing" path for
    // something the runner never chose.
    const onFiles = vi.fn();
    render(<Well onFiles={onFiles} />);

    fireEvent.drop(screen.getByRole("note", { name: "Photo well" }), {
      dataTransfer: transferWith(),
    });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("prevents the browser's default on both dragover and drop", () => {
    // The one that is invisible when it is wrong: without
    // `preventDefault` on dragover the drop event never fires, and the
    // browser navigates to the file — out of the flow, with the runner's
    // half-filled form gone.
    render(<Well onFiles={vi.fn()} />);
    const well = screen.getByRole("note", { name: "Photo well" });

    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: transferWith() });
    fireEvent(well, over);
    expect(over.defaultPrevented).toBe(true);

    const dropped = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropped, "dataTransfer", {
      value: transferWith(png()),
    });
    fireEvent(well, dropped);
    expect(dropped.defaultPrevented).toBe(true);
  });
});
