/**
 * The unsubscribe link. **Opening it changes nothing** (owner, 2026-09-27,
 * D-64 — overriding round 26 #19's "opening it is the unsubscribe"):
 * security scanners and corporate mail gateways fetch every link in a
 * message, so a GET that unsubscribes unsubscribes runners who never
 * clicked. The landing asks, and its one button POSTs. A mail client's own
 * one-click (RFC 8058) is a POST already, and stays one click. No session:
 * the signature is the permission. Round 27 #8 draws it: the address
 * masked, a second visit showing the done state, and "Turn them back on"
 * returning to the question.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import type { EmailPreferenceKind } from "../../lib/email";
import { firstColumnWhere } from "../../lib/keyed-read";
import { isEmailWanted, setEmailPreference } from "./preferences";
import { verifiedUnsubscribe } from "./unsubscribe";

type Db = ReturnType<typeof drizzle>;

export type SubscriptionLanding =
  | {
      /**
       * `ask` while the kind is on — the question and its one button —
       * and `off` once it is ("Run reminder emails are off").
       */
      readonly state: "ask" | "off";
      readonly kind: EmailPreferenceKind;
      /**
       * The address the landing names, masked (round 27 #8's
       * "ma•••@example.com"): a signed-out page anyone holding the link
       * can open.
       */
      readonly email: string;
    }
  | { readonly state: "invalid" };

/**
 * An address as a signed-out page may show it: the first two characters
 * of the local part, then `•••`, then the whole domain.
 */
export function maskedAddress(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

/**
 * The runner and address a signed link names, or nothing: what the
 * landing needs to ask.
 */
async function signedFor(
  db: Db,
  secret: string | undefined,
  search: unknown,
): Promise<
  { userId: string; kind: EmailPreferenceKind; email: string } | undefined
> {
  const signed = await verifiedUnsubscribe(secret, search);
  if (signed === undefined) return undefined;
  const email = await firstColumnWhere(
    db,
    user,
    user.email,
    eq(user.id, signed.userId),
  );
  if (email === undefined) return undefined;
  return { ...signed, email: maskedAddress(email) };
}

/**
 * What the landing shows for a kind that is on (the question) or off.
 */
function landingOf(
  signed: Readonly<{ kind: EmailPreferenceKind; email: string }>,
  isOn: boolean,
): SubscriptionLanding {
  return {
    state: isOn ? "ask" : "off",
    kind: signed.kind,
    email: signed.email,
  };
}

/**
 * Opening the link (GET): read, never write — the landing asks whether to
 * unsubscribe, or, when the kind is already off, says so (a second visit
 * shows the done state). A scanner that fetches it changes nothing.
 */
export async function readByLink(
  db: Db,
  secret: string | undefined,
  search: unknown,
): Promise<SubscriptionLanding> {
  const signed = await signedFor(db, secret, search);
  if (signed === undefined) return { state: "invalid" };
  return landingOf(signed, await isEmailWanted(db, signed.userId, signed.kind));
}

/**
 * Switch the kind a signed link names off (`isOn` false) or back on — back
 * on lands on the question again. A tampered link, or one for an account that is gone, changes nothing and
 * lands on "That link doesn't work."
 */
export async function switchByLink(
  db: Db,
  secret: string | undefined,
  search: unknown,
  isOn: boolean,
): Promise<SubscriptionLanding> {
  const signed = await signedFor(db, secret, search);
  if (signed === undefined) return { state: "invalid" };
  await setEmailPreference(db, signed.userId, signed.kind, isOn);
  return landingOf(signed, isOn);
}

/**
 * RFC 8058's one-click unsubscribe: a mail client's own Unsubscribe button
 * POSTs the `List-Unsubscribe` URL with `List-Unsubscribe=One-Click`, and
 * expects a 2xx. The link's search is the whole of the permission, so the
 * body is not read.
 */
export async function oneClickUnsubscribe(
  db: Db,
  secret: string | undefined,
  request: Request,
): Promise<Response> {
  const search = Object.fromEntries(new URL(request.url).searchParams);
  const landing = await switchByLink(db, secret, search, false);
  return new Response(undefined, {
    status: landing.state === "invalid" ? 400 : 200,
  });
}
