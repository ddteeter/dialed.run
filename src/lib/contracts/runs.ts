/**
 * Runs — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

import { latitudeSchema, longitudeSchema } from "./garments";

// ---- Runs -----------------------------------------------------------------

export const runSources = ["manual", "file"] as const;
export const effortSchema = z.enum(["easy", "steady", "workout", "race"]);
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
});
export type RunDraft = z.infer<typeof runDraftSchema>;

/**
Every import path (file parser now; Polar/Fitbit later) produces this.
*/
export interface RunSource {
  readonly kind: "fit" | "gpx" | "tcx";
  parse(bytes: ArrayBuffer): Promise<RunDraft>;
}
