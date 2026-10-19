import { AsyncLocalStorage } from "node:async_hooks";

import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

/**
 * D1 read replication, request side (design 143, decision D-123).
 *
 * A query only reaches a read replica through a D1 session; the bare
 * binding always reads the primary. So inside a request every query goes
 * through a session, opened lazily on the first query and shared by every
 * caller in that request. Outside a request (a queue consumer, a cron)
 * there is no scope and every query goes to the bare binding, which is
 * the primary, as before.
 *
 * The handle decides this **per query, not when it is made**. Better
 * Auth's instance is built once, at module load, outside any request, and
 * its queries still have to land in the request they belong to.
 *
 * Where a session starts decides what it may read:
 *
 * - **pinned** (a write-class gate ran, a check that authorizes a write
 *   asked for it, or the handle is the primary one): `first-primary`, so
 *   such a check never reads a lagging replica (D-123's carve-out);
 * - **a bookmark**, the newest of the device's cookie, the runner's stored
 *   one and the request's own primary session: a replica waits until it
 *   has caught up to it, so a runner never reads older than their own
 *   last write, on any device;
 * - **neither**: `first-unconstrained`, any replica.
 */

export type DbKey = "core" | "weather";

/**
 * A slot's session, the binding that opened it (which reopens it), and the
 * bookmark it was opened from, if it was opened from one.
 */
interface Open {
  readonly binding: D1Database;
  session: D1DatabaseSession;
  from: string | undefined;
}

interface Slot {
  open: Open | undefined;
  pinned: boolean;
  bookmark: string | undefined;
  wrote: boolean;
}

/**
 * One request's sessions: core and weather for `scopedDb`, and core's
 * primary for `primaryDb`, which is pinned from the start.
 */
interface Scope {
  readonly core: Slot;
  readonly weather: Slot;
  readonly primary: Slot;
  runnerId: string | undefined;
}

const scopes = /*#__PURE__*/ new AsyncLocalStorage<Scope>();

function newSlot(isPinned: boolean): Slot {
  return {
    open: undefined,
    pinned: isPinned,
    bookmark: undefined,
    wrote: false,
  };
}

/**
 * A bookmark as it arrives from outside: a cookie, or a column a past
 * request wrote. D1 throws on a malformed one, so anything else is
 * treated as no bookmark at all. Locally they are four groups of
 * fixed-width, zero-padded hex (`00000000-0000003d-00000000-<32 hex>`);
 * the check stays loose about the grouping and strict about the alphabet
 * and length, so a format change in production degrades to "no bookmark"
 * rather than a thrown request.
 */
const bookmarkSchema = z
  .string()
  .max(128)
  .regex(/^[0-9a-f]+(?:-[0-9a-f]+)*$/i);

export function parseBookmark(value: unknown): string | undefined {
  const parsed = bookmarkSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The later of two bookmarks. Cloudflare documents the order: "Bookmarks
 * are lexicographically sortable. Sorting orders a list of bookmarks from
 * oldest-to-newest", and the Sessions API uses the same bookmarks (D1
 * Time Travel reference; design 143, Q1). `scopeOutcome` reports a request
 * whose bookmark went backwards, which is how a change to that would show.
 */
export function newerBookmark(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  // `<` on strings is UTF-16 code-unit order: lexicographic, as the docs
  // promise, and the order SQLite's BINARY `<` gives ASCII in
  // `storeRunnerBookmark`. Not `localeCompare`, whose collation only
  // agrees while every bookmark is the same width and case.
  // Equivalent mutant: `<=` differs from `<` only when `a === b`, and then
  // either operand is the same string.
  // Stryker disable next-line EqualityOperator
  return a < b ? b : a;
}

const READ_STATEMENT = /^\s*select\b/i;

/**
 * Whether a statement may change rows, so the request's bookmark is worth
 * storing for the runner's other devices.
 *
 * The test is one-sided on purpose. A statement whose first word is
 * `SELECT` is a SQLite select-stmt, and that grammar cannot write: a CTE
 * inside it is a select too, `RETURNING` belongs only to
 * INSERT/UPDATE/DELETE, and D1 has no user functions. Everything else
 * counts as a write — a leading comment, `WITH … SELECT`, a `PRAGMA`,
 * whatever drizzle emits next — and the cost of being wrong that way is
 * one idempotent UPDATE. Listing the write verbs instead would fail the
 * other way, silently. D1's own `meta.changed_db` cannot replace this:
 * drizzle reads every query with fields, `.returning()` included, through
 * `raw()`, which carries no meta.
 */
export function isWriteStatement(sql: string): boolean {
  return !READ_STATEMENT.test(sql);
}

function primaryBookmarkOf(scope: Scope): string | undefined {
  return parseBookmark(scope.primary.open?.session.getBookmark());
}

/**
 * Only core follows the primary session: they are one database. Weather is
 * another, and a core bookmark means nothing to it.
 */
function constraintOf(scope: Scope, slot: Slot): string {
  if (slot.pinned) return "first-primary";
  const own = slot === scope.core ? primaryBookmarkOf(scope) : undefined;
  return newerBookmark(slot.bookmark, own) ?? "first-unconstrained";
}

function opened(binding: D1Database, constraint: string): Open {
  return {
    binding,
    session: binding.withSession(constraint),
    from: parseBookmark(constraint),
  };
}

function sessionOf(
  scope: Scope,
  slot: Slot,
  binding: D1Database,
): D1DatabaseSession {
  slot.open ??= opened(binding, constraintOf(scope, slot));
  return slot.open.session;
}

export const SESSION_ONLY_MESSAGE =
  "a D1 session offers only prepare and batch";

function sessionOnly(): never {
  throw new Error(SESSION_ONLY_MESSAGE);
}

/**
 * A `D1Database` that routes each call by the request it runs in, so
 * drizzle runs on it with no cast. Only `prepare` and `batch` are drizzle's
 * query path; a session has nothing else, so in a request the rest refuse
 * rather than quietly reaching the primary.
 */
function routedDatabase(
  binding: D1Database,
  slotIn: (scope: Scope) => Slot,
): D1Database {
  return {
    prepare(query) {
      const scope = scopes.getStore();
      if (scope === undefined) return binding.prepare(query);
      const slot = slotIn(scope);
      if (isWriteStatement(query)) slot.wrote = true;
      return sessionOf(scope, slot, binding).prepare(query);
    },
    batch(statements) {
      const scope = scopes.getStore();
      if (scope === undefined) return binding.batch(statements);
      return sessionOf(scope, slotIn(scope), binding).batch(statements);
    },
    exec(query) {
      if (scopes.getStore() === undefined) return binding.exec(query);
      return sessionOnly();
    },
    withSession(constraint) {
      if (scopes.getStore() === undefined) {
        return binding.withSession(constraint);
      }
      return sessionOnly();
    },
    dump: sessionOnly,
  };
}

/**
 * Drizzle that reads `key` through the request's session, and through the
 * bare binding outside a request.
 */
export function scopedDb(binding: D1Database, key: DbKey) {
  return drizzle(routedDatabase(binding, (scope) => scope[key]));
}

/**
 * The core handle `src/env/d1.ts` hands out: `scopedDb` on `core`.
 */
export function coreDbOver(binding: D1Database) {
  return scopedDb(binding, "core");
}

/**
 * The weather handle `src/env/d1.ts` hands out: `scopedDb` on `weather`.
 */
export function weatherDbOver(binding: D1Database) {
  return scopedDb(binding, "weather");
}

/**
 * Drizzle that always reads the primary: Better Auth and the auth gates.
 * In a request it is a `first-primary` session of its own, so its writes
 * leave a bookmark the request's replica reads and its cookie start from.
 */
export function primaryDb(binding: D1Database) {
  return drizzle(routedDatabase(binding, (scope) => scope.primary));
}

/**
 * Run `work` as one request. `deviceBookmark` is the `d1b` cookie's value,
 * which only core carries; weather has one writer, the cron, and nobody
 * reads their own write there.
 */
export function runInD1Scope<T>(
  deviceBookmark: string | undefined,
  work: () => PromiseLike<T>,
): Promise<T> {
  const core = newSlot(false);
  core.bookmark = parseBookmark(deviceBookmark);
  const scope: Scope = {
    core,
    weather: newSlot(false),
    primary: newSlot(true),
    runnerId: undefined,
  };
  // Awaited inside the scope: a drizzle builder is lazy (CLAUDE.md, D1
  // query discipline), so one handed back unawaited would otherwise run
  // after the scope has closed, on the bare binding.
  return scopes.run(scope, async () => {
    const result = await work();
    return result;
  });
}

function reopen(scope: Scope, slot: Slot): void {
  if (slot.open === undefined) return;
  slot.open = opened(slot.open.binding, constraintOf(scope, slot));
}

/**
 * From here on this request reads `key` from the primary. A session
 * already open on a replica is replaced; a `first-primary` session is at
 * least as new as anything it read, so nothing goes backwards.
 */
export function pinPrimary(key: DbKey): void {
  const scope = scopes.getStore();
  if (scope === undefined) return;
  const slot = scope[key];
  if (slot.pinned) return;
  slot.pinned = true;
  reopen(scope, slot);
}

/**
 * The signed-in runner and the bookmark stored for them, from the auth
 * gate's primary read. A replica session already open moves forward to it.
 */
export function offerRunnerBookmark(
  runnerId: string,
  stored: string | null | undefined,
): void {
  const scope = scopes.getStore();
  if (scope === undefined) return;
  scope.runnerId = runnerId;
  const slot = scope.core;
  const next = newerBookmark(slot.bookmark, parseBookmark(stored));
  if (next === slot.bookmark) return;
  slot.bookmark = next;
  if (!slot.pinned) reopen(scope, slot);
}

export interface ScopeOutcome {
  /**
  The newest core bookmark the request reached: the `d1b` cookie.
  */
  readonly bookmark: string | undefined;
  /**
  The runner to store it for, when this request wrote to core.
  */
  readonly writerId: string | undefined;
  /**
   * A session that ended at a bookmark sorting before the one it started
   * from. D1 promises that cannot happen, so this is the alarm for the
   * ordering `newerBookmark` relies on.
   */
  readonly backwards: { from: string; reached: string } | undefined;
}

function backwardsIn(slot: Slot): ScopeOutcome["backwards"] {
  const from = slot.open?.from;
  const reached = parseBookmark(slot.open?.session.getBookmark());
  if (from === undefined || reached === undefined) return undefined;
  return newerBookmark(from, reached) === reached
    ? undefined
    : { from, reached };
}

/**
What `runInD1Scope`'s request leaves behind, read before it returns.
*/
export function scopeOutcome(): ScopeOutcome {
  const scope = scopes.getStore();
  if (scope === undefined) {
    return { bookmark: undefined, writerId: undefined, backwards: undefined };
  }
  const reached = parseBookmark(scope.core.open?.session.getBookmark());
  const replicaSide = newerBookmark(scope.core.bookmark, reached);
  const bookmark = newerBookmark(replicaSide, primaryBookmarkOf(scope));
  const didWrite = scope.core.wrote || scope.primary.wrote;
  return {
    bookmark,
    writerId: didWrite ? scope.runnerId : undefined,
    // Core only: weather and the primary session never open from a
    // bookmark, so they have nothing to go backwards from.
    backwards: backwardsIn(scope.core),
  };
}

/**
 * The cookie the device's bookmark round-trips in. A day: a device away
 * longer than that has nothing of its own still waiting on a replica, and
 * the runner's stored bookmark covers what it wrote.
 */
export const DEVICE_BOOKMARK_COOKIE = "d1b";

/**
 * How long a bookmark is worth anything: the cookie's lifetime, and the
 * age past which `auth/d1-bookmark.ts` ignores a stored one. A write a day
 * old is on every replica, and D1 does not document how it treats a very
 * old bookmark (Time Travel calls one over 30 days "invalid"), so nothing
 * older is ever handed to `withSession`.
 */
export const BOOKMARK_MAX_AGE_S = 86_400;

/**
The device's bookmark from a `Cookie` header, parsed (trust boundary).
*/
export function deviceBookmarkFrom(
  cookieHeader: string | null,
): string | undefined {
  if (cookieHeader === null) return undefined;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [name, value] = part.trim().split("=", 2);
    if (name === DEVICE_BOOKMARK_COOKIE) return parseBookmark(value);
  }
  return undefined;
}

/**
The `Set-Cookie` value that hands the device its new bookmark.
*/
export function deviceBookmarkCookie(bookmark: string): string {
  return `${DEVICE_BOOKMARK_COOKIE}=${bookmark}; Path=/; Max-Age=${String(BOOKMARK_MAX_AGE_S)}; HttpOnly; Secure; SameSite=Lax`;
}
