import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono } from "../../ui";
import type { AuthBand, RefusalLink } from "./auth-copy";

/**
 * Where each refusal points, in the words round 28 #9 draws: the page
 * that fixes it.
 */
function RefusalLinkTo({ link }: Readonly<{ link: RefusalLink }>): JSX.Element {
  const className =
    "target inline-flex items-center font-bold text-ink underline underline-offset-4";
  return link === "request-access" ? (
    <Link to="/account/request-access" className={className}>
      Request access
    </Link>
  ) : (
    <Link to="/auth/signup" className={className}>
      Create an account
    </Link>
  );
}

/**
 * Round 28 #9's band for a Google refusal: the failure band's frame —
 * kicker, sentence, a 1px ink rule, no fill, no hue (Form Contract 02b) —
 * with no Try again, because pressing again cannot fix it. The fix is the
 * code field above ("Enter your invite code above, then continue with
 * Google.") or the page it links: Request access, or Create an account.
 */
export function RefusalBand({
  band,
}: Readonly<{ band: AuthBand }>): JSX.Element {
  return (
    <div
      data-part="failure-band"
      data-state="refused"
      className="flex flex-col items-start gap-3 border border-ink p-4"
    >
      <Mono step="xs">{band.kicker}</Mono>
      <span className="text-body">{band.message}</span>
      {band.link === undefined ? undefined : (
        <RefusalLinkTo link={band.link} />
      )}
    </div>
  );
}
