/**
 * Sign-in stops working for a banned runner (packet 106 §4, audit 0.3,
 * task 128 · SAF-4).
 *
 * **Where a session is created, not where one is read.** Revoking sessions
 * was already done — `banUser` deletes them in the same batch as the ban —
 * but nothing stopped the runner signing straight back in, because
 * `banStateOf` had no caller. A check at the point of creation is the one
 * place every way in passes through: email and password, Google's
 * callback, and any provider added later. A check on each read would be
 * one per gate, and the one somebody forgets is the one that matters.
 *
 * **A Better Auth plugin rather than an option on `createAuth`**, because a
 * plugin can bring its own `databaseHooks` (Better Auth merges them in
 * `runPluginInit`), so the rule lives in this module beside the ban it
 * enforces and the auth factory does not learn what a ban is. The auth
 * instance lists it with its other plugins.
 */
import { eq } from "drizzle-orm";
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";

import { session as sessions } from "../../db/schema-auth";
import { primaryCoreDb } from "../../env";
import { ACCOUNT_CLOSED_CODE } from "../../lib/contracts/access";
import { banStateOf, type BanState } from "./bans";

/**
The ban as the primary has it: a replica a moment behind would let a runner just banned in.
*/
function primaryBanStateOf(userId: string): Promise<BanState> {
  return banStateOf(userId, primaryCoreDb());
}

/**
The session a ban overtook, deleted on the primary.
*/
async function dropSession(sessionId: string): Promise<void> {
  await primaryCoreDb().delete(sessions).where(eq(sessions.id, sessionId));
}

function closed(): APIError {
  return new APIError("FORBIDDEN", { code: ACCOUNT_CLOSED_CODE });
}

/**
 * The plugin. `stateOf` is injectable so a test can refuse without a
 * profile row; production reads the ban column through `banStateOf`, on
 * the primary.
 *
 * The refusal's code (`ACCOUNT_CLOSED_CODE`) is what a sign-in form reads
 * to put D4's band on screen instead of a failure band: a code rather than
 * the status, because 403 alone says "forbidden" and a runner whose
 * account is closed is owed a statement, not a fault.
 *
 * **The code and nothing else.** Not the operator's reason and not the
 * ban's date: design-deltas item 23's band prints neither (the ban email
 * carries the reason), and Better Auth forwards a refusal's message into
 * Google's error redirect as `error_description` — a URL, which lands in
 * browser history and the edge's request logs.
 *
 * **Checked again once the session exists.** A ban that lands between the
 * check before and the session's insert would otherwise leave a live
 * session: `banUser` deleted the runner's sessions in its batch, before
 * this one was written. So the gate reads the ban again after the insert,
 * and for a banned runner deletes the new session and refuses the same
 * way. Either the ban's batch runs after the insert and deletes it, or the
 * read after it sees the ban.
 */
export function banGate(
  stateOf: (userId: string) => Promise<BanState> = primaryBanStateOf,
): BetterAuthPlugin {
  return {
    id: "ban-gate",
    init: () => ({
      options: {
        databaseHooks: {
          session: {
            create: {
              before: async (session: { userId: string }) => {
                const state = await stateOf(session.userId);
                if (!state.banned) return;
                throw closed();
              },
              after: async (session: { id: string; userId: string }) => {
                const state = await stateOf(session.userId);
                if (!state.banned) return;
                await dropSession(session.id);
                throw closed();
              },
            },
          },
        },
      },
    }),
  };
}
