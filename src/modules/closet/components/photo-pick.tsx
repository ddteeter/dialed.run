import { useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { photoFormatWords } from "../../../lib/photo-constraints";
import { DURATION, Sheet, useReturnFocus } from "../../../ui";
import type { FileWell, PhotoStep } from "../../../ui";

/**
 * The garment photo well's six lines (round 22, item 8), for both places
 * a garment photo is taken: F and Edit, where the well is a field, and
 * garment detail, where it is Replace and Remove under the photo.
 *
 * One constant because the two are one well, and a second copy of the
 * words is how one of them would stop saying what the other says.
 */
export const GARMENT_PHOTO_COPY = {
  kicker: "Photo · optional",
  label: "Add a photo",
  wideLabel: "Drop a photo, or browse",
  overLabel: "Let go to add it",
  pendingLabel: "Adding",
  hint: `Flat on the floor works best. ${photoFormatWords}.`,
} satisfies ComponentProps<typeof FileWell>["copy"];

/**
 * The kicker when removing a garment's photo fails, on Edit and on Y
 * alike: the state still true, in round 28 #13's words (was "Photo
 * kept"). The band's capitals come from its CSS, so this stays in normal
 * case for the status line.
 */
export const PHOTO_STILL_ON = "Photo still on";

/**
 * A picked garment photo, on its way through W3's blur.
 *
 * **Every garment photo passes through the step the route hands in**
 * (R-102): the picked file and the step answering for it are held
 * together — so a held file always has the step that opened for it, the
 * pair `VerdictForm` holds for the same reason — until the step hands back
 * the bytes that should actually be used. Those, and never the picked
 * ones, reach `onReady`.
 *
 * Absent a step, a picked file is ready as it is, which is what the tests
 * of everything else on these screens want.
 *
 * One at a time: the step is a screen, and two of them at once is not a
 * thing a runner can answer.
 */
export function usePhotoPick({
  renderPhotoStep,
  onReady,
}: {
  renderPhotoStep: PhotoStep | undefined;
  onReady: (file: File) => void;
}): {
  /**
  True while the step holds a file, so the well can say it is busy.
  */
  stepping: boolean;
  pick: (file: File) => void;
  /**
  The step itself, for the screen to render where it belongs.
  */
  step: (announce: (sentence: string) => void) => ReactNode;
  /**
   * For the well's `inputRef`: when the step closes — Use this photo,
   * Cancel or Esc — focus goes back to the well it was opened from.
   */
  wellRef: (node: HTMLElement | null) => void;
} {
  const [pending, setPending] = useState<
    { file: File; step: PhotoStep; open: boolean } | undefined
  >();
  const returnFocus = useReturnFocus();

  /**
   * A closed step stays in the sheet while the sheet travels out, so it
   * leaves with its content rather than as an empty panel, and lets go of
   * the file once the exit is over (`quick`, the sheet's way out). A new
   * pick in that time replaces it, and this timer with it.
   */
  useEffect(() => {
    if (pending?.open !== false) return;
    const timer = globalThis.setTimeout(() => {
      setPending(undefined);
    }, DURATION.quick);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [pending]);

  /**
   * The step closes: on Use this photo, on Cancel, and on Esc or anything
   * else that shuts the sheet. Saying it twice is harmless — the sheet
   * reports its own close after either of the first two — because it
   * only ever shuts the sheet and puts focus back on the well.
   */
  function close(): void {
    setPending((held) => held && { ...held, open: false });
    returnFocus.restore();
  }

  return {
    stepping: pending?.open === true,
    wellRef: returnFocus.ref,
    pick: (file) => {
      if (renderPhotoStep === undefined) {
        onReady(file);
        return;
      }
      setPending({ file, step: renderPhotoStep, open: true });
    },
    // W3 is a sheet over the screen that picked the photo (round 28 #5:
    // "the closet form and AttachKit use the same sheet"), kept mounted so
    // it can travel out as well as in. Its label is the step's own head.
    step: (announce) => (
      <Sheet
        open={pending?.open === true}
        onClose={close}
        label={PHOTO_STEP_LABEL}
      >
        {pending?.step(
          pending.file,
          (ready) => {
            close();
            onReady(ready);
          },
          announce,
          // Cancel in W3 (round 28 #5): the step closes, nothing is kept.
          close,
        )}
      </Sheet>
    ),
  };
}

/**
 * The sheet's name, which is W3's head (round 28 #5): what a screen
 * reader hears as the dialog opens, before focus lands on the heading.
 */
export const PHOTO_STEP_LABEL = "Check the blur";
