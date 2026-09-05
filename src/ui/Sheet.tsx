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
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-3xl bg-chalk p-6 text-night backdrop:bg-night/60 sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:m-0 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
    >
      {children}
    </dialog>
  );
}
