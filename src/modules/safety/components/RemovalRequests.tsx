import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { z } from "zod";

import { declineReasonField } from "../contracts";
import {
  Bracketed,
  FormElement,
  FormFailureBand,
  ListSection,
  Mono,
  QUIET_CANCEL,
  QUIET_PILL,
  SubmitButton,
  TextField,
  useFormSubmit,
  useReturnFocus,
} from "../../../ui";
import type { FormShell } from "../../../ui";
import { blockRequesterInput } from "../inputs";
import type { HoldState } from "../takedown-limits";
import type { PendingTakedownRequest } from "../takedown-requests";
import { ACTION_BAR } from "./DeskForm";
import { StatutoryLine } from "./StatutoryLine";
import { OtherPhotos } from "./OtherPhotos";
import { PhotoMatches, type DecideMatch } from "./PhotoMatches";
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
 * One request's decision: which request, what sends it, and what follows.
 */
type Deciding = Readonly<{
  requestId: string;
  decide: Decide;
  onDecided: () => void;
}>;

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
  decideMatch,
}: Readonly<{
  requests: readonly PendingTakedownRequest[];
  decide: Decide;
  block: Block;
  /**
   * Takes down a garment photo copy search found (design 159); without
   * it, a garment match is shown and offers nothing.
   */
  decideMatch?: DecideMatch | undefined;
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
          actions={{ decide, block, decideMatch }}
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

/**
 * What a row can do with its request, handed down from the route: decide
 * it, block its requester, and take down a garment photo copy search
 * found (design 159).
 */
type RowActions = Readonly<{
  decide: Decide;
  block: Block;
  decideMatch: DecideMatch | undefined;
}>;

type RowProps = Readonly<{
  request: PendingTakedownRequest;
  actions: RowActions;
  hasFocus: boolean;
  onFocused: () => void;
  onDecided: () => void;
  onBlocked: () => void;
}>;

function RemovalRequestRow(props: RowProps): JSX.Element {
  const { request, hasFocus, onFocused, onDecided, onBlocked } = props;
  const { decide, block, decideMatch } = props.actions;
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
      <StatutoryLine />
      <OtherPhotos others={request.otherPhotos} />
      <PhotoMatches found={request.photoMatches} decide={decideMatch} />
      <RequestActions
        request={request}
        acts={{ decide, block, onDecided, onBlocked }}
      />
    </li>
  );
}

/**
 * A request's decisions, as rounds 37 and 44 draw them: one bar, Take it
 * down first, then Decline and Block and decline all as outline pills.
 * Each of those two asks in the bar's place. Block and decline all asks
 * first (design 137) because it declines every open request from this
 * requester at once and blocks them; nothing is sent to them. Decline asks
 * why not (round 45 #107), and what was typed is kept through Cancel until
 * the row is decided. Cancel or Esc draws the bar again with focus on the
 * button that asked (round 37 #59f).
 */
function RequestActions({
  request,
  acts,
}: Readonly<{
  request: PendingTakedownRequest;
  /**
  What a decision is sent through, and what follows it.
  */
  acts: Readonly<{
    decide: Decide;
    block: Block;
    onDecided: () => void;
    onBlocked: () => void;
  }>;
}>): JSX.Element {
  const { decide, block, onDecided, onBlocked } = acts;
  const deciding = { requestId: request.id, decide, onDecided };
  const [asking, setAsking] = useState<"decline" | "block" | undefined>();
  const [reason, setReason] = useState("");
  const declinedFrom = useReturnFocus();
  const blockedFrom = useReturnFocus();
  if (asking === "block") {
    return (
      <BlockQuestion
        requestId={request.id}
        count={request.relatedIds.length + 1}
        block={block}
        onBlocked={onBlocked}
        onCancel={() => {
          setAsking(undefined);
          blockedFrom.restore();
        }}
      />
    );
  }
  if (asking === "decline") {
    return (
      <DeclineQuestion
        deciding={deciding}
        reason={{ value: reason, onChange: setReason }}
        onCancel={() => {
          setAsking(undefined);
          declinedFrom.restore();
        }}
      />
    );
  }
  return (
    <div data-part="request-actions" className={ACTION_BAR}>
      <RemoveForm deciding={deciding} />
      <button
        ref={declinedFrom.ref}
        type="button"
        className={`target ${QUIET_PILL}`}
        onClick={() => {
          setAsking("decline");
        }}
      >
        Decline
      </button>
      <button
        ref={blockedFrom.ref}
        type="button"
        className={`target ${QUIET_PILL}`}
        onClick={() => {
          setAsking("block");
        }}
      >
        Block and decline all
      </button>
    </div>
  );
}

/**
 * A question asked in the bar's place: what it asks, the §4a band, then
 * its answer as the chalk pill and Cancel beside it. Esc anywhere in it is
 * Cancel. On a wrapper, because `FormElement` is the forms primitive and
 * takes no key handler; a key pressed inside the form bubbles to it.
 */
function QuestionInPlace({
  form,
  dataPart,
  onSubmit,
  answer,
  children,
}: Readonly<{
  form: FormShell;
  dataPart: string;
  onSubmit: () => void;
  /**
  The answer's words, the way back, and whether Cancel takes focus.
  */
  answer: Readonly<{
    label: string;
    pendingLabel: string;
    onCancel: () => void;
    cancelHasFocus: boolean;
  }>;
  children: ReactNode;
}>): JSX.Element {
  // Where the question opens (round 37 #59f, round 45 #107): Block's on
  // Cancel, the safe answer; Decline's on its field. State rather than a
  // ref, so the effect runs once the question is in the page.
  const [question, setQuestion] = useState<HTMLDivElement | undefined>();
  useEffect(() => {
    const target = question?.querySelector<HTMLElement>(
      answer.cancelHasFocus ? "[data-part='cancel']" : "input",
    );
    if (target) target.focus();
  }, [question, answer.cancelHasFocus]);
  // `presentation`: the wrapper only catches what bubbles, and is no
  // control itself.
  return (
    <div
      role="presentation"
      ref={(node) => {
        setQuestion(node ?? undefined);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") answer.onCancel();
      }}
    >
      <FormElement form={form} dataPart={dataPart} onSubmit={onSubmit}>
        {children}
        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <div className={ACTION_BAR}>
          <SubmitButton
            tone="chalk"
            label={answer.label}
            pendingLabel={answer.pendingLabel}
            pending={form.pending}
          />
          <button
            type="button"
            data-part="cancel"
            className={`target ${QUIET_CANCEL}`}
            onClick={answer.onCancel}
          >
            Cancel
          </button>
        </div>
      </FormElement>
    </div>
  );
}

/**
 * Block and decline all's question, in the bar's place. Undesigned: the
 * review row's own parts, placeholder words (design deltas).
 */
function BlockQuestion({
  requestId,
  count,
  block,
  onBlocked,
  onCancel,
}: Readonly<{
  requestId: string;
  count: number;
  block: Block;
  onBlocked: () => void;
  onCancel: () => void;
}>): JSX.Element {
  const form = useFormSubmit({
    carry: "page",
    schema: blockRequesterInput,
    action: (values) => block({ data: values }),
    successMessage: `Blocked. ${String(count)} ${count === 1 ? "request" : "requests"} declined.`,
    onSuccess: onBlocked,
  });
  return (
    <QuestionInPlace
      form={form}
      dataPart="block"
      onSubmit={() => {
        void form.submit({ requestId });
      }}
      answer={{
        label: "Block and decline all",
        pendingLabel: "Blocking",
        onCancel,
        cancelHasFocus: true,
      }}
    >
      <p className="m-0 text-body">
        Block this requester and decline{" "}
        {count === 1
          ? "this request"
          : `all ${String(count)} of their requests`}
        ? Anything they hid comes back, and nothing is sent to them.
      </p>
    </QuestionInPlace>
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
      to="/desk/kit/$entryId"
      params={{ entryId: subject.entryId }}
      className="target self-start font-bold text-ink underline underline-offset-4"
    >
      {subject.subjectType === "entry" ? "Open the kit" : "Open its kit"}
    </Link>
  );
}

function RemoveForm({
  deciding,
}: Readonly<{ deciding: Deciding }>): JSX.Element {
  const { requestId, decide, onDecided } = deciding;
  const form = useFormSubmit({
    carry: "page",
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
        tone="chalk"
        label="Take it down"
        pendingLabel="Taking it down"
        pending={form.pending}
      />
    </FormElement>
  );
}

function DeclineQuestion({
  deciding,
  reason,
  onCancel,
}: Readonly<{
  deciding: Deciding;
  /**
  What was typed, kept by the row so Cancel does not lose it.
  */
  reason: Readonly<{ value: string; onChange: (next: string) => void }>;
  onCancel: () => void;
}>): JSX.Element {
  const { requestId, decide, onDecided } = deciding;
  const form = useFormSubmit({
    carry: "page",
    schema: declineSchema,
    action: (values) =>
      decide({ data: { requestId, outcome: "declined", ...values } }),
    successMessage: "Declined.",
    onSuccess: onDecided,
  });
  return (
    <QuestionInPlace
      form={form}
      dataPart="decline"
      onSubmit={() => {
        void form.submit({ reason: reason.value });
      }}
      answer={{
        label: "Decline",
        pendingLabel: "Declining",
        onCancel,
        cancelHasFocus: false,
      }}
    >
      <Mono step="xs">Decline this request</Mono>
      <TextField
        name="reason"
        label="Why not"
        hint="The person who asked is sent this. Not nude or sexual? Say so."
        value={reason.value}
        onChange={reason.onChange}
        field={form.field}
        error={form.fieldErrors.reason}
      />
    </QuestionInPlace>
  );
}
