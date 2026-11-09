/**
 * A product row and a correction's value, each read as the other. Pure, so
 * the seven fields' two directions are tested side by side.
 */
import { sql, type SQL } from "drizzle-orm";

import { brands, products } from "../../db/schema-core";
import { fabricSchema, weightSchema } from "../../lib/contracts/garments";
import type { CorrectionField } from "../../lib/contracts/product-corrections";
import { normalizeIdentity } from "../../lib/normalize";

type ProductRow = typeof products.$inferSelect;
type ProductInsert = typeof products.$inferInsert;
/**
 * An UPDATE's set: a value, or `sql\`NULL\`` to clear a column (an
 * `undefined` would be dropped and keep the old one; `lib/sql/sql-null`).
 */
type ProductPatch = { [K in keyof ProductInsert]?: ProductInsert[K] | SQL };

/**
 * The product columns a field's value writes. Wind and water are stored
 * as the words and written as booleans; a corrected composition is the
 * label's text, so the parts read from the old one go with it. The value
 * is read back from D1, so the enums are parsed again rather than trusted.
 */
export function productPatch(
  field: CorrectionField,
  value: string,
): ProductPatch {
  switch (field) {
    case "name": {
      return { name: value, normalizedName: normalizeIdentity(value) };
    }
    case "weight": {
      return { weight: weightSchema.parse(value) };
    }
    case "fabric": {
      return { fabric: fabricSchema.parse(value) };
    }
    case "wind": {
      return { windResistant: value === "yes" };
    }
    case "water": {
      return { waterResistant: value === "yes" };
    }
    case "composition": {
      return { fabricComposition: value, fabricParts: sql`NULL` };
    }
    case "link": {
      return { sourceUrl: value };
    }
  }
}

function yesNo(value: boolean | null): string | undefined {
  if (value === null) return;
  return value ? "yes" : "no";
}

/**
 * What the product says now, per field, as a correction's value would say
 * it: the sheet's "It says Mid." and the Desk's NOW (R48·129–130). A fact
 * the product does not state is absent.
 */
export function currentValues(
  row: Pick<
    ProductRow,
    | "name"
    | "weight"
    | "fabric"
    | "windResistant"
    | "waterResistant"
    | "fabricComposition"
    | "sourceUrl"
  >,
): Partial<Record<CorrectionField, string>> {
  const values: Record<CorrectionField, string | null | undefined> = {
    name: row.name,
    weight: row.weight,
    fabric: row.fabric,
    wind: yesNo(row.windResistant),
    water: yesNo(row.waterResistant),
    composition: row.fabricComposition,
    link: row.sourceUrl,
  };
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * The product's brand name, for a select from `products`: a scalar
 * subquery rather than a join, because D1 answers by column name and a
 * joined `brands.name` beside `products.name` comes back as the product's.
 * Both sides are named by table: drizzle prints a column bare inside raw
 * SQL.
 */
export function brandNameColumn() {
  return sql<string>`(select ${brands}.${sql.identifier(brands.name.name)} from ${brands} where ${brands}.${sql.identifier(brands.id.name)} = ${products}.${sql.identifier(products.brandId.name)})`;
}

/**
 * The product columns `currentValues` reads, as a select list: the sheet's
 * context and the Desk's queue both read what the product says now.
 */
export function productFactColumns() {
  return {
    name: products.name,
    weight: products.weight,
    fabric: products.fabric,
    windResistant: products.windResistant,
    waterResistant: products.waterResistant,
    fabricComposition: products.fabricComposition,
    sourceUrl: products.sourceUrl,
  };
}
