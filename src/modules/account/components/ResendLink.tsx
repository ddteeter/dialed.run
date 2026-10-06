import { useEffect, useState } from "react";
import type { JSX } from "react";

import { EMAIL_SENDS_PER_HOUR } from "../../../lib/contracts/email";
import { clockLabel, deviceTimeZone } from "../../../lib/dates";
import {
  ControlFailureBand,
  FailureBand,
  FormStatus,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import type { ResendResult } from "../verification";

/**
"Sent ✓" stays for a minute (round 26 #11, "SENT · FOR 60 S").
*/
export const SENT_FOR_MS = 60_000;

/**
 * The kicker every failed resend wears: the link is the thing not sent.
 */
const NOT_SENT = "Not sent";

/**
 * Round 26 #11's rate-limit band, naming when the next link can go in the
 * runner's own clock.
 */
export function limitedMessage(until: number): string {
  return `That's ${String(EMAIL_SENDS_PER_HOUR)} links this hour. You can send another at ${clockLabel(until, deviceTimeZone())}.`;
}

/**
 * "Resend link" — Au4's, the "Confirm your email first" sheet's and the
 * nag band's (round 26 #11: "RESEND · THREE STATES · NEVER DISABLED").
 *
 * `[ Sending ]` while it goes; "Sent ✓ A new link is on its way. The old
 * one no longer works." for a minute; the §4a band `NOT SENT` when the
 * hour's links are used up, and the same band with the cause when the
 * send failed. Never disabled: a runner can always press it, and the
 * server says whether it went.
 *
 * It carries the screen's status region, since every screen it sits on has
 * no other.
 *
 * **Two looks, one control** (round 29 #12): the text link in the band
 * and on Au4, and on the "Confirm your email first" sheet an outline pill
 * at the control height, because there it is the sheet's only real action
 * — outline rather than ink, since Not now is the default. Both run the
 * same three states.
 */
export function ResendLink({
  email,
  resend,
  look = "link",
}: Readonly<{
  email: string;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
  look?: "link" | "pill" | undefined;
}>): JSX.Element {
  const [isSent, setIsSent] = useState(false);
  const [limitedUntil, setLimitedUntil] = useState<number | undefined>();
  const control = useControlAction<[]>({
    action: async () => {
      setIsSent(false);
      setLimitedUntil(undefined);
      const result = await resend({ data: { email } });
      if (result.status === "limited") setLimitedUntil(result.until);
      else setIsSent(true);
    },
    kicker: NOT_SENT,
  });

  useEffect(() => {
    if (!isSent) return;
    const timer = globalThis.setTimeout(() => {
      setIsSent(false);
    }, SENT_FOR_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [isSent]);

  const limited =
    limitedUntil === undefined ? undefined : limitedMessage(limitedUntil);
  const status = statusOf(control.status, isSent, limited);

  return (
    <div data-part="resend" className="flex flex-col items-start gap-3">
      <FormStatus>{status}</FormStatus>
      <button
        type="button"
        {...inFlight(control.pending)}
        onClick={() => {
          void control.run();
        }}
        className={RESEND_LOOK[look]}
      >
        <PendingLabel
          label="Resend link"
          pendingLabel="Sending"
          pending={control.pending}
        />
      </button>
      {isSent ? (
        <p data-state="sent" className="m-0 text-body">
          <span className="font-semibold">Sent ✓</span> {SENT_SENTENCE}
        </p>
      ) : undefined}
      {limited === undefined ? undefined : (
        <FailureBand
          kicker={NOT_SENT}
          message={limited}
          onRetry={() => {
            void control.run();
          }}
        />
      )}
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </div>
  );
}

/**
 * The two looks: the band's text link, and the sheet's outline pill — a
 * 1px ink rule, no fill, `HEIGHT.control` (48) high and the sheet's width,
 * as round 29 #12 draws it.
 */
export const RESEND_LOOK = {
  link: "target cursor-pointer border-none bg-transparent p-0 text-body font-semibold text-ink underline underline-offset-4",
  pill: "target flex h-12 w-full cursor-pointer items-center justify-center rounded-pill border border-ink bg-transparent px-5 text-body font-bold text-ink",
} as const;

const SENT_SENTENCE = "A new link is on its way. The old one no longer works.";

/**
 * The screen's one announcement: the band's words when the hour's links
 * are used up, the failure's when the send failed, "Sent" when it went.
 */
function statusOf(
  failed: string,
  isSent: boolean,
  limited: string | undefined,
): string {
  if (limited !== undefined) return `${NOT_SENT}. ${limited}`;
  if (isSent) return `Sent. ${SENT_SENTENCE}`;
  return failed;
}
