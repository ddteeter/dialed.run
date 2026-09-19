/**
 * Drawing the blur into the image.
 *
 * Kept apart from `./regions` (arithmetic, no DOM) and `./detect` (a
 * model, no drawing) so each is testable on its own terms: this one needs
 * a canvas, and only this one does.
 */
import { clamped, padded, type BlurRegion } from "./regions";

/**
 * How far down a region is scaled before being drawn back up.
 *
 * **Pixelation rather than `ctx.filter = "blur()"`, and the difference
 * matters.** A gaussian blur is a reversible-ish transform on a small
 * kernel — enough of the original signal survives that deblurring is a
 * known attack. Downsampling to a handful of pixels throws the
 * information away, and thrown-away information cannot be recovered from
 * the file a stranger downloads. The promise W3 makes is about what
 * leaves the device, so the weaker option is not good enough.
 */
export const PIXEL_BLOCKS = 6;

/**
 * Paints the photo and then destroys the pixels under each region.
 *
 * Regions are drawn one at a time onto the same canvas, so overlapping
 * taps compound rather than fighting. Detected regions are padded; tapped
 * ones are not — a runner tapping has already chosen the spot, and
 * growing it would move the blur away from where they pointed.
 */
export function paintBlurred(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  regions: readonly BlurRegion[],
): void {
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const context = canvas.getContext("2d");
  // Null only when the canvas already has a context of another type, which
  // cannot happen here — but a missing context should leave the photo
  // untouched rather than throw inside an upload. It is also what jsdom
  // returns, which is why every decision below lives in `paintOnto` and
  // this function is the three lines that cannot be tested without a
  // real browser.
  if (!context) return;
  paintOnto(context, image, imageWidth, imageHeight, regions);
}

/**
 * Everything `paintBlurred` decides, against a context rather than a
 * canvas.
 *
 * Split out because jsdom's `getContext("2d")` is null: with the drawing
 * inline, not one line of the padding, clamping or ordering could be
 * exercised by any test in either pool. A context is an interface a fake
 * can satisfy; a canvas is not.
 */
export function paintOnto(
  context: Pick<
    CanvasRenderingContext2D,
    "drawImage" | "canvas" | "imageSmoothingEnabled"
  >,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  regions: readonly BlurRegion[],
): void {
  context.drawImage(image, 0, 0, imageWidth, imageHeight);

  for (const region of regions) {
    const shape = clamped(
      // Detected boxes are padded; a tap is not. A runner tapping has
      // already chosen the spot, and growing it would move the blur away
      // from where they pointed.
      region.source === "detected" ? padded(region) : region,
      imageWidth,
      imageHeight,
    );
    if (shape === undefined) continue;
    pixelate(context, shape);
  }
}

/**
 * Replaces a rectangle with a scaled-down, scaled-up copy of itself.
 *
 * `imageSmoothingEnabled = false` on the way back up is what makes this
 * blocks rather than a soft smear; with smoothing on, the upscale
 * interpolates and reintroduces a plausible face.
 */
function pixelate(
  context: Pick<
    CanvasRenderingContext2D,
    "drawImage" | "canvas" | "imageSmoothingEnabled"
  >,
  shape: { x: number; y: number; width: number; height: number },
): void {
  const smallWidth = Math.max(1, Math.round(PIXEL_BLOCKS));
  const smallHeight = Math.max(
    1,
    Math.round((shape.height / shape.width) * PIXEL_BLOCKS),
  );

  const isPrevious = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    context.canvas,
    shape.x,
    shape.y,
    shape.width,
    shape.height,
    shape.x,
    shape.y,
    smallWidth,
    smallHeight,
  );
  context.drawImage(
    context.canvas,
    shape.x,
    shape.y,
    smallWidth,
    smallHeight,
    shape.x,
    shape.y,
    shape.width,
    shape.height,
  );
  context.imageSmoothingEnabled = isPrevious;
}

/**
 * The blurred image as a file to upload.
 *
 * **JPEG, and the original is never a fallback.** If the canvas cannot
 * produce a blob the upload does not happen — handing back the source
 * bytes "just this once" would send exactly the frame W3 promises never
 * leaves the device, and it would do it silently.
 */
export async function blurredFile(
  canvas: HTMLCanvasElement,
  fileName: string,
): Promise<File | undefined> {
  const blob = await new Promise<Blob | undefined>((resolve) => {
    canvas.toBlob(
      (result) => {
        resolve(result ?? undefined);
      },
      "image/jpeg",
      0.92,
    );
  });
  if (blob === undefined) return undefined;
  return new File([blob], fileName, { type: "image/jpeg" });
}
