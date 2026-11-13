import { useEffect, useRef } from "react";
import type { JSX, ReactNode, RefObject } from "react";

import { Icon } from "./icons";
import { Mono } from "./Mono";

/**
 * Bottom-sheet and desk-drawer primitive on the native <dialog> element:
 * slides up from the bottom edge on the phone, and is the 390 drawer at
 * the right from `wide` up (R54·164.1). Escape closes it natively; every
 * path reports through onClose. Dependency-free by design.
 *
 * **It travels, and leaving is faster than arriving** — `move`/`snap` in,
 * `quick`/`ease-exit` out (design/motion.js, "Sheet / drawer"). The whole
 * move lives in the `sheet-motion` utility, including the
 * `@starting-style` and `allow-discrete` transitions a `<dialog>` needs
 * before it can animate out at all.
 *
 * **It owns its heading** (R55·173): `label` is the sheet's name *and* its
 * visible title, TYPE.title in both themes, with the ✕ in its own 44
 * column at the right, so a two-line title wraps in its own column and
 * never around the ✕. A caller never writes the sheet's h2; that is how
 * three sizes of sheet heading shipped. A receipt passes `kicker`, the
 * MONO line that sits above its heading.
 *
 * **At width it is the drawer, over a page that stays** (R54·164.1). The
 * page and top bar stay visible, undimmed and inert, with no scrim (DS5:
 * "a dimmed backdrop is a third grey"). Inert is `showModal()`'s, and the
 * backdrop is transparent rather than the old opaque ground, which painted
 * over the bar the panel was meant to sit under (audit C-02, D1-01,
 * E1-03). The drawer is 390 wide, 24 under the bar and 24 from the right,
 * with its own surface and edge (`ground-drawer`). It is still
 * top-aligned, never centred, so a flow's steps start at the same y.
 *
 * **The fold** (R54·164.4). A long sheet is capped — the window less 24
 * top and bottom at width, 90% of the viewport on the phone — and scrolls
 * inside. The header is pinned and gains its hairline once the body has
 * scrolled; a `SheetFooter` is pinned under the body with its hairline on
 * top, so the actions are always in view and the body's last row is cut
 * against it, with no fade. Both are `sticky` in the one scroll box rather
 * than three boxes, so a `<form>` can still wrap the body and its footer.
 *
 * **`isModal={false}`** opens it with `show()` rather than `showModal()`,
 * for content that is not a question laid over the page — the Desk's
 * detail pane below `desk` (R55·202). The page stays live and there is no
 * backdrop at all; the ✕ and Escape still close it.
 *
 * Horizontal placement is `inset-x-0` on the phone and `right-6` at width,
 * never `left-1/2 -translate-x-1/2`: Tailwind v4 compiles that into the
 * `translate` property, which is the property the travel needs.
 */
export function Sheet({
  open,
  onClose,
  label,
  kicker,
  isLocked = false,
  isModal = true,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  /**
  The sheet's title: its TYPE.title heading and its accessible name.
  */
  label: string;
  /**
  A MONO line over the title: a receipt's "Report sent".
  */
  kicker?: string | undefined;
  /**
   * While true, Esc and the ✕ do not close it: the sheet is mid-way
   * through work that has to end where it can be told (round 45 #103's
   * release).
   */
  isLocked?: boolean | undefined;
  /**
  False for a pane the page beside it stays usable with (R55·202).
  */
  isModal?: boolean | undefined;
  children: ReactNode;
}>) {
  const dialogRef = useSheetDialog(open, isModal);
  const close = () => {
    if (!isLocked) dialogRef.current?.close();
  };

  return (
    <dialog
      ref={(node) => {
        dialogRef.current = node ?? undefined;
      }}
      aria-label={label}
      onCancel={(event) => {
        if (isLocked) event.preventDefault();
      }}
      onKeyDown={(event) => {
        // A modal's Escape is the platform's cancel; a dialog opened with
        // `show()` has none, so its Escape is this.
        if (!isModal && event.key === "Escape") close();
      }}
      onScroll={(event) => {
        const box = event.currentTarget;
        box.dataset.scrolled = String(box.scrollTop > 0);
      }}
      onClose={() => {
        unstack();
        onClose();
      }}
      data-slot="sheet"
      className={SHEET_CLASS}
    >
      <SheetHeader
        label={label}
        kicker={kicker}
        isLocked={isLocked}
        onClose={close}
      />
      <div className="flex flex-col px-6 pb-6 has-[[data-part=sheet-footer]]:pb-0">
        {children}
      </div>
    </dialog>
  );
}

/**
 * Opens and shuts the dialog to match `open`: `showModal()` for a sheet,
 * `show()` for a pane, and a stacked pair marked as such (Design 165).
 */
function useSheetDialog(
  isOpen: boolean,
  isModal: boolean,
): RefObject<HTMLDialogElement | undefined> {
  const dialogRef = useRef<HTMLDialogElement | undefined>(undefined);
  useEffect(() => {
    const dialog = dialogRef.current;
    // Equivalent mutant: React attaches refs before it runs effects, and
    // this effect has no cleanup that could run after a detach, so the ref
    // is always populated here. The check is the compiler's — the ref type
    // includes undefined — not the runtime's.
    // Stryker disable next-line ConditionalExpression
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      if (!isModal) {
        dialog.show();
        return;
      }
      const under = openSheetBelow();
      dialog.showModal();
      if (under !== undefined) stack(dialog, under);
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, isModal]);
  return dialogRef;
}

/**
 * The pinned head: the kicker, if any, over the title, and the ✕ in its
 * own 44 column. The hairline under it is transparent until the sheet has
 * scrolled, so a sheet that fits shows no line.
 *
 * The title is focusable from script (`tabIndex={-1}`) so a receipt, which
 * swaps the sheet's content and its title, can send focus here and have
 * the swap read out.
 */
function SheetHeader({
  label,
  kicker,
  isLocked,
  onClose,
}: Readonly<{
  label: string;
  kicker: string | undefined;
  isLocked: boolean;
  onClose: () => void;
}>): JSX.Element {
  return (
    <div
      data-part="sheet-header"
      className="sticky top-0 z-10 flex items-start gap-3 border-b border-transparent bg-ground px-6 pb-4 pt-6 group-data-[scrolled=true]:border-hairline"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
        {kicker === undefined ? undefined : (
          <Mono step="xs" className="text-muted">
            {kicker}
          </Mono>
        )}
        <h2 tabIndex={-1} className="m-0 font-display text-title">
          {label}
        </h2>
      </div>
      <button
        type="button"
        aria-label="Close"
        aria-disabled={isLocked || undefined}
        onClick={onClose}
        className="target -mr-3 inline-flex w-11 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-ink"
      >
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

/**
 * A ref callback for content swapped into a sheet that should be read out
 * from the top — a receipt, W3's photo check: it focuses the heading of
 * the sheet it has just been attached in. Outside a sheet it does nothing.
 */
export function focusSheetHeading(node: HTMLElement | null): void {
  node?.closest("dialog")?.querySelector<HTMLElement>("h2")?.focus();
}

/**
 * A sheet's pinned foot (R54·164.4): the line that changes what pressing
 * means, then the actions, full width and stacked (R54·167.2, "inside a
 * desk drawer"). It sticks to the bottom of the sheet's scroll box with
 * its hairline on top, so the primary is always in view; in a sheet that
 * fits, it sits in its place under the body. Put it last, inside the form
 * when its actions submit one.
 */
export function SheetFooter({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div
      data-part="sheet-footer"
      className="sticky bottom-0 z-10 -mx-6 mt-2 flex flex-col gap-3 border-t border-hairline bg-ground px-6 pb-6 pt-4"
    >
      {children}
    </div>
  );
}

/**
 * The sheet's surface. Phone-and-light is the original: `--ground`, no
 * edge, over the 60% scrim. **Phone-and-dark is Design 165**: in dark the
 * sheet, the scrim and the page were one colour (`#0B0B0E`), so the sheet
 * takes `--panel` with a hairline over its top corners and down both
 * sides, and a grabber (`ground-sheet`). Stacked, the upper sheet's edge
 * steps up to the stronger hairline, and the lower one stays at least 48
 * taller so both top edges show (`stack`). **At width** it is the drawer
 * (`ground-drawer`), placed by the bar and the right edge, over a
 * transparent backdrop. `z-40` matters only to a pane opened with
 * `show()`, which is not in the top layer.
 */
const SHEET_CLASS =
  "sheet-motion group fixed inset-x-0 bottom-0 top-auto z-40 m-0 max-h-[var(--sheet-cap)] w-full max-w-none overflow-y-auto rounded-t-sheet bg-ground p-0 text-ink backdrop:bg-scrim/60 max-wide:dark:ground-sheet max-wide:dark:data-[stacked=over]:border-hairline-2 max-wide:data-[stacked=under]:min-h-[calc(var(--over-height)+3rem)] wide:bottom-auto wide:left-auto wide:right-6 wide:top-[calc(var(--bar-height)+1.5rem)] wide:h-fit wide:max-h-[calc(100dvh-var(--bar-height)-3rem)] wide:max-w-panel wide:rounded-sheet wide:ground-drawer wide:backdrop:bg-transparent";

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
