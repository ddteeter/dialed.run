import { useMemo, useState } from "react";

import type {
  ColorName,
  Garment,
  GarmentVisibility,
} from "../../../lib/contracts";
import {
  colorNameSchema,
  fabricSchema,
  garmentCategories,
  garmentCategoryLabels,
  garmentVisibilitySchema,
  layerSchema,
  weightSchema,
} from "../../../lib/contracts";
import {
  garmentCategoriesInOrder,
  hasGarmentAttribute,
  type GarmentAttributeKey,
} from "../../../lib/garment-fields";
import { estimateTempRange, formatTempRange } from "../../../lib/thermal";
import {
  Bracketed,
  ChoiceField,
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  ToggleField,
  useFormSubmit,
} from "../../../ui";
import { garmentFormSchema, type GarmentFormValues } from "../form-schema";
import { ShadeSheet } from "./ShadeSheet";

type Category = (typeof garmentCategories)[number];

/**
 * Display names only. The *values* come from the schema's own enums below,
 * so an option can never exist that the contract would reject — a
 * hand-written `<option value="…">` list is a second statement of a set
 * zod already holds (CLAUDE.md, "Derive, don't mirror").
 */
const LAYER_LABELS: Record<(typeof layerSchema.options)[number], string> = {
  base: "Base",
  mid: "Mid",
  outer: "Outer",
};
const WEIGHT_LABELS: Record<(typeof weightSchema.options)[number], string> = {
  light: "Light",
  mid: "Mid",
  heavy: "Heavy",
};
const FABRIC_LABELS: Record<(typeof fabricSchema.options)[number], string> = {
  synthetic: "Synthetic",
  merino: "Merino",
  cotton: "Cotton",
  blend: "Blend",
  down: "Down",
};

/**
Field name -> human label, for the summary rows the contract requires once
two or more fields fail at once.
*/
const LABELS = {
  brand: "Brand",
  name: "Model / name",
  category: "Category",
  layer: "Layer",
  weight: "Weight",
  fabric: "Fabric",
  size: "Size",
  // The free text the runner types — a brand's own name for a shade, like
  // "Obsidian". §AH keeps it exactly as it was and calls it the colourway;
  // `colorName` below is the structured reading beside it. Two fields
  // labelled "Color" on one form is the collision that rename avoids.
  color: "Colorway",
  colorName: "Color",
  colorHex: "Hex",
  visibilityLevel: "Visibility",
  productUrl: "Product link",
};

/**
 * The thirteen, sentence-cased for the chip.
 *
 * **Not a re-hash of the database.** The *keys* are the contract's thirteen
 * names and `satisfies` is what holds them to it — add a fourteenth to
 * `colorNames`, or remove one, and this stops compiling. The *values* are
 * display copy that exists nowhere else: the column stores `hi_viz`, the
 * chip says "Hi-viz", and nothing in D1 knows the difference.
 *
 * **And the labels do not belong in the database**, for three reasons that
 * all point the same way. They are user-facing copy, which `docs/product.md`
 * §UI lexicon owns and which changes on a design round rather than on a
 * migration. The set is locked at thirteen and not user-extensible, so a
 * lookup table would be a join for a constant. And this renders in the
 * client bundle, so sourcing it from D1 means a query to draw a form.
 *
 * Written out rather than derived by capitalising `colorNames`, because
 * `Object.fromEntries` comes back as `Record<string, string>` and needs a
 * cast to narrow — and a cast cannot fail, so it would answer `undefined`
 * for a name nobody labelled. `garmentCategoryLabels` in `lib/contracts.ts`
 * made the same trade for the same reason.
 */
const COLOR_LABELS = {
  black: "Black",
  white: "White",
  grey: "Grey",
  navy: "Navy",
  brown: "Brown",
  beige: "Beige",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
} as const satisfies Record<ColorName, string>;

/**
 * Same split as `COLOR_LABELS`: the keys are `garmentVisibilities`, held
 * there by the annotation; the words are this screen's, and `hi_viz` is a
 * column value that no runner should ever read.
 */
const VISIBILITY_LABELS: Record<GarmentVisibility, string> = {
  plain: "Plain",
  reflective: "Reflective trim",
  hi_viz: "Hi-viz",
};

/**
 * Which attribute inputs a category admits. Derived from `garmentSchema`
 * via lib/garment-fields — this used to be a hand-written switch mirroring
 * the union, which meant adding an attribute to a category required
 * editing the schema, this file, and form-mapping.ts, with no type error
 * if you missed one.
 */
function fieldsForCategory(
  category: Category,
): Record<GarmentAttributeKey, boolean> {
  return {
    layer: hasGarmentAttribute(category, "layer"),
    weight: hasGarmentAttribute(category, "weight"),
    fabric: hasGarmentAttribute(category, "fabric"),
    windResistant: hasGarmentAttribute(category, "windResistant"),
    waterResistant: hasGarmentAttribute(category, "waterResistant"),
  };
}

const EMPTY_VALUES: GarmentFormValues = {
  brand: "",
  name: "",
  category: "top",
  size: "",
  color: "",
  colorName: "",
  colorHex: "",
  visibilityLevel: "",
  productUrl: "",
  layer: "",
  weight: "",
  fabric: "",
  windResistant: false,
  waterResistant: false,
};

export interface GarmentFormProps {
  initial?: Partial<GarmentFormValues> | undefined;
  brandOptions?: readonly string[] | undefined;
  onBrandInput?: ((value: string) => void) | undefined;
  /**
   * The save, handed in rather than imported.
   *
   * `../functions` pulls TanStack Start's virtual server entry, so a file
   * that reaches it cannot be imported by any test. The route wires it and
   * closes over whatever differs between adding and editing — the
   * idempotency key, the item id — so this component does not branch on
   * which one it is.
   */
  save: (garment: Garment) => Promise<{ id: string }>;
  onSaved: (result: { id: string }) => Promise<void>;
  submitLabel: string;
  pendingLabel: string;
  successMessage: string;
  /**
   * The garment's own photo, when it has one — the shade sampler reads a
   * pixel out of it.
   *
   * Handed in rather than derived, because the add form has no photo yet
   * (a piece is photographed on detail, after it exists) and the edit form
   * does. §AH: no photo, no sampler — the hex field stands alone.
   */
  photoUrl?: string | undefined;
}

/**
 * Screen F (v1, identity-first, D-27): brand + model lead; category one tap;
 * attribute fields collapsed below, shown only where the category admits
 * them. A generic entry (category + name only) is still one submit away —
 * never blocked on brand/model.
 *
 * **This form had no failure path before D-17.** It was presentational,
 * and the route called `garmentFromFormValues` — which ended in
 * `garmentSchema.parse` — inside a `void`-ed async handler. An invalid
 * garment threw into an unhandled rejection: no message, no mark, the
 * button simply did nothing. An `http://` product link and any over-long
 * value both reached it, since `type="url"` accepts the scheme and no
 * input carried a `maxLength`.
 *
 * The form is `noValidate` on purpose now. The browser's own checks are
 * not the contract's — they cannot produce the summary, the live-region
 * sentence or the failure band — so the schema is the single gate and
 * `useFormSubmit` renders what it says.
 */
export function GarmentForm({
  initial,
  brandOptions,
  onBrandInput,
  save,
  onSaved,
  submitLabel,
  pendingLabel,
  successMessage,
  photoUrl,
}: Readonly<GarmentFormProps>) {
  const [values, setValues] = useState<GarmentFormValues>({
    ...EMPTY_VALUES,
    ...initial,
  });
  const fields = fieldsForCategory(values.category);
  const [shadeOpen, setShadeOpen] = useState(false);

  const form = useFormSubmit({
    schema: garmentFormSchema,
    action: save,
    successMessage,
    labels: LABELS,
    onSuccess: onSaved,
  });

  const estimate = useMemo(
    () =>
      estimateTempRange({
        category: values.category,
        // Equivalent mutants on both conversions, and the same class as
        // `estimateTempRange`'s own weight guard: the estimator reads
        // `layer === "outer"` and indexes its tables by weight, so an
        // empty string and an absent value already behave identically
        // there. These exist because `GarmentFormValues` types an
        // unanswered select as `""` and `ThermalInput` types it as
        // absent — the conversion is for the compiler, not the runtime.
        // Stryker disable next-line ConditionalExpression,StringLiteral
        layer: values.layer === "" ? undefined : values.layer,
        // Stryker disable next-line ConditionalExpression,StringLiteral
        weight: values.weight === "" ? undefined : values.weight,
        windResistant: values.windResistant,
      }),
    [values.category, values.layer, values.weight, values.windResistant],
  );

  function update<K extends keyof GarmentFormValues>(
    key: K,
    value: GarmentFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit(values);
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-heading">What is it?</legend>
        <FormField
          name="brand"
          label={LABELS.brand}
          error={form.fieldErrors.brand}
        >
          <input
            {...form.field("brand")}
            id="brand"
            type="text"
            list="garment-brand-options"
            value={values.brand}
            onChange={(event) => {
              update("brand", event.target.value);
              onBrandInput?.(event.target.value);
            }}
            className="rounded-field border border-hairline bg-panel px-3 py-2 font-normal"
          />
        </FormField>
        <datalist id="garment-brand-options">
          {(brandOptions ?? []).map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <TextField
          name="name"
          label={LABELS.name}
          value={values.name}
          onChange={(value) => {
            update("name", value);
          }}
          field={form.field}
          error={form.fieldErrors.name}
        />
      </fieldset>

      <FormField
        name="category"
        label={LABELS.category}
        error={form.fieldErrors.category}
      >
        {/*
          `field()` carries `readOnly` for §5's "inputs stay focusable while
          in flight, never disabled". A `<select>` has no such attribute and
          React drops it while `pending` is false, so it is inert here
          rather than wrong — which is why this spreads the same helper as
          every text input instead of a filtered copy of it. The filtered
          copy existed briefly and its only effect was four mutants nothing
          could kill.
        */}
        <select
          {...form.field("category")}
          id="category"
          value={values.category}
          onChange={(event) => {
            update("category", event.target.value as Category);
          }}
          className="rounded-field border border-hairline bg-panel px-3 py-2 font-normal"
        >
          {garmentCategoriesInOrder.map((category) => (
            <option key={category} value={category}>
              {garmentCategoryLabels[category]}
            </option>
          ))}
        </select>
      </FormField>

      <fieldset className="flex flex-col gap-3 border-t border-hairline pt-4">
        <legend className="sr-only">Attributes</legend>
        {
          // fallow-ignore-next-line code-duplication -- three optional attributes rendered explicitly so the form reads as a form; the shared body is already ChoiceField
          fields.layer ? (
            <ChoiceField
              name="layer"
              label={LABELS.layer}
              error={form.fieldErrors.layer}
              field={form.field}
              value={values.layer}
              options={layerSchema.options}
              optionLabels={LAYER_LABELS}
              onChange={(picked) => {
                update("layer", picked);
              }}
            />
          ) : undefined
        }
        {fields.weight ? (
          <ChoiceField
            name="weight"
            label={LABELS.weight}
            error={form.fieldErrors.weight}
            field={form.field}
            value={values.weight}
            options={weightSchema.options}
            optionLabels={WEIGHT_LABELS}
            onChange={(picked) => {
              update("weight", picked);
            }}
          />
        ) : undefined}
        {fields.fabric ? (
          <ChoiceField
            name="fabric"
            label={LABELS.fabric}
            error={form.fieldErrors.fabric}
            field={form.field}
            value={values.fabric}
            options={fabricSchema.options}
            optionLabels={FABRIC_LABELS}
            onChange={(picked) => {
              update("fabric", picked);
            }}
          />
        ) : undefined}
        {fields.windResistant ? (
          <ToggleField
            name="windResistant"
            label="Wind resistant"
            field={form.field}
            isOn={values.windResistant}
            onChange={(next) => {
              update("windResistant", next);
            }}
          />
        ) : undefined}
        {fields.waterResistant ? (
          <ToggleField
            name="waterResistant"
            label="Water resistant"
            field={form.field}
            isOn={values.waterResistant}
            onChange={(next) => {
              update("waterResistant", next);
            }}
          />
        ) : undefined}
        {/* §AH: the fourth and fifth attributes, inside the group that is
            already collapsed. F stays identity-first and the tap count on
            the happy path does not move. Not gated on `fields.*` — every
            category has a colour, including the ones with no layer and no
            fabric. */}
        <ChoiceList
          name="visibilityLevel"
          legend={LABELS.visibilityLevel}
          layout="chips"
          options={garmentVisibilitySchema.options}
          optionLabels={VISIBILITY_LABELS}
          value={values.visibilityLevel}
          field={form.field}
          error={form.fieldErrors.visibilityLevel}
          onChange={(picked) => {
            update("visibilityLevel", picked);
          }}
        />
        <ChoiceList
          name="colorName"
          legend={LABELS.colorName}
          hint="Pick the nearest. A print is its main color."
          layout="chips"
          options={colorNameSchema.options}
          optionLabels={COLOR_LABELS}
          value={values.colorName}
          field={form.field}
          error={form.fieldErrors.colorName}
          onChange={(picked) => {
            update("colorName", picked);
          }}
        />
        {/* §AH: "Level 2 without level 1 isn't possible — the sheet is
            reached from a chosen name." So the affordance does not exist
            until a name does, rather than existing and refusing. */}
        {values.colorName === "" ? undefined : (
          <>
            <button
              type="button"
              onClick={() => {
                setShadeOpen(true);
              }}
              className="target cursor-pointer self-start border-none bg-transparent p-0 text-quiet underline underline-offset-4"
            >
              <Mono step="sm">
                Exact shade
                {values.colorHex === "" ? "" : ` · ${values.colorHex}`}
              </Mono>
            </button>
            <ShadeSheet
              open={shadeOpen}
              colorName={COLOR_LABELS[values.colorName]}
              value={values.colorHex}
              photoUrl={photoUrl}
              onUse={(picked) => {
                update("colorHex", picked);
                setShadeOpen(false);
              }}
              onClear={() => {
                update("colorHex", "");
                setShadeOpen(false);
              }}
              onClose={() => {
                setShadeOpen(false);
              }}
            />
          </>
        )}
      </fieldset>

      {estimate ? (
        <p className="text-small text-quiet">
          Estimated{" "}
          <Bracketed className="text-dialed-text">
            {formatTempRange(estimate)}
          </Bracketed>
        </p>
      ) : undefined}

      <TextField
        name="size"
        label={LABELS.size}
        value={values.size}
        onChange={(value) => {
          update("size", value);
        }}
        field={form.field}
        error={form.fieldErrors.size}
      />
      <TextField
        name="color"
        label={LABELS.color}
        value={values.color}
        onChange={(value) => {
          update("color", value);
        }}
        field={form.field}
        error={form.fieldErrors.color}
      />
      <TextField
        name="productUrl"
        label={LABELS.productUrl}
        value={values.productUrl}
        onChange={(value) => {
          update("productUrl", value);
        }}
        field={form.field}
        error={form.fieldErrors.productUrl}
        type="url"
      />
      {values.productUrl === "" ? undefined : (
        <p className="text-micro text-muted">
          <Mono>Enrichment pending — lane 107</Mono>
        </p>
      )}

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label={submitLabel}
        pendingLabel={pendingLabel}
        pending={form.pending}
      />
    </form>
  );
}
