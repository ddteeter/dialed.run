import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import {
  Bracketed,
  ControlFailureBand,
  FormStatus,
  Mono,
  QUIET_PILL,
  TextField,
  inFlight,
  useControlAction,
  useFormSubmit,
} from "../../../ui";
import {
  closureRuleLabels,
  closureRuleSchema,
  closureRules,
  renameReasonSchema,
  renameReasons,
  type ClosureRule,
  type RenameReason,
} from "../contracts";
import { banUserInput, forceRenameInput } from "../inputs";
import type { RenameOutcome } from "../rename";
import type { DeskRunner, RunnersFilter } from "../runners";
import { DeskForm, PickOne } from "./DeskForm";
import { NotRenamedBand } from "./NotRenamedBand";
import { useFocusWhen } from "./use-focus-when";

/**
 * Desk · Runners, "D8" (round 27 #22). A search and four filters over a
 * table of every account; a row click selects, and the selected runner's
 * right column holds the flag when one is open (D-161, R47·124), Rename
 * (#16), then Close account (D3's ban panel, moved here from the entry
 * view). **There is no separate runner page.** R47·124: nothing on D8
 * says "intimate".
 */

type Rename = (input: {
  data: { userId: string; nameReason: RenameReason };
}) => Promise<RenameOutcome>;
type Ban = (input: {
  data: { userId: string; reason: string; rule: ClosureRule };
}) => Promise<unknown>;
/**
Reopen account, and Keep account (D-161): an act on the account by id.
*/
type OnAccount = (input: { data: { userId: string } }) => Promise<unknown>;

const FILTERS: readonly { value: RunnersFilter["filter"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "closed", label: "Closed" },
  // R47·124: last, with its count, shown at 0 too.
  { value: "flagged", label: "Flagged" },
];

export const RENAME_LABELS: Readonly<Record<RenameReason, string>> =
  Object.fromEntries(renameReasons.map((reason) => [reason, reason])) as Record<
    RenameReason,
    string
  >;

/**
 * What the operator is told after a Rename. A rename that lost a race
 * names the handle as it is now, so the operator can look at it before
 * pressing again (round 38 #60).
 */
export function renameMessage(outcome: RenameOutcome): string {
  if (outcome.kind === "renamed") return `Renamed to @${outcome.username}.`;
  if (outcome.kind === "taken") {
    return "That placeholder is taken. Press Rename again.";
  }
  if (outcome.kind === "moved") {
    return `The handle changed to @${outcome.username} before the rename landed. Nothing was renamed. Look at it, then press Rename again if it still has to go.`;
  }
  return "This runner has no handle to take away.";
}

/**
 * What D8 says after a Rename: a rename that did not happen and can be
 * pressed again, a taken placeholder or a handle that moved, in the
 * control band; anything else as a line.
 */
function RenameSaid({
  outcome,
}: Readonly<{ outcome: RenameOutcome | undefined }>): JSX.Element | undefined {
  if (outcome === undefined) return undefined;
  const said = renameMessage(outcome);
  return outcome.kind === "taken" || outcome.kind === "moved" ? (
    <NotRenamedBand message={said} />
  ) : (
    <p className="text-body">{said}</p>
  );
}

function joinedLabel(joinedAt: number): string {
  return new Date(joinedAt * 1000).toISOString().slice(0, 10);
}

function Search({
  filter,
  flagged,
}: Readonly<{ filter: RunnersFilter; flagged: number }>): JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState(filter.query ?? "");
  return (
    <form
      role="search"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void navigate({
          to: "/desk/runners",
          search: { query, filter: filter.filter },
        });
      }}
    >
      <label className="target flex flex-col gap-1">
        <Mono step="xs" className="text-muted">
          Handle or email
        </Mono>
        <input
          type="search"
          name="query"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="rounded-field border border-hairline bg-panel px-3 py-2 text-field"
        />
      </label>
      <nav aria-label="Filter runners" className="flex gap-4">
        {FILTERS.map((option) => (
          <Link
            key={option.value}
            to="/desk/runners"
            search={{ query: filter.query, filter: option.value }}
            aria-current={option.value === filter.filter ? "page" : undefined}
            className="target text-body"
          >
            {option.label}
            {option.value === "flagged" ? (
              <>
                {" "}
                <Bracketed step="xs">{String(flagged)}</Bracketed>
              </>
            ) : undefined}
          </Link>
        ))}
      </nav>
    </form>
  );
}

function RunnerRow({
  runner,
  selected,
  onSelect,
  focusName,
}: Readonly<{
  runner: DeskRunner;
  selected: boolean;
  onSelect: () => void;
  /**
  R47·124: where focus lands once a decision clears the runner's flag.
  */
  focusName: boolean;
}>): JSX.Element {
  const nameRef = useFocusWhen(focusName);
  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      className="cursor-pointer border-b border-hairline"
    >
      <td>
        <button
          ref={nameRef}
          type="button"
          className="target text-left"
          onClick={onSelect}
        >
          {runner.username === undefined ? "—" : `@${runner.username}`}
        </button>
      </td>
      <td>{runner.email}</td>
      <td>
        <Mono step="xs">{joinedLabel(runner.joinedAt)}</Mono>
      </td>
      <td>
        <Mono step="xs">{String(runner.runs)}</Mono>
      </td>
      <td>
        <Mono step="xs">{String(runner.reports)}</Mono>
      </td>
      <td>
        <span className="flex flex-wrap gap-2">
          <Bracketed step="xs">{runner.state}</Bracketed>
          {runner.flaggedAt === undefined ? undefined : (
            <Bracketed step="xs" className="text-hiviz-text">
              Flagged
            </Bracketed>
          )}
        </span>
      </td>
    </tr>
  );
}

/**
What a panel acting on the selected runner is handed.
*/
interface PanelProps<TAction> {
  runner: DeskRunner;
  act: TAction;
  onDone: () => void;
}

function RenamePanel({
  runner,
  act: rename,
  onDone,
}: Readonly<PanelProps<Rename>>): JSX.Element {
  // Nothing chosen is `undefined`, which the schema refuses with its own
  // message; the select sees it as the "—" option's value.
  const [reason, setReason] = useState<RenameReason | undefined>();
  const [said, setSaid] = useState<RenameOutcome | undefined>();
  const form = useFormSubmit({
    carry: "page",
    schema: forceRenameInput,
    action: (values) => rename({ data: values }),
    onSuccess: (outcome) => {
      setSaid(outcome);
      onDone();
    },
    successMessage: "Rename sent.",
  });
  return (
    <DeskForm
      form={form}
      title="Rename"
      className="flex flex-col gap-3 border border-hairline p-4"
      onSubmit={() => {
        void form.submit({
          userId: runner.userId,
          nameReason: reason,
        });
      }}
      submit={{ label: "Rename", pendingLabel: "Renaming" }}
    >
      <PickOne<RenameReason>
        name="nameReason"
        label="Why the name has to go"
        options={renameReasons}
        optionLabels={RENAME_LABELS}
        schema={renameReasonSchema}
        value={reason}
        onChange={setReason}
        field={form.field}
        error={form.fieldErrors.nameReason}
      />
      <p className="text-small text-quiet">
        The handle becomes @runner_ and four digits, and the old one is never
        given to anyone else. They pick a new one on their next visit.
      </p>
      <RenameSaid outcome={said} />
    </DeskForm>
  );
}

function CloseAccountPanel({
  runner,
  act: ban,
  onDone,
}: Readonly<PanelProps<Ban>>): JSX.Element {
  const [reason, setReason] = useState("");
  const [rule, setRule] = useState<ClosureRule | undefined>();
  const form = useFormSubmit({
    carry: "page",
    schema: banUserInput,
    action: (values) => ban({ data: values }),
    onSuccess: onDone,
    successMessage: "Account closed.",
  });
  return (
    <DeskForm
      form={form}
      title="Close account"
      className="flex flex-col gap-3 border border-hairline p-4"
      onSubmit={() => {
        void form.submit({ userId: runner.userId, reason, rule });
      }}
      submit={{ label: "Close account", pendingLabel: "Closing" }}
    >
      <TextField
        name="reason"
        label="Why"
        value={reason}
        onChange={setReason}
        field={form.field}
        error={form.fieldErrors.reason}
        hint="Their notice quotes this back to them."
        autoComplete="off"
      />
      {/* C8 (D-145): the notice names the rule, or none for suspected
          CSAM, which stays silent. */}
      <PickOne<ClosureRule>
        name="rule"
        label="Which rule it breaks"
        options={closureRules}
        optionLabels={closureRuleLabels}
        schema={closureRuleSchema}
        value={rule}
        onChange={setRule}
        field={form.field}
        error={form.fieldErrors.rule}
      />
    </DeskForm>
  );
}

/**
 * A panel with one act on the account: a heading, what is on record, and
 * a button that runs `act` on the runner (Reopen account, Keep account).
 * `words.still` names what stays true when the act fails.
 */
function AccountActPanel({
  runner,
  act,
  onDone,
  words,
}: Readonly<
  PanelProps<OnAccount> & {
    words: Readonly<{
      heading: string;
      said: string;
      button: string;
      still: string;
      isFlag?: boolean;
    }>;
  }
>): JSX.Element {
  const control = useControlAction({
    action: () => act({ data: { userId: runner.userId } }),
    kicker: words.still,
    onSuccess: onDone,
  });
  const isFlag = words.isFlag === true;
  return (
    <section
      className={
        isFlag
          ? "flex flex-col gap-3 border border-hiviz-text p-4"
          : "flex flex-col gap-3 border border-hairline p-4"
      }
    >
      <h2 className="m-0">
        <Mono step="xs" className={isFlag ? "text-hiviz-text" : undefined}>
          {words.heading}
        </Mono>
      </h2>
      <p className="text-body">{words.said}</p>
      <FormStatus>{control.status}</FormStatus>
      <button
        type="button"
        {...inFlight(control.pending)}
        className={isFlag ? `target ${QUIET_PILL}` : "target text-left"}
        onClick={() => {
          void control.run();
        }}
      >
        {/* R47·124: Keep account is an outline pill. */}
        {isFlag ? words.button : <Mono step="xs">{words.button}</Mono>}
      </button>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </section>
  );
}

function ReopenPanel(props: Readonly<PanelProps<OnAccount>>): JSX.Element {
  return (
    <AccountActPanel
      {...props}
      words={{
        heading: "Account closed",
        said: props.runner.banReason ?? "No reason recorded.",
        button: "Reopen account",
        still: "Still closed",
      }}
    />
  );
}

/**
 * An open flag (D-161 1): an intimate-image removal of theirs, and no
 * decision on the account since. Keep account clears it; Close account,
 * below, is the other answer. Nothing closes the account by itself.
 */
function FlaggedPanel({
  flaggedAt,
  ...props
}: Readonly<PanelProps<OnAccount> & { flaggedAt: number }>): JSX.Element {
  return (
    <AccountActPanel
      {...props}
      words={{
        heading: "Flagged",
        said: `A takedown of an image they posted was upheld on ${monthDayLabel(flaggedAt)}. Nothing has happened to the account. Keep it, or ban it below.`,
        button: "Keep account",
        still: "Still flagged",
        isFlag: true,
      }}
    />
  );
}

/**
 * The selected runner's right column: Rename, any open flag, then Close
 * account, or Reopen once closed.
 */
function RunnerPanels({
  runner,
  acts,
  onDone,
  onCleared,
}: Readonly<{
  runner: DeskRunner;
  acts: Readonly<{
    rename: Rename;
    ban: Ban;
    unban: OnAccount;
    keep: OnAccount;
  }>;
  onDone: () => void;
  /**
  After Keep, a ban or an unban of a flagged runner: each one clears the
  flag (R47·124).
  */
  onCleared: (userId: string) => void;
}>): JSX.Element {
  const isClosed = runner.state === "CLOSED";
  const onDecided =
    runner.flaggedAt === undefined
      ? onDone
      : () => {
          onCleared(runner.userId);
        };
  return (
    <aside
      aria-label={`@${runner.username ?? runner.email}`}
      className="flex flex-col gap-4 desk:w-[var(--container-column)]"
    >
      {/* R47·124: at the top of the column. */}
      {isClosed || runner.flaggedAt === undefined ? undefined : (
        <FlaggedPanel
          key={`flag-${runner.userId}`}
          runner={runner}
          flaggedAt={runner.flaggedAt}
          act={acts.keep}
          onDone={onDecided}
        />
      )}
      <RenamePanel
        key={`rename-${runner.userId}`}
        runner={runner}
        act={acts.rename}
        onDone={onDone}
      />
      {isClosed ? (
        <ReopenPanel runner={runner} act={acts.unban} onDone={onDecided} />
      ) : (
        <CloseAccountPanel
          key={`close-${runner.userId}`}
          runner={runner}
          act={acts.ban}
          onDone={onDecided}
        />
      )}
    </aside>
  );
}

export function DeskRunners({
  runners,
  total,
  filter,
  flagged,
  ...acts
}: Readonly<{
  runners: readonly DeskRunner[];
  total: number;
  filter: RunnersFilter;
  /**
  How many accounts are flagged, for the Flagged chip (R47·124).
  */
  flagged: number;
  rename: Rename;
  ban: Ban;
  unban: OnAccount;
  keep: OnAccount;
}>): JSX.Element {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // The runner whose flag a decision just cleared: focus goes to their
  // name (R47·124), once. It holds only for the list it was cleared in,
  // so a later list (the reload, another filter) that draws their row
  // again does not take focus back to it.
  const [cleared, setCleared] = useState<
    Readonly<{ userId: string; among: readonly DeskRunner[] }> | undefined
  >();
  const clearedId = cleared?.among === runners ? cleared.userId : undefined;
  const selected = runners.find((runner) => runner.userId === selectedId);
  const refresh = (): void => {
    void router.invalidate();
  };

  return (
    <section aria-labelledby="desk-runners" className="flex flex-col gap-6">
      <h1 id="desk-runners" className="m-0 font-display text-title uppercase">
        Runners
      </h1>
      <Bracketed step="xs">{`${String(total)} accounts`}</Bracketed>
      <Search filter={filter} flagged={flagged} />
      <div className="flex flex-col gap-6 desk:flex-row">
        <table className="flex-1 text-left">
          <thead>
            <tr>
              {["Handle", "Email", "Joined", "Runs", "Reports", "State"].map(
                (heading) => (
                  <th key={heading} scope="col">
                    <Mono step="xs" className="text-muted">
                      {heading}
                    </Mono>
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {runners.map((runner) => (
              <RunnerRow
                key={runner.userId}
                runner={runner}
                selected={runner.userId === selectedId}
                focusName={runner.userId === clearedId}
                onSelect={() => {
                  setSelectedId(runner.userId);
                }}
              />
            ))}
          </tbody>
        </table>
        {selected === undefined ? (
          <p className="text-small text-quiet">
            Pick a runner to rename or close.
          </p>
        ) : (
          <RunnerPanels
            runner={selected}
            acts={acts}
            onDone={refresh}
            onCleared={(userId) => {
              setCleared({ userId, among: runners });
              refresh();
            }}
          />
        )}
      </div>
    </section>
  );
}
