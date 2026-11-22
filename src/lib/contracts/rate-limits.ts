/**
 * What `rate_limits` counts, as its `kind` column stores it: one
 * fixed-window count per kind and subject.
 *
 * The sends a visitor can ask for again, each limited on its own (a runner
 * who has used up their confirm links can still reset a password), whose
 * subject is the address, lowercased:
 *
 * - `verify` — a link confirming the account's address;
 * - `reset` — a password reset link;
 * - `change` — a link confirming a new address.
 *
 * Two forms anyone can fill, which send no email but borrow the same
 * hourly window, so a script cannot fill the Desk; their subject is the
 * visitor's IP:
 *
 * - `access` — Au5's request (ACC-5);
 * - `takedown` — `/takedown`'s request (design 136).
 */
export const SEND_LIMIT_KINDS = [
  "verify",
  "reset",
  "change",
  "access",
  "takedown",
] as const;

/**
 * Every kind, the sends and then the counts that are not (design 221):
 *
 * - `change-runner` — one runner's email-change requests, whatever
 *   addresses they name; the subject is the runner's id;
 * - `enrich-runner` — one runner's enrichment requests; the runner's id;
 * - `upload-runner` — one runner's run-file uploads (SA-M29); the
 *   runner's id;
 * - `page-fetch` — enrichment's page fetches across everyone;
 *   `GLOBAL_SUBJECT`;
 * - `proxy-call` — enrichment's proxy calls across everyone;
 *   `GLOBAL_SUBJECT`;
 * - `proxy-product` — enrichment's proxy calls for one product; the
 *   product's id;
 * - `model-call` — enrichment's model calls across everyone;
 *   `GLOBAL_SUBJECT`;
 * - `sign-in` — email sign-in's tries for one typed address, lowercased,
 *   whether or not it has an account (`SIGN_IN_TRIES`);
 * - `csp-report` — the CSP reports one visitor's browser posts, so a
 *   script cannot spend the error tracker's quota (SA-L19); the visitor's
 *   IP;
 * - `report-runner` — one runner's reports in a day; the runner's id
 *   (design 232);
 * - `report-at-once` — one runner's reports a day that hide at once, of a
 *   reason on the removal clock; the runner's id (design 232);
 * - `resend-visitor` — Au4's Resend, per visitor, before the address is
 *   counted (SA-M12); the visitor's IP;
 * - `takedown-to` — `/takedown`'s receipts to one address, whoever asks
 *   (SA-M11); the address, lowercased;
 * - `weather-runner` — the weather-provider calls made for one runner in
 *   a day (SA-M13); the runner's id;
 * - `photo-runner` — one runner's photo uploads in a day, kit and garment
 *   (SA-M14); the runner's id;
 * - `purge-runner` — the edge purges one runner's own writes make in a
 *   minute (SA-L15); the runner's id;
 * - `deletion-notice` — the "delete scheduled" emails one runner is owed
 *   in a day; the runner's id;
 * - `access-to` — Au5's asks for one address in a day, whoever asks; the
 *   address, lowercased;
 * - `correction-runner` — one runner's product corrections in a day; the
 *   runner's id;
 * - `strava-connect-runner` — the Strava code exchanges one runner's
 *   connect callbacks make in an hour; the runner's id.
 */
export const RATE_LIMIT_KINDS = [
  ...SEND_LIMIT_KINDS,
  "change-runner",
  "enrich-runner",
  "upload-runner",
  "page-fetch",
  "proxy-call",
  "proxy-product",
  "model-call",
  "sign-in",
  "csp-report",
  "report-runner",
  "report-at-once",
  "resend-visitor",
  "takedown-to",
  "weather-runner",
  "photo-runner",
  "purge-runner",
  "deletion-notice",
  "access-to",
  "correction-runner",
  "strava-connect-runner",
] as const;

/**
 * The kinds whose subject is a visitor's IP. Their key is the address's
 * network (`visitorAddress`, SA-M11), so one line is one visitor.
 */
export const VISITOR_KINDS = [
  "access",
  "takedown",
  "resend-visitor",
  "csp-report",
] as const satisfies readonly (typeof RATE_LIMIT_KINDS)[number][];

export type SendLimitKind = (typeof SEND_LIMIT_KINDS)[number];
export type RateLimitKind = (typeof RATE_LIMIT_KINDS)[number];

/**
The subject of a count kept across everyone rather than per address or runner.
*/
export const GLOBAL_SUBJECT = "global";
