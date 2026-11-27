/**
 * The auth module's public API.
 *
 * The `auth` instance lives in ./instance, which only auth's own files
 * import: no other module reaches it through this barrel.
 */

// Session type export returns when a lane consumes it (knip keeps us honest).

// Server-fn glue lives in ./functions, imported directly by route files.

export { authRequest } from "./auth-route";

// The shared auth gate. Reached through the barrel (not deep-imported)
// because `no-cross-module-deep-imports` in .dependency-cruiser.cjs makes
// the barrel the only legal module-to-module entry point.
//
// `requireUserId` pulls @tanstack/react-start/server, so importing THIS
// barrel inside the vitest workers pool no longer works. That is a real
// narrowing of what the barrel was before; it is acceptable because the
// only importers are the modules own functions.ts files, which were never
// pool-loadable either. Unit tests that need the error reach for
// ./auth-error, which stays framework-free on purpose.
export {
  checkCurrentPassword,
  currentSessionId,
  optionalUserId,
  optionalVerifiedUserId,
  requireSignedInSince,
  requireUserId,
  requireUserIdBeforeTerms,
  requireUserIdWhileLeaving,
  verifiedUserId,
} from "./require-user";
export { deploymentPosture } from "./create-auth";
export { sessionFromRequest } from "./session";
export { d1RequestDepsFromEnv, respondInD1Scope } from "./d1-request";
