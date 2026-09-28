import type { JSX } from "react";

import type { ResendResult } from "../verification";
import { ResendLink } from "./ResendLink";

/**
 * The one nag (round 26 #11): *"A hairline band at the top of Feed and You:
 * 'Confirm your email to share runs. Resend link'. No modal, no badge on
 * the bell, and no dismiss, because it goes once verified."* Lane 129
 * places it (FEED-11); it renders nothing once the address is confirmed,
 * so the page need not decide.
 */
export function ConfirmEmailBand({
  account,
  resend,
}: Readonly<{
  account: { email: string; isVerified: boolean } | undefined;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
}>): JSX.Element | undefined {
  if (account === undefined || account.isVerified) return undefined;
  return (
    <aside
      data-part="confirm-email-band"
      aria-label="Confirm your email"
      className="flex flex-col gap-2 border border-hairline p-4"
    >
      <p className="m-0 text-body">Confirm your email to share runs.</p>
      <ResendLink email={account.email} resend={resend} />
    </aside>
  );
}
