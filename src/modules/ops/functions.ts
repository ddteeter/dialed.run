/**
 * The ops module's server functions: glue only (see
 * `test/architecture/server-functions-are-glue.test.ts`). The decisions
 * live in ./desk and ./desk-gate, where a test can reach them.
 */
import { createServerFn } from "@tanstack/react-start";

import { optionalUserId, requireUserId } from "../auth";
import { requireAdmin } from "../safety";
import { deskToday, isOperator } from "./desk";

/**
 * Whether the viewer may see the Desk. Signed out is a plain "no", not a
 * redirect to sign-in: the route turns "no" into not-found.
 */
export const deskAccessQuery = createServerFn({ method: "GET" }).handler(
  async () => ({ operator: isOperator(await optionalUserId()) }),
);

/**
 * Today's counts (Operator Screens D0), behind the admin gate of its own:
 * the route's door decides what renders, and this decides what a direct
 * call may read.
 */
export const deskTodayQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await requireUserId());
    return deskToday();
  },
);
