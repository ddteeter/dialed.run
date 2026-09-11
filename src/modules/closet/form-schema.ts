/**
 * The closet form's schema: its own shape, the contract's rules.
 *
 * `docs/product.md` §Forms & failure allows a client pre-check only because
 * there is **one schema run twice** — so this cannot be a second statement
 * of what a garment is. It is not: the form contributes the shapes a set of
 * `<input>`s actually produce (everything a string, `""` for an unanswered
 * select) and `garmentSchema` contributes every rule, reached through a
 * `.pipe()`. Nothing here restates a constraint or a sentence.
 *
 * The reshape in the middle is the same one `garmentFromFormValues` did
 * before this existed. What changed is where the parse happens: it used to
 * end in `garmentSchema.parse(...)`, called from a route inside a `void`-ed
 * async handler, so an invalid garment threw into an unhandled rejection
 * and the button silently did nothing. Now `useFormSubmit` runs the schema
 * and the throw is a field message.
 *
 * **Issue paths survive the pipe**, which is the property the whole
 * arrangement rests on — `useFormSubmit` maps `issue.path[0]` to a field
 * name, and a `garmentSchema` issue is raised against the transformed
 * object. They line up because a garment is flat in both shapes; the tests
 * in `test/closet/form-schema.test.ts` pin that rather than trusting it.
 */
import { z } from "zod";

import {
  fabricSchema,
  garmentCategories,
  garmentSchema,
  layerSchema,
  weightSchema,
} from "../../lib/contracts";
import { hasGarmentAttribute } from "../../lib/garment-fields";

/**
An unanswered `<select>` is `""`, which is not absence to the DOM.
*/
const unanswered = z.literal("");

const formValues = z.object({
  brand: z.string(),
  name: z.string(),
  category: z.enum(garmentCategories),
  size: z.string(),
  color: z.string(),
  productUrl: z.string(),
  layer: z.union([layerSchema, unanswered]),
  weight: z.union([weightSchema, unanswered]),
  fabric: z.union([fabricSchema, unanswered]),
  windResistant: z.boolean(),
  waterResistant: z.boolean(),
});

/**
An empty text field means the user did not answer, not that they answered
with nothing — so it becomes absent rather than `""`, which the strict
object would reject.
*/
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Form state -> the object `garmentSchema` expects.
 *
 * Only the attributes this category declares: the union is a
 * `strictObject`, so carrying an extra one is a parse error rather than a
 * field that gets quietly dropped. Which attributes those are is read from
 * `garmentSchema` via `lib/garment-fields` — this was once a switch over
 * all eight categories, the third hand-written copy of a fact the schema
 * already states.
 */
function toGarmentInput(values: z.output<typeof formValues>): unknown {
  const { category } = values;
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

  return {
    name: values.name.trim(),
    brand: optional(values.brand),
    size: optional(values.size),
    color: optional(values.color),
    productUrl: optional(values.productUrl),
    category,
    ...attributes,
  };
}

export const garmentFormSchema = formValues
  .transform(toGarmentInput)
  .pipe(garmentSchema);

/**
The form's own shape, derived from the schema rather than written beside
it — a hand-kept copy is a rival truth (CLAUDE.md, "Derive, don't mirror").
*/
export type GarmentFormValues = z.input<typeof garmentFormSchema>;
