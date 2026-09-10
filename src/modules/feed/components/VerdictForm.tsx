import { useNavigate } from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { useState } from "react";

import { entryTags, verdictScale } from "../../../lib/contracts";
import { newUlid } from "../../../lib/ids";
import {
  isAllowedPhotoType,
  maxPhotosPerEntry,
} from "../../../lib/photo-constraints";
import { Bracketed } from "../../../ui";
import type { entryDetailForViewer } from "../entries";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

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
  entryId,
  bandFloor,
  submitVerdict,
  uploadPhoto,
  itemBandWearStat,
}: Readonly<{
  entry: Entry;
  entryId: string;
  bandFloor: number | undefined;
  submitVerdict: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  uploadPhoto: (input: { data: FormData }) => Promise<{ key: string }>;
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
    Object.fromEntries(entry.items.map((item) => [item.itemId, item.flag ?? ""])),
  );
  const [noted, setNoted] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [photoKeys, setPhotoKeys] = useState<string[]>(entry.photoKeys);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  // Equivalent mutant on the fallback: every item is seeded above, so the
  // lookup always finds one. The `??` is `noUncheckedIndexedAccess`'s, not
  // the runtime's — and it is hoisted out of the JSX because a `Stryker
  // disable` comment does not attach inside an expression container.
  // Stryker disable next-line StringLiteral
  const flagFor = (itemId: string) => flags[itemId] ?? "";

  async function handlePhotoSelect(event: ChangeEvent<HTMLInputElement>) {
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
        // Multipart: the browser streams the file and nothing transcodes
        // it. TanStack passes FormData through to the server function
        // untouched (its types special-case it for POST).
        const upload = new FormData();
        upload.append("entryId", entryId);
        upload.append("photo", file);
        // One key per file, not per submission: each photo is its own
        // create, and they are uploaded in a loop.
        upload.append("idempotencyKey", newUlid());
        const { key } = await uploadPhoto({ data: upload });
        count += 1;
        setPhotoKeys((previous) => [...previous, key]);
      }
    } catch {
      setPhotoError("Couldn't upload that photo. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    // Equivalent mutant: the Save button is disabled until a verdict is
    // chosen, so this cannot be reached from the screen. It stays because
    // it is what narrows `verdict` to a number for the payload below.
    // Stryker disable next-line ConditionalExpression
    if (verdict === undefined) return;
    setError(undefined);
    try {
      await submitVerdict({
        data: {
          entryId,
          verdict,
          isPublic,
          tags: [...tags] as (typeof entryTags)[number][],
          itemFlags: entry.items.map((item) => {
            // `=== ""` alone: an item with no entry reads as undefined,
            // which is already the answer this returns for it.
            const flagValue = flags[item.itemId];
            return {
              itemId: item.itemId,
              flag: flagValue === "" ? undefined : flagValue,
            };
          }),
        },
      });
      const firstItem = entry.items[0];
      if (firstItem && bandFloor !== undefined) {
        const stat = await itemBandWearStat({
          data: { itemId: firstItem.itemId, bandFloorC: bandFloor },
        });
        setNoted(`${firstItem.name} is now ${String(stat.worn)} of ${String(stat.total)}`);
      } else {
        await navigate({ to: "/feed/entry/$entryId", params: { entryId } });
      }
    } catch {
      setError("Couldn't save that. Try again.");
    }
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <h1 className="font-display text-2xl uppercase leading-none">Verdict</h1>
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

        {entry.items.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase">Per-item notes</h2>
            {entry.items.map((item) => (
              <div key={item.itemId} className="flex items-center justify-between text-sm">
                <span>{item.name}</span>
                <select
                  value={flagFor(item.itemId)}
                  onChange={(event) => {
                    setFlags((prev) => ({
                      ...prev,
                      [item.itemId]: event.target.value as "too_much" | "not_enough" | "",
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
          {photoKeys.length < maxPhotosPerEntry ? (
            <label className="text-sm font-semibold text-pink">
              {uploading ? "Uploading…" : "Add a photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={uploading}
                onChange={(event) => {
                  void handlePhotoSelect(event);
                }}
                className="hidden"
              />
            </label>
          ) : undefined}
          {photoError ? <p className="text-sm font-semibold text-pink">{photoError}</p> : undefined}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {entryTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setTags((prev) => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag);
                    else next.add(tag);
                    return next;
                  });
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

        {error ? <p className="text-sm font-semibold text-pink">{error}</p> : undefined}

        <button
          type="button"
          disabled={verdict === undefined}
          onClick={() => {
            void submit();
          }}
          className="rounded-md bg-night px-4 py-3 font-semibold text-chalk disabled:opacity-40"
        >
          Save verdict
        </button>
    </div>
  );
}
