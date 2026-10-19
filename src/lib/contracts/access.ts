/**
 * Invite-only sign-up (task 126, ACC-5; decision D-39; round 26 #20): the
 * flag, the code's shape and the words for each refusal — shared by the
 * sign-up form, request access (Au5), Desk D7 and the server's gate, so
 * none of them restates another.
 */
import { z } from "zod";

import { clockLabel, deviceTimeZone } from "../dates";
import { APPEAL_ADDRESS } from "./contact";

/**
 * **The one flag.** On, sign-up needs a code (email and Google alike),
 * Au2 shows the INVITE CODE field and the "No code? Request access" link.
 * Off, all three go and sign-up is open. Flipping it is the owner's call
 * at the public gate (D-38); nothing else reads a second copy.
 */
export const IS_INVITE_ONLY = true;

/**
 * The characters a code is made of: no 0/O and no 1/I, so a code read
 * aloud or off a screen cannot be mistyped into a different one.
 */
export const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * `DIAL-` and four of the alphabet: 32^4, about a million codes (20 bits).
 * Enough for the friends stage (D-38), where a code is handed to someone
 * and a guesser must also pass Turnstile and Better Auth's sign-up limit
 * per attempt; the public gate lengthens it or retires codes altogether.
 */
export const INVITE_PREFIX = "DIAL-";
const INVITE_BODY_LENGTH = 4;

const INVITE_SHAPE = new RegExp(
  `^${INVITE_PREFIX}[${INVITE_ALPHABET}]{${String(INVITE_BODY_LENGTH)}}$`,
);

/**
 * Round 28 #9's refusals. A spent code, a revoked one, one nobody made
 * and one that is not the right shape all read as `invalid`: the form's
 * check and the server's say the same thing, so none of them tells a
 * prober which it was, and a real runner learns what to do next.
 */
export const INVITE_COPY = {
  missing: "Enter the code from your invite.",
  invalid: "That code doesn't work. Check it, or request access.",
} as const;

/**
 * A code as it is stored and compared: case ignored, spaces dropped, and
 * the `DIAL-` a runner left off put back.
 */
export function normalizeInviteCode(typed: string): string {
  const compact = typed.replaceAll(/\s/gu, "").toUpperCase();
  return compact.startsWith(INVITE_PREFIX)
    ? compact
    : `${INVITE_PREFIX}${compact}`;
}

/**
The field, as the form and the server parse it.
*/
export const inviteCodeField = z
  .string()
  .min(1, INVITE_COPY.missing)
  .transform(normalizeInviteCode)
  .refine((code) => INVITE_SHAPE.test(code), INVITE_COPY.invalid);

/**
 * A fresh code, from `random` (`crypto.getRandomValues` in production, a
 * fixed source in a test). The modulo is unbiased: 256 is a multiple of
 * the alphabet's 32 characters.
 */
export function mintInviteCode(
  random: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = random(INVITE_BODY_LENGTH);
  const body = Array.from(
    bytes,
    (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length],
  ).join("");
  return `${INVITE_PREFIX}${body}`;
}

/**
 * Au5's note: optional, one line of 140 characters (round 28 #9; round 26
 * #20 drew 280), with a counter shown from 120.
 */
export const ACCESS_NOTE_MAX = 140;
export const ACCESS_NOTE_COUNT_FROM = 120;

/**
 * Round 27 #12: what Au2 and Au5 say when Turnstile refused the browser.
 * The kicker is `NOT SENT` on both.
 */
export const TURNSTILE_REFUSED =
  "We couldn't check this browser. Reload the page and try again.";

/**
 * **The blocked US states** (owner, 2026-10-18): no new account from a
 * request Cloudflare places in these states. Both states' laws require
 * the age of every account creator to be verified and are in force
 * against every provider: Mississippi's HB 1126 (2024) and Tennessee's
 * Protecting Children from Social Media Act, Tenn. Code Ann. §47-18-5701
 * et seq. dialed.run asks for a date of birth and checks no ID, so it
 * stays closed to new accounts there instead. Existing accounts and
 * signing in are untouched, and so is asking for access: a waitlist entry
 * is not an account, so Au5 takes the request and records the state on it
 * (`access_requests.blocked_region`), and D7 will not invite it.
 *
 * **Lifting a state is deleting its line.** Do that only on a court order
 * enjoining the law as to non-parties: an injunction that protects only
 * the plaintiffs (a trade group's members) does not cover dialed.run. The
 * requests already tagged with it become invitable at once, because D7
 * reads this list, not the tag, to decide.
 *
 * Keyed by Cloudflare's `request.cf.regionCode` (ISO 3166-2 without the
 * `US-`); the name is what the copy says, so every sentence follows the
 * list rather than restating it.
 */
export const BLOCKED_US_REGIONS = {
  MS: "Mississippi",
  TN: "Tennessee",
} as const;

export type BlockedRegion = keyof typeof BLOCKED_US_REGIONS;

/**
The listed states' names, as one sentence says them.
*/
const BLOCKED_NAMES = Object.values(BLOCKED_US_REGIONS).join(" or ");

/**
 * Whether a state code is one of `BLOCKED_US_REGIONS` now — its own key,
 * not an inherited one.
 */
export function isBlockedRegion(code: string): code is BlockedRegion {
  return Object.hasOwn(BLOCKED_US_REGIONS, code);
}

/**
 * The words (owner, 2026-10-18; placeholder until design words them —
 * design-deltas item 66). `signUp` is Au2's refusal, on the form and on
 * Google's band alike; `waitlist` is Au5's receipt for a request from a
 * blocked state, which is taken.
 */
export const REGION_COPY = {
  signUp: `dialed.run isn't open to new sign-ups from ${BLOCKED_NAMES}. State laws there require ID age checks for every new account, which we don't do.`,
  waitlist: `Thanks. Sign-up isn't open in ${BLOCKED_NAMES} yet, because state laws there require ID age checks for every new account. We'll email you if that changes.`,
} as const;

/**
Au2's refusal, as the server's hook and both bands say it.
*/
export const REGION_BLOCKED_COPY = REGION_COPY.signUp;

/**
 * D7's tag on a request recorded from a state: its code in brackets, the
 * bracket notation measured values wear (`[TN]`).
 */
export function regionTag(code: string): string {
  return `[${code}]`;
}

/**
 * Why D7 has no Send invite on a request from a state that is blocked
 * now: the operator's reason, the state named.
 */
export function regionInviteRefusal(code: BlockedRegion): string {
  return `No invite while sign-up is closed in ${BLOCKED_US_REGIONS[code]}.`;
}

/**
 * The code the server's refusal carries, which Au2 reads to say it in a
 * band, and Google's round trip brings back as `?error=REGION_BLOCKED`.
 */
export const REGION_BLOCKED_CODE = "REGION_BLOCKED";

/**
 * The slice of a Workers request the gate reads: Cloudflare's `cf`, which
 * the edge writes and a client cannot, parsed rather than trusted. A
 * request with none (local dev, a test, Better Auth called from the
 * server) or with one of another shape is not placed anywhere.
 */
const placedRequestSchema = z.object({
  cf: z.object({ country: z.string(), regionCode: z.string() }),
});

/**
 * **The one gate** on where a new account may come from: the blocked US
 * state (`BLOCKED_US_REGIONS`) this request comes from, or nothing.
 * Anything that cannot be placed is not blocked.
 */
export function blockedRegionOf(request: unknown): BlockedRegion | undefined {
  const placed = placedRequestSchema.safeParse(request).data?.cf;
  if (placed?.country !== "US") return undefined;
  return isBlockedRegion(placed.regionCode) ? placed.regionCode : undefined;
}

/**
The same gate, as a yes or no.
*/
export function isFromBlockedRegion(request: unknown): boolean {
  return blockedRegionOf(request) !== undefined;
}

/**
 * A signed-out form's request that was not taken — Au5's, and `/takedown`'s
 * (design 136), which share Turnstile and the per-visitor limit.
 */
export type FormRefusal =
  | { readonly status: "refused" }
  | { readonly status: "limited"; readonly until: number };

/**
 * What the band says when the request was not taken — both are about the
 * browser, never the address: Turnstile's (round 27 #12) and the limit's
 * (round 28 #9, #11's grammar in local time).
 */
export function refusalMessage(result: FormRefusal): string {
  return result.status === "refused"
    ? TURNSTILE_REFUSED
    : `Too many requests from here. You can send another at ${clockLabel(result.until, deviceTimeZone())}.`;
}

/**
 * The headers sign-up carries its code and Turnstile token in. Better
 * Auth's body is its own (unknown fields are refused or dropped), so the
 * two ride beside it, where its `before` hook reads them.
 */
export const ACCESS_HEADERS = {
  inviteCode: "x-invite-code",
  turnstileToken: "x-turnstile-token",
} as const;

/**
 * The codes the server's refusals carry (`modules/auth/access-hook.ts`),
 * which the forms read to land each one: the invite refusals on the code
 * field, Turnstile's in the band.
 */
export const ACCESS_CODES = {
  turnstile: "TURNSTILE_REFUSED",
  missing: "INVITE_MISSING",
  invalid: "INVITE_INVALID",
} as const;

/**
 * The ban gate's refusal (task 128 · SAF-4, `safety/ban-gate.ts`): the
 * code a refused sign-in carries, here rather than beside the gate so the
 * sign-in forms can read it without importing the server's auth plugin.
 * Google's round trip brings it back as `?error=ACCOUNT_CLOSED`.
 */
export const ACCOUNT_CLOSED_CODE = "ACCOUNT_CLOSED";

/**
 * Design-deltas item 23 (round 27, "Au1 account closed Google"): D4's
 * band on Au1, word for word, the same for a password log-in. No date, no
 * reason and no case line (round 27 #30): the ban email carries the
 * reason, and an appeal is a reply to it (D-73).
 *
 * **It does confirm the password was right**: the gate refuses only once
 * the credentials check out, so a wrong password still reads Au3. The
 * owner accepted that (2026-10-12) — the account cannot be used, so the
 * confirmation opens nothing.
 *
 * `appeal` is the owner's addition to the drawn copy (2026-10-12; design
 * deltas item 62): a fallback for a runner who no longer has the email.
 */
export const ACCOUNT_CLOSED_COPY = {
  kicker: "Account closed",
  message: "This account was closed for breaking the community rules.",
  detail: "Think we got it wrong? Reply to the email we sent you.",
  appeal: `Or write to ${APPEAL_ADDRESS}.`,
} as const;
