/**
 * Messages on the dialed-enrichment queue (and its DLQ). A queue body is a
 * trust boundary: the consumer parses with this schema, never casts.
 *
 * The job carries a **pointer, not the work**: the URL lives on the product
 * row (`source_url`), written before the message is sent, so a lost or
 * duplicated message costs nothing — the row is the source of truth, and the
 * hourly sweep re-dispatches anything still `pending`. Same shape as the
 * Strava revocation job, for the same reason.
 *
 * A wire format between two deploys (law 9): a second job type joins as a
 * new variant on `type`, never by changing this one.
 */
import { z } from "zod";

export const enrichJobSchema = z.object({
  type: z.literal("enrich"),
  productId: z.string().min(1),
  /**
   * When a person asked (epoch ms): a paste or the Desk's Retry. The job
   * reads only a page stored since, and otherwise fetches a fresh one. The
   * sweep's re-sends carry none. Optional, so a message sent before it
   * existed still parses (law 9).
   */
  askedAt: z.number().int().nonnegative().optional(),
});
export type EnrichJob = z.infer<typeof enrichJobSchema>;
