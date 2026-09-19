import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * Column value that clears a nullable column without the `null` literal.
 *
 * Two reasons this exists rather than each caller writing `null`:
 *
 * - `unicorn/no-null` is on, and the repo's answer to "but the database
 *   needs one" is raw `sql\`NULL\`` rather than a suppression.
 * - **On an UPDATE, `undefined` and NULL mean different things.** Drizzle
 *   drops an `undefined` set-value, so a column meant to be *cleared*
 *   silently keeps its old value. That is the bug this prevents, and it is
 *   invisible: no error, no type complaint, just a stale field.
 *
 * On an INSERT the distinction does not arise — an omitted nullable column
 * is stored as NULL either way — so prefer passing the `undefined` straight
 * through there and reach for this only when clearing.
 *
 * Lifted out of `modules/closet/service.ts`, which had it private, when
 * `modules/safety` needed the same thing. Copying it would have been the
 * rival truth CLAUDE.md warns about; a module-private helper that two
 * modules need belongs in `lib/`.
 */
export function orSqlNull<T>(value: T | undefined): T | SQL {
  return value ?? sql`NULL`;
}
