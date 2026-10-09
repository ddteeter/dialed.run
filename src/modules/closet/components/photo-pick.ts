import type { ComponentProps } from "react";

import { photoFormatWords } from "../../../lib/photo-constraints";
import type { FileWell } from "../../../ui";

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
