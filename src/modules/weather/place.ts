/**
 * Where a place a runner typed is — E2-lite's recovery when location is
 * refused (round 22; owner's ruling of 2026-09-24). The provider geocodes
 * the label; nothing else in the app reads a typed place as coordinates.
 *
 * Not cached, for `normals.ts`'s reason: it runs once, when a runner saves
 * a city, and a cache would be a table for one lookup per account.
 */
import type { ResolvedPlace } from "../../lib/contracts";
import { weatherProvider } from "./provider";

export function resolvePlace(
  label: string,
): Promise<ResolvedPlace | undefined> {
  return weatherProvider().resolvePlace(label);
}
