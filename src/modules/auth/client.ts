/**
 * `auth`'s client-safe door (design 255): what a route may import at module
 * scope. A route is in the client bundle, and `index.ts` reaches `env`, so
 * this door re-exports only files that reach no server code by value;
 * `client-side-reaches-no-server` in `.dependency-cruiser.cjs` checks it at
 * commit. A component imports these files directly, never this door.
 */
export { useCarriedEmail } from "./carried-email";
export {
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
  signOutEverywhere,
  signUp,
} from "./credentials";
export { optionalUserIdFrom } from "./session-user";
export {
  googleReturn,
  joinSearch,
  onToSignUp,
  parseSignInSearch,
} from "./sign-in-search";
export { signedInOnly } from "./signed-in-only";
