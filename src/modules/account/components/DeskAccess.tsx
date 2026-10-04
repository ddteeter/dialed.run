import { useEffect, useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import {
  FailureBand,
  FormElement,
  FormFailureBand,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  useControlAction,
  useFormSubmit,
  useIdempotencyKey,
} from "../../../ui";
import { newInviteSchema } from "../inputs";
import type { AccessDesk, DeskCode, DeskRequest } from "../invites";

/**
 * How long a revoked row keeps its Undo (round 26 #20: "no confirm; it's
 * undoable for 10 s"; round 28 #9: on the row, with no countdown).
 */
export const UNDO_WINDOW_MS = 10_000;

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
/**
From here an age is a date (round 28 #9: "From 30 days on they show a date").
*/
const DATED_FROM_S = 30 * DAY_S;

/**
 * An age as round 28 #9 draws it, in MONO.sm capitals: `NOW` under a
 * minute, then whole minutes, hours and days (`12M`, `5H`, `3D`), and a
 * date (`AUG 29`) from 30 days. Lowercase here; the mono step's CSS sets
 * the capitals, so a screen reader hears "5h", not five letters.
 */
export function ageLabel(createdAt: number, asOf: number): string {
  const seconds = Math.max(0, asOf - createdAt);
  if (seconds < MINUTE_S) return "now";
  if (seconds < HOUR_S) return `${String(Math.floor(seconds / MINUTE_S))}m`;
  if (seconds < DAY_S) return `${String(Math.floor(seconds / HOUR_S))}h`;
  if (seconds < DATED_FROM_S) return `${String(Math.floor(seconds / DAY_S))}d`;
  return monthDayLabel(createdAt);
}

/**
Whether a code can still let anyone in.
*/
function isActive(code: DeskCode): boolean {
  return !code.isRevoked && code.usedBy.length < code.maxUses;
}

/**
 * The Codes header's counts: "12 active · 31 used", where used is every
 * account a code let in.
 */
export function codeCounts(codes: readonly DeskCode[]): string {
  const active = codes.filter((code) => isActive(code)).length;
  const used = codes.reduce((sum, code) => sum + code.usedBy.length, 0);
  return `${String(active)} active · ${String(used)} used`;
}

/**
 * The codes in the server's order (newest first), with revoked ones at
 * the foot — except the one whose Undo is showing, which stays where it
 * was until its ten seconds are up (round 28 #9).
 */
export function orderedCodes(
  codes: readonly DeskCode[],
  holding: string | undefined,
): DeskCode[] {
  const isStaying = (code: DeskCode) => !code.isRevoked || code.id === holding;
  return [
    ...codes.filter((code) => isStaying(code)),
    ...codes.filter((code) => !isStaying(code)),
  ];
}

/**
 * The status line over the list when a code is made (round 28 #9):
 * "DIAL-7QX2 MADE · LINK COPIED", or just MADE when the copy failed and
 * the row's band shows the link instead.
 */
export function madeLine(code: string, isCopied: boolean): string {
  return isCopied ? `${code} made · link copied` : `${code} made`;
}

type RowAction = (input: { data: { id: string } }) => Promise<unknown>;

/**
 * What each row action says when it fails, under its own row (round 29
 * #14): the state still true, and the board's sentence. The page-level
 * band is gone; only New code, which has no row yet, keeps the form's.
 */
const ROW_FAILURES = {
  invite: {
    kicker: "Not sent",
    sentence: "Send invite didn't go through. No email went out. Try again?",
  },
  decline: {
    kicker: "Still waiting",
    sentence:
      "Decline didn't go through. The request is still here. Try again?",
  },
  undo: {
    kicker: "Still revoked",
    sentence: "Undo didn't go through. Try again?",
  },
  revoke: {
    kicker: "Still active",
    sentence: "Revoke didn't go through. Try again?",
  },
} as const;

type RowFailureKind = keyof typeof ROW_FAILURES;

/**
 * One row action: in flight behind the server (never optimistic), which
 * row it was last pressed on, and that row's band. A failure is said once
 * in the page's one status region, in the band's own words; focus stays on
 * the control, and Try again repeats the same action on the same row.
 */
function useRowAction({
  kind,
  act,
  onChanged,
  announce,
  onSuccess,
}: Readonly<{
  kind: RowFailureKind;
  act: RowAction;
  onChanged: () => Promise<void>;
  announce: (sentence: string) => void;
  onSuccess?: (() => void) | undefined;
}>) {
  const { kicker, sentence } = ROW_FAILURES[kind];
  const [target, setTarget] = useState<string>();
  const control = useControlAction<[string]>({
    kicker,
    action: async (id) => {
      await act({ data: { id } });
      await onChanged();
    },
    onSuccess,
  });
  const { failure } = control;
  useEffect(() => {
    if (failure !== undefined) announce(`${kicker}. ${sentence}`);
  }, [failure, announce, kicker, sentence]);
  return {
    isFailed: failure !== undefined,
    run: (id: string) => {
      setTarget(id);
      void control.run(id);
    },
    /**
    The band under `id`'s row, when this action failed there.
    */
    bandFor: (id: string): JSX.Element | undefined =>
      failure !== undefined && id === target ? (
        <FailureBand
          kicker={failure.kicker}
          message={sentence}
          onRetry={control.retry}
          retryRef={control.retryRef}
        />
      ) : undefined,
  };
}

/**
 * Forgets the row whose Undo is showing ten seconds after its revoke went
 * through — never while its revoke or its Undo has failed, when its band
 * shows instead.
 */
function useReleaseHold(
  holding: string | undefined,
  setHolding: (id: string | undefined) => void,
  isFailed: boolean,
): void {
  useEffect(() => {
    if (holding === undefined || isFailed) return;
    const timer = setTimeout(() => {
      setHolding(undefined);
    }, UNDO_WINDOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [holding, isFailed, setHolding]);
}

/**
One row action, as a row uses it: press it on a row, and read that row's band.
*/
type RowActionHandle = Pick<ReturnType<typeof useRowAction>, "run" | "bandFor">;

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
  return (
    <li className="flex flex-col gap-2 border-b border-hairline py-4">
      <span className="flex items-baseline justify-between gap-4">
        <span className="font-semibold">{request.email}</span>
        <Mono step="sm" className="text-muted">
          {ageLabel(request.createdAt, asOf)}
        </Mono>
      </span>
      <span className={request.note === null ? "text-muted" : "text-ink"}>
        {request.note ?? "No note."}
      </span>
      <span className="flex gap-4">
        <button
          type="button"
          className="target font-semibold underline"
          onClick={() => {
            invite.run(request.id);
          }}
        >
          Send invite
        </button>
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
 * What a code's actions cell says: Undo while its revoke can still be
 * taken back, its two actions while it works, and why not once it does
 * not.
 */
function CodeActions({
  code,
  isHeld,
  onCopy,
  onRevoke,
  onUndo,
}: Readonly<{
  code: DeskCode;
  isHeld: boolean;
  onCopy: () => void;
  onRevoke: () => void;
  onUndo: () => void;
}>): JSX.Element {
  if (isHeld) {
    // D-92, round 29 #5: from T1 roles, never opacity — REVOKED in
    // `--quiet` MONO.xs, and Undo in ink, semibold and underlined.
    return (
      <span className="flex items-baseline gap-4">
        <Mono step="xs" className="text-quiet">
          Revoked
        </Mono>
        <button
          type="button"
          className="target font-semibold text-ink underline"
          onClick={onUndo}
        >
          Undo
        </button>
      </span>
    );
  }
  // Round 29 #14: USED and REVOKED in `--quiet`, as the STATE column is.
  if (code.isRevoked) {
    return (
      <Mono step="xs" className="text-quiet">
        Revoked
      </Mono>
    );
  }
  if (!isActive(code)) {
    return (
      <Mono step="xs" className="text-quiet">
        Used
      </Mono>
    );
  }
  return (
    <span className="flex gap-4">
      <button
        type="button"
        className="target font-semibold underline"
        onClick={onCopy}
      >
        Copy link
      </button>
      <button
        type="button"
        className="target text-quiet underline"
        onClick={onRevoke}
      >
        Revoke
      </button>
    </span>
  );
}

/**
 * `NOT COPIED` (round 28 #9): the browser would not copy, so the link is
 * shown selected for the operator to copy themselves. No Try again — the
 * same press would fail the same way.
 */
function NotCopied({ url }: Readonly<{ url: string }>): JSX.Element {
  return (
    <div
      data-part="failure-band"
      data-state="not-copied"
      className="flex flex-col items-start gap-3 border border-ink p-4"
    >
      <Mono step="xs">Not copied</Mono>
      <span className="text-body">
        Copying didn&apos;t work here. The link is selected: copy it yourself.
      </span>
      <input
        readOnly
        aria-label="Invite link"
        value={url}
        ref={(node) => {
          node?.select();
        }}
        className="min-h-target w-full rounded-field border border-hairline bg-ground px-3 font-mono text-mono-sm"
      />
    </div>
  );
}

/**
What one code row shows besides the code itself.
*/
interface CodeRowState {
  readonly asOf: number;
  readonly isNew: boolean;
  readonly isHeld: boolean;
  readonly uncopiedLink: string | undefined;
}

function CodeRow({
  code,
  state,
  onCopy,
  onRevoke,
  onUndo,
  band,
}: Readonly<{
  code: DeskCode;
  state: CodeRowState;
  onCopy: () => void;
  onRevoke: () => void;
  onUndo: () => void;
  /**
  Revoke's or Undo's failure band, when one failed on this row.
  */
  band: JSX.Element | undefined;
}>): JSX.Element {
  const isStruck = code.isRevoked || state.isHeld;
  const tone = isActive(code) && !state.isHeld ? "text-ink" : "text-quiet";
  // Round 29 #5: a revoked code is struck through in `--quiet`, held or at
  // the foot — the strike carries the meaning without colour.
  const codeTone = isStruck ? "text-quiet line-through" : tone;
  return (
    <li
      data-state={isActive(code) ? undefined : "spent"}
      className="flex flex-col gap-3 border-b border-hairline py-4"
    >
      <span
        className={
          isStruck
            ? "grid grid-cols-[auto_1fr_auto_auto_auto] items-baseline gap-4 text-quiet"
            : "grid grid-cols-[auto_1fr_auto_auto_auto] items-baseline gap-4"
        }
      >
        <span className="flex items-baseline gap-2">
          <Mono step="sm" className={codeTone}>
            {code.code}
          </Mono>
          {state.isNew ? (
            <Mono step="xs" className="bg-hi-viz px-1 text-accent-ink">
              New
            </Mono>
          ) : undefined}
        </span>
        <span className="flex flex-col gap-1">
          <span>{code.label ?? "No label"}</span>
          <span className="text-small text-quiet">
            {code.usedBy.length === 0 ? "Not used yet" : code.usedBy.join(", ")}
          </span>
        </span>
        <Mono step="sm" className="text-muted">
          {ageLabel(code.createdAt, state.asOf)}
        </Mono>
        <Mono step="sm" className={tone}>
          {`${String(code.usedBy.length)}/${String(code.maxUses)}`}
        </Mono>
        <CodeActions
          code={code}
          isHeld={state.isHeld}
          onCopy={onCopy}
          onRevoke={onRevoke}
          onUndo={onUndo}
        />
      </span>
      {band}
      {state.uncopiedLink === undefined ? undefined : (
        <NotCopied url={state.uncopiedLink} />
      )}
    </li>
  );
}

/**
 * D7's Create code: a label ("for you only") and a uses limit. The key is
 * the form's (law 8b), rotated once a code is made.
 */
function NewCodeForm({
  createCode,
  onCreated,
}: Readonly<{
  createCode: (input: {
    data: { label: string; maxUses: number; idempotencyKey: string };
  }) => Promise<{ code: string }>;
  onCreated: (code: string) => Promise<void>;
}>): JSX.Element {
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const { idempotencyKey, rotate } = useIdempotencyKey();
  const form = useFormSubmit({
    schema: newInviteSchema,
    action: (values) => createCode({ data: { ...values, idempotencyKey } }),
    successMessage: "Code created.",
    labels: { label: "Label · for you only", maxUses: "Uses" },
    onSuccess: async ({ code }) => {
      rotate();
      setLabel("");
      setMaxUses("1");
      await onCreated(code);
    },
  });
  return (
    <FormElement
      form={form}
      dataPart="new-code"
      onSubmit={() => {
        void form.submit({ label, maxUses });
      }}
    >
      <TextField
        name="label"
        label="Label · for you only"
        value={label}
        onChange={setLabel}
        field={form.field}
        error={form.fieldErrors.label}
      />
      <TextField
        name="maxUses"
        label="Uses"
        value={maxUses}
        onChange={setMaxUses}
        field={form.field}
        error={form.fieldErrors.maxUses}
      />
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Create code"
        pendingLabel="Creating"
        pending={form.pending}
      />
    </FormElement>
  );
}

/**
 * Desk D7 · Access (task 126, ACC-5; round 26 #20, round 28 #9):
 * Requests, oldest first, each with Send invite and a silent Decline; and
 * Codes, with a form to make one (its link copied as it is made), who used
 * each, Copy link, and Revoke with ten seconds of Undo on the row.
 */
export function DeskAccess({
  desk,
  asOf,
  linkFor,
  copy,
  onChanged,
  createCode,
  sendInvite,
  decline,
  revoke,
  restore,
}: Readonly<{
  desk: AccessDesk;
  asOf: number;
  /**
  The `/join?code=` link for a code, absolute.
  */
  linkFor: (code: string) => string;
  copy: (text: string) => Promise<void>;
  /**
  Reloads the page's data after a change.
  */
  onChanged: () => Promise<void>;
  createCode: (input: {
    data: { label: string; maxUses: number; idempotencyKey: string };
  }) => Promise<{ code: string }>;
  sendInvite: RowAction;
  decline: RowAction;
  revoke: RowAction;
  restore: RowAction;
}>): JSX.Element {
  const [said, setSaid] = useState("");
  const inviting = useRowAction({
    kind: "invite",
    act: sendInvite,
    onChanged,
    announce: setSaid,
  });
  const declining = useRowAction({
    kind: "decline",
    act: decline,
    onChanged,
    announce: setSaid,
  });
  const revoking = useRowAction({
    kind: "revoke",
    act: revoke,
    onChanged,
    announce: setSaid,
  });
  const isRevokeFailed = revoking.isFailed;
  const [holding, setHolding] = useState<string>();
  const undoing = useRowAction({
    kind: "undo",
    act: restore,
    onChanged,
    announce: setSaid,
    // Not optimistic: the row stays held until the code is back.
    onSuccess: () => {
      setHolding(undefined);
    },
  });
  // A failed Undo keeps its row held, so its Undo and its band stay where
  // the operator's focus is rather than sorting to the foot. `setHolding`
  // is React's own setter, stable across renders, so the timer is armed
  // once per hold and not again on every render.
  useReleaseHold(holding, setHolding, isRevokeFailed || undoing.isFailed);
  const [madeStatus, setMadeStatus] = useState("");
  // Codes made on this page load wear NEW until it reloads; codes whose
  // copy failed show their link selected. Both by the code itself, which
  // a new row has before the reload gives it an id.
  const [made, setMade] = useState<readonly string[]>([]);
  const [uncopied, setUncopied] = useState<string>();
  const wasCopied = async (code: string): Promise<boolean> => {
    try {
      await copy(linkFor(code));
      setUncopied(undefined);
      return true;
    } catch {
      setUncopied(code);
      return false;
    }
  };
  return (
    <div className="flex flex-col gap-10">
      <FormStatus>{said}</FormStatus>
      <section aria-labelledby="desk-requests" className="flex flex-col gap-4">
        <h1
          id="desk-requests"
          className="m-0 font-display text-title uppercase"
        >
          Requests
        </h1>
        <Mono step="xs" className="text-muted">
          {`${String(desk.requests.length)} waiting · oldest first`}
        </Mono>
        <ul className="m-0 flex list-none flex-col p-0">
          {desk.requests.map((request) => (
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
      <section aria-labelledby="desk-codes" className="flex flex-col gap-4">
        <h2 id="desk-codes" className="m-0 font-display text-title uppercase">
          Codes
        </h2>
        <Mono step="xs" className="text-muted">
          {codeCounts(desk.codes)}
        </Mono>
        <NewCodeForm
          createCode={createCode}
          onCreated={async (code) => {
            setMade((codes) => [...codes, code]);
            setMadeStatus(madeLine(code, await wasCopied(code)));
            await onChanged();
          }}
        />
        <p role="status" data-part="status-line" className="m-0">
          <Mono step="xs">{madeStatus}</Mono>
        </p>
        <ul className="m-0 flex list-none flex-col p-0">
          {orderedCodes(desk.codes, holding).map((code) => (
            <CodeRow
              key={code.id}
              code={code}
              state={{
                asOf,
                isNew: made.includes(code.code),
                isHeld: code.id === holding && !isRevokeFailed,
                uncopiedLink:
                  uncopied === code.code ? linkFor(code.code) : undefined,
              }}
              onCopy={() => {
                void wasCopied(code.code).then((isCopied) => {
                  setSaid(isCopied ? "Link copied." : "Link not copied.");
                });
              }}
              onRevoke={() => {
                setHolding(code.id);
                revoking.run(code.id);
              }}
              onUndo={() => {
                undoing.run(code.id);
              }}
              band={revoking.bandFor(code.id) ?? undoing.bandFor(code.id)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
