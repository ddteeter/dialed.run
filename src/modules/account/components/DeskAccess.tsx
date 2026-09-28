import { useEffect, useState } from "react";
import type { JSX } from "react";

import {
  ControlFailureBand,
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
 * How long Revoke's undo stays in the status line (round 26 #20: "no
 * confirm; it's undoable for 10 s").
 */
export const UNDO_WINDOW_MS = 10_000;

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

/**
 * A request's age as the board draws it: `5H`, `3D` — whole hours under
 * a day, whole days after.
 */
export function ageLabel(createdAt: number, asOf: number): string {
  const seconds = Math.max(0, asOf - createdAt);
  return seconds < DAY_S
    ? `${String(Math.floor(seconds / HOUR_S))}h`
    : `${String(Math.floor(seconds / DAY_S))}d`;
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

type RowAction = (input: { data: { id: string } }) => Promise<unknown>;

/**
The one row action in flight, and its failure band.
*/
function useRowAction(onChanged: () => Promise<void>) {
  return useControlAction<[RowAction, string]>({
    kicker: "Not changed",
    action: async (act, id) => {
      await act({ data: { id } });
      await onChanged();
    },
  });
}

function RequestRow({
  request,
  asOf,
  onInvite,
  onDecline,
}: Readonly<{
  request: DeskRequest;
  asOf: number;
  onInvite: () => void;
  onDecline: () => void;
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
        <button type="button" className="target font-semibold underline" onClick={onInvite}>
          Send invite
        </button>
        <button type="button" className="target text-quiet underline" onClick={onDecline}>
          Decline
        </button>
      </span>
    </li>
  );
}

/**
 * What a code's actions cell says: its two actions while it works, and
 * why not once it does not.
 */
function CodeActions({
  code,
  onCopy,
  onRevoke,
}: Readonly<{
  code: DeskCode;
  onCopy: () => void;
  onRevoke: () => void;
}>): JSX.Element {
  if (code.isRevoked) return <span className="text-muted">Revoked</span>;
  if (!isActive(code)) return <span className="text-muted">Used</span>;
  return (
    <span className="flex gap-4">
      <button type="button" className="target font-semibold underline" onClick={onCopy}>
        Copy link
      </button>
      <button type="button" className="target text-quiet underline" onClick={onRevoke}>
        Revoke
      </button>
    </span>
  );
}

function CodeRow({
  code,
  onCopy,
  onRevoke,
}: Readonly<{
  code: DeskCode;
  onCopy: () => void;
  onRevoke: () => void;
}>): JSX.Element {
  const tone = isActive(code) ? "text-ink" : "text-muted";
  return (
    <li
      data-state={isActive(code) ? undefined : "spent"}
      className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-4 border-b border-hairline py-4"
    >
      <Mono step="sm" className={tone}>
        {code.code}
      </Mono>
      <span className="flex flex-col gap-1">
        <span>{code.label ?? "No label"}</span>
        <span className="text-small text-quiet">
          {code.usedBy.length === 0 ? "Not used yet" : code.usedBy.join(", ")}
        </span>
      </span>
      <Mono step="sm" className={tone}>
        {`${String(code.usedBy.length)}/${String(code.maxUses)}`}
      </Mono>
      <CodeActions code={code} onCopy={onCopy} onRevoke={onRevoke} />
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
 * Revoke's undo, in the status line for ten seconds and then gone. The
 * revoke has already happened; Undo puts the code back.
 */
export function UndoRevoke({
  code,
  onUndo,
  onExpire,
}: Readonly<{
  code: DeskCode;
  onUndo: () => void;
  onExpire: () => void;
}>): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onExpire, UNDO_WINDOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [onExpire]);
  return (
    <p data-part="undo" className="m-0 flex gap-3">
      <span>{`Revoked ${code.code}.`}</span>
      <button type="button" className="target font-semibold underline" onClick={onUndo}>
        Undo
      </button>
    </p>
  );
}

/**
 * Desk D7 · Access (task 126, ACC-5; round 26 #20): Requests, oldest
 * first, each with Send invite and a silent Decline; and Codes, with a
 * form to make one, who used each, Copy link and Revoke with a 10 s undo.
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
  const row = useRowAction(onChanged);
  const [said, setSaid] = useState("");
  const [revoked, setRevoked] = useState<DeskCode>();
  // Made once (a state setter is stable), so the undo's ten seconds are
  // not restarted by every render.
  const [forgetRevoked] = useState(() => () => {
    setRevoked(undefined);
  });
  return (
    <div className="flex flex-col gap-10">
      <FormStatus>{said}</FormStatus>
      <ControlFailureBand
        failure={row.failure}
        onRetry={row.retry}
        retryRef={row.retryRef}
      />
      {revoked === undefined ? undefined : (
        <UndoRevoke
          code={revoked}
          onExpire={forgetRevoked}
          onUndo={() => {
            setRevoked(undefined);
            void row.run(restore, revoked.id);
          }}
        />
      )}
      <section aria-labelledby="desk-requests" className="flex flex-col gap-4">
        <h1 id="desk-requests" className="m-0 font-display text-title uppercase">
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
              onInvite={() => {
                void row.run(sendInvite, request.id);
              }}
              onDecline={() => {
                void row.run(decline, request.id);
              }}
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
            setSaid(`Created ${code}.`);
            await onChanged();
          }}
        />
        <ul className="m-0 flex list-none flex-col p-0">
          {desk.codes.map((code) => (
            <CodeRow
              key={code.id}
              code={code}
              onCopy={() => {
                void copy(linkFor(code.code))
                  .then(() => {
                    setSaid("Link copied.");
                  })
                  .catch(() => {
                    setSaid("Link not copied. Your browser refused.");
                  });
              }}
              onRevoke={() => {
                setRevoked(code);
                void row.run(revoke, code.id);
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
