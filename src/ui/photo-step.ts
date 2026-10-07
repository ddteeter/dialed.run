import type { ReactNode } from "react";

/**
 * A screen shown between picking a photo and uploading it — W3's blur.
 *
 * It is handed the picked file and a callback for the bytes that should
 * actually be sent, which are not the same bytes. `announce` is the third
 * argument because of Accessibility Contract rule 08: the step has
 * sentences of its own to say and the screen is allowed **one**
 * `role="status"` region, which the screen already mounts.
 *
 * A render slot rather than a component import, because a feature module
 * may not reach `modules/safety` (dependency-cruiser forbids the deep
 * import, and the safety barrel reaches D1). The route composes the step
 * and hands it in. Here in `ui/` because every screen that takes a photo
 * takes the same slot — the verdict's and the garment's — and a second
 * copy of the type is how one of them would stop reaching the blur.
 *
 * **The step decides when it is done** (round 28 #5): `onReady` comes
 * only once the runner presses "Use this photo", and `cancel` when they
 * press Cancel or Esc. Either way the host closes the step; on `cancel` it
 * keeps nothing, and a photo already on the form stays. Pick another is
 * the step's own business. See `modules/safety/components/PhotoBlur`.
 */
export type PhotoStep = (
  file: File,
  onReady: (ready: File) => void,
  announce: (sentence: string) => void,
  cancel: () => void,
) => ReactNode;
