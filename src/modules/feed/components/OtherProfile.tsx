import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { COLUMN, FormStatus, Icon, Mono, PhoneBell } from "../../../ui";
import type { OtherProfile as OtherProfileData } from "../profiles";
import { Avatar } from "./Avatar";
import { Handle, handleText } from "./Handle";
import { ReportFoot } from "./ReportFoot";
import { FollowBand, FollowPill, useFollowToggle } from "./Follow";
import type { FollowAction } from "./Follow";
import { RunRow } from "./RunRow";

/**
 * Someone else's profile — screen H, drawn with only what v1 stores
 * (round 22, "H No public entries").
 *
 * - **No counts on H**: a stranger's follower count is a status number,
 *   and G shows them only to their owner.
 * - **The header and Follow stay** whatever there is to show; Follow is
 *   on the control-failure pattern (`useFollowToggle`).
 * - **Nothing public reads as their silence**, not as a next step for the
 *   viewer — a plain lead, no brackets.
 * - **Report is the foot link**, in the same place as D's.
 */
export function OtherProfile({
  profile,
  isFollowing,
  follow,
  unfollow,
  reportAffordance,
}: Readonly<{
  profile: OtherProfileData;
  isFollowing: boolean;
  follow: FollowAction;
  unfollow: FollowAction;
  /**
   * W1's report control, composed by the route — a node rather than a
   * callback for the same boundary reason as `EntryDetail`: this module
   * may not reach `modules/safety`.
   */
  reportAffordance?: ReactNode;
}>) {
  const [status, setStatus] = useState("");
  const toggle = useFollowToggle({
    userId: profile.userId,
    isFollowing,
    follow,
    unfollow,
    onStatus: setStatus,
  });
  const name = handleText(profile.username);

  return (
    <div className={`${COLUMN} flex flex-col gap-6 px-5 pt-6 wide:px-6`}>
      <FormStatus>{status}</FormStatus>
      {/* `exact`: the router marks a prefix match current, and this page
          sits under /feed. */}
      <div className="flex items-center justify-between">
        <Link
          to="/feed"
          activeOptions={{ exact: true }}
          aria-label="Back to feed"
          className="target inline-flex items-center text-ink"
        >
          <Icon name="back" size={20} />
        </Link>
        <PhoneBell />
      </div>
      <div data-part="header" className="flex flex-col items-start gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={profile.username ?? name} size="large" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 text-heading wrap-anywhere">
              <Handle username={profile.username} />
            </h1>
            {profile.cityLabel === null ? undefined : (
              <Mono className="text-muted wrap-anywhere">
                {profile.cityLabel}
              </Mono>
            )}
          </div>
        </div>
        <FollowPill toggle={toggle} />
        <FollowBand toggle={toggle} />
      </div>

      {profile.recentPublicEntries.length === 0 ? (
        <div
          data-part="entries"
          data-state="empty"
          className="flex flex-col gap-3"
        >
          <p className="m-0 text-lead">No shared runs yet.</p>
          {/* Once followed, the line stops asking for what is done (#590,
              owner 2026-11-11). It turns with the pill, on the server's
              answer, and is not a live region: the pill's new name is the
              one thing announced. */}
          <p className="m-0 text-body text-quiet">
            {toggle.isFollowing
              ? "Their shared runs will show in your feed."
              : `Follow ${name} and their shared runs will show in your feed.`}
          </p>
          <ReportFoot>{reportAffordance}</ReportFoot>
        </div>
      ) : (
        <div data-part="entries" className="flex flex-col gap-3">
          {/* R55·210: G's row, conditions, verdict and distance together,
              ruled from a hairline above the first. */}
          <ul className="m-0 flex list-none flex-col border-t border-hairline p-0">
            {profile.recentPublicEntries.map((entry) => (
              <RunRow key={entry.entryId} run={entry} units={profile.units} />
            ))}
          </ul>
          <ReportFoot>{reportAffordance}</ReportFoot>
        </div>
      )}
    </div>
  );
}
