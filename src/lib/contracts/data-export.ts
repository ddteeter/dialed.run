/**
 * The emailed data export's shared facts (task 126, ACC-10; round 27
 * #13), in lib so the server that enforces them and the Settings row that
 * says them read one number each.
 */

import { z } from "zod";

const DAY_S = 24 * 60 * 60;

/**
 * The download link's token: 128 random bits as lower-case hex. A path
 * segment and an email payload are both untrusted, so both parse it.
 */
export const exportTokenSchema = z.string().regex(/^[0-9a-f]{32}$/u);

/**
 * How long the emailed link works: the board's "The link works for 7
 * days". The ZIP is deleted once it passes.
 */
export const EXPORT_LINK_DAYS = 7;
export const EXPORT_LINK_TTL_S = EXPORT_LINK_DAYS * DAY_S;

/**
 * "One export a day" (round 27 #13): how long after a request that did
 * not fail the next one waits.
 */
export const EXPORT_EVERY_S = DAY_S;

/**
 * What Settings › Account's export row shows, as the server reads it:
 * nothing asked for (or the last copy is over a day old), a build under
 * way, a copy ready — with the link and its last day — or a build that
 * gave up.
 */
export type ExportRowState =
  | { readonly state: "idle" }
  | { readonly state: "preparing" }
  | {
      readonly state: "ready";
      readonly token: string;
      readonly expiresAt: number;
    }
  | { readonly state: "failed" };
