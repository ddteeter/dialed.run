/**
 * Route-facing helper: GarmentForm's flat, always-a-string form state ->
 * the discriminated-union Garment the server functions validate against.
 * Lives here (not in the component) so both new.tsx and edit.$itemId.tsx
 * share one mapping.
 */
import type { Garment } from "../../lib/contracts";
import type { GarmentFormValues } from "./components/GarmentForm";
import type { EffectiveAttributes, WardrobeItemRow } from "./service";

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function garmentFromFormValues(values: GarmentFormValues): Garment {
  const identity = {
    name: values.name.trim(),
    brand: optional(values.brand),
    size: optional(values.size),
    color: optional(values.color),
    productUrl: optional(values.productUrl),
  };
  const layer = values.layer === "" ? undefined : values.layer;
  const weight = values.weight === "" ? undefined : values.weight;
  const fabric = values.fabric === "" ? undefined : values.fabric;

  switch (values.category) {
    case "top":
    case "bottom": {
      return {
        ...identity,
        category: values.category,
        layer,
        weight,
        fabric,
        windResistant: values.windResistant,
        waterResistant: values.waterResistant,
      };
    }
    case "headwear": {
      return {
        ...identity,
        category: "headwear",
        weight,
        fabric,
        windResistant: values.windResistant,
      };
    }
    case "neckwear": {
      return { ...identity, category: "neckwear", weight, fabric };
    }
    case "gloves": {
      return {
        ...identity,
        category: "gloves",
        weight,
        windResistant: values.windResistant,
        waterResistant: values.waterResistant,
      };
    }
    case "socks": {
      return { ...identity, category: "socks", weight, fabric };
    }
    case "shoes": {
      return {
        ...identity,
        category: "shoes",
        waterResistant: values.waterResistant,
      };
    }
    case "accessory": {
      return { ...identity, category: "accessory" };
    }
  }
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
