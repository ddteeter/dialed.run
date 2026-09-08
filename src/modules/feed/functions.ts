/**
 * Server-function glue: zod-validates every input, resolves the session,
 * then delegates to the pure query modules. Route files import from here
 * (and only from here) — no business logic lives in `src/routes/feed/`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  entryTagSchema,
  itemFlagSchema,
  latitudeSchema,
  longitudeSchema,
  verdictSchema,
} from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
import { optionalUserId, requireUserId } from "../auth";
import { currentConditions } from "./conditions";
import { yourConditionsConsensus } from "./consensus";
import { attachKit, getEntryDetail, itemBandWearStat, recordVerdictPrompted, shouldPromptForVerdict, submitVerdict, verdictBandCounts } from "./entries";
import { followingFeed } from "./feed";
import { follow, isFollowing, unfollow } from "./follows";
import { pickerGroups } from "./picker";
import {
  ALLOWED_CONTENT_TYPES,
  InvalidPhotoError,
  MAX_PHOTO_BYTES,
  uploadPhoto,
} from "./photos";
import { nearestPriorEntry } from "./prefill";
import { otherProfile, ownProfile } from "./profiles";
import { hasReacted, toggleUsefulReaction, usefulCount } from "./reactions";
import { searchByDisplayName } from "./search";

// ---- Attach the kit (A2/A2b) ------------------------------------------------

const attachKitInput = z.object({
  runId: ulidSchema,
  itemIds: z.array(ulidSchema).max(40),
});

export const attachKitAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => attachKitInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const entryId = await attachKit({ userId, runId: data.runId, itemIds: data.itemIds });
    return { entryId };
  });

const pickerGroupsInput = z.object({
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
});

export const pickerGroupsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => pickerGroupsInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const conditions =
      data.lat === undefined || data.lng === undefined
        ? undefined
        : await currentConditions(data.lat, data.lng, Math.floor(Date.now() / 1000));
    return pickerGroups(userId, conditions);
  });

// One schema for both surfaces that take a coordinate: the prefill lookup
// and the conditions consensus ask the same question of the same input.
const coordinatesInput = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});

export const prefillQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => coordinatesInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const conditions = await currentConditions(
      data.lat,
      data.lng,
      Math.floor(Date.now() / 1000),
    );
    if (!conditions) return;
    return nearestPriorEntry(userId, conditions);
  });

// ---- The verdict (A3) -------------------------------------------------------

const itemFlagInputSchema = z.object({
  itemId: ulidSchema,
  flag: itemFlagSchema.optional(),
  note: z.string().max(280).optional(),
});

const submitVerdictInput = z.object({
  entryId: ulidSchema,
  verdict: verdictSchema,
  isPublic: z.boolean(),
  caption: z.string().max(280).optional(),
  tags: z.array(entryTagSchema).max(entryTagSchema.options.length),
  itemFlags: z.array(itemFlagInputSchema),
});

export const submitVerdictAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => submitVerdictInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await submitVerdict({ userId, ...data });
  });

const bandCountsInput = z.object({ bandFloorC: z.number(), excludeEntryId: ulidSchema.optional() });
export const verdictBandCountsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => bandCountsInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return verdictBandCounts(userId, data.bandFloorC, data.excludeEntryId);
  });

const itemBandStatInput = z.object({ itemId: ulidSchema, bandFloorC: z.number() });
export const itemBandWearStatQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => itemBandStatInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return itemBandWearStat(userId, data.itemId, data.bandFloorC);
  });

const entryIdInput = z.object({ entryId: ulidSchema });

export const verdictPromptQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => entryIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return shouldPromptForVerdict(userId, data.entryId);
  });

export const recordVerdictPromptedAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => entryIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await recordVerdictPrompted(userId, data.entryId);
  });

// ---- Entry detail (D) --------------------------------------------------------

export const entryDetailQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => entryIdInput.parse(input))
  .handler(async ({ data }) => {
    const viewerId = await optionalUserId();
    const entry = await getEntryDetail(data.entryId, viewerId);
    if (!entry) return;
    const useful = await usefulCount(data.entryId);
    const isReacted = viewerId ? await hasReacted(data.entryId, viewerId) : false;
    return { ...entry, usefulCount: useful, viewerHasReacted: isReacted };
  });

// ---- Useful reactions (D-11) -------------------------------------------------

export const toggleUsefulAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => entryIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return toggleUsefulReaction(data.entryId, userId);
  });

// ---- Follows ------------------------------------------------------------------

const followInput = z.object({ userId: ulidSchema });

export const followAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => followInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await follow(userId, data.userId);
  });

export const unfollowAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => followInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await unfollow(userId, data.userId);
  });

export const followStatusQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => followInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return isFollowing(userId, data.userId);
  });

// ---- Following feed (E1) -----------------------------------------------------

const feedCursorSchema = z
  .object({ createdAt: z.number().int(), id: z.string() })
  .optional();
const feedInput = z.object({ cursor: feedCursorSchema });

export const followingFeedQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => feedInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return followingFeed(userId, data.cursor);
  });

// ---- Your conditions (E2-lite) -----------------------------------------------

export const yourConditionsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => coordinatesInput.parse(input))
  .handler(async ({ data }) => {
    await requireUserId();
    const now = Math.floor(Date.now() / 1000);
    const viewer = await currentConditions(data.lat, data.lng, now);
    if (!viewer) return;
    return yourConditionsConsensus(viewer, now);
  });

// ---- Profiles (G/H) -----------------------------------------------------------

export const ownProfileQuery = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return ownProfile(userId);
});

const userIdInput = z.object({ userId: ulidSchema });

export const otherProfileQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => userIdInput.parse(input))
  .handler(async ({ data }) => otherProfile(data.userId));

// ---- Username search ------------------------------------------------------------

const searchInput = z.object({ prefix: z.string().max(60) });

export const searchQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => searchInput.parse(input))
  .handler(async ({ data }) => {
    await requireUserId();
    return searchByDisplayName(data.prefix);
  });

// ---- Photos -----------------------------------------------------------------

/**
 * Multipart, not base64.
 *
 * The previous version encoded the file to base64 in the browser and
 * decoded it here with a byte-at-a-time loop. That is ~33% more bytes on
 * the wire, plus two full passes over up to 10MB inside a 128MB isolate —
 * pure overhead, and it stacked badly against the image resize that runs
 * next. TanStack's types special-case FormData for POST server functions
 * (see ValidateValidatorInput), so the file streams as multipart and the
 * handler gets bytes with no transcode. No URL is involved, so this stays
 * a called server function rather than a fetch to a string path.
 *
 * Size is checked before the bytes are read, so an oversized upload is
 * rejected without allocating it.
 */
const uploadPhotoFields = z.object({
  entryId: ulidSchema,
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  // A multipart field, so it arrives as a string like every other one.
  idempotencyKey: ulidSchema.optional(),
});

export const uploadPhotoAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) {
      throw new InvalidPhotoError("expected multipart form data");
    }
    const file = input.get("photo");
    if (!(file instanceof File)) {
      throw new InvalidPhotoError("no photo in upload");
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new InvalidPhotoError("photo too large");
    }
    const fields = uploadPhotoFields.parse({
      entryId: input.get("entryId"),
      contentType: file.type,
      idempotencyKey: input.get("idempotencyKey") ?? undefined,
    });
    return { ...fields, file };
  })
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const key = await uploadPhoto({
      userId,
      entryId: data.entryId,
      contentType: data.contentType,
      bytes: await data.file.arrayBuffer(),
      idempotencyKey: data.idempotencyKey,
    });
    return { key };
  });
