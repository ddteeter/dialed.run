/**
 * The account module's public API (task 126): the handle today; email,
 * verification, invites, export and deletion as they land.
 *
 * Server-fn glue lives in ./functions, imported directly by route files,
 * so this barrel stays importable in the vitest workers pool.
 */
export { claimUsername, lookUpHandle, usernameOf } from "./username";
export type { HandleClaim, HandleLookup } from "./username";
