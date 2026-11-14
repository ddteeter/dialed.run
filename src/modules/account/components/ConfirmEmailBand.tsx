import type { JSX } from "react";

import type { ResendResult } from "../verification";
import type { ViewerZone } from "../../../lib/dates";
import { ResendLink } from "./ResendLink";

/**
 * The one nag (round 26 #11): *"A hairline band at the top of Feed and You:
 * 'Confirm your email to share runs. Resend link'. No modal, no badge on
 * the bell, and no dismiss, because it goes once verified."* Round 27 #7
 * retired "public" from the copy, so it reads "…to share runs with other
 * runners." Lane 129 places it (FEED-11) on Feed and You, and U1 Account
 * carries it too; it renders nothing once the address is confirmed, so
 * the page need not decide.
 */
export function ConfirmEmailBand({
  account,
  resend,
}: Readonly<{
  account:
    { email: string; isVerified: boolean; viewer: ViewerZone } | undefined;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
}>): JSX.Element | undefined {
  if (account === undefined || account.isVerified) return undefined;
  return (
    // R55·211, R29's band: no box, one hairline below, the sentence and
    // Resend link on one line where it fits. The page sets it flush under
    // its header; the band only draws itself.
    <aside
      data-part="confirm-email-band"
      aria-label="Confirm your email"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-hairline py-3 text-small"
    >
      <p className="m-0">
        Confirm your email to share runs with other runners.
      </p>
      <ResendLink
        email={account.email}
        resend={resend}
        viewer={account.viewer}
        look="band"
      />
    </aside>
  );
}
