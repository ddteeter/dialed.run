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
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";

import { ACCOUNT_CLOSED_CODE } from "../../lib/contracts/access";
import { banStateOf, type BanState } from "./bans";

/**
 * The plugin. `stateOf` is injectable so a test can refuse without a
 * profile row; production reads the ban column through `banStateOf`.
 *
 * The refusal's code (`ACCOUNT_CLOSED_CODE`) is what a sign-in form reads
 * to put D4's band on screen instead of a failure band: a code rather than
 * the status, because 403 alone says "forbidden" and a runner whose
 * account is closed is owed a statement, not a fault.
 *
 * It also carries the operator's reason, word for word, and when the ban
 * was made. Design-deltas item 23's band prints neither — the ban email
 * carries the reason — but Google's error redirect forwards the message
 * as `error_description`, and nothing reads it. Nobody reaches this hook without having
 * proved they are the account's owner — a session is created only after
 * the credentials or the OAuth callback check out — so the reason goes to
 * the person it was written to and to nobody else.
 */
export function banGate(
  stateOf: (userId: string) => Promise<BanState> = banStateOf,
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
                throw new APIError("FORBIDDEN", {
                  code: ACCOUNT_CLOSED_CODE,
                  message: state.reason ?? "",
                  closedAt: state.bannedAt,
                });
              },
            },
          },
        },
      },
    }),
  };
}
