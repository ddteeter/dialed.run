/**
 * The geometry half of W3 — pure, so it can be tested without a canvas.
 *
 * Everything here is arithmetic on boxes. The drawing lives in
 * `./paint.ts` and the detector in `./detect.ts`, because those need a DOM
 * and a model respectively and this needs neither.
 */

/**
A rectangle in image pixels, origin top-left.
*/
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a region came from. The copy differs — "we blurred one face" is a
 * claim about detection, and a runner's own tap is not — and so does what
 * happens when the detector is re-run.
 */
export type RegionSource = "detected" | "tapped";

export interface BlurRegion extends Region {
  source: RegionSource;
}

/**
 * Grows a detected box so the blur covers more than the crop the detector
 * returned.
 *
 * Detectors return a tight box around facial landmarks. Blurring exactly
 * that leaves hairline, ears and jaw legible, which is the difference
 * between a blurred face and a recognisable person with a smudged nose.
 * 35% is chosen to cover the head rather than the face; it is a visual
 * judgement, not a measured one, and it is written down here rather than
 * inlined so it can be changed in one place.
 */
export const DETECTION_PADDING = 0.35;

export function padded(region: Region, ratio = DETECTION_PADDING): Region {
  const growX = region.width * ratio;
  const growY = region.height * ratio;
  return {
    x: region.x - growX / 2,
    y: region.y - growY / 2,
    width: region.width + growX,
    height: region.height + growY,
  };
}

/**
 * Clamps a region to the image, so a padded box at the edge does not ask
 * the canvas to read pixels that do not exist.
 *
 * Returns `undefined` when nothing of the region is inside the image — a
 * tap outside the photo, or a detection the padding pushed off it
 * entirely. A caller that drew a zero-width region would blur nothing
 * while believing it had.
 */
export function clamped(
  region: Region,
  imageWidth: number,
  imageHeight: number,
): Region | undefined {
  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const right = Math.min(imageWidth, region.x + region.width);
  const bottom = Math.min(imageHeight, region.y + region.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A square region centred on a tap.
 *
 * Sized from the image rather than fixed in pixels, so one tap covers
 * roughly a head whether the photo is 600px or 4000px wide. A tenth of the
 * short edge is about right for a mirror shot and generous for a distant
 * one, which is the correct way round: a runner who taps is telling us
 * they want something gone.
 */
export const TAP_SIZE_RATIO = 0.1;

export function tapRegion(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
): Region {
  const size = Math.min(imageWidth, imageHeight) * TAP_SIZE_RATIO;
  return { x: x - size / 2, y: y - size / 2, width: size, height: size };
}

/**
 * Maps a click on a displayed canvas back to image coordinates.
 *
 * The canvas is CSS-scaled to fit the column, so a tap at (100, 40) on
 * screen is somewhere else entirely in the photo. Getting this wrong
 * blurs the wrong part of the image, which looks like a broken feature
 * rather than a coordinate bug.
 */
export function toImageCoordinates(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  // A zero-sized rect means the element is not laid out yet; treating the
  // scale as 1 is wrong but finite, where dividing by zero is Infinity and
  // paints nothing anywhere.
  const scaleX = rect.width === 0 ? 1 : imageWidth / rect.width;
  const scaleY = rect.height === 0 ? 1 : imageHeight / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

/**
 * The sentence shown above the photo.
 *
 * **The wording is the artboard's and the distinctions in it are
 * deliberate.** "No face found", never "no face" — the app does not claim
 * certainty it has not got. And when there is no detector at all, it says
 * so rather than reporting a clean sweep it never made: "no face found"
 * after looking and "no face found" after not looking are the same
 * sentence describing very different states, and only one of them is
 * honest.
 */
export function blurSummary(params: {
  detector: "ran" | "unavailable";
  detected: number;
  tapped: number;
}): string {
  if (params.detector === "unavailable") {
    return params.tapped === 0
      ? "We couldn't check this photo. Tap anything you want blurred."
      : `You blurred ${countOf(params.tapped, "spot")}.`;
  }
  if (params.detected === 0) {
    return params.tapped === 0
      ? "No face found. Posting as-is."
      : `No face found. You blurred ${countOf(params.tapped, "spot")}.`;
  }
  const blurred = `We blurred ${countOf(params.detected, "face")}.`;
  return params.tapped === 0
    ? `${blurred} Missed something? Tap it to blur it too.`
    : `${blurred} You blurred ${countOf(params.tapped, "more spot")}.`;
}

/**
 * "one face" / "two faces" — words for small numbers, because this is a
 * sentence rather than a measurement. Bracket-notation mono is for values
 * the system measured; a count inside prose is not one.
 */
function countOf(count: number, noun: string): string {
  const WORDS = ["no", "one", "two", "three", "four", "five"];
  const word = WORDS[count] ?? String(count);
  return `${word} ${noun}${count === 1 ? "" : "s"}`;
}
