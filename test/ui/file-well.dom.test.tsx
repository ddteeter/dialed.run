import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileWell, type FileWellProps } from "../../src/ui/FileWell";

/**
 * The one well A1 and F share.
 *
 * It exists because the clone detector refused twenty identical lines
 * once F's photo well stopped being a raw `<input type="file">` — and it
 * was right: this is one drawn pattern with two labels, and bend 1
 * governs both at once.
 */
function transferWith(...files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer;
}

const png = () =>
  new File([new Uint8Array([1])], "kit.png", { type: "image/png" });

function renderWell(overrides: Partial<FileWellProps> = {}) {
  const onFiles = vi.fn();
  render(
    <FileWell
      label="Add a photo"
      pendingLabel="Uploading"
      pending={false}
      accept="image/png"
      onFiles={onFiles}
      {...overrides}
    />,
  );
  return onFiles;
}

const well = () => screen.getByText("Add a photo").closest("label");

describe("FileWell", () => {
  it("makes the label the control and hides the input inside it", () => {
    // **A visible `<input type="file">` renders the browser's own
    // "Choose file / No file chosen" pair**, unstyleable and
    // locale-dependent — which is exactly what F's photo well looked like
    // on film, two native buttons jammed together in a panel. The label
    // is the control; the input is clipped to a corner behind it.
    renderWell();

    const input = screen.getByLabelText(/Add a photo/);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("sr-only");
    expect(input).toHaveAttribute("accept", "image/png");
  });

  it("puts the focus ring on the box, because the input cannot show one", () => {
    // `sr-only` clips the input to a 1px corner, so an outline on it is
    // invisible and rule 06's "never removed" fails by construction
    // rather than by an `outline-none`. `has-[:focus-visible]` moves it
    // to the box a runner can see.
    renderWell();

    expect(well()).toHaveClass(
      "target",
      "has-[:focus-visible]:outline",
      "has-[:focus-visible]:outline-ink",
    );
  });

  it("darkens its border while a file is over it, and nothing else", () => {
    // Bend 1's "one state change; the layout is untouched". The box is
    // the same dashed field either way.
    renderWell();

    expect(well()).toHaveClass("border-dashed", "border-hairline-2");
    expect(well()).not.toHaveClass("border-ink");

    fireEvent.dragOver(well() ?? document.body, {
      dataTransfer: transferWith(png()),
    });

    expect(well()).toHaveClass("border-ink", "border-dashed");
    expect(well()).not.toHaveClass("border-hairline-2");
  });

  it("hands a dropped file and a chosen file to the same callback", () => {
    // Bend 1: "face-blur runs the same WASM path on the dropped file — do
    // not fork it." One callback is how that is guaranteed rather than
    // remembered.
    const onFiles = renderWell();

    fireEvent.drop(well() ?? document.body, {
      dataTransfer: transferWith(png()),
    });
    expect(onFiles).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/Add a photo/), {
      target: { files: transferWith(png()).files },
    });
    expect(onFiles).toHaveBeenCalledTimes(2);
  });

  it("swaps the label for the pending one, by visibility", () => {
    // `PendingLabel` stacks both halves in one grid cell so the box
    // cannot change size mid-upload, which means `textContent` holds both
    // words whatever `pending` is — visibility is the mechanism.
    renderWell({ pending: true });

    expect(screen.getByText("Uploading")).toBeVisible();
    expect(screen.getByText("Add a photo")).not.toBeVisible();
  });

  it("stays reachable while in flight rather than going disabled", () => {
    // Rule 07: `aria-disabled` and `aria-busy`, never the `disabled`
    // attribute — it drops focus and stops announcing. The double-submit
    // guard lives in each caller's handler.
    renderWell({ pending: true });

    const input = screen.getByLabelText(/Add a photo/);
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute("aria-disabled", "true");
  });

  it("renders the caller's hint, and nothing when there is none", () => {
    // A node rather than a string: A1's is a size cap shown always, F's is
    // bend 1's line and is width-only, and which is which is the caller's
    // business.
    renderWell({ hint: <span>up to 25 MB</span> });
    expect(screen.getByText("up to 25 MB")).toBeVisible();
  });

  it("shows the caller's failure under the well, and nothing when there is none", () => {
    // **The well owns its failure line.** Both callers used to draw the
    // identical paragraph beside their own call, which the clone detector
    // matched — and a `fallow-ignore` on each would have been a
    // suppression standing in for a one-prop fix.
    renderWell({ error: "That didn't upload. Try again." });

    const message = screen.getByText("That didn't upload. Try again.");
    expect(message).toBeVisible();
    // Weight and the cold role, never hue alone: rule 01 is "remove every
    // colour and the meaning survives", so the sentence carries it.
    expect(message).toHaveClass("font-semibold", "text-cold-text");
  });

  it("draws no failure line when there is no error", () => {
    renderWell();
    // Not a text query: `pendingLabel` is "Uploading" and is always in the
    // DOM (PendingLabel stacks both halves), so the absence has to be
    // asserted against the paragraph itself.
    expect(document.querySelector("p")).toBeNull();
  });

  it("draws no hint when the caller passes none", () => {
    renderWell();
    // The brackets are `PendingLabel`'s breathing device, hidden from
    // assistive tech; what matters is that no third line appears.
    expect(well()?.textContent).toBe("Add a photo[Uploading]");
  });
});
