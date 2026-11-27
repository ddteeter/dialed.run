/**
 * The safety module's public API (task 106): the names its own folder
 * holds, the Desk's input schemas and the notice band. Every other name
 * is on the sub-module door it lives on (`safety/rules`, `safety/review`,
 * …), and other modules import that door (design 261 ruling 2).
 *
 * Framework-free on purpose: nothing here pulls `@tanstack/react-start`, so
 * this barrel stays importable from the vitest workers pool. Server-fn glue
 * lives in ./functions and is imported directly by route files, the same
 * split `modules/auth` documents.
 */

export {
  type HandleReviewValues,
  type ReviewActionValues,
  copyrightHoldInput,
  garmentMatchActionInput,
  removalDecisionInput,
  reviewActionInput,
  takedownInput,
} from "./inputs";
export { NoticeBand } from "./notices/components/NoticeBand";
