import type { JSX, ReactNode } from "react";

import { inFlight, PendingLabel } from "./form";
import { useFileDrop } from "./use-file-drop";

/**
 * The dashed box a file is chosen or dropped into.
 *
 * **One well, two callers**, and the clone detector is what insisted:
 * A1's run-file upload and F's add-a-photo were twenty identical lines
 * once the photo well stopped being a raw `<input type="file">`. They are
 * not a rhyme — they are one drawn pattern with two labels, and design
 * round 16 governs both at once (the drop zone is bend 1 on each), so
 * they should evolve together.
 *
 * Three things here are load-bearing and were each learned the hard way:
 *
 * - **The input is `sr-only`, and the ring is on the label.** `sr-only`
 *   clips the input to a 1px corner, so an outline on it is invisible —
 *   tabbing to the control showed nothing at all, which is rule 06's
 *   "never removed" failing by construction rather than by an
 *   `outline-none`. `has-[:focus-visible]` puts it on the box a runner
 *   can actually see.
 * - **The label is the control.** A visible `<input type="file">` renders
 *   the browser's own "Choose file / No file chosen" pair, unstyleable and
 *   locale-dependent, which is exactly what the photo well looked like on
 *   film: two native buttons jammed together in the middle of a panel.
 * - **A dropped file and a chosen file take one path.** `useFileDrop`
 *   hands both to `onFiles`, so the size and type checks, W3's blur and
 *   the upload are reached identically (Desktop Contract bend 1: "do not
 *   fork it").
 */
const WELL_BASE =
  "flex cursor-pointer flex-col items-center gap-2 rounded-field border border-dashed bg-panel px-6 py-10 text-center has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

/**
 * The one state change bend 1 allows: the border darkens while a file is
 * over the well. Nothing moves and nothing animates — the doctrine has no
 * surface for this, and an undesigned one stays still.
 */
const WELL_RESTING = `${WELL_BASE} border-hairline-2`;
const WELL_OVER = `${WELL_BASE} border-ink`;

/**
 * Named rather than inline, which is `UploadFormProps`'s convention one
 * directory over. An inline `Readonly<{…}>` of this length is a
 * seven-property signature with doc comments between the properties,
 * and the clone detector matched that skeleton against `AuthPage`'s —
 * two components that share nothing but their arity. Naming the shape
 * is the fix; a suppression would have been the excuse.
 */
export interface FileWellProps {
  /**
  The well's rest label — the control's accessible name, so it says what
  the runner is about to do rather than naming the field.
  */
  label: string;
  pendingLabel: string;
  pending: boolean;
  /**
  Passed straight to the input, so the picker filters as the caller wants.
  */
  accept: string;
  /**
   * A second line under the label — the size cap, or bend 1's
   * "shoot it on your phone later". Taken as a node rather than a string
   * because one of the two is width-only and that is the caller's
   * business, not the well's.
   */
  hint?: ReactNode;
  /**
   * What went wrong with the last file, shown under the well.
   *
   * **The well owns its own failure line**, which is why this is a prop
   * and not markup left at the call site. Both callers drew the identical
   * paragraph — same `text-cold-text` weight, same position — and the
   * clone detector matched them; a `fallow-ignore` on each would have
   * been a suppression standing in for a one-prop fix, and
   * `.fallowrc.jsonc`'s bar for one is a *rhyme*, not "two copies I would
   * rather keep". The message is still the caller's: A1's comes from a
   * failed multipart POST, F's from a rejected image.
   *
   * Not a `FormField` error: neither well is inside a form, so there is
   * no summary row to focus and no schema to carry the copy.
   */
  error?: string | undefined;
  onFiles: (files: FileList | null) => void;
}

export function FileWell({
  label,
  pendingLabel,
  pending,
  accept,
  hint,
  error,
  onFiles,
}: Readonly<FileWellProps>): JSX.Element {
  const drop = useFileDrop(onFiles);

  return (
    <div className="flex flex-col gap-3">
      <label
        {...drop.handlers}
        // `target` at the site rather than inside `WELL_BASE`: the 44px hit
        // area is this label's and belongs where a reviewer — and
        // `targets-and-focus`, which resolves a double-quoted constant and
        // not a template literal — can see it.
        className={`target ${drop.isOver ? WELL_OVER : WELL_RESTING}`}
      >
        <span className="text-body font-semibold text-ink">
          <PendingLabel
            label={label}
            pendingLabel={pendingLabel}
            pending={pending}
          />
        </span>
        {hint}
        <input
          type="file"
          accept={accept}
          {...inFlight(pending)}
          className="sr-only"
          onChange={(event) => {
            onFiles(event.target.files);
          }}
        />
      </label>
      {error === undefined ? undefined : (
        <p className="text-small font-semibold text-cold-text">{error}</p>
      )}
    </div>
  );
}
