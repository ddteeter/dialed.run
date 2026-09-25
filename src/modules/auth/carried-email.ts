import { useEffect, useState } from "react";
import { z } from "zod";

import type { CarriedForm } from "./sign-in-search";

/**
 * Au7's prefilled email, carried beside the URL rather than in it.
 *
 * The board's *"email prefilled"* was built as `?email=` first, which put
 * the address in the Workers request log and the browser's history. Session
 * storage is per tab, gone when the tab closes, and never sent anywhere —
 * which is exactly the lifetime of "you were signed out a moment ago". What
 * writes it is the session-expiry carry (`ui/use-form-submit`'s `session`
 * branch); this is the reading half.
 */
export const CARRIED_EMAIL_KEY = "dialed.carried-email";

const emailSchema = z.email();

/**
 * The carried email, or nothing — never a throw. Storage can be absent or
 * refuse access (a private window, blocked site data), and what is in it
 * is `unknown` until parsed like any other input.
 */
function readCarriedEmail(): string | undefined {
  try {
    const parsed = emailSchema.safeParse(
      globalThis.sessionStorage.getItem(CARRIED_EMAIL_KEY),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    // No storage is no carried email: the ordinary empty field.
    return undefined;
  }
}

/**
 * The log-in page's email field, prefilled on Au7's arrival.
 *
 * Read after mount rather than during render: the server has no session
 * storage, so reading it in render would paint one email on the server and
 * another on the client. An ordinary visit (`carried` absent) never looks.
 */
export function useCarriedEmail(
  carried: CarriedForm | undefined,
): [string, (email: string) => void] {
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (carried === undefined) return;
    const found = readCarriedEmail();
    if (found !== undefined) setEmail(found);
  }, [carried]);
  return [email, setEmail];
}
