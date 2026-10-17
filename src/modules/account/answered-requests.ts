/**
 * The daily sweep of answered access requests (Au5's waitlist, D7):
 * a request is deleted 90 days after it was answered, invited or
 * declined. A request nobody has answered stays until somebody does.
 *
 * Handed to the daily firing by the Worker entry (`src/server.ts`), as
 * account deletion's purge is: `account` imports `ops`, so `ops` cannot
 * import it back.
 */
import { and, inArray, lt } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { accessRequests } from "../../db/schema-core";
import { coreDb } from "../../env";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

/**
How long an answered request is kept: 90 days (owner, approved with the sweep).
*/
const ANSWERED_KEPT_S = 90 * 24 * 60 * 60;

/**
 * Delete requests answered more than 90 days ago.
 *
 * **`updated_at` is the answer's time.** Inviting or declining is the
 * last write a request gets (`settleRequest` in `invites.ts`) — unless the
 * address asks again, which writes `updated_at` too: a declined request
 * goes back to `pending` and so is no longer swept, and an invited one
 * starts its 90 days over, which only ever keeps a row longer.
 *
 * **What goes with the row.** An invited request's code stays
 * (`invite_codes.request_id` keeps the id, with no foreign key), so a
 * second press on the same request still finds it; D7 shows the code with
 * its own label — none, for a request's code — instead of the address,
 * which is the point. An address that asks again after the sweep is a new
 * pending request on D7, as a declined one already is.
 *
 * Re-runnable (law 1): a second pass finds nothing past the cutoff. Reads
 * through `access_requests_status_updated`, not a scan.
 */
export async function forgetAnsweredRequests(
  db: Db = coreDb(),
  now = nowSeconds(),
): Promise<void> {
  await db
    .delete(accessRequests)
    .where(
      and(
        inArray(accessRequests.status, ["invited", "declined"]),
        lt(accessRequests.updatedAt, now - ANSWERED_KEPT_S),
      ),
    );
}
