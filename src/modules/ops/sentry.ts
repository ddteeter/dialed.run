import { Toucan } from "toucan-js";

import { env } from "../../env";

/**
 * Error reporting (CLAUDE.md law 7): context enough to act on, never
 * tokens, file contents, or request bodies. No-op locally when
 * SENTRY_DSN is unset — a missing reporter must never fail the app.
 */
export function captureException(
  error: unknown,
  context: Record<string, string>,
): void {
  const dsn = env.SENTRY_DSN;
  if (dsn === undefined || dsn === "") {
    console.error("[sentry-disabled]", context, error);
    return;
  }
  const sentry = new Toucan({ dsn });
  sentry.setContext("dialed", context);
  sentry.captureException(error);
}
