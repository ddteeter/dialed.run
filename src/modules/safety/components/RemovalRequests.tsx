import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  useReturnFocus,
} from "../../../ui";
import { blockRequesterInput } from "../inputs";
import type { HoldState } from "../takedown-limits";
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

function requestId(request: PendingTakedownRequest): string {
  return request.id;
}

type Block = (input: { data: { requestId: string } }) => Promise<unknown>;

/**
 * What filing decided, as Review says it (design 137). Placeholder words
 * (design deltas).
 */
const HOLD_WORDS: Readonly<Record<HoldState, string>> = {
  held: "hidden",
  confirm: "unconfirmed",
  valve: "valve shut",
  blocked: "blocked",
};

/**
 * Review's removal requests (design 136, decision D-117), as round 35
 * #58e draws them: REMOVAL REQUESTS · N above the queue, soonest due
 * first, each row the queue row's shape. The header names the subject
 * with `[via /takedown]` and the clock right, where the age sits (#58b);
 * then who signed and what they said; then Take it down, and Decline,
 * a text button that asks for the one line the requester is sent.
 */
export function RemovalRequests({
  requests,
  decide,
  block,
}: Readonly<{
  requests: readonly PendingTakedownRequest[];
  decide: Decide;
  block: Block;
}>): JSX.Element | undefined {
  // A decided request leaves the list, as a decided review row does.
  const { remaining, settle } = useSettled(requests, requestId);
  // Round 37 #59f: after a block, focus goes to the next request left.
  const [focusId, setFocusId] = useState<string>();
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
          block={block}
          hasFocus={focusId === request.id}
          onFocused={() => {
            setFocusId(undefined);
          }}
          onDecided={() => {
            settle(request.id);
          }}
          onBlocked={() => {
            const gone = new Set([request.id, ...request.relatedIds]);
            for (const id of gone) settle(id);
            // The first request left, or none when the block took them all.
            const [next] = remaining
              .filter((row) => !gone.has(row.id))
              .map((row) => row.id);
            setFocusId(next);
          }}
        />
      )}
    </ListSection>
  );
}

/**
 * The Cancel of a question asked in place. The question opens on Cancel
 * (round 37 #59f), so the safe answer is the one under focus.
 */
function CancelButton({
  onCancel,
}: Readonly<{ onCancel: () => void }>): JSX.Element {
  // State rather than a ref, so the effect runs once the button exists.
  const [button, setButton] = useState<HTMLButtonElement | undefined>();
  useEffect(() => {
    button?.focus();
  }, [button]);
  return (
    <button
      ref={(node) => {
        setButton(node ?? undefined);
      }}
      type="button"
      className="target self-start"
      onClick={onCancel}
    >
      <Mono step="xs">Cancel</Mono>
    </button>
  );
}

/**
 * A ref callback that focuses its element once: the flag clears as focus
 * lands, so a later render of the row never takes focus back from a
 * control inside it.
 */
function focusOnce(
  hasFocus: boolean,
  onFocused: () => void,
): (node: HTMLElement | null) => void {
  return (node) => {
    if (!hasFocus || node === null) return;
    node.focus();
    onFocused();
  };
}

function RemovalRequestRow({
  request,
  decide,
  block,
  hasFocus,
  onFocused,
  onDecided,
  onBlocked,
}: Readonly<{
  request: PendingTakedownRequest;
  decide: Decide;
  block: Block;
  hasFocus: boolean;
  onFocused: () => void;
  onDecided: () => void;
  onBlocked: () => void;
}>): JSX.Element {
  const [isDeclining, setIsDeclining] = useState(false);
  const takeFocus = focusOnce(hasFocus, onFocused);
  return (
    <li
      ref={takeFocus}
      tabIndex={-1}
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
          {request.holdState === undefined ? undefined : (
            <span data-part="hold-state" className="text-micro text-ink">
              <Bracketed>{HOLD_WORDS[request.holdState]}</Bracketed>
            </span>
          )}
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
        {request.relatedIds.length === 0 ? undefined : (
          <span data-part="related" className="text-micro text-ink">
            {String(request.relatedIds.length)} more from this requester
          </span>
        )}
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
      <BlockRequester
        requestId={request.id}
        count={request.relatedIds.length + 1}
        block={block}
        onBlocked={onBlocked}
      />
    </li>
  );
}

/**
 * Block and decline all (design 137): asks in the row first, because it
 * declines every open request from this requester at once and blocks
 * them. Nothing is sent to them. Undesigned: the review row's own parts,
 * placeholder words (design deltas).
 */
function BlockRequester({
  requestId,
  count,
  block,
  onBlocked,
}: Readonly<{
  requestId: string;
  count: number;
  block: Block;
  onBlocked: () => void;
}>): JSX.Element {
  const [isAsking, setIsAsking] = useState(false);
  // Round 37 #59f: the question opens on Cancel, as CSAM's does, and
  // Cancel or Esc hands focus back to the button that asked.
  const askedFrom = useReturnFocus();
  const form = useFormSubmit({
    schema: blockRequesterInput,
    action: (values) => block({ data: values }),
    successMessage: `Blocked. ${String(count)} ${count === 1 ? "request" : "requests"} declined.`,
    onSuccess: onBlocked,
  });
  function stopAsking(): void {
    setIsAsking(false);
    askedFrom.restore();
  }
  if (!isAsking) {
    return (
      <button
        ref={askedFrom.ref}
        type="button"
        className="target self-start"
        onClick={() => {
          setIsAsking(true);
        }}
      >
        <Mono step="xs">Block and decline all</Mono>
      </button>
    );
  }
  // Esc anywhere in the question is Cancel. On a wrapper, because
  // `FormElement` is the forms primitive and takes no key handler; a key
  // pressed inside the form bubbles to it.
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") stopAsking();
      }}
    >
      <FormElement
        form={form}
        dataPart="block"
        onSubmit={() => {
          void form.submit({ requestId });
        }}
      >
        <p className="m-0 text-body">
          Block this requester and decline{" "}
          {count === 1
            ? "this request"
            : `all ${String(count)} of their requests`}
          ? Anything they hid comes back, and nothing is sent to them.
        </p>
        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <SubmitButton
          label="Block and decline all"
          pendingLabel="Blocking"
          pending={form.pending}
        />
        <CancelButton onCancel={stopAsking} />
      </FormElement>
    </div>
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
          {request.posterUsername === undefined
            ? "Not one of our links: find it from what they wrote."
            : `Not one of our links: find it on @${request.posterUsername}'s entries from what they wrote.`}
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
