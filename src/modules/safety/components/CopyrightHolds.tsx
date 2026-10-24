import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import { Bracketed, ListSection, Mono, useFormSubmit } from "../../../ui";
import type {
  CaseOverOutcome,
  CopyrightHoldSummary,
  CounterNoticeOutcome,
  CourtActionOutcome,
} from "../copyright-holds";
import { copyrightHoldInput } from "../inputs";
import { DeskForm } from "./DeskForm";

type HoldAct<R> = (input: { data: { holdId: string } }) => Promise<R>;

/**
The Desk's four actions on a hold, each a server function the route wires.
*/
interface HoldActs {
  readonly counterNotice: HoldAct<CounterNoticeOutcome>;
  readonly courtAction: HoldAct<CourtActionOutcome>;
  readonly caseOverDelete: HoldAct<CaseOverOutcome>;
  readonly caseOverRestore: HoldAct<CaseOverOutcome>;
}

/**
 * Review's copyright holds (D-130, design 149): what a copyright takedown
 * is keeping hidden, soonest deletion first, with the runner's strikes
 * and the notice it answered. "Counter-notice received" records today
 * and the day the material comes back; once it is recorded, "Court action
 * filed" cancels that and holds it until the case ends (D-146), when
 * "Case over: delete" or "Case over: restore" settles it. Undesigned:
 * existing parts and placeholder words (design deltas).
 */
export function CopyrightHolds({
  holds,
  ...acts
}: Readonly<{ holds: readonly CopyrightHoldSummary[] } & HoldActs>):
  JSX.Element | undefined {
  return (
    <ListSection
      title={`Copyright holds · ${String(holds.length)}`}
      items={holds}
    >
      {(hold) => <HoldRow key={hold.id} hold={hold} {...acts} />}
    </ListSection>
  );
}

/**
Where the hold stands, in a line: what the sweep will do, and when.
*/
export function holdState(hold: CopyrightHoldSummary): string {
  if (hold.courtActionAt !== null) {
    return `court action ${monthDayLabel(hold.courtActionAt)}: held until the case is over`;
  }
  if (hold.restoreAt !== null) {
    return `counter-notice received: back ${monthDayLabel(hold.restoreAt)}`;
  }
  return `no counter-notice: deleted ${monthDayLabel(hold.purgeAt)}`;
}

const COUNTER_NOTICE: Readonly<
  Record<CounterNoticeOutcome["outcome"], string>
> = {
  recorded: "Counter-notice recorded.",
  already: "A counter-notice is already recorded.",
  gone: "This hold is settled: put back or deleted.",
};

const COURT_ACTION: Readonly<Record<CourtActionOutcome["outcome"], string>> = {
  recorded: "Court action recorded. It stays hidden until the case is over.",
  already: "A court action is already recorded.",
  no_counter_notice: "Record the counter-notice first.",
  gone: "This hold is settled: put back or deleted.",
};

const CASE_OVER_DELETE: Readonly<Record<CaseOverOutcome["outcome"], string>> = {
  recorded: "Case over. It is deleted.",
  not_held: "Record the court action first.",
  gone: "This hold is settled: put back or deleted.",
};

const CASE_OVER_RESTORE: Readonly<Record<CaseOverOutcome["outcome"], string>> =
  {
    recorded: "Case over. It is back.",
    not_held: "Record the court action first.",
    gone: "This hold is settled: put back or deleted.",
  };

function HoldRow({
  hold,
  counterNotice,
  courtAction,
  caseOverDelete,
  caseOverRestore,
}: Readonly<{ hold: CopyrightHoldSummary } & HoldActs>): JSX.Element {
  // The row as the last action left it, so a recording shows at once.
  const [held, setHeld] = useState(hold);
  const [said, setSaid] = useState("");
  // A case over settles the hold: the row keeps its sentence, no action.
  const [isSettled, setIsSettled] = useState(false);
  const settle = (): void => {
    setIsSettled(true);
  };
  return (
    <li
      data-part="copyright-hold"
      className="flex flex-col gap-3 border-b border-hairline py-4"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body font-semibold text-ink">
          {held.subjectType} <Mono step="xs">{held.subjectId}</Mono>
        </span>
        <span data-part="hidden-at" className="text-ink uppercase">
          <Mono step="xs">Hidden {monthDayLabel(held.hiddenAt)}</Mono>
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span data-part="owner" className="text-micro text-quiet">
          <Mono step="xs">
            Owner {held.ownerId} · strikes {String(held.strikes)}
          </Mono>
        </span>
        <span data-part="notice" className="text-micro text-ink">
          {held.notice}
        </span>
        <span data-part="hold-state" className="text-micro text-ink">
          <Bracketed>{holdState(held)}</Bracketed>
        </span>
      </span>
      {nextAction(held, isSettled, {
        counter: (
          <HoldAction
            holdId={held.id}
            label="Counter-notice received"
            sentences={COUNTER_NOTICE}
            act={counterNotice}
            onRecorded={(result) => {
              setHeld({ ...held, ...result });
            }}
            onSaid={setSaid}
          />
        ),
        court: (
          <HoldAction
            holdId={held.id}
            label="Court action filed"
            sentences={COURT_ACTION}
            act={courtAction}
            onRecorded={(result) => {
              setHeld({ ...held, ...result });
            }}
            onSaid={setSaid}
          />
        ),
        caseOver: (
          <span data-part="case-over" className="flex flex-wrap gap-4">
            <HoldAction
              holdId={held.id}
              label="Case over: delete"
              sentences={CASE_OVER_DELETE}
              act={caseOverDelete}
              onRecorded={settle}
              onSaid={setSaid}
            />
            <HoldAction
              holdId={held.id}
              label="Case over: restore"
              sentences={CASE_OVER_RESTORE}
              act={caseOverRestore}
              onRecorded={settle}
              onSaid={setSaid}
            />
          </span>
        ),
      })}
      {said === "" ? undefined : (
        <p data-part="hold-said" className="text-body">
          {said}
        </p>
      )}
    </li>
  );
}

/**
 * What a hold still takes: the counter-notice until there is one, then
 * the court action until there is one, then the two ways a case ends
 * until one of them has (D-146).
 */
function nextAction(
  held: CopyrightHoldSummary,
  isSettled: boolean,
  actions: Readonly<{
    counter: JSX.Element;
    court: JSX.Element;
    caseOver: JSX.Element;
  }>,
): JSX.Element | undefined {
  if (held.counterNoticeAt === null) return actions.counter;
  if (held.courtActionAt === null) return actions.court;
  return isSettled ? undefined : actions.caseOver;
}

/**
 * One Desk action on a hold: a form with no fields but the hold, so it
 * fails, retries and announces as every Desk form does. Whatever it
 * answered is `said` to the row, which keeps the sentence after a
 * recording has moved the row on to its next action, or to none.
 */
function HoldAction<
  K extends string,
  R extends { readonly outcome: K | "recorded" },
>({
  holdId,
  label,
  sentences,
  act,
  onRecorded,
  onSaid,
}: Readonly<{
  holdId: string;
  label: string;
  sentences: Readonly<Record<K | "recorded", string>>;
  act: HoldAct<R>;
  onRecorded: (result: R) => void;
  onSaid: (sentence: string) => void;
}>): JSX.Element {
  const form = useFormSubmit({
    schema: copyrightHoldInput,
    action: (values) => act({ data: values }),
    successMessage: sentences.recorded,
    refusal: {
      matches: (result) => result.outcome !== "recorded",
      answer: (result) => {
        onSaid(sentences[result.outcome]);
      },
    },
    onSuccess: (result) => {
      onSaid(sentences.recorded);
      onRecorded(result);
    },
  });
  return (
    <DeskForm
      form={form}
      className="flex flex-col gap-4"
      onSubmit={() => {
        void form.submit({ holdId });
      }}
      submit={{ label, pendingLabel: "Recording" }}
    >
      {undefined}
    </DeskForm>
  );
}
