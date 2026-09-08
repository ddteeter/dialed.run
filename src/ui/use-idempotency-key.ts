import { useCallback, useState } from "react";

import { newUlid } from "../lib/ids";

/**
 * One key per composed submission (CLAUDE.md law 8b).
 *
 * Minted when the form mounts, carried by every retry of *that* submission,
 * and rotated after a success so a genuine second save on the same mount
 * gets its own. Without it the server cannot tell a double-click, a browser
 * replaying a POST, and a retry over a flaky connection from someone
 * deliberately adding two of the same thing — and the cost of guessing
 * wrong is a duplicate the user has to notice and delete.
 *
 * Here rather than in a lane because four forms need it and each writing
 * its own `useState(() => newUlid())` is how the same three-line rule ends
 * up with four subtly different lifetimes. `rotate()` after the await that
 * succeeded, never in a `finally` — a failed submit has to keep its key or
 * the retry is a new request.
 *
 * The Forms & failure contract (`product.md`) will fold this into
 * `useFormSubmit`; until then it stands alone so the key is not optional
 * while the primitive is being built.
 */
export function useIdempotencyKey(): {
  idempotencyKey: string;
  rotate: () => void;
} {
  const [idempotencyKey, setKey] = useState(() => newUlid());
  const rotate = useCallback(() => {
    setKey(newUlid());
  }, []);
  return { idempotencyKey, rotate };
}
