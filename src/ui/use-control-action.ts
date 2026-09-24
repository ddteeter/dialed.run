import { useRef, useState } from "react";
import type { RefObject } from "react";

import type { ControlFailure } from "./form";
import { classifyFailure } from "./use-form-submit";

/**
 * An action a control takes outside a form — Useful, Follow, Unblock,
 * Attach, Strava, a DS2 row — and what it says when that fails.
 *
 * Round 23, item 9 (design's product.md §4a), in one hook so every control
 * says it the same way:
 *
 * - **Not optimistic.** The control waits for the server behind its
 *   in-flight label (`pending` → `PendingLabel`, `inFlight`). A count
 *   changes, and a row leaves, on success only. Optimistic-then-rollback is
 *   the snap-back the ruling removes: *"the heart fills, the count ticks,
 *   then both reverse, and the runner has read a lie twice."*
 * - **The band names what is still true.** `kicker` is the caller's —
 *   `Not marked`, `Still blocked` — because only the caller knows the state
 *   it failed to change. The sentence is the Form Contract's cause line,
 *   from the same `classifyFailure` a submit uses, so "your connection
 *   dropped" cannot drift into a second phrasing.
 * - **It stays until the next attempt.** Running again, from the band's
 *   Try again or the control itself, clears it; success clears it; there
 *   is no timer, because a band that clears itself takes the retry with it.
 * - **One announcement.** `status` is the sentence for the screen's one
 *   status region (Accessibility Contract rule 08) — the caller renders it
 *   in its `FormStatus`, so a screen with two controls still has one
 *   region. Focus stays on the control.
 *
 * The re-entry guard is a ref, not state: two presses inside one render
 * would both read `pending` as false.
 */
export interface ControlAction<TArgs extends unknown[]> {
  pending: boolean;
  failure: ControlFailure | undefined;
  status: string;
  run: (...args: TArgs) => Promise<void>;
  /**
  Runs again with the arguments of the attempt that failed.
  */
  retry: () => void;
  retryRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The Form Contract's cause line, for a control. A form's server failure
 * reads "Our end failed. Nothing changed."; a control's kicker already says
 * what did not change, so its sentence stops at the cause (§4a: *"Our end
 * failed." in place of the connection line*).
 */
function causeLine(error: unknown): string {
  const failure = classifyFailure(error);
  return failure.kind === "server" ? "Our end failed." : failure.message;
}

export function useControlAction<TArgs extends unknown[]>({
  action,
  kicker,
  onSuccess,
}: {
  action: (...args: TArgs) => Promise<unknown>;
  /**
  The state still true if the action fails — "Not marked", "Still blocked".
  */
  kicker: string;
  onSuccess?: ((...args: TArgs) => void | Promise<void>) | undefined;
}): ControlAction<TArgs> {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ControlFailure | undefined>();
  const [status, setStatus] = useState("");
  const inFlight = useRef(false);
  const lastArgs = useRef<TArgs | undefined>(undefined);
  const retryRef = useRef<HTMLButtonElement>(null);

  async function run(...args: TArgs): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    lastArgs.current = args;
    setPending(true);
    setFailure(undefined);
    setStatus("");
    try {
      await action(...args);
      await onSuccess?.(...args);
    } catch (error: unknown) {
      const message = causeLine(error);
      setFailure({ kicker, message });
      setStatus(`${kicker}. ${message}`);
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  return {
    pending,
    failure,
    status,
    run,
    retry: () => {
      // A retry only exists once an attempt has failed, and that attempt
      // recorded its arguments before it ran.
      if (lastArgs.current !== undefined) void run(...lastArgs.current);
    },
    retryRef,
  };
}
