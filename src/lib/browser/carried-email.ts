import { z } from "zod";

/**
 * Au7's prefilled email, carried beside the URL rather than in it.
 *
 * The board's *"email prefilled"* was built as `?email=` first, which put
 * the address in the Workers request log and the browser's history. Session
 * storage is per tab, gone when the tab closes, and never sent anywhere —
 * which is exactly the lifetime of "you were signed out a moment ago".
 *
 * Both halves live here, so the key is written once: the session-expiry
 * carry (`ui/session-lapse`) writes it, and log-in's field
 * (`modules/auth/carried-email`) reads it.
 */
export const CARRIED_EMAIL_KEY = "dialed.carried-email";

const emailSchema = z.email();

/**
 * Keep the address for log-in, or keep nothing — never a throw. Storage can
 * be absent or refuse access (a private window, blocked site data), and the
 * carry goes on without it: the runner types the address instead. Without
 * an address to keep, an older one is cleared rather than left to prefill a
 * different runner's log-in.
 */
export function writeCarriedEmail(email: string | undefined): void {
  try {
    if (email === undefined) {
      globalThis.sessionStorage.removeItem(CARRIED_EMAIL_KEY);
    } else {
      globalThis.sessionStorage.setItem(CARRIED_EMAIL_KEY, email);
    }
  } catch {
    // Storage refused: nothing kept, so log-in shows an empty field.
  }
}

/**
 * The carried email, or nothing — never a throw. What is in storage is
 * `unknown` until parsed like any other input.
 */
export function readCarriedEmail(): string | undefined {
  let stored: unknown;
  try {
    stored = globalThis.sessionStorage.getItem(CARRIED_EMAIL_KEY);
  } catch {
    // Storage refused: nothing stored, so the ordinary empty field.
  }
  const parsed = emailSchema.safeParse(stored);
  return parsed.success ? parsed.data : undefined;
}
