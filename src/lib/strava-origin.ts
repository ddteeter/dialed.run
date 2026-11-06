import { z } from "zod";

/**
 * Where a trip to Strava's consent screen started, when it was not T1
 * (round 39, #66): the refused receipt's Try again goes back there. Only
 * P3 is named; anything else, or nothing, means T1.
 *
 * It rides the OAuth state cookie beside the nonce (design 172), so it is
 * read back from a cookie and parsed, never echoed.
 */
export const stravaOriginSchema = z.enum(["onboarding"]);

export type StravaOrigin = z.infer<typeof stravaOriginSchema>;

/**
 * `?from=` on the connect link. A value that is not an origin is dropped
 * rather than refused: the link still connects, and Try again means T1.
 */
export const stravaConnectSearch = z.object({
  from: stravaOriginSchema.optional().catch(undefined),
});

/**
 * `?again=true` on T1 and P3: the runner came back from a refused
 * receipt's Try again, so the screen puts focus on its heading and the
 * consent is the next thing read. Anything else is an ordinary visit.
 */
export const tryAgainSearch = z.object({
  again: z.boolean().optional().catch(undefined),
});
