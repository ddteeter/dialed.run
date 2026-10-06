import { useEffect, useState } from "react";
import type { JSX } from "react";

import type { ConfirmTrigger } from "../../../lib/auth-signal";
import { Sheet } from "../../../ui";
import type { ConfirmGate } from "../../../ui";
import type { ResendResult } from "../verification";
import { ResendLink } from "./ResendLink";

/**
 * The sentence that says what waits (round 27 #17): *"The body's first
 * word changes with the trigger: 'Sharing…', 'Marking runs Useful…',
 * 'Reporting…' leads, the rest stays."* Only the triggers a board draws a
 * sentence for are here. Follow waits too (design 133, D-113) and no
 * board gives it one, so it shows the address alone until one is drawn
 * (design-deltas).
 */
const WAITS_FOR: Readonly<Partial<Record<ConfirmTrigger, string>>> = {
  useful:
    "Marking runs Useful, sharing and reporting need a confirmed address.",
  report:
    "Reporting, sharing and marking runs Useful need a confirmed address.",
};

type Resend = (input: { data: { email: string } }) => Promise<ResendResult>;

/**
 * "Confirm your email first" (round 26 #11, as round 27 #17 redrew it;
 * seam 7): what a control opens when the server refuses it for want of a
 * confirmed address — through `confirmEmailOnRefusal` below, one sheet
 * for the whole app, whichever control was refused (design 133). *"The
 * control draws at full strength (rule 07: 'not yet'). Pressing it opens
 * a small sheet."*
 *
 * Resend link, then **Not now**, which has focus (round 27 #17): the
 * runner did not ask for a sheet, so the way out is where they land.
 * Without a sentence for the trigger (an email change or a follow, which
 * no board draws one for) the body is the address alone. Until the address
 * has arrived there is no address line and nothing to resend.
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
  email: string | undefined;
  resend: Resend;
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
  const lead = trigger && WAITS_FOR[trigger];
  // The lead alone while the address is on its way; nothing at all when
  // there is neither.
  const leadAlone =
    lead === undefined ? undefined : <p className="m-0 text-body">{lead}</p>;

  return (
    <Sheet open={open} onClose={onClose} label="Confirm your email first">
      <div data-part="confirm-email-sheet" className="flex flex-col gap-4">
        <h2 className="m-0 font-display text-title uppercase">
          Confirm your email first
        </h2>
        {email === undefined ? (
          leadAlone
        ) : (
          <>
            <p className="m-0 text-body">
              {lead === undefined ? undefined : `${lead} `}We sent a link to{" "}
              <strong>{email}</strong>.
            </p>
            <ResendLink email={email} resend={resend} />
          </>
        )}
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
 * The sheet as the root opens it: asking for the runner's address when it
 * opens, because nothing at the root has it — `ownAccount` is `account`'s
 * `ownAccountQuery`. Asked on the first opening and kept: the address does
 * not change under an open tab, since an email change signs every other
 * session out.
 *
 * A failed read leaves the address line off, and the sheet still says
 * what waits: the refusal was the server's, and the runner learns it
 * either way (law 5 — the read is secondary to what they asked). The
 * next opening asks again.
 */
export function ConfirmEmailOnRefusal({
  open,
  onClose,
  trigger,
  ownAccount,
  resend,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  trigger: ConfirmTrigger | undefined;
  ownAccount: () => Promise<{ email: string }>;
  resend: Resend;
}>): JSX.Element {
  const [email, setEmail] = useState<string | undefined>();
  useEffect(() => {
    if (!open || email !== undefined) return;
    async function askForAddress(): Promise<void> {
      try {
        const account = await ownAccount();
        setEmail(account.email);
      } catch {
        // No address line, as said above.
      }
    }
    void askForAddress();
  }, [open, email, ownAccount]);
  return (
    <ConfirmEmailSheet
      open={open}
      onClose={onClose}
      email={email}
      resend={resend}
      trigger={trigger}
    />
  );
}

/**
 * The gate the root hands `ui/unconfirmed-refusal`: the sheet every form
 * and control under it opens when the server refuses it for want of a
 * confirmed address (design 133, D-113). The root composes it because
 * `ui/` may not import this module's components.
 *
 * It asks nothing about whether the runner is confirmed: the server
 * decides that on every press, and this only says where the link went.
 */
export function confirmEmailOnRefusal(
  ownAccount: () => Promise<{ email: string }>,
  resend: Resend,
): ConfirmGate {
  return {
    sheet: ({ open, trigger }, onClose) => (
      <ConfirmEmailOnRefusal
        open={open}
        onClose={onClose}
        trigger={trigger}
        ownAccount={ownAccount}
        resend={resend}
      />
    ),
  };
}
