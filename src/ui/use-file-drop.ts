import { useState, type DragEvent } from "react";

/**
 * The Desktop Contract's first bend, as a hook.
 *
 * *"A1 upload and F add-garment open the camera on phone. At width the
 * same panel shows a drop zone in the photo well — 'Drop a photo, or
 * shoot it on your phone later.' **Copy and one state change; the layout
 * is untouched.** Face-blur runs the same WASM path on the dropped
 * file."*
 *
 * The last sentence is the whole design of this file. A dropped file and
 * a chosen file are handed to **the same callback** the `onChange`
 * handler already uses, so everything downstream — the size and type
 * checks in `lib/photo-constraints`, W3's blur, the multipart upload — is
 * reached identically. There is no second path to keep in sync, which is
 * DS5's "no second wide form" one layer down.
 *
 * **The label was already lying.** `UploadForm`'s rest label has said
 * "Drop a .FIT, .gpx, or .tcx file" since design's round-13 table named
 * it, and nothing in the app listened for a drop: the `<input>` is
 * `sr-only`, so a file dropped on the dashed box it draws landed on the
 * document and the browser navigated away from the flow. The copy was the
 * promise; this is the part that keeps it.
 *
 * `isOver` is the "one state change" — the well marks itself while a file
 * is over it and nothing else moves. No layout, no motion: the Motion
 * Doctrine has no surface for this, and an undesigned one stays still.
 */
export interface FileDrop {
  /**
  Whether a file is currently over the well.
  */
  isOver: boolean;
  /**
   * Spread onto the element that draws the well.
   *
   * `onDragOver` has to `preventDefault` or the drop never fires — the
   * browser's default for a dragged file is to open it, which in a flow
   * means leaving it.
   */
  handlers: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

export function useFileDrop(onFiles: (files: FileList) => void): FileDrop {
  const [isOver, setIsOver] = useState(false);

  return {
    isOver,
    handlers: {
      onDragOver: (event) => {
        event.preventDefault();
        setIsOver(true);
      },
      onDragLeave: () => {
        setIsOver(false);
      },
      onDrop: (event) => {
        event.preventDefault();
        setIsOver(false);
        // A drag with no files — text from another tab, a link — is not a
        // drop this well has anything to do with. Handing an empty list
        // on would take the caller down the "you chose nothing" path for
        // something the runner never chose.
        if (event.dataTransfer.files.length > 0) {
          onFiles(event.dataTransfer.files);
        }
      },
    },
  };
}
