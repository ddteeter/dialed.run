import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  isBlockedRegion,
  regionInviteRefusal,
  regionTag,
} from "../../../lib/contracts/access";
import { FormStatus, Mono } from "../../../ui";
import type { AccessDesk, DeskRequest } from "../invites";
import {
  ageLabel,
  useRowAction,
  type RowAction,
  type RowActionHandle,
} from "./desk-rows";

/**
 * A request's Send invite — or, for one from a state that is blocked now
 * (`BLOCKED_US_REGIONS`; design-deltas item 69), the reason there is
 * none. The server refuses it too (`inviteFromRequest`); this is where
 * the operator reads why.
 */
function InviteAction({
  region,
  onInvite,
}: Readonly<{
  region: string;
  onInvite: () => void;
}>): JSX.Element {
  if (isBlockedRegion(region)) {
    return <span className="text-quiet">{regionInviteRefusal(region)}</span>;
  }
  return (
    <button
      type="button"
      className="target font-semibold underline"
      onClick={onInvite}
    >
      Send invite
    </button>
  );
}

function RequestRow({
  request,
  asOf,
  invite,
  decline,
}: Readonly<{
  request: DeskRequest;
  asOf: number;
  /**
  Send invite, whose band shows here when it failed on this row; Decline's likewise.
  */
  invite: RowActionHandle;
  decline: RowActionHandle;
}>): JSX.Element {
  const region = request.blockedRegion;
  return (
    <li className="flex flex-col gap-2 border-b border-hairline py-4">
      <span className="flex items-baseline justify-between gap-4">
        {/* A long address wraps, so the age keeps its place (N3-09). */}
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span
            data-part="request-email"
            className="min-w-0 font-semibold wrap-anywhere"
          >
            {request.email}
          </span>
          {region === "" ? undefined : (
            <Mono step="sm">{regionTag(region)}</Mono>
          )}
        </span>
        <Mono step="sm" className="shrink-0 text-muted">
          {ageLabel(request.createdAt, asOf)}
        </Mono>
      </span>
      <span className={request.note === null ? "text-muted" : "text-ink"}>
        {request.note ?? "No note."}
      </span>
      <span className="flex gap-4">
        <InviteAction
          region={region}
          onInvite={() => {
            invite.run(request.id);
          }}
        />
        <button
          type="button"
          className="target text-quiet underline"
          onClick={() => {
            decline.run(request.id);
          }}
        >
          Decline
        </button>
      </span>
      {invite.bandFor(request.id) ?? decline.bandFor(request.id)}
    </li>
  );
}

/**
The heading of each of Access's two lists.
*/
const SECTION_HEADING = "m-0 font-display text-heading uppercase";

/**
 * Desk D7 · Access (task 126, ACC-5; round 26 #20): Requests, oldest
 * first, each with Send invite and a silent Decline. Codes are their own
 * page since R55·194 (`DeskCodes`).
 */
export function DeskAccess({
  requests,
  asOf,
  sendInvite,
  decline,
}: Readonly<{
  requests: AccessDesk["requests"];
  asOf: number;
  sendInvite: RowAction;
  decline: RowAction;
}>): JSX.Element {
  const [said, setSaid] = useState("");
  const onChanged = useReload();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 font-display text-title uppercase">Access</h1>
      <FormStatus>{said}</FormStatus>
      <RequestsSection
        requests={requests}
        asOf={asOf}
        actions={{ sendInvite, decline }}
        onChanged={onChanged}
        announce={setSaid}
      />
    </div>
  );
}

/**
Reloads the route's data after a change, so the rail's counts follow.
*/
function useReload(): () => Promise<void> {
  const router = useRouter();
  return () => router.invalidate();
}

/**
 * D7's Requests: who asked, oldest first, each with Send invite and a
 * silent Decline. What either says goes to `DeskAccess`'s one status
 * region, through `announce`.
 */
function RequestsSection({
  requests,
  asOf,
  actions,
  onChanged,
  announce,
}: Readonly<{
  requests: AccessDesk["requests"];
  asOf: number;
  actions: { sendInvite: RowAction; decline: RowAction };
  onChanged: () => Promise<void>;
  announce: (said: string) => void;
}>): JSX.Element {
  const inviting = useRowAction({
    kind: "invite",
    act: actions.sendInvite,
    onChanged,
    announce,
  });
  const declining = useRowAction({
    kind: "decline",
    act: actions.decline,
    onChanged,
    announce,
  });
  return (
    <section aria-labelledby="desk-requests" className="flex flex-col gap-4">
      <h2 id="desk-requests" className={SECTION_HEADING}>
        Requests
      </h2>
      <Mono step="xs" className="text-muted">
        {`${String(requests.length)} waiting · oldest first`}
      </Mono>
      <ul className="m-0 flex list-none flex-col p-0">
        {requests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            asOf={asOf}
            invite={inviting}
            decline={declining}
          />
        ))}
      </ul>
    </section>
  );
}
