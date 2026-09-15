import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ToggleField } from "../../../ui";
import { setBlurPreference, shouldBlurFaces } from "../blur/preference";
import { browserPipeline, type BlurPipeline } from "../blur/pipeline";
import {
  blurSummary,
  tapRegion,
  toImageCoordinates,
  type BlurRegion,
} from "../blur/regions";

/**
 * W3 · FACES BLURRED, on the web.
 *
 * **The promise survives; the delivery changes.** The artboard says
 * "Detection runs on-device, so the unblurred frame never leaves the
 * phone". Here the detector runs in the browser and only the blurred
 * canvas is uploaded, so the sentence stays true — what changed is that
 * the device is a browser rather than a native app.
 *
 * **The copy never claims certainty it has not got.** "No face found",
 * never "no face"; and a browser where the detector could not load says
 * so rather than borrowing the sentence of one that ran. `blurSummary`
 * owns that distinction and is tested on it.
 *
 * **Tap-to-blur is not a fallback.** It is what makes the wording
 * honest — the artboard is explicit that recall is soft on profiles,
 * sunglasses and distant shots — so it is available whatever the detector
 * did, including when there is no detector at all.
 *
 * Nothing here animates: the Motion Doctrine's per-surface map does not
 * list this screen, so it stays still until design asks otherwise.
 */
export function PhotoBlur({
  file,
  onReady,
  pipeline = browserPipeline,
  storage,
}: Readonly<{
  file: File;
  /**
   * The bytes to upload. Called with the blurred file when blur is on and
   * produced one, and with the original when blur is off — never with the
   * original as a silent fallback for a blur that failed.
   */
  onReady: (ready: File) => void;
  pipeline?: BlurPipeline;
  /**
  Injected in tests; production reads `localStorage`.
  */
  storage?: Storage | undefined;
}>): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<{ image: ImageBitmap } | undefined>(undefined);

  const [isOn, setIsOn] = useState(() => shouldBlurFaces(storage));
  const [phase, setPhase] = useState<"checking" | "ran" | "unavailable">(
    "checking",
  );
  const [regions, setRegions] = useState<readonly BlurRegion[]>([]);
  const [size, setSize] = useState<{ width: number; height: number }>();

  /**
   * Repaints and hands the caller the bytes that should be uploaded.
   *
   * Kept in one place because the two must not drift: a canvas showing a
   * blurred face while the upload carries the original is the single
   * worst failure this component could have.
   */
  const publish = useCallback(
    async (next: readonly BlurRegion[]) => {
      const canvas = canvasRef.current;
      const loaded = loadedRef.current;
      if (!canvas || !loaded || !size) return;
      pipeline.paint(canvas, loaded.image, size.width, size.height, next);
      const blurred = await pipeline.toFile(canvas, file.name);
      // No fallback to `file`. Handing back the original because the
      // canvas failed would upload exactly the frame this screen promises
      // never leaves the device, and would do it silently.
      if (blurred !== undefined) onReady(blurred);
    },
    [file.name, onReady, pipeline, size],
  );

  useEffect(() => {
    // Read through a function, not as a variable or a property. Either of
    // those gets narrowed to `false` by the first check and every check
    // after it is then reported as dead code — exactly backwards, since
    // the point is that the cleanup writes it later, after an await this
    // narrowing does not account for.
    const effect = { isCancelled: false };
    const isStale = (): boolean => effect.isCancelled;
    async function run(): Promise<void> {
      if (!isOn) {
        // Blur off: the original is what gets uploaded, said plainly
        // rather than by omission. No detector is loaded — that is the
        // whole point of remembering a refusal.
        onReady(file);
        return;
      }
      const loaded = await pipeline.load(file);
      if (isStale()) return;
      loadedRef.current = { image: loaded.image };
      setSize({ width: loaded.width, height: loaded.height });

      const outcome = await pipeline.detect(loaded.image);
      if (isStale()) return;
      setPhase(outcome.status);
      setRegions(
        outcome.status === "ran"
          ? outcome.faces.map((face) => ({ ...face, source: "detected" }))
          : [],
      );
    }
    void run();
    return () => {
      effect.isCancelled = true;
    };
  }, [file, isOn, onReady, pipeline]);

  // Painting follows the regions rather than happening inside the handler
  // that changed them, so a detection and a tap take the same path.
  useEffect(() => {
    if (!isOn || !size) return;
    void publish(regions);
  }, [isOn, publish, regions, size]);

  const detected = regions.filter((r) => r.source === "detected").length;
  const tapped = regions.length - detected;

  return (
    <div className="flex flex-col gap-3">
      <ToggleField
        name="blurFaces"
        label="Blur faces"
        isOn={isOn}
        onChange={(next) => {
          setIsOn(next);
          setBlurPreference(next, storage);
        }}
        field={blurFieldProps}
      />
      <p className="text-xs text-night/60">
        Happens on your device, before upload.
      </p>

      {isOn ? (
        <>
          <p aria-live="polite" className="text-sm">
            {phase === "checking"
              ? "Checking this photo…"
              : blurSummary({
                  detector: phase === "ran" ? "ran" : "unavailable",
                  detected,
                  tapped,
                })}
          </p>
          <canvas
            ref={canvasRef}
            aria-label="Outfit photo. Tap a spot to blur it."
            className="h-auto w-full cursor-crosshair"
            onClick={(event) => {
              if (!size) return;
              const point = toImageCoordinates(
                event.clientX,
                event.clientY,
                event.currentTarget.getBoundingClientRect(),
                size.width,
                size.height,
              );
              setRegions((current) => [
                ...current,
                {
                  ...tapRegion(point.x, point.y, size.width, size.height),
                  source: "tapped",
                },
              ]);
            }}
          />
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-night/50">
            Tap to blur
          </p>
        </>
      ) : undefined}
    </div>
  );
}

/**
 * `ToggleField` wants the form-primitive field props, and this toggle is
 * not inside a form — it is a control on the photo, not a field being
 * saved. Supplying the shape rather than pretending there is a form is the
 * honest version; `useFormSubmit` owns the real one.
 */
function blurFieldProps(name: string) {
  return {
    name,
    readOnly: false,
    "aria-invalid": undefined,
    "aria-describedby": undefined,
    onInput: () => {
      // Nothing to clear: there is no field error to dismiss.
    },
  };
}
