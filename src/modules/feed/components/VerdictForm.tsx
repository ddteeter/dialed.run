import { useNavigate } from "@tanstack/react-router";
import type { ChangeEvent, ReactNode } from "react";
import { useRef, useState } from "react";

import { entryTags, verdictScale } from "../../../lib/contracts";
import { newUlid } from "../../../lib/ids";
import {
  isAllowedPhotoType,
  maxPhotosPerEntry,
} from "../../../lib/photo-constraints";
import {
  Bracketed,
  ChoiceList,
  FlowStep,
  FormErrorSummary,
  FormFailureBand,
  FieldGroup,
  FormField,
  FormStatus,
  LOG_FLOW,
  Mono,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";

/**
 * The chosen verdict, and the row that is not chosen.
 *
 * `verdict-lock` is only on the chosen one, and that asymmetry is the
 * move: "brackets close onto the chosen verdict, **then** the row locks"
 * (design/motion.js). The lock is a `reveal`-long delay before the ink
 * arrives, so the receipt reads first — and putting the same delay on the
 * resting class would make *un*-choosing linger for 320ms, which is a
 * receipt for something that did not happen. Removed with the class, the
 * revert is instant.
 */
/**
 * `justify-start`, not `justify-center`, and it is not a nicety.
 *
 * Four of the five labels are two words and wrap inside their cell;
 * "Dialed" is one. Centred, the short one floats to the middle of the cell
 * while its neighbours' first lines sit above it — five labels, no shared
 * baseline. The board aligns all five first lines, which a layout-signature
 * diff against it is what caught: the board reads
 * `['WAY','A BIT','DIALED','A BIT','WAY']` on one row, and this read
 * `['WAY COLD','A BIT COLD','A BIT WARM','WAY WARM']` with `['DIALED']`
 * alone on the next.
 */
/**
 * `relative` and a horizontal gutter, because the brackets frame the cell.
 *
 * Design round 18: *"the brackets frame the cell, not the words — they
 * start at the cell's outer edges, vertically centred … the pair never
 * enters the text."* So they are positioned against these edges rather
 * than sitting in the text flow, and `px-3` is the gutter they occupy.
 *
 * The gutter is on every cell, chosen or not. Adding it only to the chosen
 * one would re-flow that cell's label the instant it was picked — a layout
 * shift on the single most important input in the product, and on the one
 * frame the runner is actually watching.
 *
 * `justify-start`, not `justify-center`: four of the five labels are two
 * words and wrap; "Dialed" is one. Centred, the short one floats to the
 * middle of its cell while its neighbours' first lines sit above it, so
 * five labels share no baseline. Caught by diffing a layout signature
 * against the board, which reads all five on one row.
 */
const VERDICT_BASE =
  "relative flex flex-col items-center justify-start gap-0 rounded-card px-3 py-3 text-center text-micro font-semibold uppercase";

/**
 * A bracket, pinned to one edge of the cell and vertically centred.
 *
 * Out of the flow, which is the whole point of round 18's ruling: an
 * absolutely positioned child is not a flex item, so the cell's `flex-col`
 * cannot stack it as a row of its own, and a label wrapping to two lines
 * cannot split the pair. `inset-y-0` plus `items-center` is the "vertically
 * centred" half — against the cell's full height, so it stays centred
 * whether the label took one line or two.
 */
const BRACKET_BASE =
  "pointer-events-none absolute inset-y-0 flex items-center";

const VERDICT_CHOSEN = `verdict-lock ${VERDICT_BASE} bg-ink text-ground`;

/**
 * The per-item flag as three visible choices.
 *
 * `"none"` rather than `""`: a radio's value is a real string and an empty
 * one reads as "no value" to the platform, which is a different thing from
 * "the runner chose not to flag this". `payload()` maps it back to
 * `undefined`, which is what the contract stores.
 */
const ITEM_FLAG_OPTIONS = ["none", "too_much", "not_enough"] as const;

const ITEM_FLAG_LABELS: Readonly<Record<(typeof ITEM_FLAG_OPTIONS)[number], string>> =
  {
    none: "Fine",
    too_much: "Too much",
    not_enough: "Not enough",
  };

const VERDICT_RESTING = `${VERDICT_BASE} border border-hairline`;
import { submitVerdictInput } from "../inputs";
import type { entryDetailForViewer } from "../entries";
import { toggledIn } from "../../../lib/toggled-in";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
Field name -> human label, for the summary rows the contract requires once
two or more fields fail at once.
*/
const LABELS = {
  // "Did it work?", not "How it felt": design's A3 board carries this
  // wording and DS2's backlog header already shipped it in round 16, so
  // the two mirrored everywhere except here. Copy is the artboard's
  // domain; owner confirmed 2026-09-21.
  verdict: "Did it work?",
  tags: "Tags",
  itemFlags: "Per-item notes",
  isPublic: "Sharing",
};

/**
 * The verdict (screen A3) — the one screen the whole product turns on.
 *
 * A verdict is per-run, stored as -2..+2 with 0 meaning dialed, and the
 * per-item signal is a `flag`, not a second verdict (docs/contracts.md).
 * Photos are optional and capped; the cap and the allowed types are read
 * from `lib/photo-constraints` rather than restated, because the server
 * enforces the same two facts and a second copy would drift.
 */
/**
 * A screen shown between picking a photo and uploading it — W3's blur.
 *
 * It is handed the picked file and a callback for the bytes that should
 * actually be sent, which are not the same bytes.
 */
/**
 * The blur step, rendered by the route because it lives in
 * `modules/safety`.
 *
 * `announce` is the third argument because of rule 08: the step has three
 * sentences of its own to say and the screen is allowed **one**
 * `role="status"` region, which this form already mounts. Handing the
 * writer down is what stops the step opening a second one — which is
 * exactly what it used to do, and what made one of the two announcements
 * unreadable.
 */
type PhotoStep = (
  file: File,
  onReady: (ready: File) => void,
  announce: (sentence: string) => void,
) => ReactNode;

export function VerdictForm({
  entry,
  bandFloor,
  submitVerdict,
  uploadPhoto,
  renderPhotoStep,
  itemBandWearStat,
}: Readonly<{
  entry: Entry;
  bandFloor: number | undefined;
  submitVerdict: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  uploadPhoto: (input: { data: FormData }) => Promise<{ key: string }>;
  /**
   * W3's step between picking a photo and uploading it: the route hands
   * in something that takes the picked file and calls back with the bytes
   * to send. A render slot rather than a direct import, because this
   * module may not reach `modules/safety` — dependency-cruiser forbids
   * the deep import and the safety barrel reaches D1.
   *
   * Absent, a picked file is uploaded as-is, which is what every caller
   * did before W3 existed.
   */
  renderPhotoStep?: PhotoStep;
  itemBandWearStat: (input: {
    data: { itemId: string; bandFloorC: number };
  }) => Promise<{ worn: number; total: number }>;
}>) {
  const navigate = useNavigate();

  const [verdict, setVerdict] = useState<number | undefined>(entry.verdict);
  const [tags, setTags] = useState<Set<string>>(new Set(entry.tags));
  const [isPublic, setIsPublic] = useState(entry.isPublic);
  // Seeded from the entry, not from nothing.
  //
  // `entry.items[].flag` is what was saved last time, and starting empty
  // meant re-opening a verdict showed every piece as unflagged — so
  // saving again silently cleared flags the runner had set.
  const [flags, setFlags] = useState<
    Record<string, (typeof ITEM_FLAG_OPTIONS)[number]>
  >(() =>
    Object.fromEntries(
      entry.items.map((item) => [item.itemId, item.flag ?? "none"]),
    ),
  );
  const [noted, setNoted] = useState<string | undefined>();
  const [photoKeys, setPhotoKeys] = useState<string[]>(entry.photoKeys);
  // `entry.id`, not an `entryId` prop beside it — the same duplication
  // EntryDetail carried: two sources for one fact, one from the URL params
  // and one from the loader, which a route can silently disagree with
  // itself about.
  const entryId = entry.id;
  const [photoError, setPhotoError] = useState<string | undefined>();
  /**
   * A picked file waiting on W3's blur step. One at a time: the step is a
   * screen, and two of them at once is not a thing a runner can answer.
   */
  /**
   * The picked file and the step that will answer for it, together.
   *
   * **A pair rather than just the file, because the pair is the
   * invariant.** Only the branch that has a step sets this, so a held
   * file always has one — but TypeScript cannot see that across a state
   * update, so the render needed a `?.` for a case no input could reach.
   * Carrying the step makes the guarantee a type, and it also means the
   * step a runner is looking at is the one that opened, even if the
   * parent stops supplying one mid-way.
   */
  const [pending, setPending] = useState<
    { file: File; step: PhotoStep } | undefined
  >();
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);

  // Equivalent mutant on the fallback: every item is seeded above, so the
  // lookup always finds one. The `??` is `noUncheckedIndexedAccess`'s, not
  // the runtime's — and it is hoisted out of the JSX because a `Stryker
  // disable` comment does not attach inside an expression container.
  // Stryker disable next-line StringLiteral
  const flagFor = (itemId: string) => flags[itemId] ?? "none";

  /**
   * Uploads one file. Multipart: the browser streams it and nothing
   * transcodes it — TanStack passes FormData to the server function
   * untouched (its types special-case it for POST).
   */
  async function sendPhoto(file: File): Promise<void> {
    const upload = new FormData();
    upload.append("entryId", entryId);
    upload.append("photo", file);
    // One key per file, not per submission: each photo is its own create.
    upload.append("idempotencyKey", newUlid());
    const { key } = await uploadPhoto({ data: upload });
    setPhotoKeys((previous) => [...previous, key]);
  }

  /**
   * What the blur step handed back — the bytes that actually get sent.
   */
  async function handlePhotoReady(ready: File): Promise<void> {
    setPending(undefined);
    setUploading(true);
    try {
      await sendPhoto(ready);
    } catch {
      setPhotoError("Couldn't upload that photo. Try again.");
    } finally {
      // No `uploadInFlight` reset here: `handlePhotoSelect`'s own `finally`
      // already released it on the way out to the step, so a second reset
      // is a line that cannot change an answer.
      setUploading(false);
    }
  }

  async function handlePhotoSelect(event: ChangeEvent<HTMLInputElement>) {
    // The guard the `disabled` attribute used to be. A second selection
    // mid-upload would race the cap count below, which is counted locally
    // precisely because state does not settle between iterations.
    if (uploadInFlight.current) return;
    uploadInFlight.current = true;
    // Copy out of the live FileList BEFORE clearing the input. `files` is
    // a live view onto the input, so resetting `value` first empties it —
    // the loop below then saw zero files and the upload silently did
    // nothing, with no error to show for it. Clearing is still needed so
    // re-picking the same file fires `change` again.
    // Two equivalent mutants below. A `change` from a file input always
    // carries a `FileList` — empty when the picker was dismissed — so the
    // `[]` fallback is the compiler's, not the runtime's. And proceeding
    // with an empty list does nothing observable: the loop has no
    // iterations, and React batches the `uploading` flag on and off inside
    // one commit, so no render ever shows it. The guard is here to say
    // what it means, not because anything can see it.
    // Stryker disable next-line ArrayDeclaration,ConditionalExpression
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = "";
    // Stryker disable next-line ConditionalExpression
    if (files.length === 0) return;
    setPhotoError(undefined);
    setUploading(true);
    // Counted locally, not read back off state.
    //
    // `photoKeys` is captured when this render ran, and `setPhotoKeys`
    // inside the loop does not change it — so the cap check used to see
    // the same number on every iteration and a multi-select could put an
    // entry over the limit. The server refuses the extra one, which meant
    // the runner got "couldn't upload that photo" instead of being told
    // about the cap.
    let count = photoKeys.length;
    try {
      for (const file of files) {
        if (count >= maxPhotosPerEntry) {
          setPhotoError(`Up to ${String(maxPhotosPerEntry)} photos per entry.`);
          break;
        }
        if (!isAllowedPhotoType(file.type)) {
          setPhotoError("Photos must be JPEG, PNG, or WebP.");
          continue;
        }
        const step = renderPhotoStep;
        if (step !== undefined) {
          // W3: the picked file does not go anywhere until the blur step
          // hands back the bytes to send. Queued rather than uploaded, and
          // one at a time — the step is a screen, and two of them at once
          // is not a thing a runner can answer.
          setPending({ file, step });
          return;
        }
        await sendPhoto(file);
        count += 1;
      }
    } catch {
      setPhotoError("Couldn't upload that photo. Try again.");
    } finally {
      setUploading(false);
      uploadInFlight.current = false;
    }
  }

  /**
   * The whole A3 submission, validated by the same schema the server
   * function validates with — `submitVerdictInput`, not a copy of its
   * rules. The form's state is already the payload's shape, so unlike the
   * closet's there is no transform in between.
   *
   * **No `disabled` on the submit button any more.** The screen used to
   * enforce "pick a verdict" by disabling it, which §5 bans: a disabled
   * button drops focus, stops announcing, and tells nobody why nothing
   * happened. The schema refuses the submission with a reason instead.
   */
  const form = useFormSubmit({
    schema: submitVerdictInput,
    action: async (values) => submitVerdict({ data: values }),
    successMessage: "Verdict saved.",
    labels: LABELS,
    onSuccess: async () => {
      // The calibration note is the reason to log a verdict at all, so
      // when there is one the screen stays and shows it rather than
      // navigating away from it.
      const firstItem = entry.items[0];
      if (firstItem && bandFloor !== undefined) {
        const stat = await itemBandWearStat({
          data: { itemId: firstItem.itemId, bandFloorC: bandFloor },
        });
        setNoted(
          `${firstItem.name} is now ${String(stat.worn)} of ${String(stat.total)}`,
        );
        return;
      }
      await navigate({ to: "/feed/entry/$entryId", params: { entryId } });
    },
  });

  function payload() {
    return {
      entryId,
      verdict,
      isPublic,
      tags: [...tags] as (typeof entryTags)[number][],
      itemFlags: entry.items.map((item) => {
        // `=== "none"` alone: an item with no entry reads as undefined,
        // which is already the answer this returns for it.
        const flagValue = flags[item.itemId];
        return {
          itemId: item.itemId,
          flag: flagValue === "none" ? undefined : flagValue,
        };
      }),
    };
  }

  if (noted !== undefined) {
    return (
      <div className="mx-auto flex w-full max-w-panel flex-col items-center gap-4 px-5 pt-16 text-center">
        <Bracketed className="text-dialed-text">Noted</Bracketed>
        <p>{noted}</p>
        <button
          type="button"
          onClick={() => {
            void navigate({ to: "/feed/entry/$entryId", params: { entryId } });
          }}
          className="target rounded-pill bg-ink px-4 py-3 font-semibold text-ground"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <FlowStep step={LOG_FLOW.verdict}>
      <form
        ref={form.formRef}
        noValidate
        className="mx-auto flex w-full max-w-panel flex-col gap-6 px-5 pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit(payload());
        }}
      >
        <h1 className="font-display text-title uppercase">Verdict</h1>
        <FormStatus>{form.status}</FormStatus>
        <FormErrorSummary
          rows={form.summaryRows}
          onFocusField={form.focusField}
          summaryRef={form.summaryRef}
        />
        {/* **One row at every width — in the 390 panel too; never a
            stack, never wider than the panel** (design round 17). It was
            `flex flex-col`, which put five full-width buttons in a tall
            column and, at desk, a tall column beside a screen of empty
            space. `grid-cols-5` cannot wrap, which is the rule stated as
            a layout rather than remembered: the labels break inside their
            own cell instead of the row breaking.

            `FieldGroup`, not `FormField`, for the same round-17 ruling —
            "neither the row nor the chips sit inside a field box" — and
            because the box was suppressing each button's focus ring. */}
        <FieldGroup
          name="verdict"
          legend={LABELS.verdict}
          error={form.fieldErrors.verdict}
        >
          <div className="grid grid-cols-5 gap-1">
            {verdictScale.map((choice) => {
              const isChosen = verdict === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  // The chosen one was announced to nobody. Visually it is
                  // an ink inversion plus a pair of brackets, and the
                  // brackets are `aria-hidden` (they are a move, not a
                  // word) — so a reader heard five identical buttons and
                  // no indication of which was picked. Rule 01 is "remove
                  // every colour and the meaning survives", and here it
                  // did not.
                  //
                  // `aria-pressed`, not a `radiogroup`: the contract asks
                  // for five radios with arrow-key navigation, which is a
                  // behaviour change this lane may not make. A
                  // single-select toggle group is honest about what the
                  // control does today and announces the state; the
                  // radiogroup is D-84.
                  aria-pressed={isChosen}
                  onClick={() => {
                    setVerdict(choice.value);
                  }}
                  // `target` at the site rather than inside
                  // `VERDICT_BASE`: the 44px hit area is this button's,
                  // and `targets-and-focus` resolves a double-quoted
                  // constant but not a template literal — which both of
                  // these now are, since they share a base.
                  className={`target ${isChosen ? VERDICT_CHOSEN : VERDICT_RESTING}`}
                >
                  {isChosen ? (
                    <span
                      aria-hidden="true"
                      className={`bracket-close-start ${BRACKET_BASE} left-1`}
                    >
                      [
                    </span>
                  ) : undefined}
                  {choice.label}
                  {isChosen ? (
                    <span
                      aria-hidden="true"
                      className={`bracket-close-end ${BRACKET_BASE} right-1`}
                    >
                      ]
                    </span>
                  ) : undefined}
                </button>
              );
            })}
          </div>
        </FieldGroup>

        {entry.items.length > 0 ? (
          // **Chips, never a `<select>`** (design round 16). A dropdown
          // beside the kit reads as the verdict control — which is exactly
          // what happened when the owner watched the demo: he took this
          // for the verdict and asked why it did not match the backlog's.
          // `ChoiceList`'s own note has argued the case since it was
          // written: "a `<select>` hides its options behind a tap and
          // reads them out one at a time", and comparing the options is
          // how a runner picks.
          //
          // One group per garment, legended with the garment's name, so a
          // reader entering the group hears which piece it is about.
          <div className="flex flex-col gap-4">
            <h2>
              <Mono step="xs">Anything specific?</Mono>
            </h2>
            {entry.items.map((item) => (
              <ChoiceList
                key={item.itemId}
                name={`flag-${item.itemId}`}
                legend={item.name}
                layout="chips"
                options={ITEM_FLAG_OPTIONS}
                optionLabels={ITEM_FLAG_LABELS}
                value={flagFor(item.itemId)}
                field={form.field}
                onChange={(next) => {
                  setFlags((prev) => ({ ...prev, [item.itemId]: next }));
                }}
              />
            ))}
          </div>
        ) : undefined}

        <div className="flex flex-col gap-2">
          <h2>
            <Mono step="xs">Photos</Mono>
          </h2>
          {photoKeys.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {photoKeys.map((key) => (
                <img
                  key={key}
                  src={`/feed/photo/${key}`}
                  alt=""
                  className="aspect-square w-full rounded-field object-cover"
                />
              ))}
            </div>
          ) : undefined}
          {/*
            The field outlives the control. "Up to 4 photos per entry." is
            set exactly when the cap is reached — which is exactly when the
            Add-a-photo link stops rendering — so putting the message
            inside that conditional hid it in the one case it exists for.
          */}
          {photoError !== undefined || photoKeys.length < maxPhotosPerEntry ? (
            <FormField
              name="photo"
              label={uploading ? "Uploading…" : "Add a photo"}
              error={photoError}
            >
              {photoKeys.length < maxPhotosPerEntry ? (
                <input
                  id="photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  // Not `disabled` while uploading (§5): it drops focus and
                  // stops announcing. The re-entry guard is in the handler,
                  // where it can also survive a re-render.
                  aria-busy={uploading || undefined}
                  onChange={(event) => {
                    void handlePhotoSelect(event);
                  }}
                  className="text-body"
                />
              ) : undefined}
            </FormField>
          ) : undefined}

          {pending === undefined
            ? undefined
            : pending.step(
                pending.file,
                (ready) => {
                  void handlePhotoReady(ready);
                },
                form.announce,
              )}
        </div>

        <div className="flex flex-col gap-2">
          <h2>
            <Mono step="xs">Tags</Mono>
          </h2>
          <div className="flex flex-wrap gap-2">
            {entryTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setTags((prev) => toggledIn(prev, tag));
                }}
                className={
                  tags.has(tag)
                    ? "target rounded-pill bg-ink px-3 py-1 text-ground"
                    : "target rounded-pill border border-hairline px-3 py-1"
                }
              >
                <Mono step="xs">{tag.replaceAll("_", " ")}</Mono>
              </button>
            ))}
          </div>
        </div>

        <label className="target flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(event) => {
              setIsPublic(event.target.checked);
            }}
          />
          Share this — the verdict label shows on the post
        </label>

        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <SubmitButton
          label="Save verdict"
          pendingLabel="Saving"
          pending={form.pending}
        />
      </form>
    </FlowStep>
  );
}
