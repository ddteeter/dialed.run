import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JSX } from "react";

import {
  DeskDetail,
  FormElement,
  FormEnd,
  FormStatus,
  Mono,
  TextField,
  useFormSubmit,
  useIdempotencyKey,
} from "../../../ui";
import { newInviteSchema } from "../inputs";
import type { AccessDesk, DeskCode } from "../invites";
import { ageLabel, useRowAction, type RowAction } from "./desk-rows";

/**
 * How long a revoked row keeps its Undo (round 26 #20: "no confirm; it's
 * undoable for 10 s"; round 28 #9: on the row, with no countdown).
 */
export const UNDO_WINDOW_MS = 10_000;

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

/**
A code's label, or NO LABEL when it was made without one.
*/
function labelOf(code: DeskCode): string {
  return code.label ?? "No label";
}

/**
How many of a code's runners its row names before "+ N more" (R55·200).
*/
const FIRST_USERS = 5;

/**
 * A count as R55·200 groups it: "1,000,000", not "1000000". In en-US
 * whatever the operator's locale, as every other Desk figure is.
 */
function grouped(count: number): string {
  return count.toLocaleString("en-US");
}

/**
The used-by cell's lead (R55·200): "29 USED", or NOT USED YET.
*/
export function usedLine(used: number): string {
  return used === 0 ? "Not used yet" : `${grouped(used)} used`;
}

/**
A code's uses against its cap, grouped: "29 / 1,000,000" (R55·200).
*/
export function usesLine(code: DeskCode): string {
  return `${grouped(code.usedBy.length)} / ${grouped(code.maxUses)}`;
}

/**
 * Where a runner's name on a code leads: Runners, searched for them (R55·
 * 200), by handle without its @ or by the address an unfinished account
 * still goes by.
 */
function runnerSearch(who: string): { query: string; filter: "all" } {
  return { query: who.replace(/^@/u, ""), filter: "all" };
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

/**
 * Round 54 · 168.3: from `wide` the codes are one grid, each row a subgrid
 * of it, so the code, label, age, count and actions share their columns
 * down the list (N3-07). On a phone a row wraps instead, its actions
 * included, so nothing runs off the screen (G-09, N3-06; not drawn, a
 * guess).
 */
const CODE_LIST =
  "m-0 flex list-none flex-col p-0 wide:grid wide:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] wide:gap-x-4";
const CODE_ROW =
  "flex flex-col gap-3 border-b border-hairline py-4 wide:col-span-full wide:grid wide:grid-cols-subgrid";
const CODE_CELLS =
  "flex flex-wrap items-baseline gap-x-4 gap-y-2 wide:col-span-full wide:grid wide:grid-cols-subgrid";

function CodeRow({
  code,
  state,
  onCopy,
  onRevoke,
  onUndo,
  onMore,
  band,
}: Readonly<{
  code: DeskCode;
  state: CodeRowState;
  onCopy: () => void;
  onRevoke: () => void;
  onUndo: () => void;
  /**
  "+ N more": opens the code in the detail pane (R55·200).
  */
  onMore: () => void;
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
    <li data-state={isActive(code) ? undefined : "spent"} className={CODE_ROW}>
      <span className={isStruck ? `${CODE_CELLS} text-quiet` : CODE_CELLS}>
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <Mono step="sm" className={codeTone}>
            {code.code}
          </Mono>
          {state.isNew ? (
            <Mono step="xs" className="bg-hi-viz px-1 text-accent-ink">
              New
            </Mono>
          ) : undefined}
        </span>
        <CodeWho code={code} onMore={onMore} />
        <Mono step="xs" className="text-muted wide:text-right">
          {ageLabel(code.createdAt, state.asOf)}
        </Mono>
        <Mono step="sm" className={`whitespace-nowrap wide:text-right ${tone}`}>
          {usesLine(code)}
        </Mono>
        <CodeActions
          code={code}
          isHeld={state.isHeld}
          onCopy={onCopy}
          onRevoke={onRevoke}
          onUndo={onUndo}
        />
      </span>
      {/* Under the row, the grid's full width. */}
      {band === undefined ? undefined : (
        <div className="wide:col-span-full">{band}</div>
      )}
      {state.uncopiedLink === undefined ? undefined : (
        <div className="wide:col-span-full">
          <NotCopied url={state.uncopiedLink} />
        </div>
      )}
    </li>
  );
}

/**
 * The code's label, one line, cut short and whole in the title (168.3),
 * and who used it (R55·200): the count, the first five as links to
 * Runners, then "+ N more", which opens the whole list in the pane. A row
 * is never taller than two lines.
 */
function CodeWho({
  code,
  onMore,
}: Readonly<{ code: DeskCode; onMore: () => void }>): JSX.Element {
  const label = labelOf(code);
  const more = code.usedBy.length - FIRST_USERS;
  return (
    <span className="flex min-w-0 basis-full flex-col gap-1 wide:basis-auto">
      <span title={label} className="truncate">
        {label}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Mono step="xs" className="text-muted">
          {usedLine(code.usedBy.length)}
        </Mono>
        {code.usedBy.slice(0, FIRST_USERS).map((who) => (
          <RunnerLink key={who} who={who} />
        ))}
        {more > 0 ? (
          <button
            type="button"
            onClick={onMore}
            className="target inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-small font-bold text-action"
          >
            {`+ ${grouped(more)} more`}
          </button>
        ) : undefined}
      </span>
    </span>
  );
}

/**
One runner a code let in, as a link to them on Runners.
*/
function RunnerLink({ who }: Readonly<{ who: string }>): JSX.Element {
  return (
    <Link
      to="/desk/runners"
      search={runnerSearch(who)}
      className="target inline-flex items-center text-small text-ink underline underline-offset-4"
    >
      {who}
    </Link>
  );
}

/**
 * A code in the detail pane (R55·200): its code, its label and everyone
 * who used it, each a link to Runners.
 */
function CodePane({ code }: Readonly<{ code: DeskCode }>): JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="m-0">
          <Mono step="sm">{code.code}</Mono>
        </h2>
        <span className="wrap-anywhere">{labelOf(code)}</span>
        <Mono step="xs" className="text-muted">
          {`${usedLine(code.usedBy.length)} · ${usesLine(code)}`}
        </Mono>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {code.usedBy.map((who) => (
          <li key={who} className="wrap-anywhere">
            <RunnerLink who={who} />
          </li>
        ))}
      </ul>
    </>
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
    carry: "page",
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
      <FormEnd
        form={form}
        tone="chalk"
        label="Create code"
        pendingLabel="Creating"
      />
    </FormElement>
  );
}

/**
 * Desk D7 · Codes (round 28 #9; its own page since R55·194, drawn in
 * R55·200): a form to make one (its link copied as it is made), the codes
 * as one table, who used each, Copy link, and Revoke with ten seconds of
 * Undo on the row.
 */
export function DeskCodes({
  codes,
  asOf,
  actions,
}: Readonly<{
  codes: AccessDesk["codes"];
  asOf: number;
  actions: CodeActions;
}>): JSX.Element {
  const [said, setSaid] = useState("");
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <FormStatus>{said}</FormStatus>
      <CodesSection
        codes={codes}
        asOf={asOf}
        link={{
          // The `/join?code=` link for a code, absolute.
          linkFor: (code) =>
            new URL(
              router.buildLocation({ to: "/join", search: { code } }).href,
              globalThis.location.origin,
            ).href,
          copy: (text) => navigator.clipboard.writeText(text),
        }}
        actions={actions}
        onChanged={() => router.invalidate()}
        announce={setSaid}
      />
    </div>
  );
}

/**
What Codes' rows and form do, as the route hands them in.
*/
type CodeActions = Readonly<{
  createCode: (input: {
    data: { label: string; maxUses: number; idempotencyKey: string };
  }) => Promise<{ code: string }>;
  revoke: RowAction;
  restore: RowAction;
}>;

/**
 * D7's Codes: the form that makes one (its link copied as it is made),
 * each code's uses, Copy link, and Revoke with ten seconds of Undo on the
 * row. Copy's outcome goes to `DeskCodes`' status region through
 * `announce`; a made code's line is this section's own.
 */
function CodesSection({
  codes,
  asOf,
  link,
  actions,
  onChanged,
  announce,
}: Readonly<{
  codes: AccessDesk["codes"];
  asOf: number;
  link: {
    linkFor: (code: string) => string;
    copy: (text: string) => Promise<void>;
  };
  actions: CodeActions;
  onChanged: () => Promise<void>;
  announce: (said: string) => void;
}>): JSX.Element {
  const { linkFor, copy } = link;
  const revoking = useRowAction({
    kind: "revoke",
    act: actions.revoke,
    onChanged,
    announce,
  });
  const isRevokeFailed = revoking.isFailed;
  const [holding, setHolding] = useState<string>();
  const undoing = useRowAction({
    kind: "undo",
    act: actions.restore,
    onChanged,
    announce,
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
  // The code "+ N more" opened in the pane (R55·200), read from the list
  // each render so a reload's counts show in it.
  const [openId, setOpenId] = useState<string>();
  const open = codes.find((code) => code.id === openId);
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
    <section aria-labelledby="desk-codes" className="flex flex-col gap-4">
      <h1 id="desk-codes" className="m-0 font-display text-title uppercase">
        Codes
      </h1>
      <Mono step="xs" className="text-muted">
        {codeCounts(codes)}
      </Mono>
      {/* The form keeps the column; only the list takes the width. */}
      <div className="max-w-column">
        <NewCodeForm
          createCode={actions.createCode}
          onCreated={async (code) => {
            setMade((previous) => [...previous, code]);
            setMadeStatus(madeLine(code, await wasCopied(code)));
            await onChanged();
          }}
        />
      </div>
      <p role="status" data-part="status-line" className="m-0">
        <Mono step="xs">{madeStatus}</Mono>
      </p>
      <DeskDetail
        picked={
          open === undefined
            ? undefined
            : { name: open.code, detail: <CodePane code={open} /> }
        }
      >
        <ul className={CODE_LIST}>
          <CodesHeader />
          {orderedCodes(codes, holding).map((code) => (
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
                  announce(isCopied ? "Link copied." : "Link not copied.");
                });
              }}
              onRevoke={() => {
                setHolding(code.id);
                revoking.run(code.id);
              }}
              onUndo={() => {
                undoing.run(code.id);
              }}
              onMore={() => {
                setOpenId(code.id);
              }}
              band={revoking.bandFor(code.id) ?? undoing.bandFor(code.id)}
            />
          ))}
        </ul>
      </DeskDetail>
    </section>
  );
}

/**
 * The table's column heads (R55·200), at width only: on a phone a row
 * wraps and its cells say what they are. Drawn, not said: a list has no
 * headers to announce, and each cell is read in its row.
 */
function CodesHeader(): JSX.Element {
  return (
    <li
      aria-hidden="true"
      className="hidden border-b border-hairline pb-2 text-muted wide:col-span-full wide:grid wide:grid-cols-subgrid"
    >
      <Mono step="xs">Code</Mono>
      <Mono step="xs">Label · used by</Mono>
      <Mono step="xs" className="text-right">
        Age
      </Mono>
      <Mono step="xs" className="text-right">
        Uses
      </Mono>
      <span />
    </li>
  );
}
