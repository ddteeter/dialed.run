/**
 * The handle (task 126, ACC-1; round 26 #7; decision D-41): the one
 * writer of `user_profiles.username`, the reserved list, the suggestion,
 * and the lookup `/@old` needs.
 *
 * The shape rule is `usernameSchema` in `lib/contracts.ts`, shared with the
 * form. What is here is what only the server can know: whether a handle is
 * free, and whether it is one nobody may have.
 */
import { and, eq, ne, sql } from "drizzle-orm";
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
 * D1's answer to a write that broke a UNIQUE index — here, a second runner
 * claiming the same handle between our read and our write.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint");
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
 * Claims `typed` as this runner's handle — at O0, or from Settings ›
 * Username. `typed` is already parsed by `usernameSchema` (the server
 * function's validator), so it is the stored form.
 *
 * **One batch** (CLAUDE.md "default to one batch"): the handle, the old
 * handle kept in the history, and the runner's own history row for the new
 * handle removed (taking an old handle back) land together or not at all.
 * The read that decides happens before it; the unique index is what
 * settles a race the read could not see, and it reads as taken.
 *
 * Claiming the handle you already have is a success that writes nothing
 * new.
 */
export async function claimUsername(
  db: Db,
  userId: string,
  typed: string,
): Promise<HandleClaim> {
  const profile = await profileOf(db, userId);
  if (profile?.username === typed) return { kind: "claimed", username: typed };
  const taken = async (): Promise<HandleClaim> => ({
    kind: "taken",
    username: typed,
    suggestion: await suggestionFor(db, userId, typed, profile?.cityLabel),
  });
  if (!(await isFreeFor(db, userId, typed))) return taken();

  const previous = profile?.username ?? undefined;
  const takeHandle = db
    .insert(userProfiles)
    .values({ userId, username: typed })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { username: typed },
    });
  const ownHistoryRow = and(
    eq(usernameHistory.username, typed),
    eq(usernameHistory.userId, userId),
  );
  const forgetRetired = db.delete(usernameHistory).where(ownHistoryRow);
  try {
    await db.batch([
      takeHandle,
      forgetRetired,
      ...(previous === undefined
        ? []
        : [retire(db, userId, previous, nowSeconds())]),
    ]);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return taken();
    throw error;
  }
  return { kind: "claimed", username: typed };
}

/**
 * The history row for a handle given up — a statement for the caller's
 * batch. `OR IGNORE`-free on purpose: a runner's old handle cannot already
 * be in the history (claiming it back deleted the row), so a conflict is a
 * real fault and should fail the batch loudly.
 */
function retire(db: Db, userId: string, username: string, at: number) {
  return db.insert(usernameHistory).values({ username, userId, retiredAt: at });
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
 * This runner's handle, or `undefined` before O0. The one read `/` makes to
 * decide whether to send a runner to O0 first.
 */
export async function usernameOf(
  db: Db,
  userId: string,
): Promise<string | undefined> {
  const profile = await profileOf(db, userId);
  return profile?.username ?? undefined;
}

/**
 * Whether `/` should send this visitor to O0 before anything else: signed
 * in and no handle yet. A signed-out visitor never is — the landing page
 * is the only thing they can see, and a redirect to a screen that needs a
 * session would be a loop.
 */
export async function requiresHandle(
  db: Db,
  userId: string | undefined,
): Promise<boolean> {
  if (userId === undefined) return false;
  return (await usernameOf(db, userId)) === undefined;
}
