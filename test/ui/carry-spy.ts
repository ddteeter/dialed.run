import type { z } from "zod";

import type * as FormSubmit from "../../src/ui/use-form-submit";

/**
 * Which noun each form hands `useFormSubmit` as its Au7 carry (D-155),
 * recorded as the forms render.
 *
 * What the carry *does* — a lapsed save goes to log-in under that noun —
 * is `test/ui/session-lapse.dom.test.tsx`'s. A form's own test only needs
 * to see which noun the form chose, and the real hook still runs, so
 * nothing else about the form changes. A test file opts in with:
 *
 * ```ts
 * vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
 *   const { spyOnCarry } = await import("../ui/carry-spy");
 *   return spyOnCarry(await importOriginal());
 * });
 * ```
 */
const carries: unknown[] = [];

export function spyOnCarry(actual: typeof FormSubmit): typeof FormSubmit {
  function useFormSubmit<TSchema extends z.ZodType, TResult>(
    options: FormSubmit.UseFormSubmitOptions<TSchema, TResult>,
  ) {
    carries.push(options.carry);
    return actual.useFormSubmit(options);
  }
  return { ...actual, useFormSubmit };
}

/**
 * Every distinct noun the forms rendered since the last call, and forget
 * them: a form that renders twice carries once.
 */
export function carriedSince(): unknown[] {
  const seen = [...new Set(carries)];
  carries.length = 0;
  return seen;
}
