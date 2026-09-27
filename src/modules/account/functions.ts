/**
 * Server-fn glue for the account module (imported directly by route files,
 * per modules/auth's pattern) — keeps this module's other files loadable
 * in the vitest workers pool with no TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { usernameInput } from "../../lib/contracts";
import { optionalUserId, requireUserId } from "../auth";
import { emailDepsFromEnv } from "../email";
import { captureException } from "../ops";
import { accountPage, accountView } from "./account-view";
import { changeEmailInput, confirmInput, resendInput } from "./inputs";
import { claimUsername, handleGate, usernameOf } from "./username";
import {
  confirmEmail,
  requestEmailChange,
  resendConfirmation,
} from "./verification";

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
 * O0 and Settings › Username: claim a handle, or hear it is taken and what
 * is free instead.
 */
export const claimUsernameFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data }) =>
    claimUsername(db(), await requireUserId(), data.username),
  );

/**
 * The signed-in runner's handle, or nothing before O0 — for the settings
 * row and Settings › Username.
 */
export const usernameQuery = createServerFn({ method: "GET" }).handler(
  async () => ({ username: await usernameOf(db(), await requireUserId()) }),
);

/**
 * Whether the root route should send this visitor to O0 before anything
 * else — see `handleGate` for the three answers.
 */
export const handleGateQuery = createServerFn({ method: "GET" }).handler(
  async () => handleGate(db(), await optionalUserId()),
);

/**
 * The account's settings pages (ACC-7, ACC-8, ACC-11): the account, the
 * handle and the email switches.
 */
export const accountPageQuery = createServerFn({ method: "GET" }).handler(
  async () => accountPage(db(), await requireUserId()),
);

/**
 * The same, for a page a signed-out visitor may also be on (Au4):
 * `undefined` when nobody is signed in.
 */
export const optionalAccountQuery = createServerFn({ method: "GET" }).handler(
  async () => accountView(db(), await optionalUserId()),
);

/**
 * Au4's Resend link (round 26 #11). No session needed: the page answers
 * the same for any address, and the limit is per address.
 */
export const resendConfirmationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => resendInput.parse(data))
  .handler(async ({ data }) =>
    resendConfirmation(db(), data.email, emailDepsFromEnv()),
  );

/**
 * The confirm link's landing: spend the link, and say which of the three
 * landings to show. POST because it changes state; the landing's loader
 * calls it once.
 */
export const confirmEmailFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => confirmInput.parse(data))
  .handler(async ({ data }) =>
    confirmEmail(db(), data.token, captureException),
  );

/**
ACC-8: send the link that moves the account to a new address.
*/
export const requestEmailChangeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => changeEmailInput.parse(data))
  .handler(async ({ data }) =>
    requestEmailChange(
      db(),
      await requireUserId(),
      data.email,
      emailDepsFromEnv(),
    ),
  );
