import type { JSX } from "react";

import { FieldMessage, inFlight, PendingLabel } from "./form";
import { Mono } from "./Mono";
import { useFileDrop } from "./use-file-drop";

/**
 * The box a file is chosen or dropped into — and, once there is a photo,
 * the photo itself.
 *
 * **One well, two callers**: A1's run file and every photo. Round 22 drew
 * it once (item 8, "one well") and the clone detector had already insisted
 * before that; they should evolve together.
 *
 * The states round 22 draws, each named on `data-state` so the conformance
 * harness can find it:
 *
 * - **empty** — dashed, three lines: a mono kicker, the title, a hint.
 * - **drag-over** — bend 1's "one state change", drawn: the dashes go to a
 *   2px solid ink border, the ground to `--panel`, and the title swaps
 *   ("Let go to add it"). Instant both ways; nothing animates.
 * - **uploading** — the title is the breathing brackets.
 * - **error** — the same 2px ink border, and the Form Contract's field
 *   message under the well. A wrong type or size is a field failure: the
 *   fix is another file. Never a pink line — pink is action.
 * - **filled** — with a photo **the well is the preview**: a solid hairline
 *   box, the photo contained at 4:3, and Replace and Remove under it as
 *   text buttons. Never an image above a well that still says "Add".
 *
 * Three things are load-bearing and were each learned the hard way:
 *
 * - **The input is `sr-only`, and the ring is on the label.** An outline
 *   on a clipped 1px input is invisible, which is rule 06 failing by
 *   construction.
 * - **The label is the control.** A visible `<input type="file">` renders
 *   the browser's own unstyleable "Choose file / No file chosen".
 * - **A dropped file and a chosen file take one path.** `useFileDrop`
 *   hands both to `onFiles`, so the checks, W3's blur and the upload are
 *   reached identically (Desktop Contract bend 1: "do not fork it").
 */
const WELL_BASE =
  "flex cursor-pointer flex-col items-center gap-2 rounded-field border-2 px-5 py-6 text-center has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

/**
 * Solid ink marks both the drag-over and the error, on purpose — round 22:
 * *"both mean 'this box is the one', and the yellow line is what tells them
 * apart."*
 */
const WELL_RESTING = `${WELL_BASE} border-dashed border-hairline-2`;
const WELL_MARKED = `${WELL_BASE} border-solid border-ink`;
const WELL_OVER = `${WELL_MARKED} bg-panel`;

/**
 * Named rather than inline, which is `UploadFormProps`'s convention one
 * directory over: an inline `Readonly<{…}>` this long matched an unrelated
 * component's skeleton in the clone detector.
 */
export interface FileWellCopy {
  /**
  The mono line above the title — "PHOTO · OPTIONAL", "GPX / TCX / FIT".
  */
  kicker: string;
  /**
  The rest title, and the control's accessible name.
  */
  label: string;
  /**
   * The rest title from 720 up, where a file can be dropped — "Drop a
   * photo, or browse". *"The desk title adds 'Drop' because the desk can;
   * the phone's can't."* Absent, the title is the same at every width.
   */
  wideLabel?: string | undefined;
  /**
  The title while a file is over the well — "Let go to add it".
  */
  overLabel: string;
  pendingLabel: string;
  hint: string;
}

/**
 * The words are one prop, `copy`, because they are one thing — the well's
 * six lines, all from the board — and the rest is behaviour. Twelve flat
 * props also matched an unrelated control's parameter list in the clone
 * detector, which is a sign the signature was saying less than it could.
 */
export interface FileWellProps {
  /**
  Round 22's region name: A1 calls its well `drop-zone`, a photo's is
  `photo-well`. The harness diffs by it.
  */
  part: "drop-zone" | "photo-well";
  copy: FileWellCopy;
  pending: boolean;
  /**
  Passed straight to the input, so the picker filters as the caller wants.
  */
  accept: string;
  /**
   * What was wrong with the last file — a field failure, so the Form
   * Contract's field message under the well. A dropped connection is not
   * one of these; it belongs on the screen's failure band.
   */
  error?: string | undefined;
  /**
   * The photo, when there is one. The well becomes its preview, with
   * Replace (the same input, so the same path) and, if `onRemove` is given,
   * Remove.
   */
  preview?: { src: string; alt: string } | undefined;
  onRemove?: (() => void) | undefined;
  onFiles: (files: FileList | null) => void;
}

/**
The four title lines a well can show, and which one is current.
*/
function Title({
  label,
  wideLabel,
  overLabel,
  isOver,
}: Readonly<{
  label: string;
  wideLabel: string | undefined;
  overLabel: string;
  isOver: boolean;
}>): JSX.Element {
  if (isOver) return <>{overLabel}</>;
  if (wideLabel === undefined) return <>{label}</>;
  return (
    <>
      <span className="wide:hidden">{label}</span>
      <span className="hidden wide:inline">{wideLabel}</span>
    </>
  );
}

export function FileWell({
  part,
  copy,
  pending,
  accept,
  error,
  preview,
  onRemove,
  onFiles,
}: Readonly<FileWellProps>): JSX.Element {
  const drop = useFileDrop(onFiles);
  const input = (
    <input
      type="file"
      accept={accept}
      aria-invalid={error === undefined ? undefined : true}
      {...inFlight(pending)}
      className="sr-only"
      onChange={(event) => {
        onFiles(event.target.files);
      }}
    />
  );

  if (preview !== undefined && !pending) {
    return (
      <div className="flex flex-col gap-2">
        <div
          {...drop.handlers}
          data-part={part}
          data-state={drop.isOver ? "drag-over" : "filled"}
          className={
            drop.isOver
              ? "aspect-[4/3] w-full wide:max-h-80 rounded-field border-2 border-ink bg-panel"
              : "aspect-[4/3] w-full wide:max-h-80 rounded-field border border-hairline bg-photo"
          }
        >
          <img
            src={preview.src}
            alt={preview.alt}
            className="h-full w-full object-contain"
          />
        </div>
        <div data-part="well-actions" className="flex gap-5">
          {/* Replace is the well's own input, so a replacement takes the
              same path — checks, W3's blur, upload — as the first photo. */}
          <label className="target inline-flex cursor-pointer items-center text-body font-semibold underline underline-offset-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
            Replace
            {input}
          </label>
          {onRemove === undefined ? undefined : (
            <button
              type="button"
              onClick={onRemove}
              className="target cursor-pointer border-none bg-transparent p-0 text-body font-semibold text-quiet underline underline-offset-4"
            >
              Remove
            </button>
          )}
        </div>
        <FieldMessage name={part} error={error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        {...drop.handlers}
        data-part={part}
        data-state={wellState(drop.isOver, pending, error)}
        // `target` at the site rather than inside `WELL_BASE`: the 44px hit
        // area is this label's, and `targets-and-focus` resolves a
        // double-quoted constant but not a template literal.
        className={`target ${wellClass(drop.isOver, error)}`}
      >
        <Mono step="xs" className="text-muted">
          {copy.kicker}
        </Mono>
        <span className="text-lead font-bold text-ink">
          <PendingLabel
            label={
              <Title
                label={copy.label}
                wideLabel={copy.wideLabel}
                overLabel={copy.overLabel}
                isOver={drop.isOver}
              />
            }
            pendingLabel={copy.pendingLabel}
            pending={pending}
          />
        </span>
        <span className="text-small text-label">{copy.hint}</span>
        {input}
      </label>
      <FieldMessage name={part} error={error} />
    </div>
  );
}

/**
The state an empty well is in, for `data-state`.
*/
function wellState(
  isOver: boolean,
  isPending: boolean,
  error: string | undefined,
): "drag-over" | "uploading" | "error" | "empty" {
  if (isOver) return "drag-over";
  if (isPending) return "uploading";
  if (error !== undefined) return "error";
  return "empty";
}

/**
The border an empty well wears: dashed at rest, solid ink when it is the one.
*/
function wellClass(isOver: boolean, error: string | undefined): string {
  if (isOver) return WELL_OVER;
  if (error !== undefined) return WELL_MARKED;
  return WELL_RESTING;
}
