import { useMemo, useState } from "react";
import type { SyntheticEvent } from "react";

import type {
  garmentCategories,
  fabricSchema,
  layerSchema,
  weightSchema,
} from "../../../lib/contracts";
import { estimateTempRange } from "../../../lib/thermal";
import { Bracketed, Mono } from "../../../ui";
import type { z } from "zod";

type Category = (typeof garmentCategories)[number];
type Layer = z.infer<typeof layerSchema>;
type Weight = z.infer<typeof weightSchema>;
type Fabric = z.infer<typeof fabricSchema>;

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

const CATEGORY_ORDER: Category[] = [
  "top",
  "bottom",
  "headwear",
  "neckwear",
  "gloves",
  "socks",
  "shoes",
  "accessory",
];

interface CategoryFields {
  layer: boolean;
  weight: boolean;
  fabric: boolean;
  windResistant: boolean;
  waterResistant: boolean;
}

/**
 * Which attribute inputs a category admits (mirrors the discriminated union
 * in lib/contracts.ts) — the form renders only these below the identity
 * fields, per screen F's "category one tap; attributes collapsed below".
 */
function fieldsForCategory(category: Category): CategoryFields {
  switch (category) {
    case "top":
    case "bottom": {
      return {
        layer: true,
        weight: true,
        fabric: true,
        windResistant: true,
        waterResistant: true,
      };
    }
    case "headwear": {
      return {
        layer: false,
        weight: true,
        fabric: true,
        windResistant: true,
        waterResistant: false,
      };
    }
    case "neckwear":
    case "socks": {
      return {
        layer: false,
        weight: true,
        fabric: true,
        windResistant: false,
        waterResistant: false,
      };
    }
    case "gloves": {
      return {
        layer: false,
        weight: true,
        fabric: false,
        windResistant: true,
        waterResistant: true,
      };
    }
    case "shoes": {
      return {
        layer: false,
        weight: false,
        fabric: false,
        windResistant: false,
        waterResistant: true,
      };
    }
    case "accessory": {
      return {
        layer: false,
        weight: false,
        fabric: false,
        windResistant: false,
        waterResistant: false,
      };
    }
  }
}

export interface GarmentFormValues {
  brand: string;
  name: string;
  category: Category;
  size: string;
  color: string;
  productUrl: string;
  layer: Layer | "";
  weight: Weight | "";
  fabric: Fabric | "";
  windResistant: boolean;
  waterResistant: boolean;
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
  onSubmit: (values: GarmentFormValues) => void;
  submitLabel?: string | undefined;
}

/**
 * Screen F (v1, identity-first, D-27): brand + model lead; category one tap;
 * attribute fields collapsed below, shown only where the category admits
 * them. A generic entry (category + name only) is still one submit away —
 * never blocked on brand/model.
 */
export function GarmentForm({
  initial,
  brandOptions,
  onBrandInput,
  onSubmit,
  submitLabel,
}: Readonly<GarmentFormProps>) {
  const [values, setValues] = useState<GarmentFormValues>({
    ...EMPTY_VALUES,
    ...initial,
  });
  const fields = fieldsForCategory(values.category);

  const estimate = useMemo(
    () =>
      estimateTempRange({
        category: values.category,
        layer: values.layer === "" ? undefined : values.layer,
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

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-lg uppercase">What is it?</legend>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Brand
          <input
            type="text"
            list="garment-brand-options"
            value={values.brand}
            onChange={(event) => {
              update("brand", event.target.value);
              onBrandInput?.(event.target.value);
            }}
            className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
          />
          <datalist id="garment-brand-options">
            {(brandOptions ?? []).map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Model / name
          <input
            type="text"
            required
            value={values.name}
            onChange={(event) => {
              update("name", event.target.value);
            }}
            className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
          />
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Category
        <select
          value={values.category}
          onChange={(event) => {
            update("category", event.target.value as Category);
          }}
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        >
          {CATEGORY_ORDER.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-3 border-t border-night/10 pt-4">
        <legend className="sr-only">Attributes</legend>
        {fields.layer ? (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Layer
            <select
              value={values.layer}
              onChange={(event) => {
                update("layer", event.target.value as Layer | "");
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            >
              <option value="">—</option>
              <option value="base">Base</option>
              <option value="mid">Mid</option>
              <option value="outer">Outer</option>
            </select>
          </label>
        ) : undefined}
        {fields.weight ? (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Weight
            <select
              value={values.weight}
              onChange={(event) => {
                update("weight", event.target.value as Weight | "");
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            >
              <option value="">—</option>
              <option value="light">Light</option>
              <option value="mid">Mid</option>
              <option value="heavy">Heavy</option>
            </select>
          </label>
        ) : undefined}
        {fields.fabric ? (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Fabric
            <select
              value={values.fabric}
              onChange={(event) => {
                update("fabric", event.target.value as Fabric | "");
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            >
              <option value="">—</option>
              <option value="synthetic">Synthetic</option>
              <option value="merino">Merino</option>
              <option value="cotton">Cotton</option>
              <option value="blend">Blend</option>
              <option value="down">Down</option>
            </select>
          </label>
        ) : undefined}
        {fields.windResistant ? (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
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
            {Math.round(estimate.lowC)}–{Math.round(estimate.highC)}°
          </Bracketed>
        </p>
      ) : undefined}

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Size
        <input
          type="text"
          value={values.size}
          onChange={(event) => {
            update("size", event.target.value);
          }}
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Color
        <input
          type="text"
          value={values.color}
          onChange={(event) => {
            update("color", event.target.value);
          }}
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Product link
        <input
          type="url"
          value={values.productUrl}
          onChange={(event) => {
            update("productUrl", event.target.value);
          }}
          placeholder="https://…"
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        />
      </label>
      {values.productUrl === "" ? undefined : (
        <p className="text-xs text-night/40">
          <Mono>Enrichment pending — lane 107</Mono>
        </p>
      )}

      <button
        type="submit"
        className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
      >
        {submitLabel ?? "Save"}
      </button>
    </form>
  );
}
