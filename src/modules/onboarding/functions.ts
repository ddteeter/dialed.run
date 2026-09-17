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
import {
  brandPrefixInput,
  calibrationInput,
  nameGarmentInput,
  preferencesInput,
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

export const savePreferencesFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => preferencesInput.parse(data))
  .handler(async ({ data }) =>
    savePreferences(db(), await requireUserId(), data),
  );

export const onboardingGateQuery = createServerFn({ method: "GET" }).handler(
  async () => requiresOnboarding(db(), await optionalUserId()),
);

export const namingOfferQuery = createServerFn({ method: "GET" }).handler(
  async () => namingOffer(db(), await requireUserId()),
);

export const nameGarmentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => nameGarmentInput.parse(data))
  .handler(async ({ data }) =>
    namedResult(
      await nameItem(db(), await requireUserId(), data.itemId, data),
    ),
  );

export const namingSuggestionsQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => brandPrefixInput.parse(data))
  .handler(async ({ data }) => namingSuggestions(db(), data.brand));
