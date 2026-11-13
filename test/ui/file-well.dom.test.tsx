import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  FileWell,
  type FileWellCopy,
  type FileWellProps,
} from "../../src/ui/FileWell";

/**
 * The one well A1 and every photo share — round 22, item 8, drawn once:
 * rest, drag-over, uploading, error, and (with a photo) the well as the
 * preview with Replace and Remove under it. Each state is named on
 * `data-state` for the conformance harness, so each is asserted by name.
 */
function transferWith(...files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer;
}

const png = () =>
  new File([new Uint8Array([1])], "kit.png", { type: "image/png" });

function renderWell(
  overrides: Partial<Omit<FileWellProps, "copy">> = {},
  copy: Partial<FileWellCopy> = {},
) {
  const onFiles = vi.fn();
  render(
    <FileWell
      part="photo-well"
      pending={false}
      accept="image/png"
      onFiles={onFiles}
      {...overrides}
      copy={{
        kicker: "Photo · optional",
        label: "Add a photo",
        overLabel: "Let go to add it",
        pendingLabel: "Adding",
        hint: "Flat on the floor works best.",
        ...copy,
      }}
    />,
  );
  return onFiles;
}

function well(): HTMLElement {
  const found = document.querySelector<HTMLElement>("[data-part='photo-well']");
  if (found === null) throw new Error("no well");
  return found;
}

describe("FileWell: empty", () => {
  it("draws the kicker, the title and the hint, dashed", () => {
    renderWell();

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(well()).toHaveClass(
      "border-2",
      "border-dashed",
      "border-hairline-2",
    );
    expect(screen.getByText("Photo · optional")).toHaveClass("text-muted");
    expect(screen.getByText("Flat on the floor works best.")).toHaveClass(
      "text-small",
      "text-label",
    );
  });

  it("makes the label the control and hides the input inside it", () => {
    // A visible `<input type="file">` renders the browser's own
    // unstyleable "Choose file / No file chosen" pair.
    renderWell();

    const input = screen.getByLabelText(/Add a photo/);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("sr-only");
    expect(input).toHaveAttribute("accept", "image/png");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("is named by its title alone, and described by the kicker and hint", () => {
    // The whole label block made a name a sentence long. The title is
    // what the runner acts on; the other two lines are said after it.
    renderWell();

    const input = screen.getByLabelText(/Add a photo/);
    expect(input).toHaveAccessibleName("Add a photo");
    expect(input).toHaveAccessibleDescription(
      "Photo · optional Flat on the floor works best.",
    );
    // Two ids and no empty third where a message would go.
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });

  it("puts the focus ring on the box, because the input cannot show one", () => {
    renderWell();

    expect(well()).toHaveClass(
      "target",
      "has-[:focus-visible]:outline",
      "has-[:focus-visible]:outline-ink",
    );
  });

  it("keeps one title at every width when there is no desk title", () => {
    // A1's "Drop a file, or browse" is the same on the phone and the desk.
    renderWell({}, { label: "Drop a file, or browse" });

    const title = screen.getByText("Drop a file, or browse");
    expect(title).not.toHaveClass("wide:hidden");
    expect(well().querySelector(String.raw`.wide\:inline`)).toBeNull();
  });

  it("says Drop at desk, where a file can be dropped, and not on the phone", () => {
    // "The desk title adds 'Drop' because the desk can; the phone's can't."
    renderWell({}, { wideLabel: "Drop a photo, or browse" });

    expect(screen.getByText("Add a photo")).toHaveClass("wide:hidden");
    expect(screen.getByText("Drop a photo, or browse")).toHaveClass(
      "hidden",
      "wide:inline",
    );
  });
});

describe("FileWell: drag-over", () => {
  it("goes to solid ink on the panel and swaps the title, and back", () => {
    // Bend 1's "one state change", as round 22 draws it.
    renderWell();

    fireEvent.dragOver(well(), { dataTransfer: transferWith(png()) });

    expect(well()).toHaveAttribute("data-state", "drag-over");
    expect(well()).toHaveClass("border-solid", "border-ink", "bg-panel");
    expect(well()).not.toHaveClass("border-dashed");
    expect(screen.getByText("Let go to add it")).toBeInTheDocument();
    expect(screen.queryByText("Add a photo")).toBeNull();

    fireEvent.dragLeave(well());

    expect(well()).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("Add a photo")).toBeInTheDocument();
  });

  it("hands a dropped file and a chosen file to the same callback", () => {
    // Bend 1: "do not fork it" — so W3's blur is reached either way.
    const onFiles = renderWell();

    fireEvent.drop(well(), { dataTransfer: transferWith(png()) });
    expect(onFiles).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/Add a photo/), {
      target: { files: transferWith(png()).files },
    });
    expect(onFiles).toHaveBeenCalledTimes(2);
  });
});

describe("FileWell: uploading", () => {
  it("swaps the title for the pending one, and stays reachable", () => {
    // Rule 07: `aria-disabled` and `aria-busy`, never `disabled`.
    renderWell({ pending: true });

    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(screen.getByText("Adding")).toBeVisible();
    expect(screen.getByText("Add a photo")).not.toBeVisible();
    const input = screen.getByLabelText(/Add a photo/);
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute("aria-disabled", "true");
  });

  it("stays a well while uploading, even over a photo", () => {
    // A replacement in flight shows the brackets, not the old photo.
    renderWell({
      pending: true,
      preview: { src: "/photo", alt: "Shell" },
    });

    expect(well()).toHaveAttribute("data-state", "uploading");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("FileWell: error", () => {
  it("marks the well in ink and puts the field message under it, never pink", () => {
    // A wrong type or size is a field failure: the fix is another file.
    renderWell({ error: "That photo is over 10 MB. Pick a smaller one." });

    expect(well()).toHaveAttribute("data-state", "error");
    expect(well()).toHaveClass("border-solid", "border-ink");
    expect(well()).not.toHaveClass("bg-panel");
    const message = screen.getByText(
      "That photo is over 10 MB. Pick a smaller one.",
    );
    expect(message).toHaveClass("bg-failure");
    expect(message).not.toHaveClass("text-cold-text");
    expect(screen.getByLabelText(/Add a photo/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // And the message is heard with the control, after its own lines.
    expect(screen.getByLabelText(/Add a photo/)).toHaveAccessibleDescription(
      "Photo · optional Flat on the floor works best. That photo is over 10 MB. Pick a smaller one.",
    );
  });

  it("draws no message when there is no error", () => {
    renderWell();
    expect(document.querySelector(".bg-failure")).toBeNull();
  });
});

describe("FileWell: with a photo", () => {
  it("is the preview, with Replace and Remove under it", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderWell({ preview: { src: "/photo", alt: "Shell" }, onRemove });

    expect(well()).toHaveAttribute("data-state", "filled");
    expect(well()).toHaveClass("border", "border-hairline", "bg-photo");
    // C-04: clipped to its 4:3, so a square or portrait photo is contained
    // in the well rather than stretching it past its rounded corners.
    expect(well()).toHaveClass("aspect-4/3", "overflow-hidden");
    expect(screen.getByRole("img", { name: "Shell" })).toHaveAttribute(
      "src",
      "/photo",
    );
    expect(screen.getByRole("img")).toHaveClass("object-contain");
    // No "Add a photo" beside a photo — the drift round 22 removes.
    expect(screen.queryByText("Add a photo")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("replaces through the well's own input, so the same path runs", () => {
    const onFiles = renderWell({ preview: { src: "/photo", alt: "Shell" } });

    const replace = screen.getByLabelText("Replace");
    expect(replace).toHaveAttribute("type", "file");
    fireEvent.change(replace, {
      target: { files: transferWith(png()).files },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it("takes a drop onto the photo, and marks it while one is over it", () => {
    const onFiles = renderWell({ preview: { src: "/photo", alt: "Shell" } });

    fireEvent.dragOver(well(), { dataTransfer: transferWith(png()) });
    expect(well()).toHaveAttribute("data-state", "drag-over");
    expect(well()).toHaveClass("border-2", "border-ink", "bg-panel");
    expect(well()).toHaveClass("aspect-4/3", "overflow-hidden");

    fireEvent.drop(well(), { dataTransfer: transferWith(png()) });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it("offers no Remove when the caller cannot remove", () => {
    renderWell({ preview: { src: "/photo", alt: "Shell" } });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows a field message under the photo too", () => {
    renderWell({
      preview: { src: "/photo", alt: "Shell" },
      error: "Photos must be JPG, PNG or WebP.",
    });
    expect(screen.getByText("Photos must be JPG, PNG or WebP.")).toHaveClass(
      "bg-failure",
    );
    // Replace is the name and the message its description: the well's
    // own lines are not drawn over a photo, so nothing points at them.
    const replace = screen.getByLabelText("Replace");
    expect(replace).toHaveAccessibleName("Replace");
    expect(replace).toHaveAccessibleDescription(
      "Photos must be JPG, PNG or WebP.",
    );
  });

  it("describes Replace by nothing while the photo is fine", () => {
    renderWell({ preview: { src: "/photo", alt: "Shell" } });
    expect(screen.getByLabelText("Replace")).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(screen.getByLabelText("Replace")).not.toHaveAttribute(
      "aria-labelledby",
    );
  });
});
