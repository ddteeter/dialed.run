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
 * The wide layout centres on `inset-0` + `margin: auto` rather than on
 * `top-1/2 left-1/2 -translate-1/2`. Tailwind v4 compiles those into the
 * `translate` property, which is the property the travel needs; the two
 * cannot both own it.
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
      className="sheet-motion fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-sheet bg-ground p-6 text-ink backdrop:bg-ink/60 wide:top-0 wide:right-0 wide:bottom-0 wide:left-0 wide:m-auto wide:h-fit wide:w-full wide:max-w-panel wide:rounded-sheet"
    >
      {children}
    </dialog>
  );
}
