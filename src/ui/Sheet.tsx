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
 * is a third grey and turns the phone screen into a dialog"*. The 60%
 * wash stays on the phone, where the sheet really is a layer over a
 * screen, and it is `--scrim` (`#0B0B0E` in both themes, R48·134), not
 * `--ink`, which a dark page turns to chalk.
 *
 * **Top-aligned means bounded.** A `<dialog>` pinned to `top` with
 * `h-fit` and nothing else will happily extend past the fold, and its
 * content below that point cannot be reached — Playwright found this
 * within a minute of the change, on W1's report sheet: "element is
 * outside of the viewport", retried for thirty seconds, on a checkbox
 * that had simply fallen off the bottom. So the panel is capped at the
 * room it actually has (the viewport, less the bar and the same SPACE[12]
 * gap at the foot as at the head) and scrolls inside that. Centring hid
 * this before by shrinking the gap at both ends.
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
  isLocked = false,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  label: string;
  /**
   * While true, Esc does not close it: the sheet is mid-way through work
   * that has to end where it can be told (round 45 #103's release).
   */
  isLocked?: boolean | undefined;
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
      const under = openSheetBelow();
      dialog.showModal();
      if (under !== undefined) stack(dialog, under);
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
      onCancel={(event) => {
        if (isLocked) event.preventDefault();
      }}
      onClose={() => {
        unstack();
        onClose();
      }}
      data-slot="sheet"
      className={SHEET_CLASS}
    >
      {children}
    </dialog>
  );
}

/**
 * The sheet's surface. Phone-and-light is the original: `--ground`, no
 * edge, over the 60% scrim. **Phone-and-dark is Design 165**: in dark the
 * sheet, the scrim and the page were one colour (`#0B0B0E`), so the sheet
 * takes `--panel` with a hairline over its top corners and down both
 * sides, and a grabber (`ground-sheet`). Stacked, the upper sheet's edge steps up to the
 * stronger hairline, and the lower one stays at least 48 taller so both
 * top edges show (`stack`).
 */
const SHEET_CLASS =
  "sheet-motion fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-sheet bg-ground p-6 text-ink backdrop:bg-scrim/60 max-wide:dark:ground-sheet max-wide:dark:data-[stacked=over]:border-hairline-2 max-wide:data-[stacked=under]:min-h-[calc(var(--over-height)+3rem)] wide:bottom-auto wide:top-[var(--bar-height)] wide:mx-auto wide:mt-12 wide:h-fit wide:max-h-[calc(100dvh-var(--bar-height)-6rem)] wide:max-w-panel wide:overflow-y-auto wide:rounded-sheet wide:backdrop:bg-ground";

/**
 * The sheet already open beneath one about to open, if any. Design 165:
 * "never more than two", so one is all there can be. Asked before the new
 * one's `showModal()`, so the only open sheet is the other one.
 */
function openSheetBelow(): HTMLDialogElement | undefined {
  return (
    document.querySelector<HTMLDialogElement>(
      "dialog[data-slot='sheet'][open]",
    ) ?? undefined
  );
}

/**
 * Two sheets at once (Design 165): the upper one marks its edge, and the
 * lower one is held at least 48 taller than it — the upper sheet's own
 * backdrop is the lower one's second 60% scrim, so only the heights are
 * this code's. Measured once it is open, since a closed `<dialog>` has no
 * height.
 */
function stack(over: HTMLDialogElement, under: HTMLDialogElement): void {
  over.dataset.stacked = "over";
  under.dataset.stacked = "under";
  under.style.setProperty("--over-height", `${String(over.offsetHeight)}px`);
}

/**
 * Either sheet closing ends the stack: with "never more than two", one
 * sheet is left, and it is nobody's upper or lower. So every mark goes,
 * whichever sheet closed.
 */
function unstack(): void {
  for (const sheet of document.querySelectorAll<HTMLDialogElement>(
    "dialog[data-stacked]",
  )) {
    delete sheet.dataset.stacked;
    sheet.style.removeProperty("--over-height");
  }
}
