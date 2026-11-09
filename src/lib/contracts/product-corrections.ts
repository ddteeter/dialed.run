/**
 * Product corrections (D-163; round 48 #129–#130): a runner says a shared
 * product's fact is wrong, and the Desk applies or declines it.
 *
 * Here rather than in `products/`, because the WRONG? sheet (a client
 * component), the server's parse, the schema's enums and the Desk's apply
 * step all read the same seven fields, and a component may not import
 * server code. One table, read by all four (CLAUDE.md, "Derive, don't
 * mirror").
 */
import { z } from "zod";

import { ulidSchema } from "../ids";
import { httpsUrlSchema } from "./common";
import {
  hasGarmentAttribute,
  type GarmentAttributeKey,
  type GarmentCategory,
} from "./garment-fields";
import { fabricSchema, weightSchema } from "./garments";

/**
 * The seven, in the sheet's order (R48·129b): one field per correction.
 */
export const CORRECTION_FIELDS = [
  "name",
  "weight",
  "fabric",
  "wind",
  "water",
  "composition",
  "link",
] as const;

export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

const correctionFieldSchema = z.enum(CORRECTION_FIELDS);

/**
 * The garment attribute a field corrects, where only some categories have
 * it. Name, composition and link are every product's; a shoe states no
 * weight and an accessory no wind or water, so WRONG? does not offer them.
 */
const CATEGORY_ATTRIBUTES: Readonly<
  Record<CorrectionField, GarmentAttributeKey | undefined>
> = {
  name: undefined,
  weight: "weight",
  fabric: "fabric",
  wind: "windResistant",
  water: "waterResistant",
  composition: undefined,
  link: undefined,
};

/**
 * The fields a piece of this category can be corrected on, in the sheet's
 * order: the closet form's own attributes for the category
 * (`garmentFieldSpec`), and the three every product has.
 */
export function correctionFieldsFor(
  category: GarmentCategory,
): readonly CorrectionField[] {
  return CORRECTION_FIELDS.filter((field) => {
    const attribute = CATEGORY_ATTRIBUTES[field];
    return attribute === undefined || hasGarmentAttribute(category, attribute);
  });
}

/**
 * The server's refusal of a field the garment's category does not have,
 * which the sheet never offers: a stale sheet, after the piece's category
 * changed in another tab, is the one way to meet it.
 */
export const CORRECTION_FIELD_NOT_ON_PIECE = "This piece doesn't have that.";

/**
 * Where a correction is: waiting for the Desk, or decided. One waiting row
 * per runner, product and field; a decided row stays as the record.
 */
export const CORRECTION_STATUSES = ["waiting", "applied", "declined"] as const;

/**
 * Wind and water are Yes / No (R48·129c), stored as the words.
 */
export const yesNoSchema = z.enum(["yes", "no"]);

/**
 * The longest a name and a composition may be (R48·129c). The product
 * name column takes 120, but the sheet's rule is the garment name's.
 */
const CORRECTION_NAME_MAX = 80;
const CORRECTION_COMPOSITION_MAX = 120;

/**
 * "How do you know?": optional, 280, with a counter from 240 (R48·129c).
 */
export const CORRECTION_NOTE_MAX = 280;
export const CORRECTION_NOTE_COUNTER_FROM = 240;

function textValue(max: number, noun: string) {
  return z
    .string()
    .trim()
    .min(1, `Type the ${noun}.`)
    .max(max, `Keep the ${noun} to ${String(max)} characters.`);
}

/**
 * What each field's value must be, as the sheet's input of that type
 * offers it. Weight and fabric are the closet form's own enums.
 */
const correctionValueSchemas = {
  name: textValue(CORRECTION_NAME_MAX, "name"),
  weight: weightSchema,
  fabric: fabricSchema,
  wind: yesNoSchema,
  water: yesNoSchema,
  composition: textValue(CORRECTION_COMPOSITION_MAX, "composition"),
  link: httpsUrlSchema,
} satisfies Record<CorrectionField, z.ZodType<string>>;

/**
 * The field as a sentence names it: "We fixed the {field} on {product}."
 */
export const CORRECTION_FIELD_NOUNS: Readonly<Record<CorrectionField, string>> =
  {
    name: "name",
    weight: "weight",
    fabric: "fabric",
    wind: "wind resistance",
    water: "water resistance",
    composition: "composition",
    link: "link",
  };

const correctionNoteSchema = z
  .string()
  .trim()
  .max(
    CORRECTION_NOTE_MAX,
    `Keep it to ${String(CORRECTION_NOTE_MAX)} characters.`,
  );

/**
 * One field's value, checked by that field's own schema, with its issues
 * reported on `value` so the sheet marks the input it came from.
 */
const correctionEntrySchema = z
  .object({
    field: correctionFieldSchema,
    value: z.string(),
  })
  .transform((entry, context) => {
    const parsed = correctionValueSchemas[entry.field].safeParse(entry.value);
    if (parsed.success) return { field: entry.field, value: parsed.data };
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: ["value"],
      });
    }
    return z.NEVER;
  });

/**
 * WRONG?'s sheet (R48·129), as the server function takes it and the sheet
 * checks it first: one field and its value, from a garment the runner
 * owns. One schema, run on both sides.
 */
export const fileCorrectionSchema = z
  .object({
    productId: ulidSchema,
    garmentId: ulidSchema,
    note: correctionNoteSchema.optional(),
    idempotencyKey: ulidSchema,
  })
  .and(correctionEntrySchema);

/**
 * Decline's reasons (R48·130): the 104 select, inline, "No reason given"
 * by default. The words are what the runners read as the bell row's
 * second line; "No reason given" sends none.
 */
export const DECLINE_REASONS = [
  "none",
  "maker_says_otherwise",
  "not_enough",
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const declineReasonSchema = z.enum(DECLINE_REASONS);

export const DECLINE_REASON_LABELS: Readonly<Record<DeclineReason, string>> = {
  none: "No reason given",
  maker_says_otherwise: "The maker's page says otherwise",
  not_enough: "Not enough to go on",
};

/**
 * A queue row on the Desk (R48·130): the product, field and value that
 * every runner in it suggested.
 */
export const correctionKeySchema = z.object({
  productId: ulidSchema,
  field: correctionFieldSchema,
  value: z.string().min(1).max(2048),
});

/**
 * Decline, with one of its three reasons.
 */
export const declineCorrectionSchema = correctionKeySchema.extend({
  reason: declineReasonSchema,
});

/**
 * A queue row's decision as the Desk's one form sends it: Apply, or
 * Decline with its reason. The row's form dispatches on `decision` to the
 * two server functions, which each take their own schema above.
 */
export const correctionDecisionSchema = z.discriminatedUnion("decision", [
  correctionKeySchema.extend({ decision: z.literal("apply") }),
  declineCorrectionSchema.extend({ decision: z.literal("decline") }),
]);
