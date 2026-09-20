import { useState } from "react";
import type { JSX } from "react";

import { colorHexSchema } from "../../../lib/contracts";
import { Mono, Sheet } from "../../../ui";

/**
 * Level 2 of design round 11 §AH — the exact shade.
 *
 * **Composed, not drawn.** Design's own instruction: *"Compose it, don't
 * draw it — this is the placement reference. Sheet, photo, one field, two
 * buttons, all existing primitives."* So there is no new glyph, no new
 * colour and no new radius here; the only thing that is not a `ui/`
 * primitive is the 18px square beside the field, and that one has design's
 * explicit blessing as **the only swatch in the product** — *"it's the
 * runner checking their own reading, not the app describing a garment."*
 *
 * **Level 2 is unreachable without level 1.** The sheet is opened from a
 * chosen name, never on its own, which is why `colorName` is a required
 * prop rather than an optional one: a hex with no name is a fidelity the
 * Call's rule has no use for.
 *
 * **No photo, no sampler.** The field stands alone rather than showing a
 * disabled affordance — a control that cannot do anything is worse than
 * one that is not there.
 *
 * The photo is served from `/closet/photo/:id/card`, same-origin, so
 * reading a pixel back off a canvas is allowed. A cross-origin image would
 * taint the canvas and `getImageData` would throw — which is why the
 * sampler reads the app's own copy and never a product page's.
 */
const SWATCH_PX = 18;

/**
 * Which pixel of the photo a tap landed on.
 *
 * Pure, and separate from the canvas work below, because the canvas is
 * what makes the rest untestable: a test environment with no 2d context
 * cannot execute a line of `sampleAt`, so every arithmetic decision in
 * here would be a mutant nothing could reach. The clamp is the reason it
 * is worth testing at all — a tap on the exact right or bottom edge gives
 * a fraction of 1, and `1 * width` is one pixel past the end.
 */
function clampToPixel(fraction: number, size: number): number {
  return Math.min(Math.max(Math.floor(fraction * size), 0), size - 1);
}

export function pixelAt(
  fractionX: number,
  fractionY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: clampToPixel(fractionX, width),
    y: clampToPixel(fractionY, height),
  };
}

/**
 * `#rrggbb`, lowercase and always six digits.
 *
 * Padded because a channel under 16 is one hex digit — a near-black pixel
 * would otherwise read `#0a11` and fail the schema that stores it.
 */
function channelHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function toHex(red: number, green: number, blue: number): string {
  return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`;
}

/**
 * `#rrggbb` from the four channels `getImageData` answers with.
 *
 * Takes the whole buffer rather than three numbers so the short-buffer
 * case is a branch a test can reach: `data[0]` is `number | undefined`
 * under `noUncheckedIndexedAccess`, and a guard written inside the canvas
 * code would be a branch nothing could ever execute.
 */
export function hexFromPixel(
  data: Uint8ClampedArray | readonly number[],
): string | undefined {
  // One guard, not three. Destructuring three channels reads as three
  // independent checks and is not: the buffer is long enough or it is not,
  // so `red === undefined` can only be true when the other two are too,
  // and two of the three could never decide anything.
  const channels = [...data].slice(0, 3);
  if (channels.length < 3) return;
  return `#${channels.map((channel) => channelHex(channel)).join("")}`;
}

/**
 * The pixel under the ring, as `#rrggbb`.
 *
 * A tap, deliberately: *"no magnifier, no drag"*. The image is drawn to an
 * offscreen canvas at its natural size and read once, so the reading is of
 * the photo rather than of whatever the browser scaled it to on screen.
 *
 * **Takes the tapped element, not an image.** The image is found from it,
 * which is what makes "there is no image" a case a test can produce — a
 * ref read inside a click handler is never unset by the time the handler
 * runs, so a guard on one is a branch no input can reach.
 */
export function sampleFromTarget(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): string | undefined {
  const image = target.querySelector("img");
  if (image === null) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.drawImage(image, 0, 0);
  const box = target.getBoundingClientRect();
  const { x, y } = pixelAt(
    (clientX - box.left) / box.width,
    (clientY - box.top) / box.height,
    image.naturalWidth,
    image.naturalHeight,
  );
  return hexFromPixel(context.getImageData(x, y, 1, 1).data);
}

export interface ShadeSheetProps {
  open: boolean;
  /**
   * The chosen name, sentence-cased — level 2 is reached from level 1.
   */
  colorName: string;
  value: string;
  /**
   * Absent when the garment has no photo: no photo, no sampler.
   */
  photoUrl?: string | undefined;
  onUse: (hex: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function ShadeSheet({
  open,
  colorName,
  value,
  photoUrl,
  onUse,
  onClear,
  onClose,
}: Readonly<ShadeSheetProps>): JSX.Element {
  const [hex, setHex] = useState(value);
  const parsed = colorHexSchema.safeParse(hex.trim().toLowerCase());
  // Transparent, never a guess: a square showing a colour the field does
  // not say is the one thing the product's only swatch must not do.
  const swatchColor = parsed.success ? parsed.data : "transparent";

  return (
    <Sheet open={open} onClose={onClose} label="Exact shade">
      <div className="flex flex-col gap-4">
        <h2 className="m-0 font-display text-heading">Exact shade</h2>
        <p className="m-0 text-muted">
          <Mono step="xs">{colorName} · optional</Mono>
        </p>

        {photoUrl === undefined ? undefined : (
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0"
            onClick={(event) => {
              const sampled = sampleFromTarget(
                event.currentTarget,
                event.clientX,
                event.clientY,
              );
              // A tap the canvas could not answer for leaves what the
              // runner typed alone, rather than blanking the field.
              if (sampled !== undefined) setHex(sampled);
            }}
          >
            <img
              src={photoUrl}
              alt="Tap to sample a shade from your photo"
              className="aspect-square w-full rounded-field object-cover"
            />
          </button>
        )}

        <label className="flex flex-col gap-2 text-muted" htmlFor="colorHex">
          <Mono step="sm">Hex</Mono>
          <span className="flex items-center gap-3">
            <input
              id="colorHex"
              name="colorHex"
              value={hex}
              onChange={(event) => {
                setHex(event.target.value);
              }}
              className="min-h-12 flex-1 rounded-field border border-hairline bg-ground px-4 py-3 text-ink"
            />
            {/* The only swatch in the product, and 18px because design said
                18px. It shows what the runner just read, so it is decorative
                — the hex beside it is the value, in words. */}
            <span
              aria-hidden="true"
              // The attribute is the rendered colour, not a second opinion
              // about it: one value, used twice, so a test can read what
              // the square actually shows without parsing a style string.
              data-swatch={swatchColor}
              className="shrink-0 rounded-tight border border-hairline"
              style={{
                width: SWATCH_PX,
                height: SWATCH_PX,
                backgroundColor: swatchColor,
              }}
            />
          </span>
        </label>
        <p className="m-0 text-small text-quiet">
          {photoUrl === undefined
            ? "Type it, or paste what the brand published."
            : "Tap the photo to sample, or type it."}
        </p>
        {parsed.success || hex.trim() === "" ? undefined : (
          <span className="self-start bg-failure px-3 py-2 text-small text-ink">
            {/* No join: React concatenates an array of strings, and a
                  separator between messages this schema can only ever
                  produce one of is a decision nothing could observe. */}
            {parsed.error.issues.map((issue) => issue.message)}
          </span>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            aria-disabled={parsed.success ? undefined : true}
            onClick={() => {
              if (parsed.success) onUse(parsed.data);
            }}
            className="cursor-pointer rounded-pill border-none bg-action px-6 py-3 font-display text-body uppercase text-ink"
          >
            Use this
          </button>
          <button
            type="button"
            onClick={() => {
              setHex("");
              onClear();
            }}
            className="cursor-pointer rounded-pill border border-hairline bg-transparent px-6 py-3 text-body font-semibold"
          >
            Clear
          </button>
        </div>
      </div>
    </Sheet>
  );
}
