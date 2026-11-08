/**
 * Which attributes each garment category admits — derived from
 * `garmentSchema`, never hand-written.
 *
 * Before this existed the same category-to-attributes fact was written out
 * by hand in three places: the discriminated union in ./contracts, the
 * `fieldsForCategory` switch in the closet's GarmentForm, and the switch in
 * the closet's form-mapping. Adding an attribute to a category meant
 * editing three files and silently dropping the attribute if you edited
 * only one — the form would render an input whose value the mapper threw
 * away, with no type error anywhere.
 *
 * zod 4 keeps the per-option shape on a discriminated union, so the union
 * can answer the question itself. There is exactly one place to edit now.
 */
import { garmentSchema, garmentTypesByCategory } from "./garments";

export type GarmentCategory = ReturnType<
  (typeof garmentSchema)["parse"]
>["category"];

/**
Attribute keys that vary by category (identity fields are on every one).
*/
export const garmentAttributeKeys = [
  "layer",
  "weight",
  "fabric",
  "windResistant",
  "waterResistant",
] as const;
export type GarmentAttributeKey = (typeof garmentAttributeKeys)[number];

function attributesFor(option: {
  shape: Record<string, unknown>;
}): ReadonlySet<GarmentAttributeKey> {
  return new Set(
    garmentAttributeKeys.filter((key) => Object.hasOwn(option.shape, key)),
  );
}

/**
 * Category -> the attribute keys that category's variant actually declares,
 * in `garmentSchema` declaration order (which is the order the form renders
 * categories in, so it needs no second list either).
 */
export const garmentFieldSpec: ReadonlyMap<
  GarmentCategory,
  ReadonlySet<GarmentAttributeKey>
> = new Map(
  garmentSchema.options.map((option) => [
    option.shape.category.value,
    attributesFor(option),
  ]),
);

/**
Categories in schema order — replaces a hand-kept CATEGORY_ORDER array.
*/
export const garmentCategoriesInOrder: readonly GarmentCategory[] =
  garmentSchema.options.map((option) => option.shape.category.value);

/**
 * True when `category` accepts `key`. The form uses this to decide whether
 * to render an input, and the form-to-garment mapper uses the same call to
 * decide whether to carry the value — so the two can no longer disagree.
 */
export function hasGarmentAttribute(
  category: GarmentCategory,
  key: GarmentAttributeKey,
): boolean {
  return garmentFieldSpec.get(category)?.has(key) ?? false;
}

/**
 * The types a category admits, in declaration order. A thin re-export of
 * `garmentTypesByCategory`, here so a caller that already has the field spec
 * does not have to know two module names — and typed as
 * `readonly GarmentType[]` so the per-category literal tuples widen to one
 * comparable type at the call site.
 */
export type GarmentType =
  (typeof garmentTypesByCategory)[GarmentCategory][number];

export function garmentTypesFor(
  category: GarmentCategory,
): readonly GarmentType[] {
  return garmentTypesByCategory[category];
}

/**
 * Every garment type, in category order.
 *
 * Not deduplicated, because it cannot need to be: no type belongs to two
 * categories, and `test/garment-fields.test.ts` pins that. The first
 * version wrapped this in a `new Set` on the belief that `gloves` and
 * `socks` appear twice — they name a category *and* its only type, but
 * only ever appear in one list. Mutation testing caught the dead
 * deduplication: replacing the array changed nothing.
 */
export const allGarmentTypes: readonly GarmentType[] =
  garmentCategoriesInOrder.flatMap((category) => garmentTypesFor(category));

/**
 * Each type as E2-lite's summary sentence says it, in lower case (round
 * 49, R49·137a′: "the tap-list words in lowercase ("long sleeve",
 * "shorts", "beanie")").
 *
 * Derived from the contract's own name for the type, split at its
 * capitals, so a new type has a word the day it is added: `longSleeve`
 * reads "long sleeve", `neckGaiter` "neck gaiter". `halfZip` is the one
 * the split cannot spell; the closet writes it "Half-zip".
 *
 * **A marked guess** (design 184, design ask #495): no list in the build
 * words every type that way, and F's TYPE chips say "L/S crew" where the
 * board says "long sleeve".
 */
export function garmentTypeWord(type: GarmentType): string {
  return type === "halfZip"
    ? "half-zip"
    : type.replaceAll(/[A-Z]/gu, (capital) => ` ${capital.toLowerCase()}`);
}

/**
 * A stored type, read back as the contract's: anything else (none, or a
 * value the contract no longer has) is no type.
 */
export function garmentTypeOf(stored: string | null): GarmentType | undefined {
  return allGarmentTypes.find((type) => type === stored);
}
