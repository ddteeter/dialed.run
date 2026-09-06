/**
 * Server-function glue: zod-validates every input, resolves the session,
 * then delegates to the pure query modules. Route files import from here
 * (and only from here) — no business logic lives in `src/routes/feed/`.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { entryTagSchema, itemFlagSchema, verdictSchema } from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
import { auth } from "../auth";
import { currentConditions } from "./conditions";
import { yourConditionsConsensus } from "./consensus";
import { attachKit, getEntryDetail, itemBandWearStat, recordVerdictPrompted, shouldPromptForVerdict, submitVerdict, verdictBandCounts } from "./entries";
import { followingFeed } from "./feed";
import { follow, isFollowing, unfollow } from "./follows";
import { pickerGroups } from "./picker";
import { ALLOWED_CONTENT_TYPES, MAX_PHOTO_BYTES, uploadPhoto } from "./photos";
import { nearestPriorEntry } from "./prefill";
import { otherProfile, ownProfile } from "./profiles";
import { hasReacted, toggleUsefulReaction, usefulCount } from "./reactions";
import { searchByDisplayName } from "./search";

class AuthRequiredError extends Error {
  constructor() {
    super("sign-in required");
  }
}

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session) throw new AuthRequiredError();
  return session.user.id;
}

async function currentUserId(): Promise<string | undefined> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session?.user.id;
}

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
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
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

const prefillInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const prefillQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => prefillInput.parse(input))
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
    const viewerId = await currentUserId();
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

const yourConditionsInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const yourConditionsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => yourConditionsInput.parse(input))
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

const uploadPhotoInput = z.object({
  entryId: ulidSchema,
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  dataBase64: z.string().max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 100),
});

export const uploadPhotoAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => uploadPhotoInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const binary = atob(data.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.codePointAt(index) ?? 0;
    }
    const key = await uploadPhoto({
      userId,
      entryId: data.entryId,
      contentType: data.contentType,
      bytes: bytes.buffer,
    });
    return { key };
  });
