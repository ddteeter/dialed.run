import type { coreDb as handle } from "../../env";

/**
 * This module's dialed-core handle: the request's D1 session, or the bare
 * binding outside a request (design 143). `src/db/` may not import `env`
 * (dependency-cruiser "db-imports-lib-only"), so the handle comes from
 * `src/env` and the type is named here for the module's own signatures.
 */
export { coreDb } from "../../env";

export type CoreDb = ReturnType<typeof handle>;
