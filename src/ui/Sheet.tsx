import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Bottom-sheet/modal primitive on the native <dialog> element: slides up
 * from the bottom edge on mobile, centers as a dialog from the sm
 * breakpoint. Escape closes it natively; both paths report through
 * onClose. Dependency-free by design (lanes 101/104 both need it).
 *
 * **It travels, and leaving is faster than arriving** — `move`/`snap` in,
 * `quick`/`ease-exit` out (design/motion.js, "Sheet / drawer"). The whole
 * move lives in the `sheet-motion` utility, including the
 * `@starting-style` and `allow-discrete` transitions a `<dialog>` needs
 * before it can animate out at all; nothing here changes, because the
 * element's `open` attribute is the state the CSS is written against and
 * `showModal`/`close` already set it.
 *
 * **At width it is DS3's panel, not a centred dialog.** The Desktop
 * Contract's panel rule is precise and three of its clauses are here:
 * width 390 (`max-w-panel`), sheet radius, and *"it sits SPACE[12] below
 * the bar, **top-aligned, never vertically centred** — a flow's first step
 * and its fifth should start at the same y"*. A sheet that centred itself
 * would move the panel up and down as the step's content grew, which is
 * the jitter that clause exists to forbid.
 *
 * And **no scrim**: `backdrop:bg-ground`, because DS5 lists "modals with
 * scrims" among the things desktop must not become — *"a dimmed backdrop
 * is a third grey and turns the phone screen into a dialog"*. The ink/60
 * wash stays on the phone, where the sheet really is a layer over a
 * screen.
 *
 * Horizontal centring is `inset-x-0` + `mx-auto` rather than `left-1/2
 * -translate-x-1/2`. Tailwind v4 compiles the latter into the `translate`
 * property, which is the property the travel needs; the two cannot both
 * own it.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}>) {
  const dialogRef = useRef<HTMLDialogElement | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    // Equivalent mutant: React attaches refs before it runs effects, and
    // this effect has no cleanup that could run after a detach, so the ref
    // is always populated here. The check is the compiler's — the ref type
    // includes undefined — not the runtime's.
    // Stryker disable next-line ConditionalExpression
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={(node) => {
        dialogRef.current = node ?? undefined;
      }}
      aria-label={label}
      onClose={onClose}
      className="sheet-motion fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-sheet bg-ground p-6 text-ink backdrop:bg-ink/60 wide:bottom-auto wide:top-[var(--bar-height)] wide:mx-auto wide:mt-12 wide:h-fit wide:max-w-panel wide:rounded-sheet wide:backdrop:bg-ground"
    >
      {children}
    </dialog>
  );
}
