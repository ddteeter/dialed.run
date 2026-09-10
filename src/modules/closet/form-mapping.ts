/**
 * Route-facing helper: GarmentForm's flat, always-a-string form state ->
 * the discriminated-union Garment the server functions validate against.
 * Lives here (not in the component) so both new.tsx and edit.$itemId.tsx
 * share one mapping.
 *
 * This was a switch over all eight categories listing each one's fields by
 * hand — the third copy of a fact `garmentSchema` already states. It is now
 * driven by lib/garment-fields, and the result is `parse`d rather than
 * asserted: CLAUDE.md requires every wardrobe write to go through
 * `garmentSchema`, and the previous version returned a hand-built object
 * typed as `Garment` that the schema never actually saw.
 */
import type { GarmentFormValues } from "./form-schema";
import type { EffectiveAttributes, WardrobeItemRow } from "./service";

/**
 * The reverse direction for edit.$itemId.tsx: pre-fill the form from a
 * stored item, using the read-side effective attributes (item columns
 * merged with product defaults) so an edit starts from what's actually
 * shown on the detail page.
 */
export function formValuesFromItem(
  item: WardrobeItemRow,
  effective: EffectiveAttributes,
): GarmentFormValues {
  return {
    brand: item.brand ?? "",
    name: item.name,
    category: item.category,
    size: item.size ?? "",
    color: item.color ?? "",
    productUrl: item.productUrl ?? "",
    layer: item.layer ?? "",
    weight: effective.weight ?? "",
    fabric: effective.fabric ?? "",
    windResistant: effective.windResistant ?? false,
    waterResistant: effective.waterResistant ?? false,
  };
}
