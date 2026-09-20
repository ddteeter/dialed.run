import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Bottom-sheet/modal primitive on the native <dialog> element: slides up
 * from the bottom edge on mobile, centers as a dialog from the sm
 * breakpoint. Escape closes it natively; both paths report through
 * onClose. Dependency-free by design (lanes 101/104 both need it).
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
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-sheet bg-ground p-6 text-ink backdrop:bg-ink/60 wide:inset-x-auto wide:bottom-auto wide:top-1/2 wide:left-1/2 wide:m-0 wide:w-full wide:max-w-panel wide:-translate-x-1/2 wide:-translate-y-1/2 wide:rounded-sheet"
    >
      {children}
    </dialog>
  );
}
