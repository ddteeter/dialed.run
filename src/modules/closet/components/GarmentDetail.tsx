import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { GarmentVisibility } from "../../../lib/contracts";
import {
  photoAcceptAttribute,
  photoFormatWords,
} from "../../../lib/photo-constraints";
import { formatTempRange } from "../../../lib/thermal";
import {
  Bracketed,
  ControlFailureBand,
  FileWell,
  FormStatus,
  Mono,
  ProductLink,
  useControlAction,
} from "../../../ui";
import type { PhotoStep } from "../../../ui";
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
  renderPhotoStep,
}: Readonly<{
  detail: Detail;
  retire: (input: { data: { itemId: string } }) => Promise<unknown>;
  unretire: (input: { data: { itemId: string } }) => Promise<unknown>;
  remove: (input: { data: { itemId: string } }) => Promise<unknown>;
  uploadPhoto: (input: {
    data: FormData;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * W3's blur, composed by the route: a garment photo is a photo, and a
   * face in it is somebody's face whatever screen it was taken on. Garment
   * photos used to upload the picked bytes as they were — the verdict
   * route was the only one that mounted the step (D-102).
   *
   * Absent, a picked file is uploaded as-is — which is what the tests of
   * everything else on this screen want.
   */
  renderPhotoStep?: PhotoStep | undefined;
}>) {
  const navigate = useNavigate();
  const router = useRouter();
  const [photoError, setPhotoError] = useState<string | undefined>();
  /**
   * The picked file and the step answering for it, together — so a held
   * file always has the step that opened for it (the same pair
   * `VerdictForm` holds, for the same reason).
   */
  const [pending, setPending] = useState<
    { file: File; step: PhotoStep } | undefined
  >();
  const [status, setStatus] = useState("");

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
   * The upload itself, once the bytes are the ones to send. A wrong type or
   * size comes back as a field failure on the well (the fix is another
   * file); a dropped connection throws, and lands on the band under it —
   * round 22: *"A network drop during upload is a form failure … the well
   * returns to rest."* It used to leave the well stuck on its in-flight
   * label for good, because nothing caught the throw.
   */
  const upload = useControlAction({
    action: async (file: File) => {
      setPhotoError(undefined);
      const formData = new FormData();
      formData.set("itemId", item.id);
      formData.set("photo", file);
      const result = await uploadPhoto({ data: formData });
      if (!result.ok) {
        setPhotoError(result.error);
        return;
      }
      await router.invalidate();
    },
    kicker: "Nothing saved",
  });

  /**
   * One path for a chosen file and a dropped one (Desktop Contract bend 1,
   * "do not fork it"), and both go through W3's blur when the route hands
   * the step in.
   */
  function handlePhotoFiles(files: FileList | null) {
    // Equivalent mutant on the optional index: a `change` from a file
    // input always carries a `FileList`, empty when the picker was
    // dismissed. The `?.` is the compiler's, because the DOM types the
    // property as nullable for inputs that are not files at all.
    // Stryker disable next-line OptionalChaining
    const file = files?.[0];
    if (!file) return;
    if (renderPhotoStep === undefined) {
      void upload.run(file);
      return;
    }
    // Held until the step hands back the bytes to send. One at a time:
    // the step is a screen, and two of them at once is not a thing a
    // runner can answer.
    setPending({ file, step: renderPhotoStep });
  }

  return (
    <div className="mx-auto flex w-full max-w-column wide:mx-0 flex-col gap-5 px-4 py-8 wide:px-6">
      <FormStatus>{status || upload.status}</FormStatus>

      <div>
        <h1 className="font-display text-title uppercase">{label}</h1>
        {isGeneric ? <Bracketed>Generic</Bracketed> : undefined}
        {item.retired ? (
          <Bracketed className="ml-2">Retired</Bracketed>
        ) : undefined}
      </div>

      {/* Round 22, item 8: the photo sits in the well — with a photo the
          well is the preview, Replace and Remove under it — and item 7
          puts it straight after the identity line. It used to be a square
          image at the top of the screen above a well that still said
          "Add a photo". One well, shared with A1 (`ui/FileWell`). */}
      <FileWell
        part="photo-well"
        copy={{
          kicker: "Photo · optional",
          label: "Add a photo",
          wideLabel: "Drop a photo, or browse",
          overLabel: "Let go to add it",
          pendingLabel: "Adding",
          hint: `Flat on the floor works best. ${photoFormatWords}.`,
        }}
        pending={upload.pending || pending !== undefined}
        accept={photoAcceptAttribute}
        error={photoError}
        preview={
          item.photoKey === null
            ? undefined
            : { src: `/closet/photo/${item.id}/card`, alt: label }
        }
        onFiles={handlePhotoFiles}
      />
      <ControlFailureBand
        failure={upload.failure}
        onRetry={upload.retry}
        retryRef={upload.retryRef}
      />
      {pending === undefined
        ? undefined
        : pending.step(
            pending.file,
            (ready) => {
              setPending(undefined);
              void upload.run(ready);
            },
            setStatus,
          )}

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
