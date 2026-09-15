/**
 * Who may review. One gate, deliberately.
 *
 * CLAUDE.md's worked example is auth: four private copies of the same check
 * became three incompatible error types before anyone noticed. This module
 * adds a second privilege question to the app, so it gets one
 * implementation from the start rather than after the same lesson.
 *
 * **A secret, not a column** (owner's call, 2026-09-15). For a solo
 * operator the list has one entry, and a privilege bit that lives in a
 * deploy is harder to change by accident than one that lives in a row.
 * The cost is honest and stated: adding an admin is a deploy.
 */
import { env } from "../../env";

/**
 * Thrown when a non-admin reaches an admin surface. Distinct from
 * `AuthRequiredError`: that one means "sign in", which is an invitation.
 * This one means "no", and a route that confuses them would offer a signed
 * -in stranger a login page in an endless loop.
 */
export class AdminRequiredError extends Error {
  readonly isAdminRequired = true;
  constructor() {
    super("admin only");
  }
}

export function isAdminRequired(error: unknown): error is AdminRequiredError {
  return error instanceof AdminRequiredError;
}

/**
 * The configured admin ids.
 *
 * Read on every call rather than captured in a module-scope constant: a
 * module-scope read of `env` is exactly what CLAUDE.md's client-bundle rule
 * forbids, and the parse is a string split over a list of one.
 *
 * An unset or empty `ADMIN_USER_IDS` yields no admins, which fails closed —
 * the review page is unreachable rather than open to everyone. That is the
 * right way round for a misconfiguration: a moderation queue nobody can
 * open is a nuisance, and one anybody can open is a breach.
 */
export function adminUserIds(): readonly string[] {
  const configured: unknown = env.ADMIN_USER_IDS;
  if (typeof configured !== "string") return [];
  return configured
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

export function isAdmin(userId: string): boolean {
  return adminUserIds().includes(userId);
}

/**
 * The gate. Returns the id so a caller can use it as the reviewer stamp
 * without asking twice.
 */
export function requireAdmin(userId: string): string {
  if (!isAdmin(userId)) throw new AdminRequiredError();
  return userId;
}
