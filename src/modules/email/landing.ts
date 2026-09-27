/**
 * What opening an unsubscribe link does (round 26 #19): "Opening it is the
 * unsubscribe: no confirm button and no 'are you sure'. 'Turn them back
 * on' undoes it on the same page." No session: the signature is the
 * permission.
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
  | { readonly state: "invalid" };

/**
 * Switch the kind a signed link names off (`isOn` false) or back on. A
 * tampered link, or one for an account that is gone, changes nothing and
 * lands on "That link doesn't work."
 */
export async function switchByLink(
  db: Db,
  secret: string,
  search: unknown,
  isOn: boolean,
): Promise<SubscriptionLanding> {
  const signed = await verifiedUnsubscribe(secret, search);
  if (signed === undefined) return { state: "invalid" };
  const email = await firstColumnWhere(
    db,
    user,
    user.email,
    eq(user.id, signed.userId),
  );
  if (email === undefined) return { state: "invalid" };
  await setEmailPreference(db, signed.userId, signed.kind, isOn);
  return { state: isOn ? "on" : "off", kind: signed.kind, email };
}

/**
 * RFC 8058's one-click unsubscribe: a mail client's own Unsubscribe button
 * POSTs the `List-Unsubscribe` URL with `List-Unsubscribe=One-Click`, and
 * expects a 2xx. The link's search is the whole of the permission, so the
 * body is not read.
 */
export async function oneClickUnsubscribe(
  db: Db,
  secret: string,
  request: Request,
): Promise<Response> {
  const search = Object.fromEntries(new URL(request.url).searchParams);
  const landing = await switchByLink(db, secret, search, false);
  return new Response(undefined, {
    status: landing.state === "invalid" ? 400 : 200,
  });
}
