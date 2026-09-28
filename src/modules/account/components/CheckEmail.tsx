import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { ResendResult } from "../verification";
import { ResendLink } from "./ResendLink";

/**
 * The quiet line under the panel's action, and its one link — the Auth
 * board's cross-link.
 */
const FOOT_LINK_CLASS = "font-bold text-ink underline underline-offset-4";

/**
 * Au4 · "Check your email" (round 26 #11): where every email sign-up
 * ends, whether the address was new or already had an account — "the page
 * can't tell anyone who has an account."
 *
 * Signed in (a runner who came back through "Log in to resend"), it says
 * so and offers the way on, as the board draws it. Signed out — which is
 * everyone straight from sign-up, since sign-up signs nobody in (see
 * `createAuth`) — it offers "Start over" and the log-in instead: a
 * "You're signed in" line there would be false for a new address and so
 * tell the two apart.
 */
export function CheckEmail({
  email,
  isSignedIn,
  resend,
}: Readonly<{
  email: string;
  isSignedIn: boolean;
  resend: (input: { data: { email: string } }) => Promise<ResendResult>;
}>): JSX.Element {
  return (
    <SignedOutPanel heading="Check your email">
      <div data-part="check-email" className="flex flex-col gap-5">
        <p className="m-0 text-lead">
          We sent a link to <strong>{email}</strong>. Open it on any device to
          confirm the address.
        </p>
        <p className="m-0 text-body text-quiet">
          It works once, for 24 hours. Not there? Check spam, or send it again.
        </p>
        <ResendLink email={email} resend={resend} />
        {isSignedIn ? (
          <p className="m-0 pt-4 text-body text-quiet">
            You&apos;re signed in.{" "}
            <Link data-target="inline" to="/" className={FOOT_LINK_CLASS}>
              Carry on to your closet ›
            </Link>
          </p>
        ) : (
          <>
            <p className="m-0 pt-4 text-body text-quiet">
              Wrong address?{" "}
              <Link
                data-target="inline"
                to="/auth/signup"
                className={FOOT_LINK_CLASS}
              >
                Start over
              </Link>
            </p>
            <p className="m-0 text-body text-quiet">
              Carry on without confirming?{" "}
              <Link
                data-target="inline"
                to="/auth/login"
                className={FOOT_LINK_CLASS}
              >
                Log in
              </Link>
            </p>
          </>
        )}
      </div>
    </SignedOutPanel>
  );
}
