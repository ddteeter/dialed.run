/**
 * Which terms a runner accepted, and whether that is the current version
 * (task 126, ACC-6; round 27 #12; round 28 PR A).
 *
 * **Only published terms can be accepted** (decision D-93). Until
 * `docs/legal/terms.md` carries the owner's published mark
 * (`./legal-markdown`'s `publishedText`), there are no current terms:
 * sign-up records nothing, nobody is prompted, and no server function
 * refuses anyone over them. Nobody ever accepts a text that was not
 * public. The moment the mark lands, every account without an acceptance
 * of that version is behind, and meets the prompt once.
 *
 * **The version is the terms' own line.** `docs/legal/terms.md` opens with
 * "**Version N.**", and that integer is the version — read from the file,
 * never restated as a constant beside it, so bumping the text is bumping
 * the version and nothing else has to remember to follow.
 *
 * **A runner is behind** when the terms are published and their latest
 * acceptance is below the version, or they have none (every account made
 * before the terms were published). Behind, the root's gate puts the terms
 * prompt in front of the app (`username.ts`' `handleGate`), and the one
 * auth gate refuses them (`auth/terms-gate.ts`).
 */
import { desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import terms from "../../../docs/legal/terms.md?raw";
import { termsAcceptances } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { publishedText } from "./legal-markdown";

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
 * The version of the published terms this build ships — or `undefined`
 * while `docs/legal/terms.md` is unpublished, which is "no current terms":
 * nothing to accept, nothing to record, nobody behind.
 */
export function currentTermsVersion(text: string = terms): number | undefined {
  const published = publishedText(text);
  return published === undefined ? undefined : termsVersionOf(published);
}

/**
 * How an acceptance happened (round 29 #17), as `terms.csv`'s `how` column
 * says it: `sign-up` as the account is made, `page` from the prompt's
 * Accept. Read from the schema's column, not restated.
 */
export type AcceptanceWay = NonNullable<
  (typeof termsAcceptances.$inferInsert)["how"]
>;

/**
 * One acceptance, unsent: the caller batches it with the write it belongs
 * to (the account's first, at sign-up) or awaits it (Accept). A repeat for
 * the same version keeps the first row, its time and its way (law 8b), so a
 * double press, a replayed request or a hook that runs twice records one
 * acceptance.
 */
export function acceptanceOf(
  db: Db,
  userId: string,
  version: number,
  now: number,
  how: AcceptanceWay,
) {
  return db
    .insert(termsAcceptances)
    .values({ userId, version, acceptedAt: now, how })
    .onConflictDoNothing();
}

/**
 * What sign-up records beside the account's first write: its acceptance of
 * the published terms ("Creating an account means you accept them") — or
 * nothing at all while none are published (D-93).
 */
export function signUpAcceptances(
  db: Db,
  userId: string,
  current: number | undefined,
  now: number,
) {
  return current === undefined
    ? []
    : [acceptanceOf(db, userId, current, now, "sign-up")];
}

/**
 * The runner's latest acceptance, unsent: one seek on
 * `terms_acceptances_pk` (it leads with the runner and carries the
 * version, so the row is never read). Unsent so the one auth gate can
 * batch it with the leaving check (`auth/terms-gate.ts`).
 */
export function latestAcceptanceOf(db: Db, userId: string) {
  return db
    .select({ version: termsAcceptances.version })
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, userId))
    .orderBy(desc(termsAcceptances.version))
    .limit(1);
}

/**
 * Where a runner stands on the terms: no terms are published (D-93's
 * first-class state — nothing is asked of anyone), they accepted the
 * current version, or they are behind it, with the version they are asked
 * to accept.
 */
export type TermsStanding =
  | { readonly state: "unpublished" }
  | { readonly state: "current" }
  | { readonly state: "behind"; readonly version: number };

/**
 * The standing, from the runner's latest accepted version (`undefined` for
 * none) and the current one.
 */
export function termsStandingOf(
  latest: number | undefined,
  current: number | undefined,
): TermsStanding {
  if (current === undefined) return { state: "unpublished" };
  // No acceptance reads as version 0, below every version the terms'
  // line can declare.
  return (latest ?? 0) < current
    ? { state: "behind", version: current }
    : { state: "current" };
}

export async function termsStanding(
  db: Db,
  userId: string,
  current: number | undefined = currentTermsVersion(),
): Promise<TermsStanding> {
  const [latest] = await latestAcceptanceOf(db, userId);
  return termsStandingOf(latest?.version, current);
}

/**
 * The prompt's Accept: the version the runner was shown, recorded — but
 * only while it is still the current one. A deploy between the page and
 * the press would otherwise record acceptance of a text they never saw,
 * and so would a press while no terms are published; `stale` sends them
 * back to read what is current now.
 */
export type AcceptResult = "accepted" | "stale";

export async function acceptTerms(
  db: Db,
  userId: string,
  shown: number,
  current: number | undefined = currentTermsVersion(),
  now: number = nowSeconds(),
): Promise<AcceptResult> {
  if (shown !== current) return "stale";
  await acceptanceOf(db, userId, current, now, "page");
  return "accepted";
}

/**
 * What `/account/terms` shows: the prompt, with the version it asks about,
 * to a signed-in runner who is behind; nothing to anyone else — nobody, a
 * runner who is current, or everyone while no terms are published — whom
 * the route sends home.
 */
export type TermsPromptView =
  | { readonly state: "ask"; readonly version: number }
  | { readonly state: "none" };

export async function termsPromptView(
  db: Db,
  userId: string | undefined,
  current: number | undefined = currentTermsVersion(),
): Promise<TermsPromptView> {
  if (userId === undefined) return { state: "none" };
  const standing = await termsStanding(db, userId, current);
  return standing.state === "behind"
    ? { state: "ask", version: standing.version }
    : { state: "none" };
}
