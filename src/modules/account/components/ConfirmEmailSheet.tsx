import { useEffect, useState } from "react";
import type { JSX } from "react";

import type { ConfirmTrigger } from "../../../lib/auth-signal";
import type { ViewerZone } from "../../../lib/dates";
import { Sheet } from "../../../ui";
import type { ConfirmGate } from "../../../ui";
import type { ResendResult } from "../verification";
import { ResendLink } from "./ResendLink";

/**
 * The lead: the one control that was refused, by name (round 29 #11). The
 * sheet names only that one — round 27's list of all three is struck —
 * and the email change has a sentence of its own. Follow's is round 35
 * #49's (it waits too since design 133, D-113), so every trigger has
 * one. A3's is the share switch's drawn lead, and the sheet opens from the
 * "Confirm your email" in A3's private line (round 38 #64, follow-up (a)).
 */
const WAITS_FOR: Readonly<Record<ConfirmTrigger, string>> = {
  useful: "Marking runs Useful needs a confirmed email.",
  report: "Reporting needs a confirmed email.",
  correct: "Sending a correction needs a confirmed email.",
  follow: "Following runners needs a confirmed email.",
  "email-change": "Confirm this address before you change it.",
  share: "Sharing needs a confirmed email. This run saves private.",
};

type Resend = (input: { data: { email: string } }) => Promise<ResendResult>;

/**
What the sheet reads about the runner once a refusal opens it.
*/
interface OwnAddress {
  readonly email: string;
  readonly viewer: ViewerZone;
}

/**
 * "Confirm your email first" (round 26 #11, as round 27 #17 redrew it;
 * seam 7): what a control opens when the server refuses it for want of a
 * confirmed address — through `confirmEmailOnRefusal` below, one sheet
 * for the whole app, whichever control was refused (design 133). *"The
 * control draws at full strength (rule 07: 'not yet'). Pressing it opens
 * a small sheet."*
 *
 * The lead, then "We sent a link to {email}." on a line of its own
 * (round 29 #11), then Resend as an outline pill (round 29 #12: the
 * sheet's only real action, but not filled, because **Not now** has focus
 * and is the default — the runner did not ask for a sheet, so the way out
 * is where they land). Without a trigger the body is the address alone.
 * Until the address has arrived, or when it can't be read, the body is
 * the lead alone with no space held for the rest; the address line and
 * Resend arrive together, without motion (round 35 #49b).
 */
export function ConfirmEmailSheet({
  open,
  onClose,
  address,
  resend,
  trigger,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  /**
   * The runner's address and clock, once read; undefined while it is
   * on its way, or if the read failed, and then there is no Resend link.
   */
  address: OwnAddress | undefined;
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
  // The lead, on its own line above the address — or alone while the
  // address is on its way; nothing at all when there is neither.
  const leadAlone =
    lead === undefined ? undefined : <p className="m-0 text-body">{lead}</p>;

  return (
    <Sheet open={open} onClose={onClose} label="Confirm your email first">
      <div data-part="confirm-email-sheet" className="flex flex-col gap-4">
        {address === undefined ? (
          leadAlone
        ) : (
          <>
            {leadAlone}
            <p className="m-0 text-body">
              We sent a link to <strong>{address.email}</strong>.
            </p>
            <ResendLink
              email={address.email}
              resend={resend}
              viewer={address.viewer}
              isPill
            />
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
  ownAccount: () => Promise<OwnAddress>;
  resend: Resend;
}>): JSX.Element {
  const [account, setAccount] = useState<OwnAddress | undefined>();
  useEffect(() => {
    if (!open || account !== undefined) return;
    async function askForAddress(): Promise<void> {
      try {
        setAccount(await ownAccount());
      } catch {
        // No address line, as said above.
      }
    }
    void askForAddress();
  }, [open, account, ownAccount]);
  return (
    <ConfirmEmailSheet
      open={open}
      onClose={onClose}
      address={account}
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
  ownAccount: () => Promise<OwnAddress>,
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
