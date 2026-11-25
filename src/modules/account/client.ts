/**
 * `account`'s client-safe door (design 255): what a route may import at module
 * scope. A route is in the client bundle, and `index.ts` reaches `env`, so
 * this door re-exports only files that reach no server code by value;
 * `client-side-reaches-no-server` in `.dependency-cruiser.cjs` checks it at
 * commit. A component imports these files directly, never this door.
 */
export {
  ACCOUNT_SECTION_TITLES,
  accessConfirmSearch,
  DELETE_REAUTH_RETURN,
  accountSectionOrNotFound,
  accountSectionSearch,
  checkEmailSearch,
  checkEmailView,
  deskAccessSearch,
  gateOnHandle,
  homeIfNothingToSay,
  leavingSearch,
  startOverIfNoAddress,
  termsPromptSearch,
  tokenSearch,
  unsubscribeSearch,
} from "./route-decisions";
export { withOwnTheme } from "./theme-answer";
export { useTermsPromptWiring } from "./use-go-home";
export { useSavedPage } from "./use-saved-page";
