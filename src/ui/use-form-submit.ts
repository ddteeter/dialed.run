import { useCallback, useRef, useState } from "react";
import { z } from "zod";

import { isAuthRequired } from "../lib/auth-signal";
import { DURATION } from "./motion";

/**
 * The submit half of the Forms & failure contract (docs/product.md).
 *
 * Ported from `design/src/ui/FormField.tsx`. Two differences from the
 * reference, both forced by this codebase rather than chosen:
 *
 * 1. **`action` returns its result and throws on failure**, instead of the
 *    reference's `ActionResult<T>` union. Our server functions are
 *    `createServerFn().validator(schema.parse)`, so a bad input rejects —
 *    there is no result shape to inspect. Making forty server functions
 *    return a union to satisfy the primitive would be the tail wagging the
 *    dog; the primitive absorbs the throw instead.
 * 2. **A thrown zod error is detected structurally, never with
 *    `instanceof`.** A rejection from a server function crosses a
 *    structured clone, so the class identity is gone by the time it
 *    arrives: `error instanceof ZodError` is false for a real ZodError
 *    thrown on the server. Same reason `modules/auth` detects its own error
 *    by `code`.
 *
 * Everything else is the contract as written: one live region, one sentence
 * per outcome, announce-then-move, errors clear on input, and the
 * double-submit guard lives here rather than on a `disabled` attribute.
 */

/**
Field name -> the one sentence to show under it.
*/
export type FieldErrors = Record<string, string>;

export interface FormFailure {
  kind: "network" | "server" | "session";
  message: string;
}

/**
 * What `field(name)` returns — spread onto a control. Named so components
 * can accept it without restating five attribute types.
 */
export interface FieldProps {
  name: string;
  readOnly: boolean;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  onInput: () => void;
}

export interface SummaryRow {
  name: string;
  label: string;
  message: string;
}

/**
First issue per field. A field shows one message, never a stack.
*/
function toFieldErrors(issues: readonly FieldIssue[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (key !== "" && out[key] === undefined) out[key] = issue.message;
  }
  return out;
}

/**
 * The shape of a zod issue, re-declared and *parsed* rather than cast.
 *
 * A rejection from a server function has crossed a structured clone, so it
 * is a plain object with no prototype and no class identity — `instanceof
 * ZodError` is false for a real one. Asserting `as ZodIssue[]` over
 * something that arrived from the wire is the structural cast the diff
 * auditor exists to reject, and it would be wrong here anyway: nothing
 * guarantees the far side sent issues in that shape.
 */
const pathSegmentSchema = z.union([z.string(), z.number(), z.symbol()]);
const fieldIssueSchema = z.object({
  path: z.array(pathSegmentSchema),
  message: z.string(),
});
type FieldIssue = z.infer<typeof fieldIssueSchema>;
const issueListSchema = z.array(fieldIssueSchema);

function zodIssuesOf(error: unknown): readonly FieldIssue[] | undefined {
  if (typeof error !== "object" || error === null || !("issues" in error)) {
    return undefined;
  }
  const parsed = issueListSchema.safeParse(error.issues);
  return parsed.success ? parsed.data : undefined;
}

/**
 * What the user is told, in their terms — never the upstream message.
 *
 * Copy rules (§6): one sentence, under ten words, sentence case, no
 * "please", no "error", no exclamation.
 */
/**
 * Exported because a *non-form* action needs the same classification.
 * "Mark all read" is not a form and has no schema, but a D1 failure there
 * should read exactly as it does under a submit button — a second
 * hand-written sentence would be the drift `docs/product.md` §Forms &
 * failure exists to stop, one layer down.
 */
export function classifyFailure(error: unknown): FormFailure {
  // Session is decided by a code, not by the message text. The reference
  // matched /401|403|session|unauthenticated/ against a string, which
  // stops working the day an upstream reworded something and does so
  // silently — and this is the one branch with real consequences, since
  // the contract routes an expired session to sign-in carrying the pending
  // payload rather than leaving the user on a dead form.
  if (isAuthRequired(error)) {
    return { kind: "session", message: "You were signed out." };
  }
  // `fetch` rejects with a TypeError, and it rejects *here* — client-side,
  // never having crossed a structured clone — so the prototype is intact
  // and `instanceof` is safe in a way it is not for a server rejection.
  if (error instanceof TypeError || !navigator.onLine) {
    return { kind: "network", message: "Your connection dropped." };
  }
  return { kind: "server", message: "Our end failed. Nothing changed." };
}

/**
 * A macrotask's grace, so a `setStatus` has been committed before anything
 * is allowed to unmount what it filled.
 *
 * The contract's rule is *announce, then move* (§1). `onSuccess` almost
 * always navigates, and navigation unmounts the `role="status"` region —
 * so without this the success sentence was set and destroyed inside one
 * commit and no screen reader could read it. Recorded as D-44; every form
 * in the app that navigates on success had the shape, which is why the
 * wait lives in the hook and not in any of them.
 *
 * `DURATION.instant` because the failure path below already defers its
 * focus move by exactly this, for exactly this reason.
 */
function announced(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, DURATION.instant);
  });
}

export interface UseFormSubmitOptions<TSchema extends z.ZodType, TResult> {
  /**
   * The same schema object the server function validates with. Not a copy
   * of its rules — the contract's "one schema, run twice" is the whole
   * reason a client pre-check is allowed at all.
   */
  schema: TSchema;
  action: (values: z.output<TSchema>) => Promise<TResult>;
  onSuccess?: (data: TResult) => void | Promise<void>;
  /**
  The live-region sentence on success, e.g. "Run logged."
  */
  successMessage: string;
  /**
  Field name -> human label, for the summary rows.
  */
  labels?: Record<string, string>;
}

export function useFormSubmit<TSchema extends z.ZodType, TResult>({
  schema,
  action,
  onSuccess,
  successMessage,
  labels,
}: UseFormSubmitOptions<TSchema, TResult>) {
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<FormFailure | undefined>();
  const [status, setStatus] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const lastValues = useRef<unknown>(undefined);

  const focusField = useCallback((name: string) => {
    formRef.current
      ?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)
      ?.focus({ preventScroll: false });
  }, []);

  /**
  Announce, then move. Never move without announcing.
  */
  const land = useCallback(
    (errors: FieldErrors) => {
      const names = Object.keys(errors);
      setFieldErrors(errors);
      setFailure(undefined);
      setStatus(
        names.length === 1
          ? "Nothing saved. One field needs a fix."
          : `Nothing saved. ${String(names.length)} fields need a fix.`,
      );
      // One error focuses its field; two or more focus the summary, which
      // is the only thing that lists them all.
      const only = names.length === 1 ? names[0] : undefined;
      globalThis.setTimeout(() => {
        if (only === undefined) summaryRef.current?.focus();
        else focusField(only);
      }, DURATION.instant);
    },
    [focusField],
  );

  const submit = useCallback(
    async (values: unknown) => {
      // Double-submit dies here, not on a `disabled` attribute — a disabled
      // button drops focus and stops announcing (§5).
      if (inFlight.current) return;
      inFlight.current = true;
      lastValues.current = values;
      setFailure(undefined);
      setStatus("");

      // Courtesy pre-check, on submit only. The server check always runs;
      // this saves a round trip and is not a live critic.
      const pre = schema.safeParse(values);
      if (!pre.success) {
        inFlight.current = false;
        land(toFieldErrors(pre.error.issues));
        return;
      }

      setPending(true);
      try {
        const result = await action(pre.data);
        setFieldErrors({});
        setStatus(successMessage);
        // The submission is over at this point, and the guard is
        // per-submission rather than a latch — so release it before the
        // announce-and-move below, which is aftermath rather than part of
        // the attempt. Leaving it held made a resubmit land inside the
        // grace period and be silently dropped.
        setPending(false);
        inFlight.current = false;
        // Announce, then move — see `announced` above (D-44).
        await announced();
        await onSuccess?.(result);
      } catch (error: unknown) {
        const issues = zodIssuesOf(error);
        if (issues === undefined) {
          const classified = classifyFailure(error);
          setFieldErrors({});
          setFailure(classified);
          setStatus(`Nothing saved. ${classified.message}`);
          globalThis.setTimeout(() => {
            retryRef.current?.focus();
          }, DURATION.instant);
        } else {
          land(toFieldErrors(issues));
        }
      } finally {
        setPending(false);
        inFlight.current = false;
      }
    },
    [schema, action, onSuccess, successMessage, land],
  );

  /**
  Clears on input, never on blur, and never re-validates while typing.
  */
  const clearField = useCallback((name: string) => {
    setFieldErrors((previous) => {
      if (previous[name] === undefined) return previous;
      return Object.fromEntries(
        Object.entries(previous).filter(([key]) => key !== name),
      );
    });
  }, []);

  /**
  Spread onto the control: invalid state, description, and readOnly.
  */
  const field = useCallback(
    (name: string): FieldProps => ({
      name,
      readOnly: pending,
      "aria-invalid": fieldErrors[name] === undefined ? undefined : true,
      "aria-describedby":
        fieldErrors[name] === undefined ? undefined : `${name}-message`,
      onInput: () => {
        clearField(name);
      },
    }),
    [pending, fieldErrors, clearField],
  );

  const summaryRows: SummaryRow[] = Object.entries(fieldErrors).map(
    ([name, message]) => ({ name, label: labels?.[name] ?? name, message }),
  );

  return {
    formRef,
    submit,
    pending,
    fieldErrors,
    failure,
    status,
    summaryRows,
    summaryRef,
    retryRef,
    field,
    focusField,
    retry: () => {
      if (lastValues.current !== undefined) void submit(lastValues.current);
    },
  };
}
