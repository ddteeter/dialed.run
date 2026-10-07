import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import { newUlid } from "../../../lib/ids";
import {
  photoAcceptAttribute,
  photoProblem,
} from "../../../lib/photo-constraints";
import {
  ControlFailureBand,
  FieldMessage,
  Icon,
  inFlight,
  Mono,
  ToggleField,
} from "../../../ui";
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
import type { DetectionOutcome } from "../blur/detect";

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
 * Said rather than swallowed: with no file there is nothing behind Use
 * this photo, and a press that silently does nothing leaves the runner
 * waiting on a photo that is not coming. The kicker names what is still
 * true — the round 23 control-failure pattern (`ui/ControlFailureBand`) —
 * and the body is round 27 #29's, which names the two ways out.
 */
const REDRAW_FAILED: ControlFailure = {
  kicker: "Photo not added",
  message:
    "This photo couldn't be prepared without blur. Turn blur on, or pick another photo.",
};

/**
 * The photo could not be decoded, or the blurred canvas could not be made
 * into a file — whichever way blur is set.
 *
 * Before this the step simply waited: an undecodable file was an
 * unhandled rejection and Use this photo stayed busy for good, with
 * nothing on screen saying why or what to do. The kicker is
 * `REDRAW_FAILED`'s, because what is still true is the same — nothing was
 * added — and the body names the two ways out that are on the screen.
 */
const PREPARE_FAILED: ControlFailure = {
  kicker: "Photo not added",
  message: "This photo couldn't be prepared. Pick another photo, or cancel.",
};

/**
 * The detector's own answer for "could not look" (`detectFaces` catches
 * everything and says this), for a pipeline whose detector throws anyway.
 * Not a failure band: a photo nobody could check is still a photo the
 * runner can blur by hand, and the copy for it already exists.
 */
const COULD_NOT_LOOK: DetectionOutcome = { status: "unavailable" };

/**
 * The picker's message, wired to it by `FieldMessage`'s id convention.
 */
const PICK_ANOTHER = "pick-another";

/**
 * W3 · CHECK THE BLUR (round 28 #5, D-76): the step stays open once
 * auto-blur paints, and **nothing is handed over until the runner presses
 * Use this photo**. Before round 28 the step called `onReady` the moment
 * the blur was painted, and every host closed it there, so tap-to-blur and
 * the keyboard cells were on screen for a beat (R-113).
 *
 * The API, for the hosts (closet's `usePhotoPick`, feed's `AttachKit`):
 *
 * - **`onReady(file)`** is called once, on Use this photo, with the bytes
 *   the canvas shows — blurred, or redrawn with blur off. Never the
 *   original, and never before the runner has said so. Close the step and
 *   take the file, as before.
 * - **`onCancel()`** is Cancel in the head, and Esc: close the step and
 *   add nothing. A photo already on the form stays.
 * - **Pick another** is the step's own: it opens the picker, and a new
 *   photo replaces this one here and auto-blur runs again. Dismissing the
 *   picker leaves the step as it was. The host is not involved, because
 *   whatever is picked comes back through the canvas and out as a fresh
 *   file anyway — but it is checked as the host's well checks a file
 *   (`photoProblem`, the one rule both ask), and one the upload would
 *   refuse is refused here, in the field's own message, with the photo
 *   before it left as it was.
 * - **A photo that cannot be prepared** — undecodable, or a canvas that
 *   makes no file — is the control-failure band (`PREPARE_FAILED`), and
 *   Use this photo goes: there is nothing behind it, and a press that
 *   waits forever is the failure the band replaces.
 *
 * Focus lands on the heading when the step opens, so Tab reaches the
 * cells before the primary.
 */
export function PhotoBlur({
  file,
  onReady,
  onCancel,
  onAnnounce,
  pipeline = browserPipeline,
  storage,
}: Readonly<{
  file: File;
  /**
   * The bytes to upload, on Use this photo. The blurred file when blur is
   * on, the redrawn one when it is off — never the original.
   */
  onReady: (ready: File) => void;
  /**
  Cancel and Esc: the runner adds nothing.
  */
  onCancel: () => void;
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
   * The photo Pick another chose, keyed so the body below starts over for
   * it — no regions, no decoded image and no bytes carried from the last
   * one. A ULID rather than a counter: a counter's `+ 1` and `- 1` are
   * both "a new key", so a mutant flipping one is invisible.
   */
  const [another, setAnother] = useState<{ file: File; key: string }>();
  /**
   * The bytes the canvas shows right now, or nothing while they are being
   * made. Use this photo hands over exactly these.
   */
  const [prepared, setPrepared] = useState<File>();
  /**
   * Why there is nothing to hand over and nothing coming, when that is the
   * state. Held here rather than in the body because it decides the foot:
   * with a failure there is no Use this photo.
   */
  const [failure, setFailure] = useState<ControlFailure>();
  /**
  What was wrong with the last file Pick another was given, if anything.
  */
  const [pickProblem, setPickProblem] = useState<string>();
  const [heading, setHeading] = useState<HTMLHeadingElement>();

  useEffect(() => {
    heading?.focus();
  }, [heading]);

  return (
    <div
      data-part="photo-check"
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          ref={(node) => {
            setHeading(node ?? undefined);
          }}
          tabIndex={-1}
          className="m-0 font-display text-heading"
        >
          Check the blur
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="target cursor-pointer border-none bg-transparent p-0 text-body font-semibold text-label"
        >
          Cancel
        </button>
      </div>
      <BlurBody
        key={another?.key}
        file={another?.file ?? file}
        onPrepared={setPrepared}
        failure={failure}
        onFailure={setFailure}
        onAnnounce={onAnnounce}
        pipeline={pipeline}
        storage={storage}
      />
      {failure === undefined ? (
        <button
          type="button"
          data-part="primary-action"
          {...inFlight(prepared === undefined)}
          onClick={() => {
            if (prepared !== undefined) onReady(prepared);
          }}
          className="target w-full cursor-pointer rounded-pill border-none bg-ink px-4 py-4 text-lead font-bold text-ground"
        >
          Use this photo
        </button>
      ) : undefined}
      {/* The picker's own input inside its label, as the well's Replace
          is (`ui/FileWell`): pressing it opens the picker with no script,
          and the input is what a keyboard reaches. */}
      <label className="target flex w-full cursor-pointer items-center justify-center rounded-pill border border-hairline bg-transparent px-4 py-4 text-lead font-semibold text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
        Pick another
        <input
          type="file"
          accept={photoAcceptAttribute}
          className="sr-only"
          data-part={PICK_ANOTHER}
          aria-invalid={pickProblem === undefined ? undefined : true}
          aria-describedby={
            pickProblem === undefined ? undefined : `${PICK_ANOTHER}-message`
          }
          onChange={(event) => {
            // Dismissing the picker is an empty list, and changes nothing.
            const [next] = event.currentTarget.files ?? [];
            if (next === undefined) return;
            const problem = photoProblem(next);
            setPickProblem(problem);
            if (problem !== undefined) {
              onAnnounce?.(problem);
              return;
            }
            // The last photo's bytes and band go in the new body's first
            // effect, the one place every restart clears them (see `run`).
            setAnother({ file: next, key: newUlid() });
          }}
        />
      </label>
      <FieldMessage name={PICK_ANOTHER} error={pickProblem} />
    </div>
  );
}

/**
 * The photo, the toggle, the sentence and the cells: everything W3 shows
 * between its head and its foot. It reports the bytes it would upload as
 * they change, and nothing while they are being made.
 */
function BlurBody({
  file,
  onPrepared,
  failure,
  onFailure,
  onAnnounce,
  pipeline,
  storage,
}: Readonly<{
  file: File;
  onPrepared: (ready: File | undefined) => void;
  failure: ControlFailure | undefined;
  onFailure: (failure: ControlFailure | undefined) => void;
  onAnnounce: ((sentence: string) => void) | undefined;
  pipeline: BlurPipeline;
  storage: Storage | undefined;
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
   * What "Try again" on the failure band changes: the effect depends on
   * it, so a retry decodes and redraws again rather than repeating a
   * hand-off that never happened.
   *
   * A fresh object rather than a counter: nothing ever reads the value,
   * only whether it changed, and a counter made that fact a coincidence —
   * `current + 1` and `current - 1` are equally "different from last
   * time", so a mutant that decremented was indistinguishable from the
   * real code and survived. A new `{}` is a different reference by
   * construction on every call, with no operator a mutant can flip to
   * make it otherwise.
   */
  const [attempt, setAttempt] = useState({});
  /**
   * The keyboard cell that has focus, if one does: round 27 #27's "focus
   * outlines the matching ninth on the canvas", so a runner tabbing
   * through the cells can see which part of the photo each one means.
   */
  const [focusedCell, setFocusedCell] = useState<number | undefined>();

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
      signal: AbortSignal,
    ) => {
      // The last bytes stop being these the moment the canvas changes: a
      // press of Use this photo while the new file is being made must not
      // hand over the one from before the tap.
      onPrepared(undefined);
      // And a band from a canvas that failed before stops being true once
      // a tap makes it paint again.
      onFailure(undefined);
      pipeline.paint(target, image.image, image.width, image.height, next);
      let blurred;
      try {
        blurred = await pipeline.toFile(target, file.name);
      } catch {
        // A canvas that throws is a canvas with no file: `undefined`, and
        // the band below.
      }
      // A newer paint has started since; its bytes are the ones to keep.
      if (signal.aborted) return;
      // No fallback to `file`. Handing back the original because the
      // canvas failed would upload exactly the frame this screen promises
      // never leaves the device, and would do it silently — so a canvas
      // with no file says so, rather than leaving Use this photo waiting.
      if (blurred === undefined) onFailure(PREPARE_FAILED);
      else onPrepared(blurred);
    },
    [file.name, onFailure, onPrepared, pipeline],
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
    // Whatever was ready is not ready for this photo, this setting or this
    // attempt: turning blur back on must not leave the unblurred redraw
    // one press from the upload.
    //
    // **The one place a restart clears them**, for every restart: a new
    // photo from the host or from Pick another (whose new body mounts
    // here), the toggle, and Try again. A second clear in each handler
    // was tried (design PR A review) and Stryker measured all five as
    // equivalent: React flushes a click's passive effects before it
    // returns from the event, so no press of Use this photo can land
    // between the handler and this line.
    onPrepared(undefined);
    onFailure(undefined);
    // Every await below is caught where it is made, so nothing this
    // effect starts can end as an unhandled rejection: a file the browser
    // cannot decode, or a canvas that throws, becomes the band.
    async function run(): Promise<void> {
      // Decoded either way (task 128 · SAF-2): the canvas step is where a
      // photo is scaled to its long edge and where its metadata — the GPS
      // a phone writes into every frame — is left behind, so blur off goes
      // through it too. What it skips is the detector.
      let decoded;
      try {
        decoded = await pipeline.load(file);
      } catch {
        // A file the browser cannot decode: `undefined`, and the band.
      }
      if (isStale()) return;
      if (decoded === undefined) {
        onFailure(PREPARE_FAILED);
        return;
      }
      if (!isOn) {
        // Blur off: the photo as it was taken, redrawn onto a canvas no
        // one sees, and nothing looked for. No detector is loaded — that
        // is the whole point of remembering a refusal.
        const flat = globalThis.document.createElement("canvas");
        pipeline.paint(flat, decoded.image, decoded.width, decoded.height, []);
        let redrawn;
        try {
          redrawn = await pipeline.toFile(flat, file.name);
        } catch {
          // A canvas that throws makes no file: the redraw band below.
        }
        if (isStale()) return;
        // No fallback to `file` here either: the original is the frame
        // with the metadata in it. Nothing to hand over is a failure the
        // runner is shown, not a silence.
        if (redrawn === undefined) onFailure(REDRAW_FAILED);
        else onPrepared(redrawn);
        return;
      }
      setLoaded(decoded);

      let outcome;
      try {
        outcome = await pipeline.detect(decoded.image);
      } catch {
        outcome = COULD_NOT_LOOK;
      }
      if (isStale()) return;
      setPhase(outcome.status);
      setRegions(detectedRegions(outcome));
    }
    void run();
    return () => {
      effect.abort();
    };
  }, [attempt, file, isOn, onFailure, onPrepared, pipeline]);

  // Painting follows the regions rather than happening inside the handler
  // that changed them, so a detection and a tap take the same path.
  // One value for "there is a decoded photo and blur is on", rather than
  // two conditions in the effect: the pair was two mutants where the fact
  // is one.
  const ready = isOn ? loaded : undefined;
  useEffect(() => {
    if (!canvas || !ready) return;
    const paint = new AbortController();
    void publish(regions, ready, canvas, paint.signal);
    return () => {
      paint.abort();
    };
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

  // A failure has no summary of its own, so it is announced on its own —
  // into the same one region.
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
            <div className="relative">
              <canvas
                ref={(node) => {
                  setCanvas(node ?? undefined);
                }}
                aria-label="Outfit photo. Tap a spot to blur it."
                className="block h-auto w-full cursor-crosshair"
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
              <Ninths focused={focusedCell} />
            </div>
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
              onFocusCell={setFocusedCell}
            />
          )}
        </>
      ) : undefined}
    </div>
  );
}

/**
 * The photo's nine parts, drawn over the canvas and seen, never heard:
 * the ninth the focused cell means wears the hi-viz outline (round 27
 * #27). Blurring shows on the canvas itself; this only says where.
 */
function Ninths({
  focused,
}: Readonly<{ focused: number | undefined }>): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3"
    >
      {BLUR_CELLS.map((name, cell) => (
        <span
          key={name}
          data-ninth={name}
          data-focused={cell === focused ? "true" : undefined}
          className="data-focused:outline-2 data-focused:-outline-offset-2 data-focused:outline-hi-viz"
        />
      ))}
    </div>
  );
}

/**
 * Tap-to-blur's keyboard path (R-84(b), the Accessibility Contract's
 * "buttons named by position ('Blur top-left')"): the photo in a 3 × 3
 * grid, one button a cell, each blurring its whole cell and pressed while
 * it does. A tap on a canvas has no keyboard equivalent; these are it.
 *
 * **Round 27 #27's map of the photo, not a row of pills**: 44px square
 * cells laid out as the photo is, a pressed one ink with the pack's
 * `check`, and focus telling the canvas which ninth to outline. The name
 * says the position, because the cell itself shows only whether it is
 * blurred.
 */
function BlurCells({
  regions,
  width,
  height,
  onToggle,
  onFocusCell,
}: Readonly<{
  regions: readonly BlurRegion[];
  width: number;
  height: number;
  onToggle: (cell: number) => void;
  onFocusCell: (cell: number | undefined) => void;
}>): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Blur by area"
      className="flex items-start gap-3"
    >
      <div className="grid shrink-0 grid-cols-3 gap-1">
        {BLUR_CELLS.map((name, cell) => {
          const isBlurred = isCellBlurred(regions, cell, width, height);
          return (
            <button
              key={name}
              type="button"
              aria-label={`Blur ${name}`}
              aria-pressed={isBlurred}
              onClick={() => {
                onToggle(cell);
              }}
              onFocus={() => {
                onFocusCell(cell);
              }}
              onBlur={() => {
                onFocusCell(undefined);
              }}
              className="target flex size-11 cursor-pointer items-center justify-center rounded-tight border border-ink bg-panel text-ground aria-pressed:bg-ink"
            >
              {isBlurred ? <Icon name="check" /> : undefined}
            </button>
          );
        })}
      </div>
      <p className="m-0 text-small text-label">
        Blur by area. Ink = blurred. The focused cell outlines its ninth of the
        photo.
      </p>
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
export const photoBlurStep: PhotoStep = (file, onReady, announce, cancel) => (
  <PhotoBlur
    file={file}
    onReady={onReady}
    onCancel={cancel}
    onAnnounce={announce}
  />
);
