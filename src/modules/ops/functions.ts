/**
 * The ops module's server functions: glue only (see
 * `test/architecture/server-functions-are-glue.test.ts`). The decisions
 * live in ./desk and ./desk-gate, where a test can reach them.
 */
import { createServerFn } from "@tanstack/react-start";

import { optionalVerifiedUserId, verifiedUserId } from "../auth";
import { requireAdmin } from "../safety";
import { deskToday, isOperator } from "./desk";

/**
 * Whether the viewer may see the Desk. Signed out is a plain "no", not a
 * redirect to sign-in: the route turns "no" into not-found. An operator
 * the Desk's own functions would refuse — unconfirmed, behind on the
 * terms — is not an operator here either (D-113 Q5).
 */
export const deskAccessQuery = createServerFn({ method: "GET" }).handler(
  async () => ({ operator: isOperator(await optionalVerifiedUserId()) }),
);

/**
 * Today's counts (Operator Screens D0), behind the admin gate of its own:
 * the route's door decides what renders, and this decides what a direct
 * call may read.
 */
export const deskTodayQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await verifiedUserId());
    return deskToday();
  },
);
