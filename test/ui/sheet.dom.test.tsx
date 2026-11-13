import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "../../src/ui/Sheet";

/**
 * The `<dialog>` primitive, opened and closed.
 *
 * Every line of `Sheet`'s effect was uncovered: it drives `showModal()`
 * and `close()` on a real dialog element, and the workers pool has no
 * dialog to drive. So "does opening it open it" had never been asked,
 * and neither had the two guards that stop it calling `showModal` on an
 * already-open dialog — which is what throws.
 */

function Controlled({
  onClose,
  initiallyOpen = false,
}: Readonly<{ onClose?: () => void; initiallyOpen?: boolean }>) {
  const [open, setOpen] = useState(initiallyOpen);
  const [nudges, setNudges] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open it
      </button>
      {/* Re-renders without changing `open`. Clicking "Open it" again
          would not do it: setState to the value it already holds makes
          React bail out before the effect ever re-runs, so a test that
          used it would exercise nothing. */}
      <button
        type="button"
        onClick={() => {
          setNudges((n) => n + 1);
        }}
      >
        Nudge
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
        }}
      >
        Close it
      </button>
      <Sheet
        open={open}
        label="Pick a kit"
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
      >
        <p>Sheet body {nudges}</p>
      </Sheet>
    </>
  );
}

function sheet(): HTMLDialogElement {
  return screen.getByLabelText("Pick a kit");
}

describe("Sheet", () => {
  it("is in the document but shut until it is opened", () => {
    render(<Controlled />);
    expect(sheet().open).toBe(false);
    // Mounted-but-closed, not conditionally rendered: the dialog element
    // has to exist for `showModal` to have something to open.
    expect(sheet()).toBeInTheDocument();
  });

  it("opens as a modal when `open` turns true after mount", async () => {
    // The effect's dependency list is `[open]`. With an empty list it would
    // run only on mount and this sheet would never open at all.
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole("button", { name: "Open it" }));

    await waitFor(() => {
      expect(sheet().open).toBe(true);
    });
    expect(screen.getByText(/Sheet body/)).toBeVisible();
  });

  it("opens on mount when it starts open", async () => {
    render(<Controlled initiallyOpen />);
    await waitFor(() => {
      expect(sheet().open).toBe(true);
    });
  });

  it("closes when `open` turns false", async () => {
    const user = userEvent.setup();
    render(<Controlled initiallyOpen />);
    await waitFor(() => {
      expect(sheet().open).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "Close it" }));

    await waitFor(() => {
      expect(sheet().open).toBe(false);
    });
  });

  it("does not re-open a dialog that is already open", async () => {
    // `open && !dialog.open` — calling showModal on an open dialog throws
    // an InvalidStateError, so the second half of that guard is the thing
    // standing between a re-render and a crash.
    const user = userEvent.setup();
    render(<Controlled initiallyOpen />);
    await waitFor(() => {
      expect(sheet().open).toBe(true);
    });
    const showModal = vi.spyOn(sheet(), "showModal");
    const close = vi.spyOn(sheet(), "close");

    // A genuine re-render with `open` unchanged.
    await user.click(screen.getByRole("button", { name: "Nudge" }));
    await screen.findByText(/Sheet body 1/);

    // Neither call fires: `showModal` on an open dialog throws, and a
    // `close` here would shut the sheet under the user on any re-render
    // of the page behind it.
    expect(showModal).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(sheet().open).toBe(true);
    showModal.mockRestore();
    close.mockRestore();
  });

  it("does not close a dialog that is already closed", async () => {
    // The spy goes on the prototype and before the render, because the
    // call this rules out would happen during the mount effect — a spy
    // installed on the element afterwards is too late to see it.
    const close = vi.spyOn(HTMLDialogElement.prototype, "close");
    const user = userEvent.setup();
    try {
      render(<Controlled />);
      await user.click(screen.getByRole("button", { name: "Nudge" }));
      await screen.findByText(/Sheet body 1/);

      expect(close).not.toHaveBeenCalled();
      expect(sheet().open).toBe(false);
    } finally {
      close.mockRestore();
    }
  });

  it("reports the native Escape close through onClose", async () => {
    // Escape is the platform's, not ours — both paths have to arrive at
    // the same callback or the caller's state drifts from the dialog's.
    const onClose = vi.fn();
    render(<Controlled initiallyOpen onClose={onClose} />);
    await waitFor(() => {
      expect(sheet().open).toBe(true);
    });

    sheet().close();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(sheet().open).toBe(false);
  });

  it("lets Escape's cancel through unless it is locked (round 45 #103)", () => {
    const { rerender } = render(
      <Sheet open onClose={vi.fn()} label="Pick a kit">
        <p>a kit</p>
      </Sheet>,
    );
    const free = new Event("cancel", { cancelable: true });
    sheet().dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);

    rerender(
      <Sheet open isLocked onClose={vi.fn()} label="Pick a kit">
        <p>a kit</p>
      </Sheet>,
    );
    const held = new Event("cancel", { cancelable: true });
    sheet().dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it("carries the label as its accessible name", () => {
    render(<Controlled initiallyOpen />);
    expect(sheet()).toHaveAttribute("aria-label", "Pick a kit");
  });

  it("becomes DS3's panel at width: top-aligned, 390, and no scrim", () => {
    render(<Controlled initiallyOpen />);
    const dialog = sheet();

    // "It sits SPACE[12] below the bar, top-aligned, **never vertically
    // centred** — a flow's first step and its fifth should start at the
    // same y." `top` is the bar's own height, read from the variable the
    // bar sets itself, so neither measures the other.
    expect(dialog).toHaveClass(
      "wide:bottom-auto",
      "wide:top-[var(--bar-height)]",
      "wide:mt-12",
    );
    // Width 390 and sheet radius — the panel rule's other two numbers,
    // both from MEASURE and RADIUS rather than from the board.
    expect(dialog).toHaveClass("wide:max-w-panel", "wide:rounded-sheet");
    // DS5, "modals with scrims": "a dimmed backdrop is a third grey and
    // turns the phone screen into a dialog". The wash stays on the phone,
    // where the sheet really is a layer over a screen.
    expect(dialog).toHaveClass(
      "backdrop:bg-scrim/60",
      "wide:backdrop:bg-ground",
    );
  });

  it("keeps the bottom edge it travels from on the phone", () => {
    // The move is unchanged at either width — `translate: 0 100%` is the
    // element's own height, not the viewport's, so the panel arrives from
    // just below itself rather than from the bottom of a monitor.
    render(<Controlled initiallyOpen />);
    expect(sheet()).toHaveClass("bottom-0", "rounded-t-sheet", "sheet-motion");
  });
});

/**
 * Two sheets at once (Design 165): an options sheet, and the confirm it
 * opens.
 */
function TwoSheets() {
  const [lower, setLower] = useState(false);
  const [upper, setUpper] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLower(true);
        }}
      >
        Options
      </button>
      <button
        type="button"
        onClick={() => {
          setUpper(true);
        }}
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() => {
          setLower(false);
        }}
      >
        Shut lower
      </button>
      <Sheet
        open={lower}
        label="This run"
        onClose={() => {
          setLower(false);
        }}
      >
        <p>Options</p>
      </Sheet>
      <Sheet
        open={upper}
        label="Delete this run?"
        onClose={() => {
          setUpper(false);
        }}
      >
        <p>Confirm</p>
        <button
          type="button"
          onClick={() => {
            setUpper(false);
          }}
        >
          Keep it
        </button>
      </Sheet>
    </>
  );
}

describe("Sheet in dark, and stacked (Design 165)", () => {
  it("takes the panel, its edge and its grabber only on a dark phone", () => {
    render(<Controlled />);
    expect(sheet()).toHaveClass(
      "bg-ground",
      "max-wide:dark:ground-sheet",
      "backdrop:bg-scrim/60",
    );
    // The grabber is the utility's `::before`, not a child: the sheet's
    // own content is still its first element.
    expect(sheet().firstElementChild).toHaveTextContent("Sheet body");
  });

  it("marks a lone sheet as nothing stacked", async () => {
    const user = userEvent.setup();
    render(<TwoSheets />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByLabelText("This run")).not.toHaveAttribute(
      "data-stacked",
    );
  });

  it("holds the lower sheet 48 taller than the upper, and steps the upper's edge up", async () => {
    const user = userEvent.setup();
    render(<TwoSheets />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm", hidden: true }),
    );

    const lower = screen.getByLabelText("This run");
    const upper = screen.getByLabelText("Delete this run?");
    expect(upper).toHaveAttribute("data-stacked", "over");
    expect(lower).toHaveAttribute("data-stacked", "under");
    // happy-dom lays nothing out, so the upper sheet measures 0.
    expect(lower.style.getPropertyValue("--over-height")).toBe("0px");
    expect(lower).toHaveClass(
      "max-wide:data-[stacked=under]:min-h-[calc(var(--over-height)+3rem)]",
    );
    expect(upper).toHaveClass(
      "max-wide:dark:data-[stacked=over]:border-hairline-2",
    );
  });

  it.each([
    ["the upper one closes", "Keep it"],
    ["the lower one closes first", "Shut lower"],
  ])("ends the stack when %s", async (_case, press) => {
    const user = userEvent.setup();
    render(<TwoSheets />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm", hidden: true }),
    );
    await user.click(screen.getByRole("button", { name: press, hidden: true }));

    for (const label of ["This run", "Delete this run?"]) {
      const one = screen.getByLabelText(label);
      expect(one).not.toHaveAttribute("data-stacked");
      expect(one.style.getPropertyValue("--over-height")).toBe("");
    }
  });
});
