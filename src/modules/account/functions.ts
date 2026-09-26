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
import { claimUsername, requiresHandle, usernameOf } from "./username";

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
 * Whether `/` should send this visitor to O0 before anything else: signed
 * in and no handle yet. A signed-out visitor never is (the landing page is
 * all they can see).
 */
export const handleGateQuery = createServerFn({ method: "GET" }).handler(
  async () => requiresHandle(db(), await optionalUserId()),
);
