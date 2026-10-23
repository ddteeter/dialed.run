import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import { Bracketed, ListSection, Mono, useFormSubmit } from "../../../ui";
import type {
  CopyrightHoldSummary,
  CounterNoticeOutcome,
  CourtActionOutcome,
} from "../copyright-holds";
import { copyrightHoldInput } from "../inputs";
import { DeskForm } from "./DeskForm";

type HoldAct<R> = (input: { data: { holdId: string } }) => Promise<R>;

/**
 * Review's copyright holds (D-130, design 148): what a copyright takedown
 * is keeping hidden, soonest deletion first, with the runner's strikes
 * and the notice it answered. "Counter-notice received" records today
 * and the day the material comes back; once it is recorded, "Court action
 * filed" cancels that. Undesigned: existing parts and placeholder words
 * (design deltas).
 */
export function CopyrightHolds({
  holds,
  counterNotice,
  courtAction,
}: Readonly<{
  holds: readonly CopyrightHoldSummary[];
  counterNotice: HoldAct<CounterNoticeOutcome>;
  courtAction: HoldAct<CourtActionOutcome>;
}>): JSX.Element | undefined {
  return (
    <ListSection
      title={`Copyright holds · ${String(holds.length)}`}
      items={holds}
    >
      {(hold) => (
        <HoldRow
          key={hold.id}
          hold={hold}
          counterNotice={counterNotice}
          courtAction={courtAction}
        />
      )}
    </ListSection>
  );
}

/**
Where the hold stands, in a line: what the sweep will do, and when.
*/
export function holdState(hold: CopyrightHoldSummary): string {
  if (hold.courtActionAt !== null) {
    return `court action ${monthDayLabel(hold.courtActionAt)}: stays hidden, deleted ${monthDayLabel(hold.purgeAt)}`;
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
  recorded: "Court action recorded. It stays hidden.",
  already: "A court action is already recorded.",
  no_counter_notice: "Record the counter-notice first.",
  gone: "This hold is settled: put back or deleted.",
};

function HoldRow({
  hold,
  counterNotice,
  courtAction,
}: Readonly<{
  hold: CopyrightHoldSummary;
  counterNotice: HoldAct<CounterNoticeOutcome>;
  courtAction: HoldAct<CourtActionOutcome>;
}>): JSX.Element {
  // The row as the last action left it, so a recording shows at once.
  const [held, setHeld] = useState(hold);
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
      {nextAction(held, {
        counter: (
          <HoldAction
            holdId={held.id}
            label="Counter-notice received"
            sentences={COUNTER_NOTICE}
            act={counterNotice}
            onRecorded={(result) => {
              setHeld({ ...held, ...result });
            }}
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
          />
        ),
      })}
    </li>
  );
}

/**
 * The one action a hold still takes: the counter-notice until there is
 * one, then the court action until there is one, then none.
 */
function nextAction(
  held: CopyrightHoldSummary,
  actions: Readonly<{ counter: JSX.Element; court: JSX.Element }>,
): JSX.Element | undefined {
  if (held.counterNoticeAt === null) return actions.counter;
  if (held.courtActionAt === null) return actions.court;
  return undefined;
}

/**
 * One Desk action on a hold: a form with no fields but the hold, so it
 * fails, retries and announces as every Desk form does. An answer other
 * than `recorded` is said under it, and changes nothing.
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
}: Readonly<{
  holdId: string;
  label: string;
  sentences: Readonly<Record<K | "recorded", string>>;
  act: HoldAct<R>;
  onRecorded: (result: R) => void;
}>): JSX.Element {
  const [said, setSaid] = useState("");
  const form = useFormSubmit({
    schema: copyrightHoldInput,
    action: (values) => act({ data: values }),
    successMessage: sentences.recorded,
    refusal: {
      matches: (result) => result.outcome !== "recorded",
      answer: (result) => {
        setSaid(sentences[result.outcome]);
      },
    },
    onSuccess: onRecorded,
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
      {said === "" ? undefined : <p className="text-body">{said}</p>}
    </DeskForm>
  );
}
