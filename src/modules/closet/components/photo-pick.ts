import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { photoFormatWords } from "../../../lib/photo-constraints";
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
 * A picked garment photo, on its way through W3's blur.
 *
 * **Every garment photo passes through the step the route hands in**
 * (D-102): the picked file and the step answering for it are held
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
} {
  const [pending, setPending] = useState<
    { file: File; step: PhotoStep } | undefined
  >();

  return {
    stepping: pending !== undefined,
    pick: (file) => {
      if (renderPhotoStep === undefined) {
        onReady(file);
        return;
      }
      setPending({ file, step: renderPhotoStep });
    },
    step: (announce) =>
      pending?.step(
        pending.file,
        (ready) => {
          setPending(undefined);
          onReady(ready);
        },
        announce,
      ),
  };
}
