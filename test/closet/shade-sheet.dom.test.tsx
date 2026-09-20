import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ShadeSheet } from "../../src/modules/closet/components/ShadeSheet";

/**
 * happy-dom has no `<dialog>` modal behaviour and no canvas, which is what
 * these two shims are for. Neither fakes the thing under test: the sheet's
 * own decisions — when the sampler exists, what the swatch shows, which
 * button does what — are all above that line.
 */
beforeAll(() => {
  const setOpen = (dialog: HTMLDialogElement, isOpen: boolean) => {
    dialog.open = isOpen;
  };
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    setOpen(this, true);
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    setOpen(this, false);
  };
});

const props = {
  open: true,
  colorName: "Navy",
  value: "",
  onUse: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
};

describe("ShadeSheet (design round 11 §AH2)", () => {
  it("names the level-1 choice it was opened from, and says it is optional", () => {
    // Level 2 is reached from a chosen name, so the sheet says which one —
    // a hex with no name is a fidelity the Call's rule has no use for.
    render(<ShadeSheet {...props} />);
    expect(screen.getByText("Navy · optional")).toBeVisible();
  });

  it("shows the swatch only once the hex is a real one", async () => {
    // The 18px square is the runner checking their own reading, so it must
    // never show a colour that is not what the field says. A partial
    // "#1f2a" is not a colour yet.
    const user = userEvent.setup();
    const { container } = render(<ShadeSheet {...props} />);
    const swatch = () => container.querySelector("[data-swatch]");

    expect(swatch()).toBeNull();
    await user.type(screen.getByLabelText("Hex"), "#1f2a");
    expect(swatch()).toBeNull();
    await user.type(screen.getByLabelText("Hex"), "44");
    expect(swatch()).toHaveAttribute("data-swatch", "#1f2a44");
  });

  it("hides the swatch from assistive tech — the hex beside it is the value", () => {
    const { container } = render(<ShadeSheet {...props} value="#1f2a44" />);
    expect(container.querySelector("[data-swatch]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("says what is wrong in the schema's own words, and not while empty", async () => {
    // Error copy lives in the schema (§Forms & failure). An empty field is
    // not an error — the whole level is optional.
    const user = userEvent.setup();
    render(<ShadeSheet {...props} />);

    expect(screen.queryByText(/six-digit hex/)).toBeNull();
    await user.type(screen.getByLabelText("Hex"), "nope");
    expect(screen.getByText("Use a six-digit hex like #1f2a44.")).toBeVisible();
  });

  it("refuses to hand back a hex that is not one", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<ShadeSheet {...props} onUse={onUse} />);

    await user.type(screen.getByLabelText("Hex"), "nope");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).not.toHaveBeenCalled();

    // aria-disabled, never the attribute: a disabled button drops focus
    // and stops announcing (§Forms & failure).
    expect(screen.getByRole("button", { name: "Use this" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Use this" })).not.toBeDisabled();
  });

  it("hands back the normalised hex, lowercased", async () => {
    // One stored spelling of a colour: the field accepts a paste as well
    // as a sample, and brands publish `#1F2A44`.
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<ShadeSheet {...props} onUse={onUse} />);

    await user.type(screen.getByLabelText("Hex"), "#1F2A44");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).toHaveBeenCalledWith("#1f2a44");
  });

  it("clears the field and the stored value together", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ShadeSheet {...props} value="#1f2a44" onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Hex")).toHaveValue("");
  });

  it("offers no sampler without a photo, and says to type it instead", () => {
    // "No photo → no sampler, the field stands alone." Not a disabled
    // affordance — a control that cannot do anything is worse than one
    // that is not there.
    render(<ShadeSheet {...props} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/paste what the brand published/i)).toBeVisible();
    expect(screen.queryByText(/tap the photo/i)).toBeNull();
  });

  it("offers the photo as the sampler when there is one", () => {
    render(<ShadeSheet {...props} photoUrl="/closet/photo/01ITEM/card" />);

    const photo = screen.getByAltText(/tap to sample a shade from your photo/i);
    expect(photo).toHaveAttribute("src", "/closet/photo/01ITEM/card");
    expect(screen.getByText(/tap the photo to sample/i)).toBeVisible();
    // Same-origin, which is what keeps the canvas untainted so a pixel can
    // be read back at all.
    expect(photo.getAttribute("src")).not.toMatch(/^https?:/);
  });

  it("starts from the hex it was given", () => {
    render(<ShadeSheet {...props} value="#abcdef" />);
    expect(screen.getByLabelText("Hex")).toHaveValue("#abcdef");
  });
});
