/**
 * Messages on the dialed-imports queue (and its DLQ). Queue bodies are a
 * trust boundary: consumers parse with these schemas, never cast.
 */
import { z } from "zod";

const importJobSchema = z.object({
  type: z.literal("import"),
  importId: z.string().min(1),
});
export type ImportJob = z.infer<typeof importJobSchema>;

/**
Strava reminder (D-33): carries the recipient and a dedupe subject only —
never distance, pace, time, or any other activity attribute.
*/
const reminderJobSchema = z.object({
  type: z.literal("strava_reminder"),
  userId: z.string().min(1),
  subjectId: z.string().min(1),
});
export type ReminderJob = z.infer<typeof reminderJobSchema>;

export const importsQueueMessageSchema = z.discriminatedUnion("type", [
  importJobSchema,
  reminderJobSchema,
]);
