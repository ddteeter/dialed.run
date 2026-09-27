import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import { ControlFailureBand, Mono, ToggleField } from "../../../ui";
import type { ControlFailure, PhotoStep } from "../../../ui";
import { setBlurPreference, shouldBlurFaces } from "../blur/preference";
import {
  browserPipeline,
  type BlurPipeline,
  type LoadedImage,
} from "../blur/pipeline";
import {
  BLUR_CELLS,
  BLUR_OFF_LINE,
  afterCell,
  afterTap,
  blurSummary,
  detectedRegions,
  isCellBlurred,
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
/**
 * What the screen says while the detector is still loading.
 *
 * A constant because it is said twice in two shapes — drawn with a
 * trailing ellipsis, announced without one — and two literals a character
 * apart is exactly the pair that drifts.
 */
const CHECKING = "Checking this photo";

/**
 * Blur off, and the canvas could not make a file from the redraw.
 *
 * Said rather than swallowed: with no file there is nothing to hand the
 * uploader, and a step that simply never calls `onReady` leaves the form
 * waiting on a photo that is not coming. The kicker names what is still
 * true — the round 23 control-failure pattern (`ui/ControlFailureBand`).
 */
const REDRAW_FAILED: ControlFailure = {
  kicker: "Photo not added",
  message: "This photo couldn't be prepared for upload.",
};

export function PhotoBlur({
  file,
  onReady,
  onAnnounce,
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
  /**
   * Puts a sentence in the **screen's** status region.
   *
   * W3's three sentences are named in the Accessibility Contract's
   * per-surface table — *"the three sentences (looking / blurred one /
   * couldn't look) go to the status region"* — and rule 08 allows the
   * screen exactly one. This screen's belongs to the verdict form, so it
   * arrives as a prop rather than being opened here: a second
   * `aria-live` beside the first means one of the two is lost, which is
   * what the contract's *"never silence, never twice"* rules out.
   *
   * Optional, because a photo can be blurred outside a form — and a
   * caller that cannot offer a region should not get a private one.
   */
  onAnnounce?: ((sentence: string) => void) | undefined;
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
   * Blur off's redraw came back empty (`REDRAW_FAILED`). `attempt` is what
   * "Try again" changes: the effect depends on it, so a retry reruns the
   * redraw rather than repeating a hand-off that never happened.
   *
   * A fresh object rather than a counter: nothing ever reads the value,
   * only whether it changed, and a counter made that fact a coincidence —
   * `current + 1` and `current - 1` are equally "different from last
   * time", so a mutant that decremented was indistinguishable from the
   * real code and survived. A new `{}` is a different reference by
   * construction on every call, with no operator a mutant can flip to
   * make it otherwise.
   */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState({});

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
      // Decoded either way (task 128 · SAF-2): the canvas step is where a
      // photo is scaled to its long edge and where its metadata — the GPS
      // a phone writes into every frame — is left behind, so blur off goes
      // through it too. What it skips is the detector.
      const decoded = await pipeline.load(file);
      if (isStale()) return;
      if (!isOn) {
        // Blur off: the photo as it was taken, redrawn onto a canvas no
        // one sees, and nothing looked for. No detector is loaded — that
        // is the whole point of remembering a refusal.
        const flat = globalThis.document.createElement("canvas");
        pipeline.paint(flat, decoded.image, decoded.width, decoded.height, []);
        const redrawn = await pipeline.toFile(flat, file.name);
        if (isStale()) return;
        // No fallback to `file` here either: the original is the frame
        // with the metadata in it. Nothing to hand over is a failure the
        // runner is shown, not a silence.
        if (redrawn === undefined) setFailed(true);
        else onReady(redrawn);
        return;
      }
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
  }, [attempt, file, isOn, onReady, pipeline]);

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

  // `phase` narrows to "ran" | "unavailable" here, which is exactly what
  // blurSummary wants. It used to be re-derived with a
  // `phase === "ran" ? "ran" : "unavailable"`, and that ternary was a
  // mutant no input could distinguish.
  const outcome =
    phase === "checking"
      ? CHECKING
      : blurSummary({ detector: phase, detected, tapped });

  /**
   * What the screen says about this photo, in one place.
   *
   * Hoisted out of the markup so it can be both rendered and announced
   * without the two drifting — the sentence a reader hears and the
   * sentence on screen are the same string, by construction.
   *
   * `undefined` with blur off: there is no outcome to report, because
   * nothing was looked at. Rule 08's "success is silent unless the runner
   * did something" — and declining the feature is not an outcome.
   */
  const summary = isOn ? outcome : undefined;

  /**
   * The same sentence, with the waiting device on it.
   *
   * **The ellipsis is drawn and never announced** (design, round 14): a
   * status region reads it out, and "checking this photo dot dot dot" is
   * the punctuation being spoken rather than the wait being conveyed.
   * X3's expected reading is "Checking this photo", with no trailing
   * character.
   */
  const shown = summary === CHECKING ? `${CHECKING}…` : summary;

  // Announced from an effect rather than during render: setting state in
  // another component while this one renders is the one thing React will
  // not have. The sentence is the dependency, so the region is written
  // once per change and not once per render — "never twice".
  useEffect(() => {
    if (summary !== undefined) onAnnounce?.(summary);
  }, [summary, onAnnounce]);

  // Blur off has no summary to announce, so its failure is announced on
  // its own — into the same one region.
  const failure = failed && !isOn ? REDRAW_FAILED : undefined;
  useEffect(() => {
    if (failure !== undefined) onAnnounce?.(failure.message);
  }, [failure, onAnnounce]);

  return (
    <div className="flex flex-col gap-3">
      <ToggleField
        name="blurFaces"
        label="Blur faces"
        isOn={isOn}
        onChange={(next) => {
          setFailed(false);
          setIsOn(next);
          setBlurPreference(next, storage);
        }}
        field={blurFieldProps}
      />
      <p className="text-micro text-quiet">
        Happens on your device, before upload.
      </p>

      {/* Visible copy, and **not a live region any more**. It was a second
          `aria-live` on a screen that already had the form's, which rule 08
          forbids and which loses one of the two announcements. The
          sentence still reaches a reader — through `onAnnounce`, into the
          one region the screen has.

          One slot for both states (round 22, item 22): blur off says what
          that means, in the same place and weight — "not a warning colour;
          the sentence does the work". */}
      <p className="text-small">{isOn ? shown : BLUR_OFF_LINE}</p>
      <ControlFailureBand
        failure={failure}
        onRetry={() => {
          setFailed(false);
          setAttempt({});
        }}
      />

      {isOn ? (
        <>
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
                setRegions((current) =>
                  afterTap(
                    current,
                    point.x,
                    point.y,
                    ready.width,
                    ready.height,
                  ),
                );
              }}
            />
          )}
          <p className="m-0 text-muted">
            <Mono step="sm">Tap to blur</Mono>
          </p>
          {ready === undefined ? undefined : (
            <BlurCells
              regions={regions}
              width={ready.width}
              height={ready.height}
              onToggle={(cell) => {
                setRegions((current) =>
                  afterCell(current, cell, ready.width, ready.height),
                );
              }}
            />
          )}
        </>
      ) : undefined}
    </div>
  );
}

/**
 * Tap-to-blur's keyboard path (D-84(b), the Accessibility Contract's
 * "buttons named by position ('Blur top-left')"): the photo in a 3 × 3
 * grid, one button a cell, each blurring its whole cell and pressed while
 * it does. A tap on a canvas has no keyboard equivalent; these are it.
 *
 * **Undrawn** — "what focusable blur targets look like" is a design ask.
 * Until it is answered they are text buttons in the pill grammar,
 * listed as a design delta.
 */
function BlurCells({
  regions,
  width,
  height,
  onToggle,
}: Readonly<{
  regions: readonly BlurRegion[];
  width: number;
  height: number;
  onToggle: (cell: number) => void;
}>): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Blur part of the photo"
      className="grid grid-cols-3 gap-2"
    >
      {BLUR_CELLS.map((name, cell) => (
        <button
          key={name}
          type="button"
          aria-pressed={isCellBlurred(regions, cell, width, height)}
          onClick={() => {
            onToggle(cell);
          }}
          className="target cursor-pointer rounded-pill border border-hairline bg-transparent px-2 py-2 text-small text-ink aria-pressed:border-ink aria-pressed:font-semibold"
        >
          Blur {name}
        </button>
      ))}
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

/**
 * W3's step in the shape every photo-taking screen's slot takes
 * (`ui/PhotoStep`), so a route hands it straight in —
 * `renderPhotoStep={photoBlurStep}` — rather than each route writing the
 * same arrow. The verdict's photos and the garment's go through the one
 * step.
 */
export const photoBlurStep: PhotoStep = (file, onReady, announce) => (
  <PhotoBlur file={file} onReady={onReady} onAnnounce={announce} />
);
