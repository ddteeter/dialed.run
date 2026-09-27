/**
 * The handle (task 126, ACC-1; round 26 #7; decision D-41): the one
 * writer of `user_profiles.username`, the reserved list, the suggestion,
 * and the lookup `/@old` needs.
 *
 * The shape rule is `usernameSchema` in `lib/contracts.ts`, shared with the
 * form. What is here is what only the server can know: whether a handle is
 * free, and whether it is one nobody may have.
 */
import { and, eq, getTableName, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { userProfiles, usernameHistory } from "../../db/schema-core";
import { USERNAME_MAX_LENGTH, usernameSchema } from "../../lib/contracts";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

/**
 * Handles nobody may claim, whatever the case (the audit's §5 list plus the
 * product's own nouns and the usual impersonations). Compared after
 * `usernameSchema` has lowercased the handle — the way the unique index
 * compares. The words in `RESERVED_WITHIN` below are refused anywhere in a
 * handle, themselves included, so they are not repeated here.
 */
const RESERVED_EXACT: ReadonlySet<string> = new Set([
  "abuse",
  "api",
  "help",
  "legal",
  "mod",
  "mods",
  "official",
  "operator",
  "privacy",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "team",
]);

/**
 * Names that may not appear anywhere inside a handle: `dialed_team` and
 * `strava_support` impersonate as well as the bare word does. Short on
 * purpose — every entry also refuses innocent handles that contain it.
 */
const RESERVED_WITHIN: readonly string[] = [
  "admin",
  "dialed",
  "moderator",
  "strava",
];

/**
 * The obvious disguises of a reserved word: underscores dropped and the
 * digits that stand in for letters read back as letters. `1` reads as
 * both `i` and `l`, so it yields two spellings.
 */
function disguisesOf(handle: string): string[] {
  const plain = handle
    .replaceAll("_", "")
    .replaceAll("0", "o")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");
  return [plain.replaceAll("1", "i"), plain.replaceAll("1", "l")];
}

/**
 * Whether nobody may hold this handle. Takes the stored (lowercased) form.
 */
export function isReservedHandle(handle: string): boolean {
  // The handle as typed is one of its own spellings, so the exact list is
  // checked there too.
  return disguisesOf(handle).some(
    (spelling) =>
      RESERVED_EXACT.has(spelling) ||
      RESERVED_WITHIN.some((word) => spelling.includes(word)),
  );
}

/**
 * Whether `handle` is held by someone other than `userId`: as a current
 * handle, or as one they gave up (an old handle is never reclaimable by
 * anyone else — the design doc's reason). Both reads compare as the unique
 * index does, NOCASE.
 */
async function isHeldByAnother(
  db: Db,
  userId: string,
  handle: string,
): Promise<boolean> {
  const heldNow = and(sameHandle(handle), ne(userProfiles.userId, userId));
  const heldBefore = and(
    eq(usernameHistory.username, handle),
    ne(usernameHistory.userId, userId),
  );
  const [current, retired] = await db.batch([
    holdersNow(db, heldNow),
    holdersBefore(db, heldBefore),
  ]);
  return current.length > 0 || retired.length > 0;
}

/**
 * `username = ?` as the unique index compares, NOCASE — so the read and
 * the index agree about what "the same handle" means, and the read is
 * served by the index.
 */
function sameHandle(handle: string) {
  return sql`${userProfiles.username} = ${handle} COLLATE NOCASE`;
}

/**
 * Who holds a handle now, among the rows `where` picks — at most one.
 */
function holdersNow(db: Db, where: SQL | undefined) {
  return db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(where)
    .limit(1);
}

/**
 * Who gave a handle up, among the rows `where` picks — at most one.
 */
function holdersBefore(db: Db, where: SQL | undefined) {
  return db
    .select({ userId: usernameHistory.userId })
    .from(usernameHistory)
    .where(where)
    .limit(1);
}

/**
 * Whether this runner could take `handle` right now.
 */
async function isFreeFor(
  db: Db,
  userId: string,
  handle: string,
): Promise<boolean> {
  if (isReservedHandle(handle)) return false;
  return !(await isHeldByAnother(db, userId, handle));
}

/**
 * The first word of a city label as a slug: "Portland, OR" is `portland`.
 */
function citySlug(cityLabel: string | null | undefined): string | undefined {
  const slug = (cityLabel ?? "").toLowerCase().replace(/[^a-z0-9].*/su, "");
  return slug === "" ? undefined : slug;
}

/**
 * The digits a suggestion may end in, 2 to 9: "maya2" reads as the second
 * maya, and there is no first.
 */
const SUGGESTION_DIGITS = Array.from({ length: 8 }, (_, index) =>
  String(index + 2),
);

/**
 * `base` with `suffix` after it, the base cut short enough that the whole
 * stays inside the handle's 20 characters.
 */
function withSuffix(base: string, suffix: string): string {
  return `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * **One real, free suggestion** (round 26 #7: "We never show a list"): the
 * typed handle plus the city slug, or else plus a digit. `undefined` when
 * none of those is free — a handle made of a reserved word has no free
 * neighbour, and a suggestion we would refuse is worse than none.
 */
async function suggestionFor(
  db: Db,
  userId: string,
  handle: string,
  cityLabel: string | null | undefined,
): Promise<string | undefined> {
  const slug = citySlug(cityLabel);
  const candidates = [
    ...(slug === undefined ? [] : [withSuffix(handle, `_${slug}`)]),
    ...SUGGESTION_DIGITS.map((digit) => withSuffix(handle, digit)),
  ];
  for (const candidate of candidates) {
    if (await isFreeFor(db, userId, candidate)) return candidate;
  }
  return undefined;
}

/**
 * What claiming came to. A taken handle carries its suggestion, which the
 * form puts into the one sentence the board draws.
 */
export type HandleClaim =
  | { readonly kind: "claimed"; readonly username: string }
  | {
      readonly kind: "taken";
      readonly username: string;
      readonly suggestion: string | undefined;
    };

/**
 * D1's answer to a write that broke the handle's unique index — here, a
 * second runner claiming the same handle between our read and our write.
 * **Only that index**: any other UNIQUE failure is a fault, not a taken
 * handle, and telling a runner their own handle is taken would be a lie.
 * SQLite names the column the index is on (`user_profiles.username`, even
 * for the NOCASE expression), read from the schema rather than restated.
 */
function isHandleIndexViolation(error: unknown): boolean {
  const column = `${getTableName(userProfiles)}.${userProfiles.username.name}`;
  return (
    error instanceof Error &&
    error.message.includes(`UNIQUE constraint failed: ${column}`)
  );
}

/**
 * The runner's current handle, and where they run (for the suggestion).
 */
async function profileOf(
  db: Db,
  userId: string,
): Promise<{ username: string | null; cityLabel: string | null } | undefined> {
  const [row] = await db
    .select({
      username: userProfiles.username,
      cityLabel: userProfiles.cityLabel,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row;
}

/**
 * **D-56 as SQL**: nobody but `userId` ever gave `handle` up. Every write
 * in the claim's batch carries it, so a handle retired between the read
 * that decided and the batch that writes is refused by the database, not
 * by a read that is already stale.
 */
function notRetiredByAnother(userId: string, handle: string): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${usernameHistory} WHERE ${usernameHistory.username} = ${handle} AND ${usernameHistory.userId} <> ${userId})`;
}

/**
 * Keeps the handle the runner holds *at the moment the batch runs* in the
 * history — read by the statement, not passed in, so two changes racing
 * each other each retire what they actually replace. Nothing when there is
 * no handle yet, when it already is `typed` (a repeat of the same change),
 * or when D-56 refuses `typed` — the claim below writes nothing then
 * either.
 */
function retireCurrent(db: Db, userId: string, typed: string, at: number) {
  return db
    .insert(usernameHistory)
    .select(
      sql`SELECT ${userProfiles.username}, ${userProfiles.userId}, ${at} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${userId} AND ${userProfiles.username} <> ${typed} AND ${notRetiredByAnother(userId, typed)}`,
    );
}

/**
 * The profile row, made bare if O0 is the first write — a row of defaults
 * reads exactly as no row does, so making it for a claim D-56 then
 * refuses changes nothing a runner can see.
 */
function ensureProfile(db: Db, userId: string) {
  return db.insert(userProfiles).values({ userId }).onConflictDoNothing();
}

/**
 * Claims `typed` as this runner's handle — at O0, or from Settings ›
 * Username. `typed` is already parsed by `usernameSchema` (the server
 * function's validator), so it is the stored form.
 *
 * A reserved handle reads as taken with **no suggestion** (D-57): a
 * suggestion beside it would tell a prober which names are on the list.
 *
 * **One batch** (CLAUDE.md "default to one batch"): the old handle kept in
 * the history, the new handle, and the runner's own history row for it
 * removed (taking an old handle back) land together or not at all, and a
 * read of the row closes it. The read that decides happens before it; the
 * batch re-checks D-56 itself, and the unique index settles a race with a
 * runner claiming the same handle now. Either reads as taken.
 *
 * Claiming the handle you already have is a success that writes nothing
 * new — including a second submit of a change that has already landed.
 */
export async function claimUsername(
  db: Db,
  userId: string,
  typed: string,
): Promise<HandleClaim> {
  if (isReservedHandle(typed)) {
    return { kind: "taken", username: typed, suggestion: undefined };
  }
  const profile = await profileOf(db, userId);
  if (profile?.username === typed) return { kind: "claimed", username: typed };
  const taken = async (): Promise<HandleClaim> => ({
    kind: "taken",
    username: typed,
    suggestion: await suggestionFor(db, userId, typed, profile?.cityLabel),
  });
  if (await isHeldByAnother(db, userId, typed)) return taken();

  const ownHistoryRow = and(
    eq(usernameHistory.username, typed),
    eq(usernameHistory.userId, userId),
  );
  // The handle is set only where D-56 still allows it; a refusal writes
  // nothing, and the read at the end of the batch is what notices.
  const mayTake = and(
    eq(userProfiles.userId, userId),
    notRetiredByAnother(userId, typed),
  );
  const holdsTyped = and(eq(userProfiles.userId, userId), sameHandle(typed));
  try {
    const results = await db.batch([
      retireCurrent(db, userId, typed, nowSeconds()),
      ensureProfile(db, userId),
      db.update(userProfiles).set({ username: typed }).where(mayTake),
      db.delete(usernameHistory).where(ownHistoryRow),
      holdersNow(db, holdsTyped),
    ]);
    const held = results[4];
    // Nothing held means D-56 refused the claim inside the batch: someone
    // gave this handle up after the read above said it was free.
    return held.length > 0
      ? { kind: "claimed", username: typed }
      : await taken();
  } catch (error: unknown) {
    if (isHandleIndexViolation(error)) return taken();
    throw error;
  }
}

/**
 * Who a handle names, for `/@handle` (129 renders it; FEED-10).
 *
 * - `current` — the runner who holds it now;
 * - `changed` — a handle someone gave up: *"This runner changed their
 *   name."*, and never a redirect, because a redirect would link the old
 *   handle to the new one (round 26 #7);
 * - `undefined` — nobody ever held it.
 */
export type HandleLookup =
  | { readonly kind: "current"; readonly userId: string }
  | { readonly kind: "changed" };

export async function lookUpHandle(
  db: Db,
  typed: string,
): Promise<HandleLookup | undefined> {
  const parsed = usernameSchema.safeParse(typed);
  if (!parsed.success) return undefined;
  const handle = parsed.data;
  const [current, retired] = await db.batch([
    holdersNow(db, sameHandle(handle)),
    holdersBefore(db, eq(usernameHistory.username, handle)),
  ]);
  const holder = current[0];
  if (holder !== undefined) return { kind: "current", userId: holder.userId };
  return retired.length > 0 ? { kind: "changed" } : undefined;
}

/**
 * This runner's handle, or `undefined` before O0. The one read the root
 * route makes to decide whether to send a runner to O0 first.
 */
export async function usernameOf(
  db: Db,
  userId: string,
): Promise<string | undefined> {
  const profile = await profileOf(db, userId);
  return profile?.username ?? undefined;
}

/**
 * What the root route needs to know about this visitor before any page:
 * signed out, signed in with no handle yet (O0 first), or signed in with
 * one. A signed-out visitor is never sent to O0 — the landing page is the
 * only thing they can see, and a redirect to a screen that needs a session
 * would be a loop.
 *
 * Three answers rather than a boolean because the browser remembers only
 * the last (`route-decisions`' `gateOnHandle`): a handle, once claimed, is
 * never cleared, while "signed out" and "no handle yet" both change the
 * moment the runner signs in or picks one.
 */
export type HandleGate = "signed-out" | "needs-handle" | "has-handle";

export async function handleGate(
  db: Db,
  userId: string | undefined,
): Promise<HandleGate> {
  if (userId === undefined) return "signed-out";
  return (await usernameOf(db, userId)) === undefined
    ? "needs-handle"
    : "has-handle";
}
