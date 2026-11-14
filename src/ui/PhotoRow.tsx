import { useEffect, useRef, useState } from "react";
import type { JSX, Ref, RefObject } from "react";

import { FieldMessage, inFlight, PendingLabel } from "./form";
import { Mono } from "./Mono";
import { PhotoViewer } from "./PhotoViewer";
import type { ViewedPhoto } from "./PhotoViewer";
import { useFileDrop } from "./use-file-drop";
import { messageIdFor } from "./use-form-submit";

/**
 * The photos a runner is about to attach, as a row of thumbnails, with the
 * add box last (Round 55 · 241, Round 56 · 249).
 *
 * - **A thumbnail** is 76 × 95, 4:5 (the card's crop), at RADIUS.field,
 *   8 apart at both widths (249.4). Pressing it opens the full photo
 *   (`PhotoViewer`, 249.1).
 * - **The add box** is the thumbnail's size, on `--panel` with a hairline
 *   edge, "+" over ADD PHOTO in MONO.xs (249.2). It is always last and
 *   leaves at `max`. It is a `<label>` around the `sr-only` input, as
 *   `FileWell` is, so the ring is on the label and a dropped file and a
 *   chosen file take one path. There is no Replace: a runner removes a
 *   photo, then adds one.
 * - **Remove** is in the viewer's foot (249.3). It closes the viewer, and
 *   focus goes to the next thumbnail, else the one before, else the add
 *   box. A plain close puts focus back on the thumbnail that opened it.
 *
 * The closet's garment forms keep `FileWell`'s one photo well (249.5).
 */
export function PhotoRow({
  photos,
  max,
  add,
  onRemove,
}: Readonly<{
  photos: readonly ViewedPhoto[];
  /**
  The photo cap, read from `maxPhotosPerEntry` by the caller.
  */
  max: number;
  /**
  Everything the add box needs, held together.
  */
  add: AddPhoto;
  onRemove: (index: number) => void;
}>): JSX.Element {
  const { accept, pending, error, onFiles, inputRef } = add;
  const focus = useRowFocus(photos.length);
  const [openAt, setOpenAt] = useState<number | undefined>();

  return (
    <div className="flex flex-col gap-2">
      <ul
        data-part="photo-row"
        className="m-0 flex list-none flex-wrap gap-2 p-0"
      >
        {photos.map((photo, index) => (
          <li key={photo.src}>
            <button
              type="button"
              ref={(node) => {
                focus.thumbs.current[index] = node;
              }}
              aria-label={`Photo ${String(index + 1)} of ${String(photos.length)}`}
              onClick={() => {
                setOpenAt(index);
              }}
              className={`target ${THUMB_CLASS} cursor-pointer overflow-hidden border-none bg-photo p-0`}
            >
              <img
                src={photo.src}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          </li>
        ))}
        {photos.length < max ? (
          <li>
            <AddBox
              accept={accept}
              pending={pending}
              error={error}
              onFiles={onFiles}
              inputRef={focus.mergeAddRef(inputRef)}
            />
          </li>
        ) : undefined}
      </ul>
      <FieldMessage name={PART} error={error} />
      {openAt === undefined ? undefined : (
        <PhotoViewer
          photos={photos}
          openAt={openAt}
          onClose={() => {
            setOpenAt(undefined);
            focus.thumbs.current[openAt]?.focus();
          }}
          onRemove={(index) => {
            setOpenAt(undefined);
            focus.afterRemove(index);
            onRemove(index);
          }}
        />
      )}
    </div>
  );
}

/**
What the add box takes: the file input's settings and the pick handler.
*/
type AddPhoto = Readonly<{
  accept: string;
  pending: boolean;
  /**
  What was wrong with the last file: the field message under the row.
  */
  error: string | undefined;
  onFiles: (files: FileList | null) => void;
  /**
  The add box's input, for a host that must take focus back to it
  (W3's blur step, `useReturnFocus`).
  */
  inputRef?: Ref<HTMLInputElement> | undefined;
}>;

/**
The row's field name, for its message and the input that message describes.
*/
const PART = "photo-row";

/**
76 wide at 4:5, so 95 high, at RADIUS.field.
*/
const THUMB_CLASS = "flex w-19 aspect-4/5 rounded-field";

/**
The add box: "+" over ADD PHOTO, the thumbnail's size.
*/
function AddBox({
  accept,
  pending,
  error,
  onFiles,
  inputRef,
}: Readonly<{
  accept: string;
  pending: boolean;
  error: string | undefined;
  onFiles: (files: FileList | null) => void;
  inputRef: Ref<HTMLInputElement>;
}>): JSX.Element {
  const drop = useFileDrop(onFiles);
  return (
    <label
      {...drop.handlers}
      data-part="add-photo"
      data-state={drop.isOver ? "drag-over" : undefined}
      className={`target ${THUMB_CLASS} cursor-pointer flex-col items-center justify-center gap-1 border bg-panel text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink data-[state=drag-over]:border-2 data-[state=drag-over]:border-ink border-hairline`}
    >
      <span aria-hidden="true" className="text-lead font-bold">
        +
      </span>
      <Mono step="xs">
        <PendingLabel
          label="Add photo"
          pendingLabel="Adding"
          pending={pending}
        />
      </Mono>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : messageIdFor(PART)}
        {...inFlight(pending)}
        className="sr-only"
        onChange={(event) => {
          onFiles(event.target.files);
        }}
      />
    </label>
  );
}

/**
 * Where focus goes once a photo is removed: the photo that slid into its
 * place, else the one before it, else the add box. It moves after the row
 * has re-rendered without that photo, so the element it lands on exists.
 */
function useRowFocus(count: number): {
  thumbs: RefObject<(HTMLButtonElement | null)[]>;
  afterRemove: (index: number) => void;
  mergeAddRef: (
    hostRef: Ref<HTMLInputElement> | undefined,
  ) => (node: HTMLInputElement | null) => void;
} {
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const boxInputRef = useRef<HTMLInputElement | null>(null);
  const [landing, setLanding] = useState<number | undefined>();
  // Whether the add box held focus as its input last detached. A ref
  // callback detaches on every render, so this only means "gone" once the
  // render has committed with no add box: the photo just kept filled the
  // row to its cap.
  const boxHadFocus = useRef(false);

  useEffect(() => {
    if (landing === undefined) return;
    setLanding(undefined);
    const thumb = landing < count ? thumbs.current[landing] : undefined;
    const before = landing > 0 ? thumbs.current[landing - 1] : undefined;
    (thumb ?? before ?? boxInputRef.current)?.focus();
  }, [landing, count]);

  // At the cap the add box leaves, and focus with it: it goes to the
  // last thumbnail, the photo just added, rather than to the page.
  useEffect(() => {
    if (!boxHadFocus.current) return;
    boxHadFocus.current = false;
    if (boxInputRef.current === null) thumbs.current[count - 1]?.focus();
  });

  return {
    thumbs,
    afterRemove: setLanding,
    mergeAddRef: (hostRef) => (node) => {
      if (node === null) {
        boxHadFocus.current =
          globalThis.document.activeElement === boxInputRef.current;
      }
      boxInputRef.current = node;
      if (typeof hostRef === "function") hostRef(node);
      else if (hostRef) hostRef.current = node;
    },
  };
}
