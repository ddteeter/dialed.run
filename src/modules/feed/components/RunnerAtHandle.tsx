import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Icon } from "../../../ui";
import type { OtherProfile as OtherProfileData } from "../profiles";
import type { ProfileAtHandle } from "../profiles";
import type { FollowAction } from "./Follow";
import { OtherProfile } from "./OtherProfile";

/**
 * `/@handle` (round 26 #7): the runner who holds the handle now, or — for
 * a handle somebody used to hold — "This runner changed their name." and
 * nothing more; for one whose runner's account was deleted, "This runner
 * isn't here." (decision D-82). Never who they are now, and never a redirect: either would
 * link the old handle to the new one (decision D-56).
 *
 * The viewer's own handle and one nobody may be shown never get here; the
 * route's `orHandlePage` sends those to G and back to the feed.
 */
export function RunnerAtHandle({
  found,
  follow,
  unfollow,
  reportAffordanceFor,
}: Readonly<{
  found: Exclude<ProfileAtHandle, { kind: "own" }>;
  follow: FollowAction;
  unfollow: FollowAction;
  /**
   * W1's report control for the runner shown, composed by the route for
   * the reason `OtherProfile` gives — this module may not reach
   * `modules/safety`. A function, because only a found runner has one.
   */
  reportAffordanceFor: (profile: OtherProfileData) => ReactNode;
}>) {
  if (found.kind === "changed") {
    return <NoRunnerHere>This runner changed their name.</NoRunnerHere>;
  }
  if (found.kind === "gone") {
    return <NoRunnerHere>{RUNNER_GONE}</NoRunnerHere>;
  }
  return (
    <OtherProfile
      profile={found.profile}
      isFollowing={found.isFollowing}
      follow={follow}
      unfollow={unfollow}
      reportAffordance={reportAffordanceFor(found.profile)}
    />
  );
}

/**
 * A deleted account's old handle (decision D-82, owner 2026-09-29): neutral — it
 * says neither that the account was deleted, nor renamed, nor removed.
 */
const RUNNER_GONE = "This runner isn't here.";

/**
 * A handle with nobody behind it to show: the ruling's sentence, and the
 * way back. Undesigned beyond the sentence (placeholder protocol): H's own
 * column and back link, and the copy set as H's empty-state lead.
 */
function NoRunnerHere({ children }: Readonly<{ children: string }>) {
  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6 wide:mx-0">
      <Link
        to="/feed"
        aria-label="Back to feed"
        className="target inline-flex items-center self-start text-ink"
      >
        <Icon name="back" size={20} />
      </Link>
      <p data-part="no-runner" className="m-0 text-lead">
        {children}
      </p>
    </div>
  );
}
