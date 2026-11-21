/**
 * `feed`'s client-safe door (design 255): what a route may import at module
 * scope. A route is in the client bundle, and `index.ts` reaches `env`, so
 * this door re-exports only files that reach no server code by value;
 * `client-side-reaches-no-server` in `.dependency-cruiser.cjs` checks it at
 * commit. A component imports these files directly, never this door.
 */
export { orOnToVerdict } from "./attach-rules";
export { publicProfileSearch } from "./inputs";
export { attachSearch, verdictSearch } from "./kit-push";
export { entryReportLabel } from "./posted";
export { kitOrNotFound, publicKitHead } from "./public-web/public-kit-shape";
export {
  profileOrNotFound,
  publicProfileHead,
} from "./public-web/public-profile-shape";
export {
  orBackToFeed,
  orHandlePage,
  requireSignedIn,
  toHandleWhenId,
  viewerContext,
} from "./redirect";
export {
  bandContextFor,
  noindexHead,
  profileReportSubject,
  shouldAskForVerdict,
} from "./route-decisions";
