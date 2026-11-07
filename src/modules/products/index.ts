/**
 * Public API for the products module (brands + canonical product identity).
 * Server-fn glue lives in ./functions (imported directly by routes) so this
 * barrel stays loadable in the vitest workers pool (no TanStack virtual
 * entries) — mirrors modules/auth's split.
 */
export {
  applyExtraction,
  ExtractionConflictError,
  type ApplyReport,
} from "./apply-extraction";
export type {
  BrandRow,
  ProductAttributeDefaults,
  ProductComposition,
  ProductForDetail,
  ProductRow,
} from "./service";
export {
  createOrGetBrand,
  productsForBrand,
  createOrGetProduct,
  getProductAttributeDefaults,
  getProductAttributeDefaultsBulk,
  getProductComposition,
  getProductForDetail,
  resolveProduct,
  searchBrands,
  searchProducts,
} from "./service";
export { CURATED_BRANDS } from "./seed-brands";
export {
  applyCorrection,
  correctionsQueue,
  declineCorrection,
  waitingCorrectionsCountOf,
  type ApplyOutcome,
  type CorrectionFiler,
  type CorrectionGroup,
  type CorrectionKey,
  type CorrectionsQueue,
} from "./correction-queue";
export {
  correctionContext,
  fileCorrection,
  type CorrectionContext,
  type WaitingCorrection,
} from "./corrections";
export { correctionKeyInput, declineCorrectionInput } from "./inputs";
