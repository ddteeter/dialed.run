import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { dayLabel } from "../../../lib/dates";
import { FormStatus, Icon, Mono } from "../../../ui";
import type { OtherProfile as OtherProfileData } from "../profiles";
import { Avatar } from "./Avatar";
import { ReportFoot } from "./ReportFoot";
import { FollowBand, FollowPill, useFollowToggle } from "./Follow";
import type { FollowAction } from "./Follow";
import { VerdictBadge } from "./VerdictBadge";

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
  const name = profile.displayName ?? "A runner";

  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6 wide:mx-0">
      <FormStatus>{status}</FormStatus>
      <Link
        to="/feed"
        aria-label="Back to feed"
        className="target inline-flex items-center self-start text-ink"
      >
        <Icon name="back" size={20} />
      </Link>
      <div data-part="header" className="flex flex-col items-start gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={name} size="large" />
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display text-heading">{name}</h1>
            {profile.cityLabel === null ? undefined : (
              <Mono className="text-muted">{profile.cityLabel}</Mono>
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
          <p className="m-0 text-lead">No public entries yet.</p>
          <p className="m-0 text-body text-quiet">
            Follow {name} and their shared runs will show in your feed.
          </p>
          <ReportFoot>{reportAffordance}</ReportFoot>
        </div>
      ) : (
        <div data-part="entries" className="flex flex-col gap-3">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {profile.recentPublicEntries.map((entry) => (
              <li key={entry.entryId} className="border-b border-hairline pb-3">
                <Link
                  to="/feed/entry/$entryId"
                  params={{ entryId: entry.entryId }}
                  className="target flex flex-col gap-2 text-ink no-underline"
                >
                  <span className="flex items-center justify-between gap-3">
                    <Mono step="xs" className="text-muted">
                      {dayLabel(entry.createdAt)}
                    </Mono>
                    {entry.verdict === null ? undefined : (
                      <VerdictBadge verdict={entry.verdict} />
                    )}
                  </span>
                  {entry.caption === null ? undefined : (
                    <span className="text-body">{entry.caption}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <ReportFoot>{reportAffordance}</ReportFoot>
        </div>
      )}
    </div>
  );
}
