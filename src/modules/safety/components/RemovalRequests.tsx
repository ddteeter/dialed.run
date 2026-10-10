import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";
import { z } from "zod";

import type { TakedownSubject } from "../../../lib/contracts/takedown";
import { declineReasonField } from "../contracts";
import {
  Bracketed,
  FormElement,
  FormFailureBand,
  ListSection,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import type { PendingTakedownRequest } from "../takedown-requests";
import { useSettled } from "./use-settled";

/**
 * Decline's one field — the decision's server input reads the same one
 * (`removalDecisionInput`), so the form says it before the round trip.
 */
const declineSchema = z.object({ reason: declineReasonField });

type Decide = (input: {
  data:
    | { requestId: string; outcome: "removed" }
    | { requestId: string; outcome: "declined"; reason: string };
}) => Promise<unknown>;

/**
 * Review's removal requests (design 136, decision D-117): what people
 * asked to come down through `/takedown`, soonest due first. A request
 * hides nothing, so this is the whole of its 48 hours: the clock, what
 * they said, the subject when the link was ours, and the two decisions.
 * Undesigned: Review's row parts and the forms primitives, placeholder
 * words (design deltas item 58).
 */
function requestId(request: PendingTakedownRequest): string {
  return request.id;
}

export function RemovalRequests({
  requests,
  decide,
}: Readonly<{
  requests: readonly PendingTakedownRequest[];
  decide: Decide;
}>): JSX.Element | undefined {
  // A decided request leaves the list, as a decided review row does.
  const { remaining, settle } = useSettled(requests, requestId);
  return (
    <ListSection title="to remove" items={remaining} count>
      {(request) => (
        <li
          key={request.id}
          data-part="removal-request"
          className="flex flex-col gap-3 border-b border-hairline py-4"
        >
          <span className="flex flex-col gap-1 text-micro">
            <Bracketed>{request.due}</Bracketed>
            <span>
              {request.signature} · {request.requesterEmail}
            </span>
          </span>
          <p className="m-0 text-body break-words">{request.location}</p>
          {request.description === undefined ? undefined : (
            <p className="m-0 text-body text-quiet">{request.description}</p>
          )}
          <SubjectLink subject={request.subject} />
          <RemoveForm
            requestId={request.id}
            decide={decide}
            onDecided={() => {
              settle(request.id);
            }}
          />
          <DeclineForm
            requestId={request.id}
            decide={decide}
            onDecided={() => {
              settle(request.id);
            }}
          />
        </li>
      )}
    </ListSection>
  );
}

/**
 * The subject, opened where a runner would see it: the shared kit's page,
 * which shows a reported photo among its own. A link that is not ours says
 * so instead. A link on its own line, so a full-size target (rule 03).
 */
function SubjectLink({
  subject,
}: Readonly<{ subject: TakedownSubject | undefined }>): JSX.Element {
  if (subject === undefined) {
    return (
      <p className="m-0 text-body text-quiet">
        Not one of our links: find it from what they wrote.
      </p>
    );
  }
  return (
    <Link
      to="/feed/entry/$entryId"
      params={{ entryId: subject.entryId }}
      className="target self-start font-bold text-ink underline underline-offset-4"
    >
      {subject.subjectType === "entry" ? "Open the kit" : "Open its kit"}
    </Link>
  );
}

function RemoveForm({
  requestId,
  decide,
  onDecided,
}: Readonly<{
  requestId: string;
  decide: Decide;
  onDecided: () => void;
}>): JSX.Element {
  const form = useFormSubmit({
    schema: z.object({}),
    action: () => decide({ data: { requestId, outcome: "removed" } }),
    successMessage: "Removed.",
    onSuccess: onDecided,
  });
  return (
    <FormElement
      form={form}
      dataPart="remove"
      onSubmit={() => {
        void form.submit({});
      }}
    >
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Take it down"
        pendingLabel="Taking it down"
        pending={form.pending}
      />
    </FormElement>
  );
}

function DeclineForm({
  requestId,
  decide,
  onDecided,
}: Readonly<{
  requestId: string;
  decide: Decide;
  onDecided: () => void;
}>): JSX.Element {
  const [reason, setReason] = useState("");
  const form = useFormSubmit({
    schema: declineSchema,
    action: (values) =>
      decide({ data: { requestId, outcome: "declined", ...values } }),
    successMessage: "Declined.",
    onSuccess: onDecided,
  });
  return (
    <FormElement
      form={form}
      dataPart="decline"
      onSubmit={() => {
        void form.submit({ reason });
      }}
    >
      <TextField
        name="reason"
        label="Why not"
        hint="The person who asked is sent this."
        value={reason}
        onChange={setReason}
        field={form.field}
        error={form.fieldErrors.reason}
      />
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Decline"
        pendingLabel="Declining"
        pending={form.pending}
      />
    </FormElement>
  );
}
