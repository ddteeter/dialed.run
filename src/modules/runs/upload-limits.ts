/**
 * What an upload is refused for, on both sides of the wire.
 *
 * **Split out of `./imports` because a route reaches this and must not
 * reach that** (D-50). `runs/inputs.ts` needs the cap and the error type to
 * validate a submission, routes import `inputs.ts`, and `imports.ts` pulls
 * `db/schema-core` and the FIT/GPX/TCX parsers with it — so one constant
 * and one three-word class were holding drizzle's column builders and the
 * Garmin SDK in the client bundle. Measured: ~7 kB of the entry chunk.
 *
 * This is the same shape `feed/route-decisions.ts` and `runs/not-found.ts`
 * already have, and the same rule CLAUDE.md states — a decision a route
 * needs goes in a sibling that imports nothing server-side.
 */

/**
 * 25 MB. A `.fit` from a watch is kilobytes; a multi-hour `.gpx` with
 * per-second track points is the case this is sized for.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/**
 * Thrown for the things the upload step can reject outright — size, type,
 * an empty file. Never for a file that might still parse: those become an
 * `imports` row with a failure status, so the user can see what happened.
 */
export class ImportUploadError extends Error {}
