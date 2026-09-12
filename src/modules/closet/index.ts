/**
 * Public API for the closet module. Server-fn glue lives in ./functions
 * (imported directly by routes) so this barrel stays loadable in the vitest
 * workers pool (no TanStack virtual entries) — mirrors modules/auth's split.
 */
export type {
  ClosetFilters,
  ClosetItemView,
  ClosetListing,
  EffectiveAttributes,
  ItemDetail,
  ItemOrigin,
  ItemPerformance,
  PerformanceSummary,
  WardrobeItemRow,
} from "./service";
export {
  computeUserPerformance,
  createItem,
  deleteOrRetireItem,
  getItemDetail,
  getItemsByIds,
  getOwnedItem,
  listItems,
  NotFoundError,
  retireItem,
  unretireItem,
  updateItem,
} from "./service";
export type { ClimateBand, TapListEntry, TapListSelection } from "./tap-list";
export {
  addFromTapList,
  climateBandSchema,
  climateBands,
  TAP_LIST,
  TAP_LIST_FOLD,
  tapListFor,
  tapListSelectionSchema,
} from "./tap-list";
export type { PhotoSize, PhotoUploadResult } from "./photos";
export { photoKeyFor, photoSizes } from "./photos";
