import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { focusSheetHeading, Sheet, SheetFooter } from "../../src/ui/Sheet";

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

  it("is the desk drawer at width: 390, under the bar, at the right, no scrim (R54·164.1)", () => {
    render(<Controlled initiallyOpen />);
    const dialog = sheet();

    // "A 390 drawer, 24 under the top bar and 24 from the right edge."
    // `top` is the bar's own height, read from the variable the bar sets
    // itself, so neither measures the other; still never centred.
    expect(dialog).toHaveClass(
      "wide:bottom-auto",
      "wide:top-[calc(var(--bar-height)+1.5rem)]",
      "wide:left-auto",
      "wide:right-6",
      "wide:max-w-panel",
      "wide:rounded-sheet",
    );
    // Its own surface, hairline and lift, so it reads as a layer on a
    // page that stays: the opaque ground backdrop painted over the bar.
    expect(dialog).toHaveClass("wide:ground-drawer");
    // DS5, "modals with scrims": no dimmed backdrop at width. The page is
    // visible and undimmed; `showModal` is what makes it inert.
    expect(dialog).toHaveClass(
      "backdrop:bg-scrim/60",
      "wide:backdrop:bg-transparent",
    );
    expect(dialog.className).not.toMatch(/wide:backdrop:bg-ground/);
  });

  it("folds a long sheet: capped, scrolling inside (R54·164.4)", () => {
    render(<Controlled initiallyOpen />);
    expect(sheet()).toHaveClass(
      "max-h-[var(--sheet-cap)]",
      "overflow-y-auto",
      "wide:max-h-[calc(100dvh-var(--bar-height)-3rem)]",
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
    // header is still its first element.
    expect(sheet().firstElementChild).toHaveAttribute(
      "data-part",
      "sheet-header",
    );
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

describe("Sheet's own head, foot and pane (R55·173, R54·164.4, R55·202)", () => {
  it("shows its label as the TYPE.title heading, with the ✕ in its own column", () => {
    render(<Controlled initiallyOpen />);
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Pick a kit",
    });
    expect(heading).toHaveClass("font-display", "text-title");
    expect(heading).toHaveAttribute("tabindex", "-1");
    const close = screen.getByRole("button", { name: "Close" });
    // Its own 44 column: a long title wraps beside it, never around it.
    expect(close).toHaveClass("target", "w-11", "shrink-0");
    expect(heading.parentElement).toHaveClass("min-w-0", "flex-1");
    expect(close).not.toHaveAttribute("aria-disabled");
  });

  it("puts a kicker over the heading only when it has one", () => {
    const { rerender } = render(
      <Sheet open onClose={vi.fn()} label="Thanks.">
        <p>body</p>
      </Sheet>,
    );
    expect(head()?.textContent).toBe("Thanks.");
    // Not an empty line where a kicker would go: the title stands alone.
    const title = screen.getByRole("heading", {
      name: "Thanks.",
      hidden: true,
    });
    expect(title.parentElement?.children).toHaveLength(1);
    rerender(
      <Sheet open onClose={vi.fn()} kicker="Report sent" label="Thanks.">
        <p>body</p>
      </Sheet>,
    );
    expect(head()?.textContent).toBe("Report sentThanks.");
    expect(screen.getByText("Report sent")).toHaveClass("text-muted");
  });

  it("closes on the ✕, through onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Controlled initiallyOpen onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(sheet().open).toBe(false);
  });

  it("holds the ✕ while it is locked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Sheet open isLocked onClose={onClose} label="Thanks.">
        <p>body</p>
      </Sheet>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("aria-disabled", "true");
    await user.click(close);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet2().open).toBe(true);
  });

  it("pins its head, which takes its hairline only once the body has scrolled", () => {
    render(<Controlled initiallyOpen />);
    const head = sheet().querySelector("[data-part='sheet-header']");
    expect(head).toHaveClass(
      "sticky",
      "top-0",
      "border-transparent",
      "group-data-[scrolled=true]:border-hairline",
    );
    expect(sheet()).toHaveClass("group");

    sheet().scrollTop = 40;
    fireEvent.scroll(sheet());
    expect(sheet()).toHaveAttribute("data-scrolled", "true");
    sheet().scrollTop = 0;
    fireEvent.scroll(sheet());
    expect(sheet()).toHaveAttribute("data-scrolled", "false");
  });

  it("pins a footer under the body, ruled on top, and drops the body's foot padding for it", () => {
    render(
      <Sheet open onClose={vi.fn()} label="Report">
        <p>body</p>
        <SheetFooter>
          <button type="button">Send</button>
        </SheetFooter>
      </Sheet>,
    );
    const foot = sheet2().querySelector("[data-part='sheet-footer']");
    expect(foot).toHaveClass(
      "sticky",
      "bottom-0",
      "border-t",
      "border-hairline",
    );
    expect(foot?.parentElement).toHaveClass(
      "pb-6",
      "has-[[data-part=sheet-footer]]:pb-0",
    );
  });

  it("opens as a pane with show(), not showModal(), when it is not modal", async () => {
    const show = vi.spyOn(HTMLDialogElement.prototype, "show");
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    try {
      render(
        <Sheet open isModal={false} onClose={vi.fn()} label="Runner">
          <p>pane</p>
        </Sheet>,
      );
      await waitFor(() => {
        expect(sheet2().open).toBe(true);
      });
      expect(show).toHaveBeenCalledOnce();
      expect(showModal).not.toHaveBeenCalled();
    } finally {
      show.mockRestore();
      showModal.mockRestore();
    }
  });

  it("closes a pane on Escape, which a modal leaves to the platform", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet open isModal={false} onClose={onClose} label="Runner">
        <p>pane</p>
      </Sheet>,
    );
    fireEvent.keyDown(sheet2(), { key: "Enter" });
    expect(sheet2().open).toBe(true);
    fireEvent.keyDown(sheet2(), { key: "Escape" });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });

    // A modal's Escape is the dialog's own cancel; the key handler must
    // not close it a second way (or close it while it is locked).
    const close = vi.spyOn(HTMLDialogElement.prototype, "close");
    try {
      rerender(
        <Sheet open isModal onClose={onClose} label="Runner">
          <p>pane</p>
        </Sheet>,
      );
      close.mockClear();
      fireEvent.keyDown(sheet2(), { key: "Escape" });
      expect(close).not.toHaveBeenCalled();
    } finally {
      close.mockRestore();
    }
  });

  it("does not close a locked pane on Escape", () => {
    const onClose = vi.fn();
    render(
      <Sheet open isLocked isModal={false} onClose={onClose} label="Runner">
        <p>pane</p>
      </Sheet>,
    );
    fireEvent.keyDown(sheet2(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet2().open).toBe(true);
  });
});

describe("focusSheetHeading", () => {
  it("does nothing in a dialog that has no heading", () => {
    render(
      <dialog open>
        <div ref={focusSheetHeading}>step</div>
      </dialog>,
    );
    expect(document.body).toHaveFocus();
  });

  it("focuses the heading of the sheet it is attached in", async () => {
    render(
      <Sheet open onClose={vi.fn()} label="Check the blur">
        <div ref={focusSheetHeading}>step</div>
      </Sheet>,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Check the blur", hidden: true }),
      ).toHaveFocus();
    });
  });
});

function head(): Element | null {
  return sheet2().querySelector("[data-part='sheet-header']");
}

function sheet2(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (dialog === null) throw new Error("no sheet");
  return dialog;
}
