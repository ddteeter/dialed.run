import type { JSX } from "react";

import { Sheet } from "../../../ui";
import type { ResendResult } from "../verification";
import { ResendLink } from "./ResendLink";

/**
 * "Confirm your email first" (round 26 #11; seam 7): what a control opens
 * when it waits for a confirmed address — Useful and report (lanes 129 and
 * 128 wire those), and an email change here. *"The control draws at full
 * strength (rule 07: 'not yet'). Pressing it opens a small sheet: 'Confirm
 * your email first. We sent a link to maya@…' · Resend link."*
 */
export function ConfirmEmailSheet({
  open,
  onClose,
  email,
  resend,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  email: string;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
}>): JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} label="Confirm your email first">
      <div data-part="confirm-email-sheet" className="flex flex-col gap-4">
        <h2 className="m-0 font-display text-title uppercase">
          Confirm your email first
        </h2>
        <p className="m-0 text-body">
          We sent a link to <strong>{email}</strong>.
        </p>
        <ResendLink email={email} resend={resend} />
        <button
          type="button"
          onClick={onClose}
          className="target cursor-pointer self-start rounded-pill border border-hairline bg-transparent px-5 text-body font-semibold text-ink"
        >
          Close
        </button>
      </div>
    </Sheet>
  );
}
