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

import { banStateOf, type BanState } from "./bans";

/**
 * The refusal's code — what a sign-in form reads to put D4 on screen
 * instead of a failure band. A code rather than the status, because 403
 * alone says "forbidden" and a runner whose account is closed is owed the
 * reason, not a fault.
 */
export const ACCOUNT_CLOSED_CODE = "ACCOUNT_CLOSED";

/**
 * The plugin. `stateOf` is injectable so a test can refuse without a
 * profile row; production reads the ban column through `banStateOf`.
 *
 * The refusal carries the operator's reason, word for word (D3: "They read
 * your reason, word for word, the next time they open the app"), and when
 * the ban was made, which D4 dates. Nobody reaches this hook without having
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
