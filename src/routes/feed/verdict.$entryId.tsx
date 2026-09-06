import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { useState } from "react";

import { entryTags } from "../../lib/contracts";
import { bandFloorC } from "../../lib/temperature";
import { getSession } from "../../modules/auth/functions";
import {
  entryDetailQuery,
  itemBandWearStatQuery,
  submitVerdictAction,
  uploadPhotoAction,
  verdictBandCountsQuery,
} from "../../modules/feed/functions";
import { redirectTo } from "../../modules/feed/redirect";
import { Bracketed, Layout } from "../../ui";

const VERDICT_CHOICES = [
  { value: -2, label: "Way cold" },
  { value: -1, label: "A bit cold" },
  { value: 0, label: "Dialed" },
  { value: 1, label: "A bit warm" },
  { value: 2, label: "Way warm" },
] as const;

// Mirrors modules/feed/photos.ts's ALLOWED_CONTENT_TYPES/MAX_PHOTOS_PER_ENTRY —
// duplicated rather than imported so this client component never pulls in
// that server module's D1/env-touching code (functions.ts is the sanctioned
// server boundary; see its file header).
const MAX_PHOTOS_PER_ENTRY = 4;
type AllowedPhotoType = "image/jpeg" | "image/png" | "image/webp";
const ALLOWED_PHOTO_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
function isAllowedPhotoType(value: string): value is AllowedPhotoType {
  return ALLOWED_PHOTO_TYPES.has(value);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x80_00;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export const Route = createFileRoute("/feed/verdict/$entryId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  loader: async ({ params }) => {
    const entry = await entryDetailQuery({ data: { entryId: params.entryId } });
    if (!entry) redirectTo({ to: "/feed" });
    const bandFloor = entry.conditions ? bandFloorC(entry.conditions.feelsLikeC) : undefined;
    const bandCounts =
      bandFloor === undefined
        ? undefined
        : await verdictBandCountsQuery({
            data: { bandFloorC: bandFloor, excludeEntryId: params.entryId },
          });
    return { entry, bandFloor, bandCounts };
  },
  component: VerdictPage,
});

function VerdictPage() {
  const { entryId } = Route.useParams();
  const { entry, bandFloor } = Route.useLoaderData();
  const navigate = useNavigate();

  const [verdict, setVerdict] = useState<number | undefined>(entry.verdict);
  const [tags, setTags] = useState<Set<string>>(new Set(entry.tags));
  const [isPublic, setIsPublic] = useState(entry.isPublic);
  const [flags, setFlags] = useState<Record<string, "too_much" | "not_enough" | "">>({});
  const [noted, setNoted] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [photoKeys, setPhotoKeys] = useState<string[]>(entry.photoKeys);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  async function handlePhotoSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    event.target.value = "";
    if (!files || files.length === 0) return;
    setPhotoError(undefined);
    setUploading(true);
    try {
      for (const file of files) {
        if (photoKeys.length >= MAX_PHOTOS_PER_ENTRY) {
          setPhotoError(`Up to ${String(MAX_PHOTOS_PER_ENTRY)} photos per entry.`);
          break;
        }
        if (!isAllowedPhotoType(file.type)) {
          setPhotoError("Photos must be JPEG, PNG, or WebP.");
          continue;
        }
        const photoBase64 = arrayBufferToBase64(await file.arrayBuffer());
        const { key } = await uploadPhotoAction({
          data: { entryId, contentType: file.type, dataBase64: photoBase64 },
        });
        setPhotoKeys((prev) => [...prev, key]);
      }
    } catch {
      setPhotoError("Couldn't upload that photo. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (verdict === undefined) return;
    setError(undefined);
    try {
      await submitVerdictAction({
        data: {
          entryId,
          verdict,
          isPublic,
          tags: [...tags] as (typeof entryTags)[number][],
          itemFlags: entry.items.map((item) => {
            const flagValue = flags[item.itemId];
            return {
              itemId: item.itemId,
              flag: flagValue === "" || flagValue === undefined ? undefined : flagValue,
            };
          }),
        },
      });
      const firstItem = entry.items[0];
      if (firstItem && bandFloor !== undefined) {
        const stat = await itemBandWearStatQuery({
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

  if (noted) {
    return (
      <Layout>
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
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <h1 className="font-display text-2xl uppercase leading-none">Verdict</h1>
        <div className="flex flex-col gap-2">
          {VERDICT_CHOICES.map((choice) => (
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
                  value={flags[item.itemId] ?? ""}
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
          {photoKeys.length < MAX_PHOTOS_PER_ENTRY ? (
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
    </Layout>
  );
}
