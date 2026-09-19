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
});
export type EnrichJob = z.infer<typeof enrichJobSchema>;
