/**
 * Entry photos in R2 (design doc "Photos"): ≤4/entry, jpeg/png/webp
 * ≤10MB, key convention `entries/{userId}/{entryId}/{photoId}` — copies
 * lane 101's convention, doesn't import it (that module doesn't exist on
 * this branch yet). Originals only for now; derived sizes follow 101's
 * photon-wasm benchmark rather than duplicating a wasm pipeline here.
 */
import { and, eq, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries } from "../../db/schema-core";
import { env } from "../../env";
import { firstColumnWhere } from "../../lib/keyed-read";
import { newUlid } from "../../lib/ids";
import { isAllowedPhotoType } from "../../lib/photo-constraints";
import { photoRefusal, withReleased } from "../../lib/photo-pipeline";
import type { z } from "zod";

import { uploadPhotoFields } from "./inputs";
import {
  entryPhotoIdOf,
  entryPhotoKeyFor,
  entryPhotoPrefixRoot,
} from "../../lib/entry-photo-key";
import { nowSeconds } from "../../lib/now";
import { requireOwned } from "../../lib/owned";
import { filePartFrom } from "../../lib/file-part";
import type { FilePartProblem } from "../../lib/file-part";
import { isAdmin, publicPhotoStatus, publiclyVisibleEntry } from "../safety";
import { classifierFromEnv, screenPhoto, type Classify } from "../safety";
import {
  isSignatureValid,
  signedBucketSeconds,
  signedExpiry,
  signPhotoKey,
  type PhotoSignature,
} from "../safety";

export const MAX_PHOTOS_PER_ENTRY = 4;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function db() {
  return drizzle(env.DIALED_CORE);
}

export class InvalidPhotoError extends Error {}

export interface UploadPhotoInput {
  userId: string;
  entryId: string;
  contentType: string;
  bytes: ArrayBuffer;
  idempotencyKey?: string | undefined;
}

/**
 * The classifier, injectable so a test can make the upstream fail on
 * demand. Production passes nothing and gets `classifierFromEnv()`.
 */
export interface UploadPhotoOptions {
  classify?: Classify | undefined;
}

export async function uploadPhoto(
  input: UploadPhotoInput,
  { classify }: UploadPhotoOptions = {},
): Promise<string> {
  if (!isAllowedPhotoType(input.contentType)) {
    throw new InvalidPhotoError("unsupported photo type");
  }
  if (input.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new InvalidPhotoError("photo too large");
  }
  // Read from the header, before anything decodes it (task 128 · SAF-2,
  // register D-3): a 10 MB file can decode to ~96 MB, and the isolate has
  // 128.
  const uploaded = new Uint8Array(input.bytes);
  const refusal = photoRefusal(uploaded);
  if (refusal !== undefined) throw new InvalidPhotoError(refusal);

  const database = db();
  const [entry] = await database
    .select({ userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, input.entryId))
    .limit(1);
  requireOwned(entry, input.userId, {
    missing: "entry not found",
    forbidden: "cannot add photos to another user's entry",
    // fallow-ignore-next-line code-duplication -- both are law 8b's idempotency check through firstColumnWhere; the scope column and the UNIQUE index behind it differ
  });

  // A repeat of a submission we already stored returns the key it made
  // (law 8b). Worth more here than on a plain row insert: without it a
  // double-submit costs an R2 put as well as a duplicate row, and burns
  // one of the four photo slots on the same image.
  //
  // Matched in SQL against the UNIQUE (entry_id, idempotency_key) index
  // rather than by scanning the rows fetched below — the index makes it a
  // seek, and an in-memory `.find` over a capped list is the habit that
  // breaks the moment the cap moves.
  if (input.idempotencyKey !== undefined) {
    const already = await firstColumnWhere(
      database,
      entryPhotos,
      entryPhotos.photoKey,
      and(
        eq(entryPhotos.entryId, input.entryId),
        eq(entryPhotos.idempotencyKey, input.idempotencyKey),
      ),
    );
    if (already !== undefined) return already;
  }

  const existing = await database
    .select({ id: entryPhotos.id })
    .from(entryPhotos)
    .where(eq(entryPhotos.entryId, input.entryId));
  if (existing.length >= MAX_PHOTOS_PER_ENTRY) {
    throw new InvalidPhotoError(
      `at most ${String(MAX_PHOTOS_PER_ENTRY)} photos per entry`,
    );
  }

  // R2 then the row, which cannot be atomic (law 8c). Deliberately left as
  // two writes: a failure between them is visible — the upload errors and
  // the user retries — and the only residue is an orphaned object under a
  // random key. Recorded as D-27 rather than swept, because MEDIA has no
  // expiry so orphans are permanent, but the failure needs D1 to fail
  // between two calls and the cost is storage, not correctness.
  const photoId = newUlid();
  const key = entryPhotoKeyFor(input.userId, input.entryId, photoId);
  const stored = await reencoded(uploaded);
  await env.MEDIA.put(key, stored, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await database.insert(entryPhotos).values({
    id: photoId,
    entryId: input.entryId,
    photoKey: key,
    position: existing.length,
    idempotencyKey: input.idempotencyKey,
  });

  // Screened inline rather than after responding, because the packet's
  // common path is "pass -> visible immediately" and a photo that appears
  // then vanishes for its own author is worse than one that takes a beat
  // to upload. The call is bounded by law 4's timeout, and `screenPhoto`
  // never throws: with no key, a slow upstream or a dead one, the row
  // simply stays `pending` and the screening-retry cron owns it from
  // there. So this can delay a save but can never fail one.
  await screenPhoto(
    {
      scope: "entry",
      photoId,
      bytes: stored,
      contentType: "image/jpeg",
    },
    classify ?? classifierFromEnv(),
  );

  return key;
}

/**
 * The photo as it is stored: decoded and encoded again as a JPEG (task 128
 * · SAF-1, audit 0.8). Nothing the runner's device wrote survives — the
 * EXIF block a phone puts in every frame carries where it was taken, and
 * on a public entry that was the runner's front door. With W3's blur on
 * the browser has already redrawn the photo; this is what makes it true
 * with blur off, from an old client, or from anything that is not our
 * client at all.
 *
 * Screening classifies these bytes, not the upload's: they are the ones a
 * stranger will be served.
 */
async function reencoded(bytes: Uint8Array): Promise<Uint8Array> {
  // Lazily, as the closet does: a static import would instantiate the WASM
  // at worker startup, for every request, photo or not.
  const { PhotonImage } = await import("@cf-wasm/photon/workerd");
  return withReleased(PhotonImage.new_from_byteslice(bytes), (image) =>
    Promise.resolve(image.get_bytes_jpeg(ENTRY_PHOTO_QUALITY)),
  );
}

/**
 * The stored JPEG's quality — the canvas step uploads at 0.92, and one
 * more generation at 88 is invisible at the sizes an entry shows.
 */
const ENTRY_PHOTO_QUALITY = 88;

/**
 * What the GET route may do with this photo for `viewerId`: nothing, serve
 * it to its owner, or hand a signed-in stranger the shared copy.
 *
 * The owner may see it whatever is pending against the photo or its entry
 * — fail open for the owner, closed for everyone else. Anyone else needs
 * both halves: the entry passes the one visibility rule **as this viewer
 * sees it** (task 128: a banned author, a blocked pair or an entry the
 * viewer reported all refuse), and the photo passed screening. A photo the
 * classifier flagged on a public entry was once served with HTTP 200,
 * because nothing read the column `screenPhoto` writes.
 *
 * **Signed out is refused** (SAF-14, D-109): the pages that show these
 * photos require a session, so the bytes do too. A signed URL (SAF-7) is
 * the one other way in, and only a signed-in viewer is ever handed one.
 *
 * One read, joined, and found by primary key: the photo's id is the key's
 * last segment (`entryPhotoKeyFor`), and `entry_photos` has no index on
 * `photo_key` — looking it up by key alone scanned the table on every
 * image a feed page drew. The key is still compared, so a well-formed id
 * under somebody else's prefix finds nothing.
 */
export async function photoAccess(
  photoKey: string,
  viewerId: string | undefined,
): Promise<{ isShared: boolean } | undefined> {
  if (viewerId === undefined) return undefined;
  const shownToOthers = and(
    publiclyVisibleEntry(viewerId),
    eq(entryPhotos.screenStatus, publicPhotoStatus),
  );
  const [row] = await photoRows(
    photoKey,
    or(eq(outfitEntries.userId, viewerId), shownToOthers),
  );
  if (row === undefined) return undefined;
  // Shared: someone other than its owner is looking.
  return { isShared: row.ownerId !== viewerId };
}

/**
 * Whether `viewerId` may fetch this photo at all — `photoAccess`, as the
 * yes-or-no the visibility tests ask.
 */
export async function isPhotoVisible(
  photoKey: string,
  viewerId: string | undefined,
): Promise<boolean> {
  return (await photoAccess(photoKey, viewerId)) !== undefined;
}

/**
 * The photo's row, joined to its entry, where `allowed` holds — at most
 * one, by primary key.
 */
function photoRows(photoKey: string, allowed: SQL | undefined) {
  const thisPhoto = and(
    eq(entryPhotos.id, entryPhotoIdOf(photoKey)),
    eq(entryPhotos.photoKey, photoKey),
  );
  return db()
    .select({ ownerId: outfitEntries.userId })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(and(thisPhoto, allowed))
    .limit(1);
}

export async function getPhotoObject(
  photoKey: string,
): Promise<R2ObjectBody | null> {
  return env.MEDIA.get(photoKey);
}

/**
The sentences this screen uses for each refusal.
*/
const PHOTO_REFUSALS: Readonly<Record<FilePartProblem, string>> = {
  "not-form-data": "expected multipart form data",
  missing: "no photo in upload",
  "too-large": "photo too large",
};

/**
 * Pulls a photo upload out of a multipart body, refusing anything the
 * pipeline cannot store.
 *
 * The size is checked against the *declared* size, before the bytes are
 * read, so an oversized upload is refused without being allocated. All
 * three refusals are decisions, which is why they are here rather than in
 * the server function's validator (D-41).
 */
export function photoUploadFrom(
  input: unknown,
): z.infer<typeof uploadPhotoFields> & { file: File } {
  const part = filePartFrom(input, "photo", MAX_PHOTO_BYTES);
  if (!part.ok) throw new InvalidPhotoError(PHOTO_REFUSALS[part.problem]);
  const { file, form } = part;
  const fields = uploadPhotoFields.parse({
    entryId: form.get("entryId"),
    contentType: file.type,
    idempotencyKey: form.get("idempotencyKey") ?? undefined,
  });
  return { ...fields, file };
}

/**
 * The signature half of a photo URL, as the query string carries it.
 * Absent parameters are absent.
 */
export interface SignedQuery {
  expires?: string | undefined;
  signature?: string | undefined;
}

const UNSIGNED: SignedQuery = {};

/**
The signature a request's URL carries, if any, for the route to hand on.
*/
export function signedQueryOf(url: string): SignedQuery {
  const query = new URL(url).searchParams;
  return {
    expires: query.get("e") ?? undefined,
    signature: query.get("s") ?? undefined,
  };
}

/**
 * The cached GET for an entry photo, as one function.
 *
 * It was the body of `routes/feed/photo.$.tsx` — three refusals and a set
 * of headers, in the one kind of file no test can import. The visibility
 * rule it enforces is the same one entry detail uses: a private entry's
 * photos are never fetchable by anyone but its owner, and a photo that is
 * not visible is *not found* rather than forbidden, because "403" tells a
 * stranger the photo exists.
 *
 * **Three ways out** (task 128 · SAF-7, decision D-46):
 *
 * - its **owner** gets the bytes, `private`, as before;
 * - a **signed-in stranger** the rule lets see it is redirected to the
 *   photo's signed URL, which any cache may hold for as long as the URL
 *   lives — that is what puts a shared photo where Cloudflare's CSAM tool
 *   can scan it. With no signing secret nothing is signed (fail closed)
 *   and the stranger gets the `private` bytes instead;
 * - a **signed URL** is served to anyone holding one, `public`, after the
 *   signature and the entry's anonymous visibility both pass.
 */
export async function photoResponse(
  key: string | undefined,
  viewerId: string | undefined,
  signed: SignedQuery = UNSIGNED,
  now: number = nowSeconds(),
): Promise<Response> {
  // Absent and blank in one check: the splat is `""` for `/feed/photo/`
  // itself, and neither is a photo. Written as one because an explicit
  // `=== ""` arm would be indistinguishable from letting it fall through
  // to the visibility check, which refuses it too — at the cost of a
  // query.
  if (!key) return notFound();
  if (signed.signature !== undefined)
    return signedPhotoResponse(key, signed, now);
  const access = await photoAccess(key, viewerId);
  if (access === undefined) return notFound();
  const signature = access.isShared
    ? await signPhotoKey(key, signedExpiry(now))
    : undefined;
  if (signature === undefined) return bytesResponse(key, PRIVATE_CACHE);
  return signedRedirect(key, signature, now);
}

/**
`private`: only people the entry is shared with see it.
*/
const PRIVATE_CACHE = "private, max-age=3600";

/**
 * A request that carries a signature: served only if we made it, for this
 * key, and it is live — and only while the entry would still be shown to
 * a stranger. The second check is what stops a removed, hidden or
 * re-privated photo at once for any request that reaches us; a cache
 * already holding it keeps it until the URL expires, which is the purge
 * bound (design doc, open question 2).
 */
async function signedPhotoResponse(
  key: string,
  signed: SignedQuery,
  now: number,
): Promise<Response> {
  if (!(await isSignatureValid(key, signed, now))) return notFound();
  const [row] = await photoRows(
    key,
    and(
      publiclyVisibleEntry(),
      eq(entryPhotos.screenStatus, publicPhotoStatus),
    ),
  );
  if (row === undefined) return notFound();
  // `isSignatureValid` has already bounded this by `maxSignedLifeSeconds`,
  // so no cache holds the copy longer than the URL it answers lives.
  return bytesResponse(
    key,
    `public, max-age=${String(Number(signed.expires) - now)}`,
  );
}

/**
 * The redirect a signed-in stranger follows to the shared copy. The
 * redirect itself is `private` — it was issued to one session — and lives
 * one bucket less than the URL it names, so a browser that reuses it
 * always lands on a URL with a quarter-hour still to run.
 */
function signedRedirect(
  key: string,
  signature: PhotoSignature,
  now: number,
): Response {
  const query = new URLSearchParams({
    e: String(signature.expires),
    s: signature.signature,
  });
  const life = signature.expires - now - signedBucketSeconds;
  return new Response(undefined, {
    status: 302,
    headers: {
      location: `/feed/photo/${key}?${query.toString()}`,
      "cache-control": `private, max-age=${String(life)}`,
    },
  });
}

/**
 * The bytes of a photo a reviewer is being asked about.
 *
 * **A different rule, not a missing one.** The review queue shows photos
 * that are hidden *because* they were reported, so `isPhotoVisible` would
 * refuse every one of them — being unable to see the thing is what made
 * the queue unusable. `requireAdmin` replaces the check rather than
 * skipping it.
 *
 * It lives here rather than in `modules/safety` because photos live here,
 * and because the arrow runs feed → safety: feed already imports safety's
 * visibility rules, and safety imports nothing from feed
 * (`docs/architecture.md`).
 */
export async function reviewerPhotoResponse(
  key: string,
  viewerId: string,
): Promise<Response> {
  // Both are parameters, as they are for `photoResponse`, and for the same
  // reason: a function that reads the session or the params itself cannot
  // be called by a test.
  //
  // **The route hands both across already normalised**, and that is what
  // keeps this to one rule. A bare URL gives an empty key, which misses in
  // R2 and answers 404 on its own; a signed-out viewer gives an empty id,
  // which is never in the admin list (`adminUserIds` drops empties). Both
  // guards that used to sit here were conditions with no second outcome —
  // `viewerId === undefined ||` in front of a membership test that already
  // says no, and `if (!key)` in front of a lookup that already misses.
  //
  // **404, not 403, and not a thrown `AdminRequiredError`.** The rest of
  // this route answers "you may not see this" as "there is nothing here",
  // deliberately — a 403 tells a stranger the photo exists, which is most
  // of what they wanted to know. A throw would also surface as a 500 on a
  // media URL, which says the same thing louder.
  if (!isAdmin(viewerId)) return notFound();
  // Only an entry photo's own prefix. A quarantined copy (SAF-5) is kept
  // for the preservation period and served by no route at all — this one
  // included, admin or not.
  if (!key.startsWith(entryPhotoPrefixRoot)) return notFound();
  return bytesResponse(key, PRIVATE_CACHE);
}

/**
The bytes and their headers, once, for both rules above.
*/
async function bytesResponse(
  key: string,
  cacheControl: string,
): Promise<Response> {
  const object = await getPhotoObject(key);
  if (object === null) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", cacheControl);
  return new Response(object.body, { headers });
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}
