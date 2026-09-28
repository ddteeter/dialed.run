/**
 * The unsubscribe link. **Opening it changes nothing** (owner, 2026-09-27,
 * D-64 — overriding round 26 #19's "opening it is the unsubscribe"):
 * security scanners and corporate mail gateways fetch every link in a
 * message, so a GET that unsubscribes unsubscribes runners who never
 * clicked. The landing asks, and its one button POSTs. A mail client's own
 * one-click (RFC 8058) is a POST already, and stays one click. No session:
 * the signature is the permission.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import type { EmailPreferenceKind } from "../../lib/email";
import { firstColumnWhere } from "../../lib/keyed-read";
import { setEmailPreference } from "./preferences";
import { verifiedUnsubscribe } from "./unsubscribe";

type Db = ReturnType<typeof drizzle>;

export type SubscriptionLanding =
  | {
      readonly state: "off" | "on";
      readonly kind: EmailPreferenceKind;
      /**
      The address the landing names ("DONE · MAYA@EXAMPLE.COM").
      */
      readonly email: string;
    }
  | {
      readonly state: "ask";
      readonly kind: EmailPreferenceKind;
      readonly email: string;
    }
  | { readonly state: "invalid" };

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
  return { ...signed, email };
}

/**
 * Opening the link (GET): read, never write — the landing asks whether to
 * unsubscribe. A scanner that fetches it changes nothing.
 */
export async function readByLink(
  db: Db,
  secret: string | undefined,
  search: unknown,
): Promise<SubscriptionLanding> {
  const signed = await signedFor(db, secret, search);
  if (signed === undefined) return { state: "invalid" };
  return { state: "ask", kind: signed.kind, email: signed.email };
}

/**
 * Switch the kind a signed link names off (`isOn` false) or back on. A
 * tampered link, or one for an account that is gone, changes nothing and
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
  return { state: isOn ? "on" : "off", kind: signed.kind, email: signed.email };
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
