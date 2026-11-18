/**
 * Where a place a runner typed is — E2-lite's recovery when location is
 * refused (round 22; owner's ruling of 2026-09-24). The provider geocodes
 * the label; nothing else in the app reads a typed place as coordinates.
 *
 * Not cached, for `normals.ts`'s reason: it runs once, when a runner saves
 * a city, and a cache would be a table for one lookup per account.
 */
import type { ResolvedPlace } from "../../lib/contracts";
import type { SpendWeatherCall } from "./budget";
import { runnerWeatherBudget } from "./budget";
import { weatherProvider } from "./provider";

export async function resolvePlace(
  label: string,
  spend: SpendWeatherCall,
): Promise<ResolvedPlace | undefined> {
  await spend();
  return weatherProvider().resolvePlace(label);
}

/**
A runner's lookup, counted against their day's budget (SA-M13).
*/
export function resolvePlaceFor(
  userId: string,
): (label: string) => Promise<ResolvedPlace | undefined> {
  const spend = runnerWeatherBudget(userId);
  return (label) => resolvePlace(label, spend);
}
