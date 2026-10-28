/**
 * Runs — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

import { latitudeSchema, longitudeSchema } from "./garments";

// ---- Runs -----------------------------------------------------------------

// `garmin`: imported through Garmin's API (plan 160), which is what earns
// the attribution line (G1). A file the runner uploads themselves is
// `file`, whatever device wrote it.
export const runSources = ["manual", "file", "garmin"] as const;
export const effortSchema = z.enum(["easy", "steady", "workout", "race"]);
// Who picked `runs.effort` (design G5): the watch's own perceived-effort
// rating, until the runner taps a chip on A3, after which it is theirs.
export const effortSources = ["watch", "runner"] as const;
// The 1–10 perceived-effort rating a watch asks for after a run. FIT
// stores it ×10 (`session.workout_rpe`); this is the rating itself.
export const rpeSchema = z.number().int().min(1).max(10);
export const runDraftSchema = z.object({
  // Messages are here, not in the form (§Forms & failure, "Error copy lives
  // in the schema"). They name the fix, not the rule: the manual-entry form
  // is the only place a human types these, and "Value out of range" tells
  // them nothing about what to do next. A parser filling this in gets the
  // same sentences, which is fine — nothing shows them to anyone.
  startedAt: z.number().int().positive("Pick when the run started."),
  durationS: z.number().int().positive("How many minutes did it take?"),
  distanceM: z.number().positive("How far did you go?"),
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
  indoor: z.boolean().default(false),
  effort: effortSchema.optional(),
  title: z.string().min(1, "Give the run a name.").max(120),
  // Read from an uploaded file only (D-111). `durationS` is elapsed time and
  // keeps running through a pause; `movingS` is the time spent moving. An
  // indoor run and a manual one carry neither, and a file that cannot say
  // leaves them out rather than inventing a zero.
  movingS: z.number().int().positive().optional(),
  elevationGainM: z.number().nonnegative().optional(),
  // Read from an uploaded file only, when the watch asked the runner how
  // hard it was (plan 160). Absent when it did not.
  rpe: rpeSchema.optional(),
});
export type RunDraft = z.infer<typeof runDraftSchema>;
export type Effort = z.infer<typeof effortSchema>;

/**
The effort a watch's rating prefills (design G5, owner 2026-10-24): 1–4
easy, 5–6 steady, 7–8 workout, 9–10 race. Garmin's own `race` event type
is not read: a race can be run at any effort, and this is the runner's
answer to how hard it was.
*/
function effortOfRpe(rpe: number): Effort {
  if (rpe <= 4) return "easy";
  if (rpe <= 6) return "steady";
  if (rpe <= 8) return "workout";
  return "race";
}

/**
The run columns a watch's rating fills: the rating, the effort it
prefills, and that the watch chose it. Nothing when the watch did not ask,
so a run with no rating has no effort until the runner picks one.
*/
export function effortFromWatch(
  rpe: number | undefined,
): { rpe: number; effort: Effort; effortSource: "watch" } | undefined {
  return rpe === undefined
    ? undefined
    : { rpe, effort: effortOfRpe(rpe), effortSource: "watch" };
}

/**
Every import path (file parser now; Polar/Fitbit later) produces this.
*/
export interface RunSource {
  readonly kind: "fit" | "gpx" | "tcx";
  parse(bytes: ArrayBuffer): Promise<RunDraft>;
}
