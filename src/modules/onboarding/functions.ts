/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps this module's other files loadable in the vitest
 * workers pool with no TanStack virtual entries.
 */
import type { BellState } from "../notifications";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { coreDb, waitUntil } from "../../env";
import { cityLookupInput } from "../../lib/contracts/city-lookup";
import { optionalUserId, requireUserId, verifiedUserId } from "../auth";
import { nameItem } from "../closet";
import { coverageLadder } from "../feed";
import { captureException, purgePublicPages } from "../ops";
import { climateNormals, resolvePlace, timeZoneAt } from "../weather";
import { countsInTotals, setCountInTotals } from "./aggregate-prefs";
import {
  brandPrefixInput,
  calibrationInput,
  countInTotalsInput,
  nameGarmentInput,
  publicProfileInput,
  sharingInput,
  unitsInput,
} from "./inputs";
import { ladderFrom } from "./ladder";
import { lookUpCity } from "./place";
import {
  completeOnboarding,
  currentSettings,
  requiresOnboarding,
  saveCalibration,
  savePreferences,
} from "./profile";
import { saveSharing, setPublicProfile } from "./public-profile";
import { namedResult, namingOffer, namingSuggestions } from "./naming";
import { starterList } from "./starter-list";
import { unitsFromLocale } from "./units-from-locale";

function db() {
  return coreDb();
}

/**
The place writer's zone lookup, where its failures go, and what keeps the
Worker alive while it finishes after the answer (design 142).
*/
const zones = {
  zoneAt: timeZoneAt,
  report: captureException,
  keepAlive: waitUntil,
};

export const callLadderQuery = createServerFn({ method: "GET" }).handler(
  async () => ladderFrom(await coverageLadder(await requireUserId())),
);

export const localeUnitsQuery = createServerFn({ method: "GET" }).handler(() =>
  unitsFromLocale(getRequestHeaders().get("accept-language")),
);

export const saveCalibrationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => calibrationInput.parse(data))
  .handler(async ({ data }) =>
    saveCalibration(db(), await requireUserId(), data, zones),
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
 * bell's state, resolved together. Takes the bell's promise already in
 * flight, rather than importing modules/notifications' functions
 * here — this file is onboarding's own server-fn glue, and reaching into
 * another module's `functions.ts` would be the deep-import
 * `no-cross-module-deep-imports` forbids. The two settings sub-page routes
 * (units, sharing) call this instead of each hand-rolling the same
 * `Promise.all`.
 */
export async function settingsSubPageData(bell: Promise<BellState>): Promise<{
  current: Awaited<ReturnType<typeof settingsQuery>>;
  bell: BellState;
}> {
  const [current, resolvedBell] = await Promise.all([settingsQuery(), bell]);
  return { current, bell: resolvedBell };
}

export const saveUnitsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => unitsInput.parse(data))
  .handler(async ({ data }) =>
    savePreferences(db(), await requireUserId(), data),
  );

/**
 * Settings › Privacy's NEW RUNS. A PUBLIC default is refused unless the
 * runner's profile is public (D-150), in the write itself (`saveSharing`).
 * Unconfirmed runners may save, since a default is seen by nobody and
 * their entries start private whatever it says (D-50).
 */
export const saveSharingFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => sharingInput.parse(data))
  .handler(async ({ data }) => saveSharing(db(), await requireUserId(), data));

/**
 * Settings › Privacy's PUBLIC PROFILE switches (round 41 #86b), saved as
 * they are switched. A public profile is seen by anyone, so it waits for
 * a confirmed address (D-113), and the refusal opens "Confirm your email
 * first". A confirmed address is never lost, so nobody is left unable to
 * turn one off.
 */
export const setPublicProfileFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => publicProfileInput.parse(data))
  .handler(async ({ data }) =>
    setPublicProfile(db(), await verifiedUserId(), data, purgePublicPages),
  );

/**
 * The runner's own totals setting alone, for A3's private line: the
 * verdict page needs nothing else of the settings.
 */
export const countInTotalsQuery = createServerFn({ method: "GET" }).handler(
  async () => countsInTotals(db(), await requireUserId()),
);

/**
 * Settings › Sharing's "Count my runs in anonymous totals" (D-108 D),
 * saved on toggle. Unconfirmed runners too (owner, 2026-10-11): it is the
 * runner's own privacy choice, nobody else sees it, and opting out must
 * never wait behind the confirm sheet.
 */
export const setCountInTotalsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => countInTotalsInput.parse(data))
  .handler(async ({ data }) =>
    setCountInTotals(db(), await requireUserId(), data),
  );

/**
 * Find (round 26 #12): resolves a typed city once, when the runner presses
 * Find — never per keystroke — through Visual Crossing's `resolvePlace`
 * (FEED-2). Saves nothing. O1's city step and Your conditions both call
 * it; what Use this then does is theirs. A POST because it can reach a
 * billed upstream.
 */
export const lookUpCityFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => cityLookupInput.parse(data))
  .handler(async ({ data }) =>
    lookUpCity({
      label: data.label,
      resolver: resolvePlace,
      report: captureException,
      userId: await requireUserId(),
    }),
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
    namedResult(await nameItem(db(), await requireUserId(), data.itemId, data)),
  );

export const namingSuggestionsQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => brandPrefixInput.parse(data))
  .handler(async ({ data }) => {
    // Other runners' brand and product names: signed-in only (D-58, F1).
    await requireUserId();
    return namingSuggestions(db(), data.brand);
  });
