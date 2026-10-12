import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";
import { z } from "zod";

import { declineReasonField } from "../contracts";
import {
  Bracketed,
  FormElement,
  FormFailureBand,
  ListSection,
  Mono,
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
 * Review's removal requests (design 136, decision D-117), as round 35
 * #58e draws them: REMOVAL REQUESTS · N above the queue, soonest due
 * first, each row the queue row's shape. The header names the subject
 * with `[via /takedown]` and the clock right, where the age sits (#58b);
 * then who signed and what they said; then Take it down, and Decline,
 * a text button that asks for the one line the requester is sent.
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
    <ListSection
      title={`Removal requests · ${String(remaining.length)}`}
      items={remaining}
    >
      {(request) => (
        <RemovalRequestRow
          key={request.id}
          request={request}
          decide={decide}
          onDecided={() => {
            settle(request.id);
          }}
        />
      )}
    </ListSection>
  );
}

function RemovalRequestRow({
  request,
  decide,
  onDecided,
}: Readonly<{
  request: PendingTakedownRequest;
  decide: Decide;
  onDecided: () => void;
}>): JSX.Element {
  const [isDeclining, setIsDeclining] = useState(false);
  return (
    <li
      data-part="removal-request"
      className="flex flex-col gap-3 border-b border-hairline py-4"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-body font-semibold text-ink">
            {request.subject?.subjectType ?? "link"}
          </span>
          <span className="text-micro text-quiet">
            <Bracketed>via /takedown</Bracketed>
          </span>
        </span>
        <span data-part="due" className="text-ink uppercase">
          <Mono step="xs">{request.due}</Mono>
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-label uppercase">
          <Mono step="xs">From {request.signature} · signed · good faith</Mono>
        </span>
        {request.description === undefined ? undefined : (
          <q className="text-body">{request.description}</q>
        )}
        <span className="text-micro text-quiet">{request.requesterEmail}</span>
      </span>
      <SubjectLink request={request} />
      <RemoveForm
        requestId={request.id}
        decide={decide}
        onDecided={onDecided}
      />
      {isDeclining ? (
        <DeclineForm
          requestId={request.id}
          decide={decide}
          onDecided={onDecided}
        />
      ) : (
        <button
          type="button"
          className="target self-start"
          onClick={() => {
            setIsDeclining(true);
          }}
        >
          <Mono step="xs">Decline</Mono>
        </button>
      )}
    </li>
  );
}

/**
 * The subject, opened where a runner would see it: the shared kit's page,
 * which shows a reported photo among its own. A link that is not ours is
 * shown as given, and says so. A link on its own line, so a full-size
 * target (rule 03).
 */
function SubjectLink({
  request,
}: Readonly<{ request: PendingTakedownRequest }>): JSX.Element {
  const { subject } = request;
  if (subject === undefined) {
    return (
      <span className="flex flex-col gap-1">
        <span className="text-body break-words">{request.location}</span>
        <span className="text-body text-quiet">
          Not one of our links: find it from what they wrote.
        </span>
      </span>
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
