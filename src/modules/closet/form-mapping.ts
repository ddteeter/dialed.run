/**
 * Route-facing helper: GarmentForm's flat, always-a-string form state ->
 * the discriminated-union Garment the server functions validate against.
 * Lives here (not in the component) so both new.tsx and edit.$itemId.tsx
 * share one mapping.
 *
 * This was a switch over all eight categories listing each one's fields by
 * hand — the third copy of a fact `garmentSchema` already states. It is now
 * driven by lib/contracts/garment-fields, and the result is `parse`d rather than
 * asserted: CLAUDE.md requires every wardrobe write to go through
 * `garmentSchema`, and the previous version returned a hand-built object
 * typed as `Garment` that the schema never actually saw.
 */
import { httpsUrlProblem } from "../../lib/contracts";
import type { FieldErrors } from "../../ui";

import type { GarmentFormValues } from "./form-schema";
import type { LinkDetail } from "./garment-link";
import { DENIED_LINK } from "./link-copy";
import type { EffectiveAttributes, WardrobeItemRow } from "./service";

/**
 * The reverse direction for edit.$itemId.tsx: pre-fill the form from a
 * stored item.
 *
 * **Weight and fabric are the runner's own** (round 43 #94): a value the
 * product lent is shown as the field's placeholder (`productPlaceholders`),
 * not filled in, so saving an Edit does not copy it onto the garment, and
 * clearing a field goes back to the product's. The two toggles still start
 * from what E shows: a checkbox has no placeholder, and F already writes
 * both on every save, so they are the runner's on any piece F made.
 */
export function formValuesFromItem(
  item: WardrobeItemRow,
  effective: EffectiveAttributes,
): GarmentFormValues {
  return {
    brand: item.brand ?? "",
    name: item.name,
    category: item.category,
    type: item.type ?? "",
    size: item.size ?? "",
    color: item.color ?? "",
    colorName: item.colorName ?? "",
    colorHex: item.colorHex ?? "",
    visibilityLevel: item.visibilityLevel ?? "",
    productUrl: item.productUrl ?? "",
    layer: item.layer ?? "",
    weight: item.weight ?? "",
    fabric: item.fabric ?? "",
    windResistant: effective.windResistant ?? false,
    waterResistant: effective.waterResistant ?? false,
  };
}

/**
 * What the product lends where the runner left a field empty: Edit's
 * placeholders for weight and fabric (round 43 #94). Partial, so a form
 * with nothing stored lends `{}` rather than a pair of `undefined`s.
 */
export type ProductPlaceholders = Readonly<
  Partial<Pick<EffectiveAttributes, "weight" | "fabric">>
>;

export function productPlaceholders(
  item: WardrobeItemRow,
  effective: EffectiveAttributes,
): ProductPlaceholders {
  return {
    weight: item.weight === null ? effective.weight : undefined,
    fabric: item.fabric === null ? effective.fabric : undefined,
  };
}

/**
 * Edit's opening error for a stored link it will not show (round 43 #93,
 * state 5): denied since it was saved, or stored before the https rule.
 * `linkDetail.link` is closet's one read of it, so a link that read lets
 * through opens clean.
 */
export function storedLinkErrors(
  item: WardrobeItemRow,
  linkDetail: LinkDetail,
): FieldErrors {
  if (item.productUrl === null || linkDetail.link !== undefined) return {};
  return { productUrl: httpsUrlProblem(item.productUrl) ?? DENIED_LINK };
}
