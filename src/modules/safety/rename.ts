/**
 * A moderator's force-rename (round 27 #16): the handle becomes
 * `@runner_NNNN`, the old one is retired for everyone, and the runner owes
 * a re-pick — O0's "USERNAME CHANGED BY A MODERATOR" field, which is 126's
 * screen, reads `username_reset_reason` and clears it.
 *
 * **Why the write is here and not in `modules/account/username.ts`**,
 * which calls itself the one writer: the rename is the Desk's, safety owns
 * the Desk's actions and their audit row, and the account module has no
 * moderator path to call. The retirement goes through the same
 * `username_history` table `claimUsername` reads, so the old handle is
 * refused to every other runner exactly as a given-up one is. Keeping the
 * runner themselves from taking it back is 126's (a PR note asks).
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { userProfiles, usernameHistory } from "../../db/schema-core";
import { firstRowWhere, hasRowWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";

import type { RenameReason } from "./contracts";
import { moderationActionInsert } from "./moderation-actions";

type Db = ReturnType<typeof drizzle>;

export type RenameOutcome =
  | { kind: "renamed"; username: string }
  | { kind: "not_found" }
  | { kind: "collided" };

/**
 * The placeholder handle: `runner_` and four digits. `digits` is a
 * parameter so a test can choose them; production draws them at random.
 */
export function placeholderHandle(digits: number = randomDigits()): string {
  return `runner_${String(digits).padStart(4, "0")}`;
}

/**
Four digits from the platform's CSPRNG — a handle is not a secret, but the lint is right that `Math.random` should not be reached for.
*/
function randomDigits(): number {
  const [value = 0] = crypto.getRandomValues(new Uint16Array(1));
  return value % 10_000;
}

export interface ForceRenameInput {
  userId: string;
  actorId: string;
  reason: RenameReason;
  replacement?: string | undefined;
}

/**
 * One batch: the old handle into the history, the placeholder in, the
 * re-pick owed, and the audit row. The unique handle index settles a
 * collision with a runner who holds the placeholder — rare at four digits,
 * and answered `collided` so the operator presses Rename again (a request
 * handler does one attempt, law 3).
 */
export async function forceRename(
  db: Db,
  input: ForceRenameInput,
): Promise<RenameOutcome> {
  const profile = await firstRowWhere(
    db,
    userProfiles,
    eq(userProfiles.userId, input.userId),
  );
  const current = profile?.username ?? undefined;
  if (current === undefined) return { kind: "not_found" };
  const username = input.replacement ?? placeholderHandle();
  // A handle someone gave up is never handed to anyone else (D-56); a
  // batch cannot branch, so the read goes first.
  if (
    await hasRowWhere(
      db,
      usernameHistory,
      usernameHistory.username,
      eq(usernameHistory.username, username),
    )
  ) {
    return { kind: "collided" };
  }
  try {
    await db.batch([
      db
        .insert(usernameHistory)
        .values({
          username: current,
          userId: input.userId,
          retiredAt: nowSeconds(),
        })
        .onConflictDoNothing(),
      db
        .update(userProfiles)
        .set({ username, usernameResetReason: input.reason })
        .where(eq(userProfiles.userId, input.userId)),
      moderationActionInsert(db, {
        actorId: input.actorId,
        action: "rename",
        subjectType: "profile",
        subjectId: input.userId,
        subjectOwnerId: input.userId,
        reason: `${input.reason} (was @${current})`,
      }),
    ]);
  } catch (error: unknown) {
    if (String(error).includes("UNIQUE")) return { kind: "collided" };
    throw error;
  }
  return { kind: "renamed", username };
}
