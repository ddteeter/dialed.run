import { useNavigate } from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";

import { entryTags, verdictScale } from "../../../lib/contracts";
import type { Units, VerdictValue } from "../../../lib/contracts";
import { bandLabel } from "../../../lib/temperature";
import { newUlid } from "../../../lib/ids";
import {
  isAllowedPhotoType,
  maxPhotosPerEntry,
} from "../../../lib/photo-constraints";
import {
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
  verdictHue,
} from "../../../ui";
import type { PhotoStep } from "../../../ui";

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
 * `justify-center`: every label sits in the vertical middle of its cell,
 * as round 19's board draws all five (measured: text centre to cell centre,
 * 0px in each). A one-word label — "Dialed" — therefore sits between the
 * two lines of its neighbours rather than on their first line.
 *
 * It was `justify-start` for one round, and that was a misreading of a
 * board that has since changed. Round 18 drew the Dialed cell with *two*
 * lines ("DIALED" and "7 IN BAND"), so centring put its first line level
 * with its neighbours'; the build centred a one-line "Dialed" instead, a
 * layout-signature diff showed it floating off their first line, and
 * `justify-start` "fixed" that. Round 19 moved the count out of the cell,
 * leaving Dialed one line — and the board still centres. The owner saw
 * the top-aligned Dialed on film. The conformance spec now compares each
 * cell's alignment against the board's rather than asserting a rule
 * derived from one round's content.
 */
const VERDICT_BASE =
  "relative flex flex-col items-center justify-center gap-0 rounded-card px-3 py-3 text-center text-micro font-semibold uppercase";

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
const BRACKET_BASE = "pointer-events-none absolute inset-y-0 flex items-center";

/**
 * The chosen cell: its verdict's T2 hue, landing in the brackets' beat.
 *
 * **The hue is the verdict's, not "chosen"** (design round 19): *"the
 * chosen cell fills with its T2 hue — cold pink, dialed teal, warm quiet
 * grey — exactly as DS2's row does; --action is never a verdict fill."*
 * It was `bg-ink` here and `--action` pink on the board, so A3 and the
 * backlog that mirrors it read three different ways. `verdictHue` is the
 * one table both surfaces read, so they cannot drift again.
 *
 * `border` on both states, so choosing a cell swaps the border's colour
 * rather than adding one — no one-pixel shift on the frame the runner is
 * watching.
 *
 * `verdict-lock` is only on the chosen cell: the fill lands on the same
 * duration and curve as the brackets, one beat (round 19, `motion.js`).
 * Removed with the class, an un-chosen cell reverts at once.
 */
function verdictChosen(value: VerdictValue): string {
  return `verdict-lock ${VERDICT_BASE} border ${verdictHue(value)}`;
}

const VERDICT_RESTING = `${VERDICT_BASE} border border-hairline`;
import { submitVerdictInput } from "../inputs";
import { BandHistory } from "./BandHistory";
import { NotedReceipt } from "./NotedReceipt";
import { SpecificsSheet } from "./SpecificsSheet";
import { VerdictChips } from "./VerdictChips";
import type { BandSignals } from "../band-signals";
import { suggestChips } from "../chips";
import type { Chip, Flag, ItemFlagChoice } from "../chips";
import type { entryDetailForViewer } from "../entries";
import { toggledIn } from "../../../lib/toggled-in";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
Field name -> human label, for the summary rows the contract requires once
two or more fields fail at once.
*/
/**
 * The id tying the share toggle to the sentence beneath it. One verdict
 * form per page, so a constant is enough and `useId` would be a hook for
 * nothing.
 */
const SHARE_HINT_ID = "verdict-share-hint";

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
export function VerdictForm({
  entry,
  bandFloor,
  submitVerdict,
  uploadPhoto,
  renderPhotoStep,
  itemBandWearStat,
  units,
  history,
}: Readonly<{
  entry: Entry;
  bandFloor: number | undefined;
  /**
   * The runner's own units, for the band in the history line and in
   * Noted's sentence ("…8 of 9 in 38–46°").
   */
  units: Units;
  /**
   * This runner's history in the run's band, both halves read over the
   * same in-band entries: `counts`, their verdicts keyed −2..+2, for the
   * line beneath the row (D-97); `signals`, each kit garment's record and
   * the tag use, for the generated chips (round 20). Absent when the run
   * has no conditions, and therefore no band — then the line is not drawn
   * and the chips suggest no garment.
   */
  history:
    | {
        counts: Readonly<Record<number, number>>;
        signals: BandSignals;
      }
    | undefined;
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
  const [flags, setFlags] = useState<Record<string, ItemFlagChoice>>(() =>
    Object.fromEntries(
      entry.items.map((item) => [item.itemId, item.flag ?? "none"]),
    ),
  );
  const [noted, setNoted] = useState<string | undefined>();
  const [sheetOpen, setSheetOpen] = useState(false);
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
          `${firstItem.name} is now ${String(stat.worn)} of ${String(stat.total)} in ${bandLabel(bandFloor, units.temp)}.`,
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

  // After Log it the form becomes its own receipt (design round 20): the
  // answer stays on screen, read-only, and Noted takes the submit's place.
  const isLocked = noted !== undefined;

  // The answer as the chip rule reads it: Fine is the default and is never
  // a chip, so "none" is simply not a choice here.
  const chosenFlags: Record<string, Flag> = {};
  for (const [itemId, flag] of Object.entries(flags)) {
    if (flag !== "none") chosenFlags[itemId] = flag;
  }
  const chips = suggestChips({
    verdict,
    kit: entry.items,
    records: history?.signals.garments ?? {},
    tagUse: history?.signals.tagUse ?? {},
    chosenFlags,
    chosenTags: tags,
  });

  function setFlag(itemId: string, flag: ItemFlagChoice): void {
    setFlags((prev) => ({ ...prev, [itemId]: flag }));
  }

  function toggleTag(tag: string): void {
    setTags((prev) => toggledIn(prev, tag));
  }

  /**
   * A chip toggles the one choice it names. A pressed garment chip goes
   * back to Fine, not to the other direction — un-choosing is all a second
   * tap on it can mean.
   */
  function toggleChip(chip: Chip, isPressed: boolean): void {
    if (chip.kind === "tag") toggleTag(chip.tag);
    else setFlag(chip.itemId, isPressed ? "none" : chip.flag);
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
          <div
            // The name design's board gives this region
            // (`data-part="verdict-row"`), so a conformance run can diff
            // the two against each other rather than the whole screen —
            // and so a failure reports as "A3 verdict row". `data-slot` is
            // this repo's existing spelling of the same idea; `top-bar`
            // and `tab-bar` already match design's names for free.
            data-slot="verdict-row"
            className="grid grid-cols-5 gap-1"
          >
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
                  // Read-only once logged, and still focusable: rule 07
                  // bans `disabled`, and a receipt is for reading.
                  aria-disabled={isLocked || undefined}
                  onClick={() => {
                    if (!isLocked) setVerdict(choice.value);
                  }}
                  // `target` at the site rather than inside
                  // `VERDICT_BASE`: the 44px hit area is this button's,
                  // and `targets-and-focus` resolves a double-quoted
                  // constant but not a template literal — which both of
                  // these now are, since they share a base.
                  className={`target ${isChosen ? verdictChosen(choice.value) : VERDICT_RESTING}`}
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

        {history === undefined || bandFloor === undefined ? undefined : (
          <BandHistory
            counts={history.counts}
            bandFloor={bandFloor}
            units={units}
          />
        )}

        {/* **Chips, never a `<select>`** (design round 16), and since
            round 20 generated rather than listed: five, chosen from this
            runner's history in the band, with everything else one tap away
            in A3b. */}
        <VerdictChips
          chips={chips}
          chosenFlags={chosenFlags}
          chosenTags={tags}
          readOnly={isLocked}
          onToggle={toggleChip}
          onMore={() => {
            setSheetOpen(true);
          }}
        />
        <SpecificsSheet
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
          }}
          items={entry.items}
          flagFor={flagFor}
          onFlag={setFlag}
          tags={tags}
          onTag={toggleTag}
          field={form.field}
        />

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

        {isLocked ? (
          <NotedReceipt sentence={noted} />
        ) : (
          <>
            {/* A3's share-toggle as round 19 draws it: "Share to feed", with
              what sharing means on the line beneath. The line is outside the
              label and linked with `aria-describedby`, so the checkbox's
              accessible name stays the three words and the sentence is read
              as its description. It was "Share this — the verdict label
              shows on the post", one line inside the label. */}
            <div className="flex flex-col gap-1">
              <label className="target flex items-center gap-2 text-body">
                <input
                  type="checkbox"
                  checked={isPublic}
                  aria-describedby={SHARE_HINT_ID}
                  onChange={(event) => {
                    setIsPublic(event.target.checked);
                  }}
                />
                Share to feed
              </label>
              <span id={SHARE_HINT_ID} className="text-small text-muted">
                Shared runs show your kit, conditions, and your verdict.
              </span>
            </div>

            <FormFailureBand
              failure={form.failure}
              onRetry={form.retry}
              retryRef={form.retryRef}
            />
            <SubmitButton
              label="Log it"
              pendingLabel="Logging"
              pending={form.pending}
            />
          </>
        )}
      </form>
    </FlowStep>
  );
}
