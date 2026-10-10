/**
 * A request to remove an intimate image shared without consent (design
 * 136, decision D-117): the TAKE IT DOWN Act's path for someone who may
 * have no account. The form, the words and the reading of a pasted link,
 * shared by `/takedown` and the server, so neither restates the other.
 *
 * The Act's valid request has four parts, and the form asks for each: a
 * signature (the typed full name), where the image is (`location`), a
 * statement of good faith that it was shared without consent (`isAttested`),
 * and a way to reach the person asking (`email`). Placeholder words
 * throughout (design deltas item 58).
 */
import { z } from "zod";

import { ulidSchema } from "../ids";

export const SIGNATURE_MAX = 120;
export const LOCATION_MAX = 2000;
export const DESCRIPTION_MAX = 1000;

/**
The words, one sentence each, naming the fix (§Forms & failure).
*/
export const TAKEDOWN_COPY = {
  email: "Enter an email address we can reach you at.",
  emailShape: "That does not look like an email address.",
  signature: "Type your full name as your signature.",
  signatureLong: `Keep your name under ${String(SIGNATURE_MAX)} characters.`,
  location: "Paste the link to the image, or say where it is.",
  locationLong: `Keep this under ${String(LOCATION_MAX)} characters.`,
  descriptionLong: `Keep this under ${String(DESCRIPTION_MAX)} characters.`,
  attest: "Confirm the statement to send the request.",
} as const;

export const takedownRequestSchema = z.object({
  email: z
    .string()
    .min(1, TAKEDOWN_COPY.email)
    .pipe(z.email(TAKEDOWN_COPY.emailShape)),
  signature: z
    .string()
    .trim()
    .min(1, TAKEDOWN_COPY.signature)
    .max(SIGNATURE_MAX, TAKEDOWN_COPY.signatureLong),
  location: z
    .string()
    .trim()
    .min(1, TAKEDOWN_COPY.location)
    .max(LOCATION_MAX, TAKEDOWN_COPY.locationLong),
  description: z.string().max(DESCRIPTION_MAX, TAKEDOWN_COPY.descriptionLong),
  isAttested: z.literal(true, TAKEDOWN_COPY.attest),
  idempotencyKey: ulidSchema,
});

export type TakedownRequestValues = z.infer<typeof takedownRequestSchema>;

/**
 * What a pasted link points at, when it is one of ours: a shared kit
 * (`/feed/entry/{id}`) or one of its photos
 * (`/feed/photo/entries/{runner}/{entry}/{photo}`). `entryId` is the kit
 * either way, where Review opens it. Any host is read, because the same
 * path on a preview deployment or a copied `www.` link is still ours;
 * anything else — another site, a description in words — is `undefined`,
 * and the operator finds it by hand.
 */
export type TakedownSubject = Readonly<{
  subjectType: "entry" | "photo";
  subjectId: string;
  entryId: string;
}>;

const ENTRY_PATH = /^\/feed\/entry\/([^/]+)\/?$/u;
const PHOTO_PATH = /^\/feed\/photo\/entries\/[^/]+\/([^/]+)\/([^/]+)$/u;

export function takedownSubjectOf(
  location: string,
): TakedownSubject | undefined {
  const path = pathOf(location);
  const entry = ENTRY_PATH.exec(path)?.[1];
  if (entry !== undefined && isUlid(entry)) {
    return { subjectType: "entry", subjectId: entry, entryId: entry };
  }
  const [, entryId = "", photoId = ""] = PHOTO_PATH.exec(path) ?? [];
  return isUlid(entryId) && isUlid(photoId)
    ? { subjectType: "photo", subjectId: photoId, entryId }
    : undefined;
}

function isUlid(value: string): boolean {
  return ulidSchema.safeParse(value).success;
}

/**
The path of a link, or an empty path when the text is not a URL.
*/
function pathOf(location: string): string {
  return URL.canParse(location) ? new URL(location).pathname : "";
}
