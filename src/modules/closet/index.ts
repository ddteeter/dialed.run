/**
 * Public API for the closet module. Server-fn glue lives in ./functions
 * (imported directly by routes) so this barrel stays loadable in the vitest
 * workers pool (no TanStack virtual entries) — mirrors modules/auth's split.
 */
export type { ClosetItemView, WardrobeItemRow } from "./service";
export { listItems, NotFoundError } from "./service";
export type { ClimateBand, TapListEntry } from "./tap-list";
export {
  climateBandSchema,
  isTapListPlaceholder,
  TAP_LIST_FOLD,
  tapListFor,
} from "./tap-list";
export { allowedLinksOf } from "./garment-link";
export { photoUrlFor } from "./photo-url";
export {
  publicRotation,
  type PublicRotation,
  type RotationPiece,
} from "./public-rotation";
export {
  linkTypedGarments,
  nameItem,
  productLinkHandler,
} from "./product-link";
export { typeWordOf } from "./type-labels";
export { clearedPhoto, getItemPhotoObject } from "./photos";
