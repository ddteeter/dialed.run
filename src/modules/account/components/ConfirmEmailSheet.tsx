import { useEffect, useState } from "react";
import type { JSX } from "react";

import { Sheet } from "../../../ui";
import type { ControlGate } from "../../../ui";
import type { ResendResult } from "../verification";
import { ResendLink } from "./ResendLink";

/**
 * The sentence that says what waits (round 27 #17): *"The body's first
 * word changes with the trigger: 'Sharing…', 'Marking runs Useful…',
 * 'Reporting…' leads, the rest stays."* Only the triggers wired today are
 * here — A3's share switch is 127's, and adds its own when it opens this.
 */
const WAITS_FOR = {
  useful:
    "Marking runs Useful, sharing and reporting need a confirmed address.",
  report:
    "Reporting, sharing and marking runs Useful need a confirmed address.",
} as const;

/**
The control that opened the sheet, and so which sentence leads.
*/
export type ConfirmTrigger = keyof typeof WAITS_FOR;

/**
 * "Confirm your email first" (round 26 #11, as round 27 #17 redrew it;
 * seam 7): what a control opens when it waits for a confirmed address —
 * Useful and report, through `confirmEmailGate` below, and an email
 * change here. *"The control draws at full strength (rule 07: 'not
 * yet'). Pressing it opens a small sheet."*
 *
 * Resend link, then **Not now**, which has focus (round 27 #17): the
 * runner did not ask for a sheet, so the way out is where they land.
 * Without a trigger (the email change, which no board draws a sentence
 * for) the body is the address alone.
 */
export function ConfirmEmailSheet({
  open,
  onClose,
  email,
  resend,
  trigger,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  email: string;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
  trigger?: ConfirmTrigger | undefined;
}>): JSX.Element {
  // State rather than a ref, so the effect re-runs once the button exists
  // (`ui/ConfirmSheet`'s Keep it, for the same reason). This effect runs
  // after `Sheet`'s `showModal`, a child's effect, which would otherwise
  // move focus to the first button.
  const [notNow, setNotNow] = useState<HTMLButtonElement | undefined>();
  useEffect(() => {
    if (open && notNow !== undefined) notNow.focus();
  }, [open, notNow]);

  return (
    <Sheet open={open} onClose={onClose} label="Confirm your email first">
      <div data-part="confirm-email-sheet" className="flex flex-col gap-4">
        <h2 className="m-0 font-display text-title uppercase">
          Confirm your email first
        </h2>
        <p className="m-0 text-body">
          {trigger === undefined ? undefined : `${WAITS_FOR[trigger]} `}We sent
          a link to <strong>{email}</strong>.
        </p>
        <ResendLink email={email} resend={resend} />
        <button
          type="button"
          ref={(node) => {
            setNotNow(node ?? undefined);
          }}
          onClick={onClose}
          className="target cursor-pointer self-start rounded-pill border border-hairline bg-transparent px-5 text-body font-semibold text-ink"
        >
          Not now
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The gate a route hands a screen whose control waits for a confirmed
 * address: act when the runner is confirmed, open this sheet when not.
 * The route composes it because the screen's module may not import this
 * one's components (docs/architecture.md, "Composing across modules").
 */
export function confirmEmailGate(
  account: Readonly<{ email: string; isVerified: boolean }>,
  resend: (input: { data: { email: string } }) => Promise<ResendResult>,
  trigger: ConfirmTrigger,
): ControlGate {
  return {
    canAct: account.isVerified,
    sheet: (isOpen, onClose) => (
      <ConfirmEmailSheet
        open={isOpen}
        onClose={onClose}
        email={account.email}
        resend={resend}
        trigger={trigger}
      />
    ),
  };
}
