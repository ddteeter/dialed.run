/**
 * Pure temperature/precipitation classification and display helpers —
 * no D1, no env, no bindings. This split exists specifically so route
 * *components* (which ship to the browser) can use these without pulling
 * in modules/feed/conditions.ts's `env`/drizzle-orm imports into the
 * client bundle: Vite/Rolldown must resolve every static import in a
 * file's module graph before it can tree-shake unused bindings, and
 * `cloudflare:workers` (imported by src/env/index.ts) has no client-side
 * shim, so any client-reachable file that value-imports from a module
 * touching `env` fails the client build outright. `src/lib/` is
 * dependency-cruiser-enforced to never import modules/routes/db/env
 * (docs/architecture.md "foundation-stays-foundation"), so this file is
 * structurally safe to import from a route component.
 */

import type { TempUnit } from "./profile";

/**
The three precipitation classes, wettest last. The copy of a run's conditions stores one (`run_conditions.precip_class`).
*/
export const PRECIP_LEVELS = ["dry", "damp", "wet"] as const;
export type PrecipClass = (typeof PRECIP_LEVELS)[number];

export function precipClassOf(precipMm: number): PrecipClass {
  if (precipMm <= 0.1) return "dry";
  if (precipMm <= 2.5) return "damp";
  return "wet";
}

/**
5 °C coverage bands: floor of the band containing feelsLikeC.
*/
export function bandFloorC(feelsLikeC: number): number {
  return Math.floor(feelsLikeC / 5) * 5;
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

/**
"[38–46°]"-style band text in the user's unit (docs/product.md).
*/
export function bandLabel(bandFloor: number, unit: TempUnit): string {
  return unit === "c"
    ? `${String(bandFloor)}–${String(bandFloor + 5)}°`
    : `${String(cToF(bandFloor))}–${String(cToF(bandFloor + 5))}°`;
}

/**
A temperature as the number a reader sees: whole degrees, in their unit.
*/
export function tempInUnit(tempC: number, unit: TempUnit): number {
  return unit === "c" ? Math.round(tempC) : cToF(tempC);
}

/**
 * The way back, for a number a reader set in their own unit (Closet C's
 * WORKS AT). Celsius to one decimal rather than whole: a whole °C is 1.8°F
 * wide, so rounding to it would move a runner's 34° to 33° or 35°. A tenth
 * is 0.18°F, inside the half-degree `tempInUnit` rounds by, so every whole
 * °F comes back as itself.
 */
export function unitToC(value: number, unit: TempUnit): number {
  const tempC = unit === "c" ? value : ((value - 32) * 5) / 9;
  return Math.round(tempC * 10) / 10;
}

export function formatTemp(tempC: number, unit: TempUnit): string {
  return `${String(tempInUnit(tempC, unit))}°`;
}
