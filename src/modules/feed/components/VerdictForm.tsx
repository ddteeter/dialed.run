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
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";
import { submitVerdictInput } from "../inputs";
import type { entryDetailForViewer } from "../entries";
import { toggledIn } from "../../../lib/toggled-in";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
Field name -> human label, for the summary rows the contract requires once
two or more fields fail at once.
*/
const LABELS = {
  verdict: "How it felt",
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
type PhotoStep = (file: File, onReady: (ready: File) => void) => ReactNode;

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
    Record<string, "too_much" | "not_enough" | "">
  >(() =>
    Object.fromEntries(
      entry.items.map((item) => [item.itemId, item.flag ?? ""]),
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
  const flagFor = (itemId: string) => flags[itemId] ?? "";

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
        // `=== ""` alone: an item with no entry reads as undefined, which
        // is already the answer this returns for it.
        const flagValue = flags[item.itemId];
        return {
          itemId: item.itemId,
          flag: flagValue === "" ? undefined : flagValue,
        };
      }),
    };
  }

  if (noted !== undefined) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-5 pt-16 text-center">
        <Bracketed className="text-teal">Noted</Bracketed>
        <p>{noted}</p>
        <button
          type="button"
          onClick={() => {
            void navigate({ to: "/feed/entry/$entryId", params: { entryId } });
          }}
          className="rounded-md bg-night px-4 py-3 font-semibold text-chalk"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      ref={form.formRef}
      noValidate
      className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit(payload());
      }}
    >
      <h1 className="font-display text-2xl uppercase leading-none">Verdict</h1>
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />
      <FormField
        name="verdict"
        label={LABELS.verdict}
        error={form.fieldErrors.verdict}
      >
        <div className="flex flex-col gap-2">
          {verdictScale.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => {
                setVerdict(choice.value);
              }}
              className={
                verdict === choice.value
                  ? "rounded-md bg-night px-4 py-3 text-left font-semibold text-chalk"
                  : "rounded-md border border-night/20 px-4 py-3 text-left"
              }
            >
              {choice.label}
            </button>
          ))}
        </div>
      </FormField>

      {entry.items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase">Per-item notes</h2>
          {entry.items.map((item) => (
            <div
              key={item.itemId}
              className="flex items-center justify-between text-sm"
            >
              <span>{item.name}</span>
              <select
                value={flagFor(item.itemId)}
                onChange={(event) => {
                  setFlags((prev) => ({
                    ...prev,
                    [item.itemId]: event.target.value as
                      "too_much" | "not_enough" | "",
                  }));
                }}
                className="rounded-md border border-night/20 px-2 py-1"
              >
                <option value="">No flag</option>
                <option value="too_much">Too much</option>
                <option value="not_enough">Not enough</option>
              </select>
            </div>
          ))}
        </div>
      ) : undefined}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase">Photos</h2>
        {photoKeys.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {photoKeys.map((key) => (
              <img
                key={key}
                src={`/feed/photo/${key}`}
                alt=""
                className="aspect-square w-full rounded-lg object-cover"
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
                className="text-sm"
              />
            ) : undefined}
          </FormField>
        ) : undefined}

        {pending === undefined
          ? undefined
          : pending.step(pending.file, (ready) => {
              void handlePhotoReady(ready);
            })}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase">Tags</h2>
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
                  ? "rounded-full bg-night px-3 py-1 text-xs text-chalk"
                  : "rounded-full border border-night/20 px-3 py-1 text-xs"
              }
            >
              {tag.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
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
  );
}
