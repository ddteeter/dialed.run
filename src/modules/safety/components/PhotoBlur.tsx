import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import { ToggleField } from "../../../ui";
import { setBlurPreference, shouldBlurFaces } from "../blur/preference";
import {
  browserPipeline,
  type BlurPipeline,
  type LoadedImage,
} from "../blur/pipeline";
import {
  blurSummary,
  detectedRegions,
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
  /**
   * The canvas, held as state through a callback ref rather than in a
   * `useRef`.
   *
   * A ref is never `null` by the time the paint effect runs, so the guard
   * it needed was a branch no input could reach. As state it is genuinely
   * absent until the element mounts — and it only mounts once there is a
   * photo to draw — so the effect's dependency on it is real and the
   * check is a fact rather than a formality.
   */
  const [canvas, setCanvas] = useState<HTMLCanvasElement>();

  const [isOn, setIsOn] = useState(() => shouldBlurFaces(storage));
  const [phase, setPhase] = useState<"checking" | "ran" | "unavailable">(
    "checking",
  );
  const [regions, setRegions] = useState<readonly BlurRegion[]>([]);
  /**
   * The decoded image and its dimensions, in one piece of state.
   *
   * They used to be a ref for the image and separate state for the size,
   * written one line apart and therefore always both present or both
   * absent — which meant every reader carried two checks for one fact and
   * neither of them could be wrong on its own. Three guards in this file
   * were that shape.
   */
  const [loaded, setLoaded] = useState<LoadedImage>();

  /**
   * Repaints and hands the caller the bytes that should be uploaded.
   *
   * Kept in one place because the two must not drift: a canvas showing a
   * blurred face while the upload carries the original is the single
   * worst failure this component could have.
   */
  const publish = useCallback(
    async (
      next: readonly BlurRegion[],
      image: LoadedImage,
      target: HTMLCanvasElement,
    ) => {
      pipeline.paint(target, image.image, image.width, image.height, next);
      const blurred = await pipeline.toFile(target, file.name);
      // No fallback to `file`. Handing back the original because the
      // canvas failed would upload exactly the frame this screen promises
      // never leaves the device, and would do it silently.
      if (blurred !== undefined) onReady(blurred);
    },
    [file.name, onReady, pipeline],
  );

  useEffect(() => {
    // An AbortController rather than a mutable flag object. The flag
    // needed an initial `false` that nothing could observe — the cleanup
    // writes the property whether or not it started there — and reading
    // it through a function to dodge TypeScript's narrowing, which treats
    // every check after the first as dead code. A signal has neither
    // problem and says what it means.
    const effect = new AbortController();
    const isStale = (): boolean => effect.signal.aborted;
    async function run(): Promise<void> {
      if (!isOn) {
        // Blur off: the original is what gets uploaded, said plainly
        // rather than by omission. No detector is loaded — that is the
        // whole point of remembering a refusal.
        onReady(file);
        return;
      }
      const decoded = await pipeline.load(file);
      if (isStale()) return;
      setLoaded(decoded);

      const outcome = await pipeline.detect(decoded.image);
      if (isStale()) return;
      setPhase(outcome.status);
      setRegions(detectedRegions(outcome));
    }
    void run();
    return () => {
      effect.abort();
    };
  }, [file, isOn, onReady, pipeline]);

  // Painting follows the regions rather than happening inside the handler
  // that changed them, so a detection and a tap take the same path.
  // One value for "there is a decoded photo and blur is on", rather than
  // two conditions in the effect: the pair was two mutants where the fact
  // is one.
  const ready = isOn ? loaded : undefined;
  useEffect(() => {
    if (!canvas || !ready) return;
    void publish(regions, ready, canvas);
  }, [canvas, publish, ready, regions]);

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
            {/* `phase` narrows to "ran" | "unavailable" here, which is
                exactly what blurSummary wants. It used to be re-derived
                with a `phase === "ran" ? "ran" : "unavailable"`, and that
                ternary was a mutant no input could distinguish. */}
            {phase === "checking"
              ? "Checking this photo…"
              : blurSummary({ detector: phase, detected, tapped })}
          </p>
          {/* Rendered only once there is a decoded photo. A canvas on
              screen while the copy still says "checking" is a blank
              rectangle that accepts taps it cannot place — and the guard
              that used to catch that lived inside the handler, where a
              throw is swallowed and no test can see it. */}
          {ready === undefined ? undefined : (
            <canvas
              ref={(node) => {
                setCanvas(node ?? undefined);
              }}
              aria-label="Outfit photo. Tap a spot to blur it."
              className="h-auto w-full cursor-crosshair"
              onClick={(event) => {
                const point = toImageCoordinates(
                  event.clientX,
                  event.clientY,
                  event.currentTarget.getBoundingClientRect(),
                  ready.width,
                  ready.height,
                );
                setRegions((current) => [
                  ...current,
                  {
                    ...tapRegion(point.x, point.y, ready.width, ready.height),
                    source: "tapped",
                  },
                ]);
              }}
            />
          )}
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
