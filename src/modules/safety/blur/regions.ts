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
 * The regions after a tap at `(x, y)`: a tapped spot under the finger is
 * undone, and anywhere else gains a new one.
 *
 * Round 22, item 22: *"You blurred 2 spots. Tap one to undo."* Only a
 * runner's own spots undo this way. A detected face is the app's claim,
 * and the Blur faces toggle is how a runner declines it — a tap on one
 * blurs a spot over it, the same as a tap anywhere else.
 *
 * The last spot under the finger goes, so on an overlap the undo takes
 * the one the runner put there most recently.
 */
export function afterTap(
  regions: readonly BlurRegion[],
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
): BlurRegion[] {
  const hit = regions.findLastIndex(
    (region) =>
      region.source === "tapped" &&
      x >= region.x &&
      x <= region.x + region.width &&
      y >= region.y &&
      y <= region.y + region.height,
  );
  if (hit !== -1) return regions.filter((_region, index) => index !== hit);
  return [
    ...regions,
    { ...tapRegion(x, y, imageWidth, imageHeight), source: "tapped" },
  ];
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
  // Only a detector that ran can have found anything, so the count alone
  // says whether there is a claim to make.
  const detected =
    params.detected > 0
      ? `We blurred ${countOf(params.detected, "face")}.`
      : undefined;
  // Round 22, item 22: once the runner has tapped, the line is theirs —
  // "You blurred 2 spots. Tap one to undo." — after the detector's claim
  // when it made one, and in place of "no face found" when it did not.
  if (params.tapped > 0) {
    // Digits, as the packet quotes the ruling ("2 spots"): the runner is
    // counting what they did, and the number is what the tap changes.
    const noun = detected ? "more spot" : "spot";
    const spots = `${String(params.tapped)} ${noun}${params.tapped === 1 ? "" : "s"}`;
    const yours = `You blurred ${spots}. Tap one to undo.`;
    return detected ? `${detected} ${yours}` : yours;
  }
  if (params.detector === "unavailable") {
    return "We couldn't check this photo. Tap anything you want blurred.";
  }
  return detected
    ? `${detected} Missed something? Tap it to blur it too.`
    : "No face found. Posting as-is.";
}

/**
 * W3's line with blur off (round 22, item 22), in the same slot as the
 * others: *"Not a warning colour; the sentence does the work."*
 */
export const BLUR_OFF_LINE =
  "Faces won't be blurred. Anyone in this photo can be recognised.";

/**
 * "one face" / "two faces" — words for small numbers, because this is a
 * sentence rather than a measurement. Bracket-notation mono is for values
 * the system measured; a count inside prose is not one.
 */
function countOf(count: number, noun: string): string {
  // Indexed from one, because every caller has already returned early on
  // zero — "no face found" and "no spots blurred" are different sentences
  // written elsewhere, so a "no" entry here was a slot no input reached.
  const WORDS = ["one", "two", "three", "four", "five"];
  const word = WORDS[count - 1] ?? String(count);
  return `${word} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The detector's answer as regions to blur.
 *
 * Pure, and here rather than inline in the component, because inline its
 * wrong branch was a crash rather than a wrong answer: reading
 * `outcome.faces` on an `unavailable` outcome throws inside a React
 * effect, which a test can only observe as the runner losing the screen.
 * Asked directly it is simply the wrong list.
 */
export function detectedRegions(outcome: DetectionAnswer): BlurRegion[] {
  return outcome.status === "ran"
    ? outcome.faces.map((face) => ({ ...face, source: "detected" }))
    : [];
}

/**
 * What a detector answered.
 *
 * Defined here, where the regions are, and imported by `detect.ts` as
 * `DetectionOutcome` rather than declared twice. A union rather than a
 * status plus an optional list: `faces` is not optional on an answer that
 * ran, and writing it as though it were needs a `?? []` for a case the
 * type already rules out.
 */
export type DetectionAnswer =
  { status: "ran"; faces: readonly Region[] } | { status: "unavailable" };
