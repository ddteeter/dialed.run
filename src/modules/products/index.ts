/**
 * Public API for the products module (brands + canonical product identity).
 * Server-fn glue lives in ./functions (imported directly by routes) so this
 * barrel stays loadable in the vitest workers pool (no TanStack virtual
 * entries) — mirrors modules/auth's split.
 */
export { applyExtraction, type ApplyReport } from "./apply-extraction";
export type {
  ProductAttributeDefaults,
  ProductComposition,
  ProductForDetail,
} from "./service";
export {
  createOrGetBrand,
  newRowsFor,
  productsForBrand,
  getProductAttributeDefaultsBulk,
  getProductForDetail,
  resolveProduct,
  searchBrands,
} from "./service";
export { waitingCorrectionsCountOf } from "./correction-queue";
