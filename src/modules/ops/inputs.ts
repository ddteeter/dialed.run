/**
 * The ops server functions' input contracts, kept out of `functions.ts`,
 * which no test can import (R-41).
 */
import { z } from "zod";

import { rowIdSchema } from "../../lib/ids";

/**
 * Which retry a Gave up row asked for (Operator Screens D6: "the retry
 * fits the job"). `again` is the one every job has — for enrichment,
 * Re-fetch page; `extract` is enrichment's Re-run extraction over the
 * stored page, and means nothing for any other job.
 */
export const gaveUpRetryInput = z.object({
  id: rowIdSchema,
  step: z.enum(["again", "extract"]),
});

export type GaveUpRetry = z.infer<typeof gaveUpRetryInput>;

/**
A Gave up row the operator dropped.
*/
export const gaveUpDropInput = z.object({ id: rowIdSchema });
