import { z } from "zod";

import { wireErrorAdapter } from "./wire-error";

/**
 * A refusal a control's band says in the server's own words, kept whole
 * across a server function's response, as `lib/field-refusal` does for a
 * form's field. Start serializes a thrown `Error` as its message alone,
 * so a refusal like "This kit is held while a copyright claim is settled"
 * (SA-L09) would otherwise read as "Our end failed". Only an error that
 * carries this code goes this way, and it carries nothing but its
 * sentence; `ui/use-form-submit`'s `classifyFailure` reads it.
 */
export const CONTROL_REFUSAL_CODE = "CONTROL_REFUSAL";

const controlRefusalSchema = z.object({
  code: z.literal(CONTROL_REFUSAL_CODE),
  message: z.string(),
});

/**
A refusal whose sentence the runner reads as the band's cause line.
*/
export class ControlRefusal extends Error {
  readonly code = CONTROL_REFUSAL_CODE;
}

/**
 * The sentence of a control refusal, on either side of the wire, or
 * `undefined` for any other error.
 */
export function controlRefusalMessage(error: unknown): string | undefined {
  const parsed = controlRefusalSchema.safeParse(error);
  return parsed.success ? parsed.data.message : undefined;
}

/**
 * The serialization adapter's options for a control refusal
 * (`lib/wire-error`; `src/start.ts` registers it).
 */
export const controlRefusalAdapter = wireErrorAdapter(
  "control-refusal",
  controlRefusalSchema,
);
