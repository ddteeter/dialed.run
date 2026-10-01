/**
 * Onboarding / profile — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

// ---- Onboarding / profile -------------------------------------------------

/** UI: +2 "always freezing" … −2 "sweating in a t-shirt at 40°".
 *  Degree mapping (code, not DB): level × 2.2 °C. */
export const thermalLevelSchema = z
  .number({
    // Error copy lives in the schema (§Forms & failure), and this one is
    // load-bearing: O1 submits `Number(undefined)` when nobody has picked,
    // so without a message a runner who taps straight past the question is
    // told "expected number, received nan".
    message: "Pick the one that sounds most like you.",
  })
  .int()
  .min(-2)
  .max(2);

/**
 * The five answers to O1's one question, in the order they are shown.
 *
 * Shaped like `verdictScale` and here for the same reason: the mapping was
 * a *comment* on the schema above, so onboarding and settings-recalibrate
 * would each have restated it, and a comment cannot be pinned by a test.
 *
 * **Positive means runs cold.** +2 is "Always freezing" — someone who needs
 * more clothes than the table suggests — and −2 is the person sweating in a
 * t-shirt at 40°. That reads backwards to about half of people on first
 * encounter, which is exactly why it is written once.
 *
 * Copy is the design's own (`design/Onboarding.dc.html`, O1).
 */
/**
 * What one step of the thermal scale is worth, in °C.
 *
 * It was a *comment* on `thermalLevelSchema` — "Degree mapping (code, not
 * DB): level × 2.2 °C" — and nothing implemented it, so O1 could not show
 * the offset its own design copy promises ("The offset is visible on
 * purpose. You'll see it change as we learn."). A number described in prose
 * and used nowhere is the shape a wrong number hides in.
 */
export const THERMAL_LEVEL_C = 2.2;

/**
 * The offset a thermal level implies, in the unit asked for.
 *
 * **A temperature *difference*, so Fahrenheit is ×9/5 and never +32.** That
 * is the whole reason this is a function and not two call sites: converting
 * a delta with the absolute formula is a classic bug, and it would be an
 * invisible one here — +8° would read as +40°, which is not obviously
 * absurd on a screen that is talking about how warm someone runs.
 *
 * Rounded to whole degrees, which is what the artboard shows: +8°, +4°, 0°,
 * −4°, −8° in Fahrenheit. The precision is not real — 2.2°C per step is
 * itself a round number — and a runner is being told roughly how much more
 * clothing they need, not a measurement.
 */
export function thermalOffset(level: number, unit: TempUnit): number {
  const celsius = level * THERMAL_LEVEL_C;
  return Math.round(unit === "f" ? celsius * 1.8 : celsius);
}

/**
 * The offset as O1 and settings print it: `+8°`, `0°`, `−8°`.
 *
 * Here rather than in either screen because it was in *both* — O1 draws it
 * beside each answer and settings states the saved one, and the second
 * copy arrived four hours after the first. A formatter for a measured
 * value is exactly the "rival truth" §Derive, don't mirror is about: two
 * copies drift on the sign, the degree symbol, or the minus character, and
 * nothing makes them disagree loudly.
 *
 * **U+2212, not a hyphen.** These render in mono as a measured value, and
 * a hyphen sits at the wrong height and width there. No `+` on zero: `+0°`
 * reads as a direction when the answer is that there is none.
 */
export function thermalOffsetLabel(level: number, unit: TempUnit): string {
  const degrees = thermalOffset(level, unit);
  const sign = degrees > 0 ? "+" : "";
  return `${sign}${String(degrees).replace("-", "\u{2212}")}°`;
}

export const thermalScale = [
  { value: 2, token: "always_freezing", label: "Always freezing" },
  { value: 1, token: "little_cold", label: "Run a little cold" },
  { value: 0, token: "average", label: "About average" },
  { value: -1, token: "little_warm", label: "Run a little warm" },
  { value: -2, token: "sweating_at_40", label: "Sweating in a t-shirt at 40°" },
] as const;
export type ThermalLevel = (typeof thermalScale)[number]["value"];

/**
 * The units a person reads their own data in — display only. The contract
 * stores SI regardless: `temp_c`, `distance_m`.
 *
 * One `z.enum` each, because these were two independent lists: a bare
 * `"f" | "c"` union in `lib/contracts/temperature.ts` and a column enum in
 * `db/schema-core.ts`, with nothing making them agree (D-7). A validator, a
 * type and the stored vocabulary are one fact, so they get one statement —
 * the type comes off the schema via `z.infer`, and `unit-contract.test.ts`
 * pins both against the columns so a value added to one has to be added to
 * the other.
 */
export const tempUnitSchema = z.enum(["f", "c"]);
export type TempUnit = z.infer<typeof tempUnitSchema>;

export const distanceUnitSchema = z.enum(["mi", "km"]);
export type DistanceUnit = z.infer<typeof distanceUnitSchema>;

/**
 * What the app shows when a person has not chosen. Fahrenheit and miles
 * because the owner is US-based and the calibration tables are authored in
 * Fahrenheit (see `lib/thermal.ts`); 105 replaces this with a locale guess
 * at onboarding, and this stays the fallback for a profile that predates
 * the question.
 */
export interface Units {
  temp: TempUnit;
  distance: DistanceUnit;
}

export const defaultUnits: Readonly<Units> = { temp: "f", distance: "mi" };
export const CALL_VERDICT_THRESHOLD = 15;

/**
 * How many verdicts in one 5°C band before the ladder calls it covered.
 *
 * Derived from `CALL_VERDICT_THRESHOLD` rather than picked: 15 verdicts
 * spread across the five bands a runner's year typically spans is three
 * each, so three is what "covered" means for a band. Two or one is
 * partial; none is unknown (O6: "pink bands are covered, teal is partial,
 * grey is unknown").
 *
 * A threshold the owner may want to move — it decides how fast the ladder
 * looks finished, which is the screen's whole emotional job.
 */
export const BAND_COVERED_VERDICTS = 3;

/**
 * What O3 sends back: the keys a runner tapped.
 *
 * **Here rather than in `closet/tap-list.ts`, and that is the documented
 * escape hatch rather than a preference.** The form needs the *same schema
 * object* the server validates with — that is what "one schema, run twice"
 * means — and a component cannot import `modules/closet`'s barrel: the
 * barrel re-exports `./service`, which pulls `db/schema`, and a route that
 * imports it ships 23kB of drizzle to the browser without failing anything
 * (CLAUDE.md, the client-bundle rule). Deep-importing the one pure file is
 * a boundary violation. So the shared contract moves to `lib/`, which is
 * exactly what "move the shared constants to lib/ where both sides can
 * import them" says to do.
 *
 * No upper bound on the array. It used to carry `.max(TAP_LIST.length)`,
 * which looked like a guard and was not one: the length that matters is
 * the number of *distinct known* keys, and `addFromTapList` now dedupes and
 * skips unknowns, so a padded payload creates nothing either way. Keeping
 * the bound here would also have meant keeping this file's knowledge of how
 * long that table is, which is the coupling the move exists to remove.
 */
export const tapListSelectionSchema = z.object({
  // The message is what a zero-tap "Next" says, and it names the way out:
  // O3 is skippable, and design's rule is that Next is live from the first
  // tap. A `disabled` button is how that is usually drawn and is forbidden
  // by §Forms & failure — it drops focus and announces nothing — so the
  // sentence does the job the grey button was drawn to do, out loud.
  keys: z
    .array(z.string())
    .min(1, { message: "Tap what you own, or skip for now." }),
});
export type TapListSelection = z.infer<typeof tapListSelectionSchema>;
