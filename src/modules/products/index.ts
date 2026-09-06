/**
 * Public API for the products module (brands + canonical product identity).
 * Server-fn glue lives in ./functions (imported directly by routes) so this
 * barrel stays loadable in the vitest workers pool (no TanStack virtual
 * entries) — mirrors modules/auth's split.
 */
export type { BrandRow, ProductAttributeDefaults, ProductRow } from "./service";
export {
  createOrGetBrand,
  createOrGetProduct,
  getProductAttributeDefaults,
  getProductAttributeDefaultsBulk,
  resolveProduct,
  searchBrands,
  searchProducts,
} from "./service";
export { CURATED_BRANDS, ensureBrandsSeeded } from "./seed-brands";
