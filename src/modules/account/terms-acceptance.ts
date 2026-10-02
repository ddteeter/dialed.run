/**
 * Which terms a runner accepted, and whether that is the current version
 * (task 126, ACC-6; round 27 #12; round 28 PR A).
 *
 * **The version is the terms' own line.** `docs/legal/terms.md` opens with
 * "**Version N.**", and that integer is the version — read from the file,
 * never restated as a constant beside it, so bumping the text is bumping
 * the version and nothing else has to remember to follow.
 *
 * **A runner is behind** when their latest acceptance is below it, or they
 * have none (every account made before this shipped). Behind, the root's
 * gate puts the terms prompt in front of the app (`username.ts`'
 * `handleGate`), and the one auth gate refuses their writes
 * (`auth/terms-gate.ts`).
 */
import { desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import terms from "../../../docs/legal/terms.md?raw";
import { termsAcceptances } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

/**
 * The terms' "**Version N.**" line, at the start of a line: the draft's
 * banner above it never matches, and neither does a later sentence that
 * mentions a version.
 */
const VERSION_LINE = /^\*\*Version (\d+)\.\*\*/mu;

/**
 * The version a terms text declares. A text without the line is refused:
 * terms with no version cannot be accepted, so the build should not pass.
 */
export function termsVersionOf(text: string): number {
  const digits = VERSION_LINE.exec(text)?.[1];
  if (digits === undefined) {
    throw new Error('the terms need a "**Version N.**" line');
  }
  return Number(digits);
}

/**
The version of `docs/legal/terms.md` this build ships.
*/
export function currentTermsVersion(text: string = terms): number {
  return termsVersionOf(text);
}

/**
 * One acceptance, unsent: the caller batches it with the write it belongs
 * to (the account's first, at sign-up) or awaits it (Accept). A repeat for
 * the same version keeps the first row and its time (law 8b), so a double
 * press, a replayed request or a hook that runs twice records one
 * acceptance.
 */
export function acceptanceOf(
  db: Db,
  userId: string,
  version: number,
  now: number,
) {
  return db
    .insert(termsAcceptances)
    .values({ userId, version, acceptedAt: now })
    .onConflictDoNothing();
}

/**
 * Whether a runner has accepted the current terms: their latest version,
 * one seek on `terms_acceptances_pk` (it leads with the runner and carries
 * the version, so the row is never read), against the current one. No
 * acceptance at all is behind.
 */
export type TermsStanding = "current" | "behind";

export async function termsStanding(
  db: Db,
  userId: string,
  current: number = currentTermsVersion(),
): Promise<TermsStanding> {
  const [latest] = await db
    .select({ version: termsAcceptances.version })
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, userId))
    .orderBy(desc(termsAcceptances.version))
    .limit(1);
  return (latest?.version ?? 0) < current ? "behind" : "current";
}

/**
 * The prompt's Accept: the version the runner was shown, recorded — but
 * only while it is still the current one. A deploy between the page and
 * the press would otherwise record acceptance of a text they never saw;
 * `stale` sends them back to read the new one.
 */
export type AcceptResult = "accepted" | "stale";

export async function acceptTerms(
  db: Db,
  userId: string,
  shown: number,
  current: number = currentTermsVersion(),
  now: number = nowSeconds(),
): Promise<AcceptResult> {
  if (shown !== current) return "stale";
  await acceptanceOf(db, userId, current, now);
  return "accepted";
}

/**
 * What `/account/terms` shows: the prompt, with the version it asks about,
 * to a signed-in runner who is behind; nothing to anyone else, whom the
 * route sends home.
 */
export type TermsPromptView =
  | { readonly state: "ask"; readonly version: number }
  | { readonly state: "none" };

export async function termsPromptView(
  db: Db,
  userId: string | undefined,
  current: number = currentTermsVersion(),
): Promise<TermsPromptView> {
  if (userId === undefined) return { state: "none" };
  return (await termsStanding(db, userId, current)) === "behind"
    ? { state: "ask", version: current }
    : { state: "none" };
}
