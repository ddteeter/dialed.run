/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps this module's other files loadable in the vitest
 * workers pool with no TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { optionalUserId, requireUserId } from "../auth";
import { nameItem } from "../closet";
import { coverageLadder } from "../feed";
import { climateNormals } from "../weather";
import { citySearchInput, searchCities } from "./cities";
import {
  brandPrefixInput,
  calibrationInput,
  nameGarmentInput,
  sharingInput,
  unitsInput,
} from "./inputs";
import { ladderFrom } from "./ladder";
import {
  completeOnboarding,
  currentSettings,
  requiresOnboarding,
  saveCalibration,
  savePreferences,
} from "./profile";
import { namedResult, namingOffer, namingSuggestions } from "./naming";
import { starterList } from "./starter-list";
import { unitsFromLocale } from "./units-from-locale";

function db() {
  return drizzle(env.DIALED_CORE);
}

export const callLadderQuery = createServerFn({ method: "GET" }).handler(
  async () => ladderFrom(await coverageLadder(await requireUserId())),
);

export const localeUnitsQuery = createServerFn({ method: "GET" }).handler(() =>
  unitsFromLocale(getRequestHeaders().get("accept-language")),
);

export const saveCalibrationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => calibrationInput.parse(data))
  .handler(async ({ data }) =>
    saveCalibration(db(), await requireUserId(), data),
  );

export const starterListQuery = createServerFn({ method: "GET" }).handler(
  async () => starterList(db(), await requireUserId(), climateNormals),
);

export const completeOnboardingFn = createServerFn({ method: "POST" }).handler(
  async () => completeOnboarding(db(), await requireUserId()),
);

export const settingsQuery = createServerFn({ method: "GET" }).handler(
  async () => currentSettings(db(), await requireUserId()),
);

/**
 * What every settings sub-page loader needs: the current settings and the
 * bell's unread count, resolved together. Takes the unread-count promise
 * already in flight, rather than importing modules/notifications' functions
 * here — this file is onboarding's own server-fn glue, and reaching into
 * another module's `functions.ts` would be the deep-import
 * `no-cross-module-deep-imports` forbids. The two settings sub-page routes
 * (units, sharing) call this instead of each hand-rolling the same
 * `Promise.all`.
 */
export async function settingsSubPageData(
  unreadCount: Promise<number>,
): Promise<{
  current: Awaited<ReturnType<typeof settingsQuery>>;
  unreadCount: number;
}> {
  const [current, resolvedUnreadCount] = await Promise.all([
    settingsQuery(),
    unreadCount,
  ]);
  return { current, unreadCount: resolvedUnreadCount };
}

export const saveUnitsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => unitsInput.parse(data))
  .handler(async ({ data }) =>
    savePreferences(db(), await requireUserId(), data),
  );

export const saveSharingFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => sharingInput.parse(data))
  .handler(async ({ data }) =>
    savePreferences(db(), await requireUserId(), data),
  );

export const searchCitiesQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => citySearchInput.parse(data))
  .handler(async ({ data }) => {
    await requireUserId();
    return searchCities(data.query);
  });

export const onboardingGateQuery = createServerFn({ method: "GET" }).handler(
  async () => requiresOnboarding(db(), await optionalUserId()),
);

export const namingOfferQuery = createServerFn({ method: "GET" }).handler(
  async () => namingOffer(db(), await requireUserId()),
);

export const nameGarmentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => nameGarmentInput.parse(data))
  .handler(async ({ data }) =>
    namedResult(await nameItem(db(), await requireUserId(), data.itemId, data)),
  );

export const namingSuggestionsQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => brandPrefixInput.parse(data))
  .handler(async ({ data }) => namingSuggestions(db(), data.brand));
