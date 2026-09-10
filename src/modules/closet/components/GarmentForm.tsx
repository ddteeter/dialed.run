import { useMemo, useState } from "react";

import type { Garment } from "../../../lib/contracts";
import {
  fabricSchema,
  garmentCategories,
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
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import { garmentFormSchema, type GarmentFormValues } from "../form-schema";

type Category = (typeof garmentCategories)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  top: "Top",
  bottom: "Bottom",
  headwear: "Headwear",
  neckwear: "Neckwear",
  gloves: "Gloves",
  socks: "Socks",
  shoes: "Shoes",
  accessory: "Accessory",
};

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
  color: "Color",
  productUrl: "Product link",
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
}: Readonly<GarmentFormProps>) {
  const [values, setValues] = useState<GarmentFormValues>({
    ...EMPTY_VALUES,
    ...initial,
  });
  const fields = fieldsForCategory(values.category);

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
        <legend className="font-display text-lg uppercase">What is it?</legend>
        <FormField name="brand" label={LABELS.brand} error={form.fieldErrors.brand}>
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
            className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
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
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        >
          {garmentCategoriesInOrder.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </FormField>

      <fieldset className="flex flex-col gap-3 border-t border-night/10 pt-4">
        <legend className="sr-only">Attributes</legend>
        {fields.layer ? (
          <FormField name="layer" label={LABELS.layer} error={form.fieldErrors.layer}>
            <select
              {...form.field("layer")}
              id="layer"
              value={values.layer}
              onChange={(event) => {
                update("layer", event.target.value as GarmentFormValues["layer"]);
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            >
              <option value="">—</option>
              {layerSchema.options.map((option) => (
                <option key={option} value={option}>
                  {LAYER_LABELS[option]}
                </option>
              ))}
            </select>
          </FormField>
        ) : undefined}
        {fields.weight ? (
          <FormField name="weight" label={LABELS.weight} error={form.fieldErrors.weight}>
            <select
              {...form.field("weight")}
              id="weight"
              value={values.weight}
              onChange={(event) => {
                update("weight", event.target.value as GarmentFormValues["weight"]);
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            >
              <option value="">—</option>
              {weightSchema.options.map((option) => (
                <option key={option} value={option}>
                  {WEIGHT_LABELS[option]}
                </option>
              ))}
            </select>
          </FormField>
        ) : undefined}
        {fields.fabric ? (
          <FormField name="fabric" label={LABELS.fabric} error={form.fieldErrors.fabric}>
            <select
              {...form.field("fabric")}
              id="fabric"
              value={values.fabric}
              onChange={(event) => {
                update("fabric", event.target.value as GarmentFormValues["fabric"]);
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            >
              <option value="">—</option>
              {fabricSchema.options.map((option) => (
                <option key={option} value={option}>
                  {FABRIC_LABELS[option]}
                </option>
              ))}
            </select>
          </FormField>
        ) : undefined}
        {fields.windResistant ? (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              {...form.field("windResistant")}
              type="checkbox"
              checked={values.windResistant}
              onChange={(event) => {
                update("windResistant", event.target.checked);
              }}
            />
            Wind resistant
          </label>
        ) : undefined}
        {fields.waterResistant ? (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              {...form.field("waterResistant")}
              type="checkbox"
              checked={values.waterResistant}
              onChange={(event) => {
                update("waterResistant", event.target.checked);
              }}
            />
            Water resistant
          </label>
        ) : undefined}
      </fieldset>

      {estimate ? (
        <p className="text-sm text-night/70">
          Estimated{" "}
          <Bracketed className="text-teal">
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
        <p className="text-xs text-night/40">
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
