import { useRef, useState } from "react";
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
 * The pixel under the ring, as `#rrggbb`.
 *
 * A tap, deliberately: *"no magnifier, no drag"*. The image is drawn to an
 * offscreen canvas at its natural size and read once, so the reading is of
 * the photo rather than of whatever the browser scaled it to on screen.
 */
function sampleAt(
  image: HTMLImageElement,
  fractionX: number,
  fractionY: number,
): string | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.drawImage(image, 0, 0);
  const x = Math.floor(fractionX * image.naturalWidth);
  const y = Math.floor(fractionY * image.naturalHeight);
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
  if (red === undefined || green === undefined || blue === undefined) return;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
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
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const parsed = colorHexSchema.safeParse(hex.trim().toLowerCase());

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
              const image = imageRef.current;
              if (image === undefined) return;
              const box = event.currentTarget.getBoundingClientRect();
              const sampled = sampleAt(
                image,
                (event.clientX - box.left) / box.width,
                (event.clientY - box.top) / box.height,
              );
              if (sampled !== undefined) setHex(sampled);
            }}
          >
            <img
              ref={(node) => {
                imageRef.current = node ?? undefined;
              }}
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
              data-swatch={parsed.success ? parsed.data : undefined}
              className="shrink-0 rounded-tight border border-hairline"
              style={{
                width: SWATCH_PX,
                height: SWATCH_PX,
                backgroundColor: parsed.success ? parsed.data : "transparent",
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
            {parsed.error.issues[0]?.message}
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
