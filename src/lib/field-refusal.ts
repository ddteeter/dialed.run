import { z } from "zod";

import { wireErrorAdapter } from "./wire-error";

/**
 * A refusal that names a field, kept whole across a server function's
 * response (R-176, design 171).
 *
 * TanStack Start serializes a thrown `Error` as its message alone
 * (`src/start.ts`), so a server-side refusal that carried
 * `{ issues: [{ path, message }] }` for `useFormSubmit` to land on a field
 * arrived as a bare `Error` and read as "Our end failed". A denied product
 * link at F's save did exactly that. An `Error` with this code goes over
 * the wire as its code, its sentence and its issues, and comes back as an
 * `Error` carrying them, which `useFormSubmit` already reads.
 *
 * The code is the opt-in: only an error that says it is a field refusal
 * is sent this way. Anything else keeps the framework's message-only
 * treatment, so nothing a server happens to attach to an error crosses.
 */
export const FIELD_REFUSAL_CODE = "FIELD_REFUSAL";

const fieldIssueSchema = z.object({
  path: z.array(z.string()),
  message: z.string(),
});

const fieldRefusalSchema = z.object({
  code: z.literal(FIELD_REFUSAL_CODE),
  message: z.string(),
  issues: z.array(fieldIssueSchema),
});

/**
What a field refusal is on the wire: its code, sentence and issues.
*/
export type FieldRefusalOnTheWire = z.infer<typeof fieldRefusalSchema>;

/**
 * The serialization adapter's options for a field refusal
 * (`lib/wire-error`; `src/start.ts` registers it).
 */
export const fieldRefusalAdapter = wireErrorAdapter(
  "field-refusal",
  fieldRefusalSchema,
);
