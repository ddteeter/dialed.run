import { z } from "zod";

/**
 * The input of a server function that takes none (SA-M25, design 230):
 * an empty object, which the caller sends as `{ data: {} }`.
 *
 * A POST function's validator refuses a call that carries no input at
 * all, so a write is only ever made by a call that says it is one.
 * `test/architecture/post-functions-take-input.test.ts` holds every POST
 * function to having a validator.
 */
export const noInput = z.object({});
