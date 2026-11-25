import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { z } from "zod";

import { declineReasonField } from "../../rules/contracts";
import {
  Bracketed,
  FormElement,
  FormFailureBand,
  ListSection,
  Mono,
  MONO_CASED_CLASS,
  PageLinks,
  QUIET_CANCEL,
  QUIET_PILL,
  SubmitButton,
  TextField,
  useFormSubmit,
  useReturnFocus,
} from "../../../../ui";
import type { FormShell } from "../../../../ui";
import { blockRequesterInput } from "../../inputs";
import type { HoldState } from "../../limits/takedown-limits";
import type { BlockResult, PendingTakedownRequest } from "../takedown-requests";
import { ACTION_BAR } from "../../components/DeskForm";
import { DueClock } from "../../components/DueClock";
import { shortId } from "../../components/short-id";
import { StatutoryLine } from "../../components/StatutoryLine";
import {
  KitOriginContext,
  kitOriginAnchor,
  useReturnToRow,
} from "../../review/components/kit-origin";
import { OtherPhotos } from "../../review/components/OtherPhotos";
import { reviewPhotoSrc } from "../../review/components/review-photo-src";
import {
  PhotoMatches,
  type DecideMatch,
} from "../../review/components/PhotoMatches";
import { useSettled } from "../../components/use-settled";

/**
 * Decline's one field — the decision's server input reads the same one
 * (`removalDecisionInput`), so the form says it before the round trip.
 */
const declineSchema = z.object({ reason: declineReasonField });

type Decide = (input: {
  data:
    | { requestId: string; outcome: "removed" }
    | { requestId: string; outcome: "declined"; reason: string };
}) => Promise<{ outcome: "decided" | "already_decided" | "not_found" }>;

/**
 * A decision's answer, as the page says it: what it did only where this
 * press decided the request, and otherwise why nothing was done.
 */
function decidedSaid(
  done: string,
): (result: Awaited<ReturnType<Decide>>) => string {
  return ({ outcome }) => {
    if (outcome === "decided") return done;
    return outcome === "already_decided" ? ALREADY_DECIDED : NO_LONGER_OPEN;
  };
}

/**
What the page says of a request no longer pending, or gone.
*/
const NO_LONGER_OPEN = "That request is no longer open.";

/**
What the page says of a request someone decided before this press landed.
*/
const ALREADY_DECIDED = "Someone already decided this request.";

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

type Block = (input: { data: { requestId: string } }) => Promise<BlockResult>;

/**
 * Block and decline all's answer, as the page says it: how many it
 * declined, from the server's count.
 */
function blockedSaid(result: BlockResult): string {
  if (result.status === "not_found") return NO_LONGER_OPEN;
  if (result.status === "decided") return ALREADY_DECIDED;
  const { declined } = result;
  return `Blocked. ${String(declined)} ${declined === 1 ? "request" : "requests"} declined.`;
}

/**
 * The requests that leave the list after a block: those it declined, or,
 * when it found nothing open, the one it was asked about, which is gone.
 */
function goneAfter(result: BlockResult, requestId: string): readonly string[] {
  return result.status === "blocked" ? result.declinedIds : [requestId];
}

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
A request needs no state to be returned to: focus is all it takes.
*/
function ignoreRow(): void {
  /*
   * Nothing to open: every request is drawn open.
   */
}

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
  pending = requests.length,
  page,
  asOf,
  decide,
  block,
  decideMatch,
  onChanged,
}: Readonly<{
  requests: readonly PendingTakedownRequest[];
  /**
   * How many requests are pending in all, when the page was read: more
   * than `requests` once they run past the list (`pendingTakedownCount`).
   */
  pending?: number;
  /**
   * Which page this is (`pendingTakedownPage`): the place it starts
   * after, the next page's, and how many pending requests come before it.
   * None is the first page.
   */
  page?: RequestsPage;
  /**
  After a decision or a block, so the route reads the list again.
  */
  onChanged: () => void;
  /**
  When the page was read, for each request's clock (R55·197).
  */
  asOf: number;
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
  // Back from a kit, the request it was opened from is focused (round 52
  // #155.5).
  useReturnToRow("request", ignoreRow);
  const waiting = pending - (requests.length - remaining.length);
  return (
    <>
      <ListSection
        title={`Removal requests · ${String(waiting)}`}
        items={remaining}
        hasCards
      >
        {(request) => (
          <RemovalRequestRow
            key={request.id}
            request={request}
            asOf={asOf}
            actions={{ decide, block, decideMatch }}
            hasFocus={focusId === request.id}
            onFocused={() => {
              setFocusId(undefined);
            }}
            onDecided={() => {
              settle(request.id);
              onChanged();
            }}
            onBlocked={(declined) => {
              const gone = new Set(declined);
              for (const id of gone) settle(id);
              // The first request left, or none when the block took them all.
              const [next] = remaining
                .filter((row) => !gone.has(row.id))
                .map((row) => row.id);
              setFocusId(next);
              onChanged();
            }}
          />
        )}
      </ListSection>
      <ShownOf
        shown={remaining.length}
        waiting={waiting}
        before={page?.after === undefined ? undefined : page.before}
      />
      <PageLinks
        to="/desk/review"
        shown={requests.length}
        next={page?.next}
        after={page?.after}
        backLabel="← Back to the soonest due"
      />
    </>
  );
}

/**
Which page of the removal requests is shown (`pendingTakedownPage`).
*/
interface RequestsPage {
  readonly after: string | undefined;
  readonly next: string | undefined;
  readonly before: number;
}

/**
 * How many of the pending requests are listed: on the first page, when
 * not all are; on a later one (`before` known), which of them, with the
 * range's end not past the total.
 */
function ShownOf({
  shown,
  waiting,
  before,
}: Readonly<{
  shown: number;
  waiting: number;
  before: number | undefined;
}>): JSX.Element | undefined {
  if (shown === 0) return undefined;
  if (before !== undefined) {
    const to = Math.min(before + shown, waiting);
    return (
      <p className="m-0 text-body text-quiet" data-part="requests-shown">
        {`Showing ${String(before + 1)}–${String(to)} of ${String(waiting)}.`}
      </p>
    );
  }
  if (shown >= waiting) return undefined;
  return (
    <p className="m-0 text-body text-quiet" data-part="requests-shown">
      {`Showing ${String(shown)} of ${String(waiting)}. The rest come in as these are decided.`}
    </p>
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
  asOf: number;
  actions: RowActions;
  hasFocus: boolean;
  onFocused: () => void;
  onDecided: () => void;
  onBlocked: (declined: readonly string[]) => void;
}>;

/**
 * A request's head (R55·197), the queue row's: `ENTRY · id · @owner [VIA
 * /TAKEDOWN]` in MONO.sm, with what filing decided after it. The owner is
 * read from the kit, as on every Desk row; the handle the requester typed
 * is their word, and goes in the body (`PosterClaim`). A link that names
 * nothing of ours is a LINK, with no id or owner. The kind and the tags
 * in capitals; the id and the handle in their own case (G-19).
 */
function RequestHead({
  request,
}: Readonly<{ request: PendingTakedownRequest }>): JSX.Element {
  const { subject, owner, holdState } = request;
  return (
    <>
      <span
        aria-hidden="true"
        data-part="request-head"
        title={subject?.subjectId}
        className={`min-w-0 truncate ${MONO_CASED_CLASS.sm}`}
      >
        <span className="uppercase">{subject?.subjectType ?? "link"}</span>
        {subject === undefined ? undefined : ` · ${shortId(subject.subjectId)}`}
        {owner === undefined ? undefined : ` · @${owner}`}{" "}
        <Bracketed>via /takedown</Bracketed>
        {holdState === undefined ? undefined : (
          <>
            {" "}
            <span data-part="hold-state">
              <Bracketed>{HOLD_WORDS[holdState]}</Bracketed>
            </span>
          </>
        )}
      </span>
      <span className="sr-only">{requestHeard(request)}</span>
    </>
  );
}

/**
The request's head as a screen reader hears it (D-150, #792): the drawn
words in one line, with no brackets, as the queue row's head is heard.
*/
function requestHeard({
  subject,
  owner,
  holdState,
}: PendingTakedownRequest): string {
  const named =
    subject === undefined
      ? "link"
      : `${subject.subjectType} · ${shortId(subject.subjectId)}`;
  const whose = owner === undefined ? "" : ` · @${owner}`;
  const hold = holdState === undefined ? "" : ` ${HOLD_WORDS[holdState]}`;
  return `${named}${whose} via /takedown${hold}`;
}

/**
 * Who the requester says posted it (round 37 #59g), as their word: the
 * handle is never checked against anyone, so it is said so beside it
 * (owner, 2026-11-21; placeholder words for Design).
 */
function PosterClaim({
  posterUsername,
}: Readonly<{ posterUsername: string | undefined }>): JSX.Element | undefined {
  return posterUsername === undefined ? undefined : (
    <span data-part="poster-claim" className="text-body">
      They name @{posterUsername} (not checked)
    </span>
  );
}

/**
 * The photo a request names, so the decision is made on the picture and
 * not only on a link (SA-M24). Drawn as the Desk kit's own photos are
 * (a guess for Design, design 226); nothing for a kit or a link not ours.
 */
function SubjectPhoto({
  photoKey,
}: Readonly<{ photoKey: string | undefined }>): JSX.Element | undefined {
  return photoKey === undefined ? undefined : (
    <img
      src={reviewPhotoSrc(photoKey)}
      alt="Requested"
      data-part="subject-photo"
      className="h-32 w-auto self-start border border-hairline"
    />
  );
}

function RemovalRequestRow(props: RowProps): JSX.Element {
  const { request, asOf, hasFocus, onFocused, onDecided, onBlocked } = props;
  const { decide, block, decideMatch } = props.actions;
  const takeFocus = focusOnce(hasFocus, onFocused);
  const origin = { from: "request", row: request.id } as const;
  return (
    <li
      ref={takeFocus}
      id={kitOriginAnchor(origin)}
      tabIndex={-1}
      data-part="removal-request"
      className="flex flex-col rounded-card border border-hairline bg-panel"
    >
      <KitOriginContext value={origin}>
        {/* R55·197: the queue row's head, its clock at the right. */}
        <span className="flex items-center justify-between gap-4 px-4 py-3">
          <RequestHead request={request} />
          <span className="shrink-0 whitespace-nowrap">
            <DueClock due={request.due} isOverdue={request.dueAt <= asOf} />
          </span>
        </span>
        <div
          data-part="request-body"
          className="flex flex-col gap-3 border-t border-hairline p-4"
        >
          <span className="flex flex-col gap-1">
            <span className="text-label uppercase">
              <Mono step="xs">
                From {request.signature} · signed · good faith
              </Mono>
            </span>
            {request.description === undefined ? undefined : (
              <q className="text-body">{request.description}</q>
            )}
            <PosterClaim posterUsername={request.posterUsername} />
            {/* The only way to tell who filed: wrapped, never cut (P3-05). */}
            <span
              data-part="requester"
              className="text-micro text-quiet wrap-anywhere"
            >
              {request.requesterEmail}
            </span>
            {request.relatedIds.length === 0 ? undefined : (
              <span data-part="related" className="text-micro text-ink">
                {String(request.relatedIds.length)} more from this requester
              </span>
            )}
          </span>
          <SubjectPhoto photoKey={request.subjectPhotoKey} />
          <SubjectLink request={request} />
          <StatutoryLine />
          <OtherPhotos others={request.otherPhotos} />
          <PhotoMatches found={request.photoMatches} decide={decideMatch} />
        </div>
        <div
          data-part="request-bar"
          className="border-t border-hairline px-4 py-3"
        >
          <RequestActions
            request={request}
            acts={{ decide, block, onDecided, onBlocked }}
          />
        </div>
      </KitOriginContext>
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
    onBlocked: (declined: readonly string[]) => void;
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
        asks={blockAsked(request)}
        acts={{
          block,
          onBlocked,
          onCancel: () => {
            setAsking(undefined);
            blockedFrom.restore();
          },
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
    <RemoveForm deciding={deciding}>
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
    </RemoveForm>
  );
}

/**
 * A question asked in the bar's place: what it asks, the §4a band, then
 * its answer as the chalk pill and Cancel beside it. Esc anywhere in it is
 * Cancel. On a wrapper, because `FormElement` is the forms primitive and
 * takes no key handler; a key pressed inside the form bubbles to it.
 */
export function QuestionInPlace({
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
 * Block and decline all's question, as the server will answer it: the
 * request and those sharing both its keys (`relatedIds`), its network
 * when it has one, and its address only once confirmed.
 */
function blockAsked(request: PendingTakedownRequest): string {
  const count = request.relatedIds.length + 1;
  const which =
    count === 1 ? "this request" : `all ${String(count)} of these requests`;
  if (request.isConfirmed) {
    const reach = request.hasNetworkKey ? "address and network" : "address";
    return `Block this ${reach} and decline ${which}? Anything they hid comes back, and nothing is sent to them.`;
  }
  return request.hasNetworkKey
    ? `Block this network and decline ${which}? The address is not blocked: nobody confirmed it.`
    : "Decline this request as abuse? Nothing else is blocked: nobody confirmed the address.";
}

/**
 * Block and decline all's question, in the bar's place. Undesigned: the
 * review row's own parts, placeholder words (design deltas).
 */
function BlockQuestion({
  requestId,
  asks,
  acts,
}: Readonly<{
  requestId: string;
  /**
  What the question says the block will reach (`blockAsked`).
  */
  asks: string;
  /**
  What sends the block, what follows it, and the way back.
  */
  acts: Readonly<{
    block: Block;
    onBlocked: (declined: readonly string[]) => void;
    onCancel: () => void;
  }>;
}>): JSX.Element {
  const { block, onBlocked, onCancel } = acts;
  const form = useFormSubmit({
    carry: "page",
    schema: blockRequesterInput,
    action: (values) => block({ data: values }),
    successMessage: blockedSaid,
    onSuccess: (result) => {
      onBlocked(goneAfter(result, requestId));
    },
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
      <p className="m-0 text-body">{asks}</p>
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
      search={{ from: "request", row: request.id }}
      className="target self-start font-bold text-ink underline underline-offset-4"
    >
      {subject.subjectType === "entry" ? "Open the kit" : "Open its kit"}
    </Link>
  );
}

/**
 * Take it down, and the bar it leads: its failure band goes above the
 * whole bar, as `DeskForm` puts one, so the buttons stay one row (P3-01).
 * `children` are the bar's other presses, which submit nothing.
 */
function RemoveForm({
  deciding,
  children,
}: Readonly<{ deciding: Deciding; children: ReactNode }>): JSX.Element {
  const { requestId, decide, onDecided } = deciding;
  const form = useFormSubmit({
    carry: "page",
    schema: z.object({}),
    action: () => decide({ data: { requestId, outcome: "removed" } }),
    successMessage: decidedSaid("Removed."),
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
      <div data-part="request-actions" className={ACTION_BAR}>
        <SubmitButton
          tone="chalk"
          label="Take it down"
          pendingLabel="Taking it down"
          pending={form.pending}
        />
        {children}
      </div>
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
    successMessage: decidedSaid("Declined."),
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
