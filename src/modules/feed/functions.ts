/**
 * Server-function glue: zod-validates every input, resolves the session,
 * then delegates to the pure query modules. Route files import from here
 * (and only from here) — no business logic lives in `src/routes/feed/`.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { optionalUserId, requireUserId } from "../auth";
import {
  attachKitInput,
  bandCountsInput,
  coordinatesInput,
  entryIdInput,
  feedInput,
  itemBandStatInput,
  pickerGroupsInput,
  searchInput,
  submitVerdictInput,
  userIdInput,
} from "./inputs";
import { conditionsAt } from "./conditions";
import { consensusAt } from "./consensus";
import {
  attachKit,
  entryDetailForViewer,
  itemBandWearStat,
  recordVerdictPrompted,
  shouldPromptForVerdict,
  submitVerdict,
  verdictBandCounts,
} from "./entries";
import { followingFeed } from "./feed";
import { follow, isFollowing, unfollow } from "./follows";
import { pickerGroups } from "./picker";
import { photoUploadFrom, uploadPhoto } from "./photos";
import { prefillAt } from "./prefill";
import { otherProfile, ownProfile } from "./profiles";
import { unitsFor } from "./units";
import { toggleUsefulReaction } from "./reactions";
import { searchByDisplayName } from "./search";

export const attachKitAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => attachKitInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const entryId = await attachKit({ userId, runId: data.runId, itemIds: data.itemIds });
    return { entryId };
  });

export const pickerGroupsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => pickerGroupsInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const conditions = await conditionsAt(
      data.lat,
      data.lng,
      Math.floor(Date.now() / 1000),
    );
    return pickerGroups(userId, conditions);
  });

export const prefillQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => coordinatesInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return prefillAt(userId, data.lat, data.lng, Math.floor(Date.now() / 1000));
  });

// ---- The verdict (A3) -------------------------------------------------------

export const submitVerdictAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => submitVerdictInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await submitVerdict({ userId, ...data });
  });

export const verdictBandCountsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => bandCountsInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return verdictBandCounts(userId, data.bandFloorC, data.excludeEntryId);
  });

export const itemBandWearStatQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => itemBandStatInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return itemBandWearStat(userId, data.itemId, data.bandFloorC);
  });

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
    return entryDetailForViewer(data.entryId, viewerId);
  });

// ---- Useful reactions (D-11) -------------------------------------------------

export const toggleUsefulAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => entryIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return toggleUsefulReaction(data.entryId, userId);
  });

// ---- Follows ------------------------------------------------------------------

export const followAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => userIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await follow(userId, data.userId);
  });

export const unfollowAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => userIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await unfollow(userId, data.userId);
  });

export const followStatusQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => userIdInput.parse(input))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return isFollowing(userId, data.userId);
  });

// ---- Following feed (E1) -----------------------------------------------------

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
    return consensusAt(data.lat, data.lng, Math.floor(Date.now() / 1000));
  });

// ---- Units (D-6) --------------------------------------------------------------

/**
 * The viewer's own units, for the screens that render measured values.
 *
 * `optionalUserId` rather than `requireUserId`: a signed-out viewer still
 * renders numbers, and gets the defaults. Refusing here would make the
 * unit preference an auth gate on the feed.
 */
export const viewerUnitsQuery = createServerFn({ method: "GET" }).handler(
  async () => unitsFor(drizzle(env.DIALED_CORE), await optionalUserId()),
);

// ---- Profiles (G/H) -----------------------------------------------------------

export const ownProfileQuery = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return ownProfile(userId);
});

export const otherProfileQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => userIdInput.parse(input))
  .handler(async ({ data }) => otherProfile(data.userId));

// ---- Username search ------------------------------------------------------------

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
export const uploadPhotoAction = createServerFn({ method: "POST" })
  .validator(photoUploadFrom)
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
