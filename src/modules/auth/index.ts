/**
 * The auth module's public API.
 *
 * The `auth` instance itself lives in ./instance so that ./require-user can
 * import it without this barrel and that file forming an import cycle
 * (dependency-cruiser rejects cycles; see CLAUDE.md "no circular imports").
 */

// Session type export returns when a lane consumes it (knip keeps us honest).

// Server-fn glue lives in ./functions, imported directly by route files.

export { auth } from "./instance";

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
export { AuthRequiredError, isAuthRequired } from "./auth-error";
export { requireUserId } from "./require-user";
export { sessionFromRequest } from "./session";
