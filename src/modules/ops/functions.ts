/**
 * The ops module's server functions: glue only (see
 * `test/architecture/server-functions-are-glue.test.ts`). The decisions
 * live in ./desk and ./desk-gate, where a test can reach them.
 */
import { createServerFn } from "@tanstack/react-start";

import { optionalVerifiedUserId, verifiedUserId } from "../auth";
import { requireAdmin } from "../safety";
import { deskToday, isOperator } from "./desk";
import { dropGaveUp, gaveUpJobs, retryGaveUp } from "./gave-up";
import { gaveUpDropInput, gaveUpRetryInput } from "./inputs";

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

/**
 * Today's Gave up rows (Operator Screens D6, a section of Today; R-119).
 */
export const deskGaveUpQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await verifiedUserId());
    return gaveUpJobs();
  },
);

/**
The retry that fits a Gave up row's job.
*/
export const retryGaveUpAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => gaveUpRetryInput.parse(input))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
    return retryGaveUp(data);
  });

/**
Drop a Gave up row: the row and the job, nothing else.
*/
export const dropGaveUpAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => gaveUpDropInput.parse(input))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
    await dropGaveUp(data.id);
  });
