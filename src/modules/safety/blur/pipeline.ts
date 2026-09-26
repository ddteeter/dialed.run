/**
 * The browser work W3 needs, behind one interface.
 *
 * **It is a seam because jsdom cannot do any of it.** `getContext("2d")`
 * returns null there, so a component that called these directly would
 * have no testable behaviour at all — and the behaviour worth testing is
 * the decisions (is blur on, what did we find, what does the copy say,
 * which file gets uploaded), not the pixel pushing. Injecting the pixels
 * leaves the decisions observable.
 *
 * It is also honest about what the default implementation needs: a real
 * browser. Nothing here runs on the Worker.
 */
import { fitWithin, photoLongEdge } from "../../../lib/photo-pipeline";

import { detectFaces } from "./detect";
import { blurredFile, paintBlurred } from "./paint";

export interface LoadedImage {
  /**
   * An `ImageBitmap` specifically, not any `CanvasImageSource`: the
   * detector needs one, and widening here would push the narrowing into
   * every caller.
   */
  image: ImageBitmap;
  width: number;
  height: number;
}

export interface BlurPipeline {
  /**
  Decodes the picked file far enough to draw and measure it.
  */
  load: (file: File) => Promise<LoadedImage>;
  detect: typeof detectFaces;
  paint: typeof paintBlurred;
  /**
  The blurred canvas as a file, or nothing if it could not be made.
  */
  toFile: typeof blurredFile;
}

export const browserPipeline: BlurPipeline = {
  // Scaled on the way in (task 128 · SAF-2, decision D-45): the long edge
  // is capped at `photoLongEdge`, so the canvas, the detector and the
  // upload all work at the size the photo will be stored at, and a 48 MP
  // frame costs neither the bandwidth nor the server's pixel budget.
  load: async (file) => {
    const source = await createImageBitmap(file);
    const size = fitWithin(source.width, source.height, photoLongEdge);
    const image = await createImageBitmap(source, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    });
    source.close();
    return { image, ...size };
  },
  detect: detectFaces,
  paint: paintBlurred,
  toFile: blurredFile,
};

export { type Detector } from "./detect";
export { type BlurRegion } from "./regions";
