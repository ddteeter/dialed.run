import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import type { Ref } from "react";
import { describe, expect, it, vi } from "vitest";

import { PhotoRow } from "../../src/ui/PhotoRow";

/**
 * A2's photos as thumbnails with the add box last (Round 56 · 249.2–.4):
 * the sizes, the cap, a pick and a drop, and where focus goes when the
 * viewer closes or a photo is removed.
 */
const all = [
  { src: "/a.jpg", alt: "First kit" },
  { src: "/b.jpg", alt: "Second kit" },
  { src: "/c.jpg", alt: "Third kit" },
];

function Host({
  start = all,
  max = 4,
  error,
  pending = false,
  onFiles = vi.fn(),
  inputRef,
}: Readonly<{
  start?: typeof all;
  max?: number;
  error?: string;
  pending?: boolean;
  onFiles?: (files: FileList | null) => void;
  inputRef?: Ref<HTMLInputElement>;
}>) {
  const [photos, setPhotos] = useState(start);
  return (
    <PhotoRow
      photos={photos}
      max={max}
      add={{ accept: "image/png", pending, error, onFiles, inputRef }}
      onRemove={(index) => {
        setPhotos((held) => held.filter((_, at) => at !== index));
      }}
    />
  );
}

/**
A row whose every pick adds a photo, up to a cap of four.
*/
function Filling({ start }: Readonly<{ start: typeof all }>) {
  const [photos, setPhotos] = useState(start);
  return (
    <PhotoRow
      photos={photos}
      max={4}
      add={{
        accept: "image/png",
        pending: false,
        error: undefined,
        onFiles: () => {
          setPhotos((held) => [...held, { src: "/d.jpg", alt: "" }]);
        },
      }}
      onRemove={vi.fn()}
    />
  );
}

const thumb = (n: number, of: number) =>
  screen.getByRole("button", { name: `Photo ${String(n)} of ${String(of)}` });

/**
 * The add box's input. Its label's text also holds the "+" and the hidden
 * pending words, so it is found by type and its name asserted as computed.
 */
function addInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  if (input === null) throw new Error("no add box");
  return input;
}

async function removeFrom(n: number, of: number) {
  const user = userEvent.setup();
  await user.click(thumb(n, of));
  await user.click(screen.getByRole("button", { name: "Remove photo" }));
}

describe("PhotoRow", () => {
  it("draws each photo as a 76 × 95 thumbnail, then the add box", () => {
    render(<Host />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[3]).toContainElement(addInput());
    expect(addInput()).toHaveAccessibleName("Add photo");
    expect(thumb(1, 3)).toHaveClass(
      "target",
      "w-19",
      "aspect-4/5",
      "rounded-field",
      "overflow-hidden",
    );
    expect(thumb(1, 3).querySelector("img")).toHaveAttribute("src", "/a.jpg");
    expect(screen.getByRole("list")).toHaveClass("gap-2", "flex-wrap");
  });

  it("draws the add box at the thumbnail's size on the panel", () => {
    render(<Host />);
    const box = addInput().closest("label");
    expect(box).toHaveAttribute("data-part", "add-photo");
    expect(box).toHaveClass(
      "target",
      "w-19",
      "aspect-4/5",
      "rounded-field",
      "bg-panel",
      "border",
      "border-hairline",
      "has-[:focus-visible]:outline-ink",
    );
    expect(box).toHaveTextContent("+Add photo");
  });

  it("drops the add box at the cap", () => {
    render(<Host max={3} />);
    expect(document.querySelector("input[type=file]")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("hands a chosen file and a dropped file to one path", () => {
    const onFiles = vi.fn();
    render(<Host start={[]} onFiles={onFiles} />);
    const input = addInput();
    const file = new File([new Uint8Array([1])], "k.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledOnce();
    expect(input).toHaveAttribute("accept", "image/png");
    expect(input).toHaveClass("sr-only");

    const box = input.closest("label");
    if (box === null) throw new Error("no add box");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fireEvent.dragEnter(box, { dataTransfer: transfer });
    fireEvent.dragOver(box, { dataTransfer: transfer });
    expect(box).toHaveAttribute("data-state", "drag-over");
    fireEvent.drop(box, { dataTransfer: transfer });
    expect(onFiles).toHaveBeenCalledTimes(2);
    expect(box).not.toHaveAttribute("data-state");
  });

  it("says Adding while the photo is on its way", () => {
    render(<Host pending />);
    const input = addInput();
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(input).toHaveAttribute("aria-disabled", "true");
    expect(input.closest("label")).toHaveTextContent("Adding");
  });

  it("puts a wrong file's message under the row, tied to the input", () => {
    render(<Host error="Photos must be JPEG or PNG." />);
    const input = addInput();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Photos must be JPEG or PNG.");
  });

  it("leaves a good input unmarked", () => {
    render(<Host />);
    const input = addInput();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("hands the add box's input to the host's ref, object or callback", () => {
    const objectRef = createRef<HTMLInputElement>();
    const { unmount } = render(<Host inputRef={objectRef} />);
    expect(objectRef.current).toBe(addInput());
    unmount();
    const callback = vi.fn();
    render(<Host inputRef={callback} />);
    expect(callback).toHaveBeenCalledWith(addInput());
  });

  it("opens the full photo on the thumbnail pressed", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(thumb(2, 3));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Photo 2 of 3");
  });

  it("puts focus back on the thumbnail that opened it", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(thumb(3, 3));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(thumb(3, 3)).toHaveFocus();
  });

  it("after Remove, focuses the photo that slid into its place", async () => {
    render(<Host />);
    await removeFrom(1, 3);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(thumb(1, 2).querySelector("img")).toHaveAttribute("src", "/b.jpg");
    expect(thumb(1, 2)).toHaveFocus();
  });

  it("after removing the last photo, focuses the one before", async () => {
    render(<Host />);
    await removeFrom(3, 3);
    expect(thumb(2, 2)).toHaveFocus();
  });

  it("after removing the only photo, focuses the add box", async () => {
    render(<Host start={all.slice(0, 1)} />);
    await removeFrom(1, 1);
    expect(screen.queryAllByRole("button", { name: /^Photo/ })).toHaveLength(0);
    expect(addInput()).toHaveFocus();
  });

  it("brings the add box back when a photo at the cap is removed", async () => {
    render(<Host max={3} />);
    await removeFrom(2, 3);
    expect(addInput()).toBeInTheDocument();
    expect(thumb(2, 2)).toHaveFocus();
  });

  it("moves focus only once per removal", async () => {
    render(<Host />);
    await removeFrom(1, 3);
    act(() => {
      thumb(2, 2).focus();
    });
    expect(thumb(2, 2)).toHaveFocus();
  });

  it("at the cap, hands the add box's focus to the photo just added", () => {
    render(<Filling start={all} />);
    act(() => {
      addInput().focus();
    });
    fireEvent.change(addInput(), { target: { files: [] } });
    expect(document.querySelector("input[type=file]")).toBeNull();
    expect(thumb(4, 4)).toHaveFocus();
  });

  it("keeps focus on the add box while it stays", () => {
    render(<Filling start={all.slice(0, 1)} />);
    act(() => {
      addInput().focus();
    });
    fireEvent.change(addInput(), { target: { files: [] } });
    expect(thumb(2, 2)).toBeInTheDocument();
    expect(addInput()).toHaveFocus();
  });
});
