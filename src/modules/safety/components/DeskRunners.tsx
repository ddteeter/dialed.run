import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import {
  Bracketed,
  CHALK_PILL,
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
import type { DeskRunner, RunnerCounts, RunnersFilter } from "../runners";
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

const FILTER_LABEL: Readonly<Record<RunnersFilter["filter"], string>> =
  Object.fromEntries(
    FILTERS.map(({ value, label }) => [value, label]),
  ) as Record<RunnersFilter["filter"], string>;

/**
 * The line beside the title (round 28 #8): every account, newest first,
 * until a search or a filter narrows it, then how many match and where. A
 * filter alone counts the whole table; a search counts what it found.
 */
export function metaLine(
  filter: RunnersFilter,
  found: number,
  counts: RunnerCounts,
): string {
  const query = filter.query ?? "";
  if (query === "" && filter.filter === "all") {
    return `${String(counts.all)} accounts · newest first`;
  }
  const matched = query === "" ? counts[filter.filter] : found;
  const among =
    filter.filter === "all" ? "" : ` in ${FILTER_LABEL[filter.filter]}`;
  return `${String(matched)} match${among}`;
}

/**
Round 28 #8: text links, the current one ink, semibold and underlined.
*/
const FILTER_CLASS =
  "target inline-flex items-center gap-1 px-2 text-body text-quiet";
const CURRENT_FILTER_CLASS =
  "target inline-flex items-center gap-1 px-2 text-body font-semibold text-ink underline underline-offset-4";

function Search({
  filter,
  counts,
}: Readonly<{ filter: RunnersFilter; counts: RunnerCounts }>): JSX.Element {
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
      <label className="flex flex-col gap-2">
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
          className="min-h-field rounded-field border border-hairline bg-ground px-4 text-field"
        />
      </label>
      <nav aria-label="Filter runners" className="-mx-2 flex flex-wrap">
        {FILTERS.map((option) => (
          <Link
            key={option.value}
            to="/desk/runners"
            search={{ query: filter.query, filter: option.value }}
            aria-current={option.value === filter.filter ? "page" : undefined}
            className={
              option.value === filter.filter
                ? CURRENT_FILTER_CLASS
                : FILTER_CLASS
            }
          >
            {option.label}{" "}
            <Bracketed step="xs">{String(counts[option.value])}</Bracketed>
          </Link>
        ))}
      </nav>
    </form>
  );
}

/**
 * A runner's state, and a hi-viz FLAGGED beside it while a flag is open,
 * each kept whole on its line (168.3: MONO.sm brackets).
 */
function StateTags({ runner }: Readonly<{ runner: DeskRunner }>): JSX.Element {
  return (
    <span className="flex gap-2 whitespace-nowrap">
      <Bracketed step="sm">{runner.state}</Bracketed>
      {runner.flaggedAt === undefined ? undefined : (
        <Bracketed step="sm" className="text-hiviz-text">
          Flagged
        </Bracketed>
      )}
    </span>
  );
}

/**
How the table names a runner: their handle, or a dash when they have none.
*/
function handleOf(runner: DeskRunner): string {
  return runner.username === undefined ? "—" : `@${runner.username}`;
}

/**
 * Round 54 · 168.3: every cell one line. Handles and emails truncate, with
 * the whole value in a title and in the pane; numbers right-align. Below
 * `wide` (not drawn; a guess) the email sits under the handle, and Joined
 * and Runs are left to the pane, so the columns the filters are about
 * stay on screen.
 */
const CELL = "px-3 py-3 align-baseline";
const NUMBER_CELL = `${CELL} text-right`;
const WIDE_CELL = "max-wide:hidden";

const COLUMNS: readonly { heading: string; className: string }[] = [
  { heading: "Handle", className: CELL },
  { heading: "Email", className: `${CELL} ${WIDE_CELL}` },
  { heading: "Joined", className: `${CELL} ${WIDE_CELL}` },
  { heading: "Runs", className: `${NUMBER_CELL} ${WIDE_CELL}` },
  { heading: "Reports", className: NUMBER_CELL },
  { heading: "State", className: CELL },
];

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
  const handle = handleOf(runner);
  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      // Round 27 #22: the picked row takes the panel's fill and a hi-viz
      // bar at its left edge.
      className="group cursor-pointer border-b border-hairline aria-selected:bg-panel"
    >
      <td
        className={`${CELL} w-full max-w-0 border-l-3 border-transparent group-aria-selected:border-hi-viz wide:w-1/4`}
      >
        <button
          ref={nameRef}
          type="button"
          title={handle}
          className="target block w-full truncate text-left font-semibold"
          onClick={onSelect}
        >
          {handle}
        </button>
        <span
          title={runner.email}
          className="block truncate text-small text-quiet wide:hidden"
        >
          {runner.email}
        </span>
      </td>
      <td
        title={runner.email}
        className={`${CELL} ${WIDE_CELL} w-1/3 max-w-0 truncate`}
      >
        {runner.email}
      </td>
      <td className={`${CELL} ${WIDE_CELL} whitespace-nowrap`}>
        <Mono step="md">{joinedLabel(runner.joinedAt)}</Mono>
      </td>
      <td className={`${NUMBER_CELL} ${WIDE_CELL}`}>
        <Mono step="md">{String(runner.runs)}</Mono>
      </td>
      <td className={NUMBER_CELL}>
        <Mono step="md">{String(runner.reports)}</Mono>
      </td>
      <td className={CELL}>
        <StateTags runner={runner} />
      </td>
    </tr>
  );
}

/**
 * Where the first row would be when nothing matches: round 28 #8's words
 * for a search, and "Nobody in {Filter}." for a filter alone (owner,
 * 2026-11-12).
 */
function NoRunners({
  filter,
}: Readonly<{ filter: RunnersFilter }>): JSX.Element {
  const query = filter.query ?? "";
  return (
    <tr>
      <td colSpan={COLUMNS.length} className={CELL}>
        {query === "" ? (
          <p className="m-0 text-body">{`Nobody in ${FILTER_LABEL[filter.filter]}.`}</p>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="text-body">{`No runner matches "${query}".`}</span>
            <span className="text-small text-quiet">
              Search by handle without the @, or by the whole email.
            </span>
          </span>
        )}
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

const CLOSE_LABELS = { reason: "Why", rule: "Which rule it breaks" } as const;

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
    // The error summary names each field as it is labelled on screen.
    labels: CLOSE_LABELS,
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
        label={CLOSE_LABELS.reason}
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
        label={CLOSE_LABELS.rule}
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
        // R47·124: Keep account is an outline pill, beside Close account's
        // chalk below. Reopen is the closed runner's one action, so it is
        // the chalk pill (round 44 #104).
        className={isFlag ? `target ${QUIET_PILL}` : `target ${CHALK_PILL}`}
        onClick={() => {
          void control.run();
        }}
      >
        {words.button}
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
 * Round 54 · 168.3: the detail pane, sticky beside the table from `desk`
 * and under it below that.
 */
const PANE_CLASS =
  "flex flex-col gap-4 rounded-card border border-hairline bg-panel p-5 desk:sticky desk:top-6";

/**
 * Whose panels these are (round 27 #22, 168.3): the whole handle and
 * email the table may have cut short, the state, and the counts.
 */
function RunnerHead({ runner }: Readonly<{ runner: DeskRunner }>): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-heading font-bold wrap-anywhere">
        {handleOf(runner)}
      </p>
      <span className="text-small text-quiet wrap-anywhere">
        {runner.email}
      </span>
      <StateTags runner={runner} />
      <Mono step="xs" className="text-muted">
        {`${counted(runner.runs, "run")} · ${counted(runner.reports, "report")} on name · joined ${joinedLabel(runner.joinedAt)}`}
      </Mono>
    </div>
  );
}

/**
"1 run", "14 runs".
*/
function counted(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
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
      className={PANE_CLASS}
    >
      <RunnerHead runner={runner} />
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
  counts,
  filter,
  ...acts
}: Readonly<{
  runners: readonly DeskRunner[];
  filter: RunnersFilter;
  /**
  Every filter's whole-table count (round 28 #8; Flagged's per R47·124).
  */
  counts: RunnerCounts;
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
      <span className="flex flex-wrap items-baseline gap-3">
        <h1 id="desk-runners" className="m-0 font-display text-title uppercase">
          Runners
        </h1>
        <Bracketed step="sm" className="text-muted">
          {metaLine(filter, runners.length, counts)}
        </Bracketed>
      </span>
      <Search filter={filter} counts={counts} />
      {/* 168.3: the table and a pane beside it from `desk` (the ruling's
          1280 and 320 collapsed to the scale: a 2fr/1fr track), the pane
          under the table below that. `items-start` keeps a tall pane from
          stretching the rows (P3-08). */}
      <div className="grid items-start gap-6 desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline">
              {COLUMNS.map(({ heading, className }) => (
                <th key={heading} scope="col" className={className}>
                  <Mono step="xs" className="text-muted">
                    {heading}
                  </Mono>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runners.length === 0 ? <NoRunners filter={filter} /> : undefined}
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
          <p className="m-0 text-small text-quiet">
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
