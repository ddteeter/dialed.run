import { Toucan } from "toucan-js";

import { env } from "../../env";

/**
 * The reporting decision, with the DSN handed in rather than read.
 *
 * Split out because both halves matter and only one is reachable through
 * `captureException`: `SENTRY_DSN` comes from the Worker's bindings, which
 * a test cannot change from inside the isolate, so the Toucan path could
 * never be exercised through the env-reading shell. With the DSN as a
 * parameter, "an unset DSN must never fail the app" and "a set DSN
 * actually sends" are both testable.
 */
export function reportException(
  dsn: string | undefined,
  error: unknown,
  context: Record<string, string>,
): void {
  // An unset secret arrives as an empty string as often as it does
  // undefined, and an empty DSN makes Toucan throw on construction — which
  // would turn a missing reporter into a crash in the error path.
  if (dsn === undefined || dsn === "") {
    console.error("[sentry-disabled]", context, error);
    return;
  }
  const sentry = new Toucan({ dsn });
  sentry.setContext("dialed", context);
  sentry.captureException(error);
}

/**
 * Error reporting (CLAUDE.md law 7): context enough to act on, never
 * tokens, file contents, or request bodies. No-op locally when
 * SENTRY_DSN is unset — a missing reporter must never fail the app.
 */
export function captureException(
  error: unknown,
  context: Record<string, string>,
): void {
  reportException(env.SENTRY_DSN, error, context);
}
