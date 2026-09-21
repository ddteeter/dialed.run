import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { GarmentVisibility } from "../../../lib/contracts";
import { formatTempRange } from "../../../lib/thermal";
import {
  Bracketed,
  inFlight,
  Mono,
  PendingLabel,
  ProductLink,
  useFileDrop,
} from "../../../ui";
import { garmentLabel } from "../label";
import { CompositionBlock } from "./Composition";
import type {
  EffectiveAttributes,
  WardrobeItemRow,
  getItemDetail,
} from "../service";

/**
`getItemFn` assembles the paired items alongside the detail, so the shape
this renders is the detail plus that list.
*/
type Detail = Awaited<ReturnType<typeof getItemDetail>> & {
  pairedItems: WardrobeItemRow[];
};

/**
 * One garment, in full (screen E).
 *
 * The retire/unretire pair is the decision worth reading twice.
 * **Retire, don't delete** is a product rule, and where it lands the user
 * afterwards is how the rule becomes visible: retiring navigates to the
 * closet *with retired items shown*, so the piece is plainly there and
 * marked, while un-retiring stays put because the badge disappearing is
 * the whole confirmation. Navigating on retire without the filter would be
 * worse than staying — the grid hides retired items, so the piece would
 * appear to have been deleted by the very action that promises not to.
 *
 * There is no toast primitive in `ui/` (an unspecced gap, queued in
 * docs/design-deltas.md); showing where the thing went beats announcing
 * that something happened.
 */
/**
 * The identity line — §AH rule 08, "garment detail carries the name on the
 * identity line — LONG SLEEVE · NAVY · OBSIDIAN — the way AG carries
 * composition. Not the closet grid, not a filter, **no swatch.**"
 *
 * The colour name and the colourway are both words here, and that is the
 * rule rather than an omission: hue means verdict everywhere in this app,
 * so a navy dot beside a teal bracket would be a third accent that means
 * nothing. `colorName` is the structured one and `color` is what the
 * runner typed; a piece can carry either, both, or neither.
 *
 * `plain` visibility is not shown. All three values are stored because the
 * Call's rule needs to tell "plain" from "not answered", but "plain" on a
 * detail screen is a line that says nothing — the two worth reading are
 * the two that change how a garment is seen.
 */
function attributeChips(
  effective: EffectiveAttributes,
  item: WardrobeItemRow,
): string[] {
  const chips: string[] = [];
  if (effective.weight) chips.push(effective.weight);
  if (effective.fabric) chips.push(effective.fabric);
  if (effective.windResistant) chips.push("wind resistant");
  if (effective.waterResistant) chips.push("water resistant");
  if (item.visibilityLevel && item.visibilityLevel !== "plain") {
    chips.push(VISIBILITY_WORDS[item.visibilityLevel]);
  }
  if (item.colorName) chips.push(item.colorName);
  if (item.color) chips.push(item.color);
  return chips;
}

const VISIBILITY_WORDS = {
  reflective: "reflective trim",
  hi_viz: "hi-viz",
} as const satisfies Record<Exclude<GarmentVisibility, "plain">, string>;

export function GarmentDetail({
  detail,
  retire,
  unretire,
  remove,
  uploadPhoto,
}: Readonly<{
  detail: Detail;
  retire: (input: { data: { itemId: string } }) => Promise<unknown>;
  unretire: (input: { data: { itemId: string } }) => Promise<unknown>;
  remove: (input: { data: { itemId: string } }) => Promise<unknown>;
  uploadPhoto: (input: {
    data: FormData;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}>) {
  const navigate = useNavigate();
  const router = useRouter();
  const [photoError, setPhotoError] = useState<string | undefined>();
  const photoDrop = useFileDrop((files) => {
    void handlePhotoFiles(files);
  });
  const [uploading, setUploading] = useState(false);

  const {
    item,
    tempRange,
    performance,
    pairedItems,
    effective,
    isGeneric,
    composition,
  } = detail;
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
      await unretire({ data: { itemId: item.id } });
      await router.invalidate();
      return;
    }
    await retire({ data: { itemId: item.id } });
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
    await remove({ data: { itemId: item.id } });
    await navigate({ to: "/closet" });
  }

  /**
   * One path for a chosen file and a dropped one (Desktop Contract bend 1,
   * "do not fork it"). `FileList | null` rather than the change event,
   * because a drop has no input to read it from — and everything after
   * this line, W3's blur included, is reached identically either way.
   */
  async function handlePhotoFiles(files: FileList | null) {
    // The guard the `disabled` attribute used to be. `aria-disabled` on an
    // input does not stop the picker opening (rule 07 keeps it reachable
    // on purpose), so a second photo chosen mid-upload has to die here.
    if (uploading) return;
    // Equivalent mutant on the optional index: a `change` from a file
    // input always carries a `FileList`, empty when the picker was
    // dismissed. The `?.` is the compiler's, because the DOM types the
    // property as nullable for inputs that are not files at all.
    // Stryker disable next-line OptionalChaining
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoError(undefined);
    const formData = new FormData();
    formData.set("itemId", item.id);
    formData.set("photo", file);
    const result = await uploadPhoto({ data: formData });
    setUploading(false);
    if (!result.ok) {
      setPhotoError(result.error);
      return;
    }
    await router.invalidate();
  }

  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-5 px-4 py-8 wide:px-6">
      {item.photoKey === null ? undefined : (
        <img
          src={`/closet/photo/${item.id}/card`}
          alt={label}
          className="aspect-square w-full rounded-field object-cover"
        />
      )}

      <div>
        <h1 className="font-display text-title uppercase">{label}</h1>
        {isGeneric ? <Bracketed>Generic</Bracketed> : undefined}
        {item.retired ? (
          <Bracketed className="ml-2">Retired</Bracketed>
        ) : undefined}
      </div>

      <ProductLink url={item.productUrl} label={label} />

      <p className="text-small text-quiet">
        {tempRange ? (
          <>
            Works at{" "}
            <Bracketed className="text-dialed-text">
              {formatTempRange(tempRange)}
            </Bracketed>
          </>
        ) : (
          <Bracketed>Untested</Bracketed>
        )}
      </p>

      {attributeChips(effective, item).length > 0 ? (
        <p className="text-small text-quiet">
          {attributeChips(effective, item).join(" · ")}
        </p>
      ) : undefined}

      {/* §AG: below the range, and on this screen only. `brand` is the
          garment's own, which is what the runner sees on the label in
          their hand; a piece with no brand gets no "as labelled by" line
          rather than an invented one. */}
      {composition === undefined ? undefined : (
        <CompositionBlock
          composition={{
            verbatim: composition.verbatim,
            parts: composition.parts,
            brand: item.brand ?? undefined,
          }}
        />
      )}

      <p className="text-small text-quiet">
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
        <p className="text-small text-quiet">
          Pairs with{" "}
          {pairedItems.map((pair, index) => (
            <span key={pair.id}>
              {index > 0 ? ", " : undefined}
              {pair.name}
            </span>
          ))}
        </p>
      ) : undefined}

      {/* Bend 1: "at width the same panel shows a drop zone in the photo
          well — 'Drop a photo, or shoot it on your phone later.' Copy and
          one state change; **the layout is untouched**." So the well is
          the same label with the same input in it; what changes is a line
          of copy that only exists from 720 up, where there is no camera to
          open, and a border while a file is over it.

          The dropped file goes to `handlePhotoFiles`, which is what the
          input's own `onChange` calls — so W3's blur and the size and type
          checks are reached identically. The contract's "do not fork it"
          is the whole point. */}
      <label
        {...photoDrop.handlers}
        className={`target flex flex-col gap-1 rounded-field border border-dashed p-3 text-body font-semibold ${
          photoDrop.isOver ? "border-ink" : "border-transparent"
        }`}
      >
        {/* "Add a photo" is design's round-13 rest label for this control;
            it had been the bare field caption "Photo", which names the
            field rather than the action and left the in-flight state with
            nowhere to appear. */}
        <PendingLabel
          label="Add a photo"
          pendingLabel="Uploading"
          pending={uploading}
        />
        <span className="hidden text-micro font-normal text-muted wide:block">
          Drop a photo, or shoot it on your phone later.
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          {...inFlight(uploading)}
          onChange={(event) => {
            void handlePhotoFiles(event.target.files);
          }}
        />
      </label>
      {photoError === undefined ? undefined : (
        <p className="text-small font-semibold text-cold-text">{photoError}</p>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          to="/closet/edit/$itemId"
          params={{ itemId: item.id }}
          className="target inline-flex items-center rounded-pill border border-hairline px-3 py-2 text-body font-semibold"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={() => {
            void handleRetireToggle();
          }}
          className="target rounded-pill border border-hairline px-3 py-2 text-body font-semibold"
        >
          {item.retired ? "Unretire" : "Retire"}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleDelete();
          }}
          className="target rounded-pill border border-hairline px-3 py-2 text-body font-semibold text-cold-text"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
