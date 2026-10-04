import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  Bracketed,
  ControlFailureBand,
  FormStatus,
  Mono,
  TextField,
  inFlight,
  useControlAction,
  useFormSubmit,
} from "../../../ui";
import {
  renameReasonSchema,
  renameReasons,
  type RenameReason,
} from "../contracts";
import { banUserInput, forceRenameInput } from "../inputs";
import type { RenameOutcome } from "../rename";
import type { DeskRunner, RunnersFilter } from "../runners";
import { DeskForm, PickOne } from "./DeskForm";

/**
 * Desk · Runners, "D8" (round 27 #22). A search and three filters over a
 * table of every account; a row click selects, and the selected runner's
 * right column holds Rename (#16) and then Close account (D3's ban panel,
 * moved here from the entry view). **There is no separate runner page.**
 */

type Rename = (input: {
  data: { userId: string; nameReason: RenameReason };
}) => Promise<RenameOutcome>;
type Ban = (input: {
  data: { userId: string; reason: string };
}) => Promise<unknown>;
type Unban = (input: { data: { userId: string } }) => Promise<unknown>;

const FILTERS: readonly { value: RunnersFilter["filter"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "closed", label: "Closed" },
];

export const RENAME_LABELS: Readonly<Record<RenameReason, string>> =
  Object.fromEntries(renameReasons.map((reason) => [reason, reason])) as Record<
    RenameReason,
    string
  >;

/**
What the operator is told after a Rename.
*/
export function renameMessage(outcome: RenameOutcome): string {
  if (outcome.kind === "renamed") return `Renamed to @${outcome.username}.`;
  if (outcome.kind === "taken") {
    return "That placeholder is taken. Press Rename again.";
  }
  return "This runner has no handle to take away.";
}

function joinedLabel(joinedAt: number): string {
  return new Date(joinedAt * 1000).toISOString().slice(0, 10);
}

function Search({ filter }: Readonly<{ filter: RunnersFilter }>): JSX.Element {
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
}: Readonly<{
  runner: DeskRunner;
  selected: boolean;
  onSelect: () => void;
}>): JSX.Element {
  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      className="cursor-pointer border-b border-hairline"
    >
      <td>
        <button type="button" className="target text-left" onClick={onSelect}>
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
        <Bracketed step="xs">{runner.state}</Bracketed>
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
  const [said, setSaid] = useState("");
  const form = useFormSubmit({
    schema: forceRenameInput,
    action: (values) => rename({ data: values }),
    onSuccess: (outcome) => {
      setSaid(renameMessage(outcome));
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
      {said === "" ? undefined : <p className="text-body">{said}</p>}
    </DeskForm>
  );
}

function CloseAccountPanel({
  runner,
  act: ban,
  onDone,
}: Readonly<PanelProps<Ban>>): JSX.Element {
  const [reason, setReason] = useState("");
  const form = useFormSubmit({
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
        void form.submit({ userId: runner.userId, reason });
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
    </DeskForm>
  );
}

function ReopenPanel({
  runner,
  act: unban,
  onDone,
}: Readonly<PanelProps<Unban>>): JSX.Element {
  const reopen = useControlAction({
    action: () => unban({ data: { userId: runner.userId } }),
    kicker: "Still closed",
    onSuccess: onDone,
  });
  return (
    <section className="flex flex-col gap-3 border border-hairline p-4">
      <h2 className="m-0">
        <Mono step="xs">Account closed</Mono>
      </h2>
      <p className="text-body">{runner.banReason ?? "No reason recorded."}</p>
      <FormStatus>{reopen.status}</FormStatus>
      <button
        type="button"
        {...inFlight(reopen.pending)}
        className="target text-left"
        onClick={() => {
          void reopen.run();
        }}
      >
        <Mono step="xs">Reopen account</Mono>
      </button>
      <ControlFailureBand
        failure={reopen.failure}
        onRetry={reopen.retry}
        retryRef={reopen.retryRef}
      />
    </section>
  );
}

export function DeskRunners({
  runners,
  total,
  filter,
  rename,
  ban,
  unban,
}: Readonly<{
  runners: readonly DeskRunner[];
  total: number;
  filter: RunnersFilter;
  rename: Rename;
  ban: Ban;
  unban: Unban;
}>): JSX.Element {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | undefined>();
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
      <Search filter={filter} />
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
          <aside
            aria-label={`@${selected.username ?? selected.email}`}
            className="flex flex-col gap-4 desk:w-[var(--container-column)]"
          >
            <RenamePanel
              key={`rename-${selected.userId}`}
              runner={selected}
              act={rename}
              onDone={refresh}
            />
            {selected.state === "CLOSED" ? (
              <ReopenPanel runner={selected} act={unban} onDone={refresh} />
            ) : (
              <CloseAccountPanel
                key={`close-${selected.userId}`}
                runner={selected}
                act={ban}
                onDone={refresh}
              />
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
