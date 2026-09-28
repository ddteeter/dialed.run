/**
 * A moderator's force-rename (round 27 #16): the handle becomes
 * `@runner_NNNN`, the old one is locked for everyone — its former holder
 * included — and the runner owes a re-pick: O0's "USERNAME CHANGED BY A
 * MODERATOR" field, which is 126's screen, reads `username_reset_reason`
 * and clears it.
 *
 * **The write is account's** (`forceRename` in `modules/account`), the one
 * writer of `user_profiles.username`, so the rename runs under the claim's
 * own rules: `usernameSchema`, the reserved list (D-57) and D-56. What is
 * safety's is the placeholder and the audit row, which rides in account's
 * batch. The server function wires the two, because account reaches `ops`,
 * which reaches safety — an import from here would be a cycle.
 */
import type { drizzle } from "drizzle-orm/d1";

import type { RenameReason } from "./contracts";
import { moderationActionInsert } from "./moderation-actions";

type Db = ReturnType<typeof drizzle>;

/**
 * What a rename came to, as the Desk reads it — account's `ForcedRename`.
 * `taken` is a placeholder somebody holds, or held: rare at four digits,
 * and the operator presses Rename again (a request handler does one
 * attempt, law 3).
 */
export type RenameOutcome =
  | { kind: "renamed"; username: string }
  | { kind: "not_found" }
  | { kind: "taken" };

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

export interface RenameRecordInput {
  userId: string;
  actorId: string;
  reason: RenameReason;
}

/**
 * The audit row for account's batch, given the handle that was taken away.
 */
export function renameRecord(db: Db, input: RenameRecordInput) {
  return (previous: string) =>
    moderationActionInsert(db, {
      actorId: input.actorId,
      action: "rename",
      subjectType: "profile",
      subjectId: input.userId,
      subjectOwnerId: input.userId,
      reason: `${input.reason} (was @${previous})`,
    });
}
