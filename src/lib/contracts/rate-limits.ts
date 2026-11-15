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
 * - `page-fetch` — enrichment's page fetches across everyone;
 *   `GLOBAL_SUBJECT`;
 * - `proxy-call` — enrichment's proxy calls across everyone;
 *   `GLOBAL_SUBJECT`.
 */
export const RATE_LIMIT_KINDS = [
  ...SEND_LIMIT_KINDS,
  "change-runner",
  "enrich-runner",
  "page-fetch",
  "proxy-call",
] as const;

export type SendLimitKind = (typeof SEND_LIMIT_KINDS)[number];
export type RateLimitKind = (typeof RATE_LIMIT_KINDS)[number];

/**
The subject of a count kept across everyone rather than per address or runner.
*/
export const GLOBAL_SUBJECT = "global";
