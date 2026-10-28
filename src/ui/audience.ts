import type { WritableAudience } from "../lib/contracts";

/**
 * The audience picker's words (round 41 #86a): the three audiences a
 * runner can pick, in the board's order, under the names the screen uses
 * for them — `runners` is SHARED and `world` is PUBLIC on screen, and
 * neither stored name ever shows.
 *
 * Here rather than in one module because three screens pick an audience:
 * A3 and D's Change (feed) and Settings › Privacy (onboarding).
 */
export const PICKED_AUDIENCES = [
  "private",
  "runners",
  "world",
] as const satisfies readonly WritableAudience[];

/**
 * In sentence case, as `Bracketed` asks: the board's PRIVATE / SHARED /
 * PUBLIC are its uppercase display, and a reader announces a typed
 * all-caps word worse. Where the brand's uppercase applies — the
 * bracketed state label — `Mono` sets it in CSS.
 */
export const AUDIENCE_LABELS: Readonly<Record<WritableAudience, string>> = {
  private: "Private",
  runners: "Shared",
  world: "Public",
};

/**
What each audience means, under its label on A3's picker.
*/
export const AUDIENCE_HINTS: Readonly<Record<WritableAudience, string>> = {
  private: "Only you.",
  runners: "Runners signed in to dialed.run.",
  world: "Anyone with the link, no sign-in. Never when or where you ran.",
};

/**
 * The line under the picker while PUBLIC is picked: what making it shared
 * or private later cannot take back.
 */
export const PUBLIC_PREVIEW_LINE =
  "Sites that already showed a preview of the link, like Reddit, iMessage or Slack, keep their own copy. Making it shared or private later can't take that back.";
