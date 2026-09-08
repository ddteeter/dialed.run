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
import { garmentSchema, type Garment } from "../../lib/contracts";
import {
  garmentTypesFor,
  hasGarmentAttribute,
} from "../../lib/garment-fields";
import type { GarmentFormValues } from "./components/GarmentForm";
import type { EffectiveAttributes, WardrobeItemRow } from "./service";

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function garmentFromFormValues(values: GarmentFormValues): Garment {
  const { category } = values;
  // Only the attributes this category declares. The union is a
  // strictObject, so carrying an extra one is a parse error rather than a
  // field that gets quietly dropped.
  const attributes: Record<string, unknown> = {};
  if (hasGarmentAttribute(category, "layer") && values.layer !== "") {
    attributes.layer = values.layer;
  }
  if (hasGarmentAttribute(category, "weight") && values.weight !== "") {
    attributes.weight = values.weight;
  }
  if (hasGarmentAttribute(category, "fabric") && values.fabric !== "") {
    attributes.fabric = values.fabric;
  }
  if (hasGarmentAttribute(category, "windResistant")) {
    attributes.windResistant = values.windResistant;
  }
  if (hasGarmentAttribute(category, "waterResistant")) {
    attributes.waterResistant = values.waterResistant;
  }

  return garmentSchema.parse({
    name: values.name.trim(),
    brand: optional(values.brand),
    size: optional(values.size),
    color: optional(values.color),
    productUrl: optional(values.productUrl),
    category,
    ...attributes,
  });
}

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

/**
 * The resolver, injected rather than imported.
 *
 * `modules/products`' server functions are not on its barrel (they pull
 * TanStack's server entry, which would make the barrel unloadable in the
 * vitest workers pool), and dependency-cruiser forbids a module deep-
 * importing another's internals. So the route — which may import a
 * functions.ts directly — passes it in. The *rule* still lives here, which
 * is the part that was duplicated.
 *
 * Longer term this belongs on the server, inside `createItemFn`: resolving
 * at the write site removes a client round-trip and stops a caller being
 * able to skip it. That is a bigger change than deduplicating two routes.
 */
type ResolveProduct = (args: {
  data: {
    brandName: string;
    productName: string;
    sourceUrl?: string | undefined;
  };
}) => Promise<{ product: { id: string; type: string | null } }>;

/**
 * The identity-first step (D-27), once.
 *
 * A garment is ideally a *product* — "Janji Rover Half-Zip", not "a long
 * sleeve" — so a brand and a name together resolve (create-if-missing) a
 * canonical product row and link `product_id`. Both the add and the edit
 * route did this, and their copies were identical down to the comment, one
 * of which said "see new.tsx for the identical note". Two copies of the
 * rule that decides whether a garment gets an identity is exactly the drift
 * worth preventing: one route linking and the other not is invisible until
 * someone wonders why half the closet has no social proof.
 *
 * Deferred until lane 107 merges: once enrichment lands, a pasted
 * `productUrl` should also call `requestEnrichment(productId, url)` here.
 * Saving never waits on it either way.
 */
export async function garmentWithResolvedProduct(
  values: GarmentFormValues,
  resolve: ResolveProduct,
): Promise<Garment> {
  const garment = garmentFromFormValues(values);
  if (values.brand.trim() === "" || values.name.trim() === "") return garment;
  const { product } = await resolve({
    data: {
      brandName: values.brand,
      productName: values.name,
      sourceUrl: values.productUrl === "" ? undefined : values.productUrl,
    },
  });
  // The type comes with the match, from the product record — it was never
  // a question F asked (design's Z1). Validated against the category rather
  // than trusted: a product row could carry a type that belongs to another
  // category, and `garmentSchema` would reject the whole save rather than
  // just ignoring a bad hint.
  const inherited = typeFor(garment.category, product.type);
  // Re-parsed rather than assembled: CLAUDE.md requires every wardrobe write
  // to go through `garmentSchema`, and it is what narrows the product's
  // free-text type back to this category's enum.
  return garmentSchema.parse({
    ...garment,
    productId: product.id,
    ...(inherited !== undefined && { type: inherited }),
  });
}

function typeFor(
  category: Garment["category"],
  candidate: string | null,
): string | undefined {
  if (candidate === null) return undefined;
  const allowed: readonly string[] = garmentTypesFor(category);
  return allowed.includes(candidate) ? candidate : undefined;
}
