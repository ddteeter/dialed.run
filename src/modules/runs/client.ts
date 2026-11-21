/**
 * `runs`'s client-safe door (design 255): what a route may import at module
 * scope. A route is in the client bundle, and `index.ts` reaches `env`, so
 * this door re-exports only files that reach no server code by value;
 * `client-side-reaches-no-server` in `.dependency-cruiser.cjs` checks it at
 * commit. A component imports these files directly, never this door.
 */
export {
  newRunSearch,
  runListDeps,
  runListSearch,
  stravaCallbackSearch,
} from "./inputs";
export { backToUpload, beforeItsEntry, runOrNotFound } from "./not-found";
