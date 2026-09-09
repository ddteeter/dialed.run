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

  it("carries the label as its accessible name", () => {
    render(<Controlled initiallyOpen />);
    expect(sheet()).toHaveAttribute("aria-label", "Pick a kit");
  });
});
