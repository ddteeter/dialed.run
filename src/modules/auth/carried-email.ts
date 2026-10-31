import { useEffect, useState } from "react";

import { readCarriedEmail } from "../../lib/browser/carried-email";
import type { CarriedForm } from "../../lib/carried-form";

/**
 * The log-in page's email field, prefilled on Au7's arrival from what the
 * session-expiry carry kept (`lib/browser/carried-email`).
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
    // Anything already typed stands when nothing was carried.
    setEmail((typed) => readCarriedEmail() ?? typed);
  }, [carried]);
  return [email, setEmail];
}
