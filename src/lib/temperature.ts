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

export type PrecipClass = "dry" | "damp" | "wet";

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
export function bandLabel(bandFloor: number, unit: "f" | "c"): string {
  return unit === "c"
    ? `${String(bandFloor)}–${String(bandFloor + 5)}°`
    : `${String(cToF(bandFloor))}–${String(cToF(bandFloor + 5))}°`;
}

export function formatTemp(tempC: number, unit: "f" | "c"): string {
  return unit === "c"
    ? `${String(Math.round(tempC))}°`
    : `${String(cToF(tempC))}°`;
}
