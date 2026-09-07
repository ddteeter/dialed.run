import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { useState } from "react";

import { requireSession } from "../../modules/auth/functions";
import {
  deleteItemFn,
  getItemFn,
  retireItemFn,
  unretireItemFn,
  uploadPhotoFn,
} from "../../modules/closet/functions";
import type { EffectiveAttributes } from "../../modules/closet/service";
import { garmentLabel } from "../../modules/closet/label";
import { Bracketed, Layout, Mono } from "../../ui";

export const Route = createFileRoute("/closet/$itemId")({
  loader: async ({ params }) => {
    await requireSession();
    const detail = await getItemFn({ data: { itemId: params.itemId } });
    return { detail };
  },
  component: GarmentDetailPage,
});

function attributeChips(effective: EffectiveAttributes): string[] {
  const chips: string[] = [];
  if (effective.weight) chips.push(effective.weight);
  if (effective.fabric) chips.push(effective.fabric);
  if (effective.windResistant) chips.push("wind resistant");
  if (effective.waterResistant) chips.push("water resistant");
  return chips;
}

function GarmentDetailPage() {
  const { detail } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);

  const { item, tempRange, performance, pairedItems, effective, isGeneric } =
    detail;
  // Same name for the heading and the photo's accessible name.
  const label = garmentLabel({
    name: item.name,
    brand: item.brand,
    isGeneric,
  });

  async function handleRetireToggle() {
    if (item.retired) {
      // Un-retiring: stay put. The badge disappearing is the confirmation,
      // and you are probably here because you wanted this item back.
      await unretireItemFn({ data: { itemId: item.id } });
      await router.invalidate();
      return;
    }
    await retireItemFn({ data: { itemId: item.id } });
    await router.invalidate();
    // Retiring: land on the closet with retired items shown, so the item
    // is visibly *there* and marked [Retired]. Navigating without the
    // filter would be worse than staying put — the grid hides retired
    // items by default, so it would simply appear to have vanished.
    //
    // There is no toast primitive in ui/ (an unspecced gap, now queued in
    // docs/design-deltas.md), and for this action showing where the thing
    // went beats announcing that something happened: the product rule is
    // retire, not delete, and this is what makes that visible.
    await navigate({ to: "/closet", search: { retired: true } });
  }

  async function handleDelete() {
    await deleteItemFn({ data: { itemId: item.id } });
    await navigate({ to: "/closet" });
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoError(undefined);
    const formData = new FormData();
    formData.set("itemId", item.id);
    formData.set("photo", file);
    const result = await uploadPhotoFn({ data: formData });
    setUploading(false);
    if (!result.ok) {
      setPhotoError(result.error);
      return;
    }
    await router.invalidate();
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8 sm:px-6">
        {item.photoKey === null ? undefined : (
          <img
            src={`/closet/photo/${item.id}/card`}
            alt={label}
            className="aspect-square w-full rounded-lg object-cover"
          />
        )}

        <div>
          <h1 className="font-display text-2xl uppercase tracking-[-0.01em]">
            {label}
          </h1>
          {isGeneric ? (
            <Bracketed className="text-xs">Generic</Bracketed>
          ) : undefined}
          {item.retired ? (
            <Bracketed className="ml-2 text-xs">Retired</Bracketed>
          ) : undefined}
        </div>

        <p className="text-sm text-night/70">
          {tempRange ? (
            <>
              Works at{" "}
              <Bracketed className="text-teal">
                {Math.round(tempRange.lowC)}–{Math.round(tempRange.highC)}°
              </Bracketed>
            </>
          ) : (
            <Bracketed>Untested</Bracketed>
          )}
        </p>

        {attributeChips(effective).length > 0 ? (
          <p className="text-sm text-night/70">
            {attributeChips(effective).join(" · ")}
          </p>
        ) : undefined}

        <p className="text-sm text-night/70">
          <Mono>
            {Math.round((performance?.summary.mileageM ?? 0) / 1000)} km
          </Mono>{" "}
          logged
          {performance !== undefined && performance.summary.verdictCount > 0 ? (
            <>
              {" "}
              ·{" "}
              <Mono>
                {performance.summary.dialedCount}/
                {performance.summary.verdictCount}
              </Mono>{" "}
              dialed
            </>
          ) : undefined}
        </p>

        {pairedItems.length > 0 ? (
          <p className="text-sm text-night/70">
            Pairs with{" "}
            {pairedItems.map((pair, index) => (
              <span key={pair.id}>
                {index > 0 ? ", " : undefined}
                {pair.name}
              </span>
            ))}
          </p>
        ) : undefined}

        <label className="flex flex-col gap-1 text-sm font-semibold">
          Photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(event) => {
              void handlePhotoChange(event);
            }}
          />
        </label>
        {photoError === undefined ? undefined : (
          <p className="text-sm font-semibold text-pink">{photoError}</p>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            to="/closet/edit/$itemId"
            params={{ itemId: item.id }}
            className="rounded-md border border-night/20 px-3 py-1.5 text-sm font-semibold"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={() => {
              void handleRetireToggle();
            }}
            className="rounded-md border border-night/20 px-3 py-1.5 text-sm font-semibold"
          >
            {item.retired ? "Unretire" : "Retire"}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleDelete();
            }}
            className="rounded-md border border-night/20 px-3 py-1.5 text-sm font-semibold text-pink"
          >
            Delete
          </button>
        </div>
      </div>
    </Layout>
  );
}
